import json
import logging
import uuid
from collections.abc import Iterable
from contextlib import asynccontextmanager
from pathlib import Path, PureWindowsPath
from typing import NamedTuple

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from geoalchemy2.elements import WKTElement
from sqlalchemy import Select, func, select, text, union
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, selectinload

from .database import SessionLocal, get_db, initialize_database
from .models import CATEGORIES, Artifact, MapFeature, Passage, Place
from .schemas import ArtifactDetailOut, ArtifactOut, FacetsOut, MapOut, SearchHitOut
from .search import Candidate, rerank
from .settings import CORS_ORIGINS, MAX_UPLOAD_BYTES, UPLOAD_DIR
from .worker import celery_app, process_artifact
from ml.pipeline import embed_text

@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    yield


app = FastAPI(title="SthalaSutra API", version="0.3.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_credentials=False, allow_methods=["*"], allow_headers=["*"])
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
logger = logging.getLogger(__name__)

ALLOWED_SUFFIXES = {"image/jpeg": {".jpg", ".jpeg"}, "image/png": {".png"},
                    "image/webp": {".webp"}, "application/pdf": {".pdf"}}
SEARCH_CANDIDATES_PER_RESULT = 5


class PageSummary(NamedTuple):
    page_count: int
    original_text: str | None
    translated_text: str | None


NO_PAGES = PageSummary(0, None, None)


def apply_filters(stmt: Select, region: str | None, category: str | None, era: str | None,
                  region_column=Place.region) -> Select:
    """Shared region/category/era filters. The caller must already join the tables the columns belong to."""
    if region:
        stmt = stmt.where(region_column.ilike(f"%{region}%"))
    if category:
        stmt = stmt.where(Artifact.category == category)
    if era:
        stmt = stmt.where(Artifact.era.ilike(f"%{era}%"))
    return stmt


def page_summaries_statement(artifact_ids: Iterable[uuid.UUID]) -> Select:
    """First page text and total page count per artifact, without loading embeddings.

    DISTINCT ON keeps the first row per artifact_id in ORDER BY order (lowest page_number);
    the window count is computed over all of that artifact's passages before DISTINCT ON runs.
    """
    page_count = func.count().over(partition_by=Passage.artifact_id)
    return (select(Passage.artifact_id, page_count, Passage.original_text, Passage.translated_text)
            .where(Passage.artifact_id.in_(list(artifact_ids)))
            .distinct(Passage.artifact_id)
            .order_by(Passage.artifact_id, Passage.page_number))


def load_page_summaries(db: Session, artifact_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, PageSummary]:
    ids = set(artifact_ids)
    if not ids:
        return {}
    return {artifact_id: PageSummary(count, original, translated)
            for artifact_id, count, original, translated in db.execute(page_summaries_statement(ids))}


def artifact_payload(row: Artifact, summary: PageSummary = NO_PAGES) -> dict:
    """ArtifactOut dict. `row.place` must already be loaded (selectinload or assignment)."""
    place = row.place
    return {"id": row.id, "title": row.title, "original_filename": row.original_filename, "media_type": row.media_type,
            "category": row.category, "era": row.era, "language": row.language, "status": row.status,
            "progress": row.progress, "error_message": row.error_message,
            "latitude": row.latitude, "longitude": row.longitude, "created_at": row.created_at,
            "place": {"id": place.id, "name": place.name, "region": place.region} if place else None,
            "original_text": summary.original_text, "translated_text": summary.translated_text,
            "page_count": summary.page_count, "image_url": f"/uploads/{row.storage_path}",
            "preview_url": f"/uploads/{row.preview_path}" if row.preview_path else None}


def artifact_payloads(db: Session, rows: list[Artifact]) -> list[dict]:
    summaries = load_page_summaries(db, (row.id for row in rows))
    return [artifact_payload(row, summaries.get(row.id, NO_PAGES)) for row in rows]


@app.get("/health")
def health():
    """Liveness check: this process is accepting requests."""
    return {"status": "ok"}


@app.get("/ready")
def ready():
    """Readiness check: database and background job broker are available."""
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
        with celery_app.connection_for_read() as connection:
            connection.ensure_connection(max_retries=0)
    except Exception as exc:
        logger.warning("Readiness check failed: %s", exc)
        raise HTTPException(status_code=503, detail="Database or background queue is unavailable.") from exc
    return {"status": "ready"}


def _matches_signature(content: bytes, media_type: str) -> bool:
    signatures = {
        "image/jpeg": lambda data: data.startswith(b"\xff\xd8\xff"),
        "image/png": lambda data: data.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/webp": lambda data: len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP",
        "application/pdf": lambda data: data.startswith(b"%PDF-"),
    }
    matcher = signatures.get(media_type)
    return bool(matcher and matcher(content))


def _clean(value: str | None) -> str | None:
    """Strip whitespace; blank strings become None."""
    value = (value or "").strip()
    return value or None


def get_or_create_place(db: Session, name: str, region: str | None,
                        latitude: float | None, longitude: float | None) -> Place:
    place = db.scalar(select(Place).where(func.lower(Place.name) == name.lower()))
    if place:
        return place
    geom = WKTElement(f"POINT({longitude} {latitude})", srid=4326) if latitude is not None else None
    # Two concurrent uploads can both miss the lookup above. ON CONFLICT DO NOTHING lets the
    # second insert wait for the first and then skip, instead of failing on the UNIQUE constraint.
    db.execute(insert(Place).values(id=uuid.uuid4(), name=name, region=region, geom=geom)
               .on_conflict_do_nothing(index_elements=["name"]))
    return db.scalars(select(Place).where(Place.name == name)).one()


# A plain `def` (not `async def`): FastAPI runs it in a worker thread, so the blocking
# file write and synchronous SQLAlchemy calls do not stall the event loop.
@app.post("/api/artifacts", response_model=ArtifactOut)
def upload_artifact(file: UploadFile = File(...), title: str | None = Form(None), category: str = Form("other"),
                    era: str | None = Form(None), place_name: str | None = Form(None), region: str | None = Form(None),
                    latitude: float | None = Form(None), longitude: float | None = Form(None),
                    db: Session = Depends(get_db)):
    if file.content_type not in ALLOWED_SUFFIXES:
        raise HTTPException(415, "Upload a JPEG, PNG, WebP image, or PDF.")
    if (latitude is None) != (longitude is None) or (latitude is not None and not (-90 <= latitude <= 90 and -180 <= longitude <= 180)):
        raise HTTPException(422, "Provide both valid latitude and longitude values.")
    content = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File exceeds the 25 MB upload limit.")
    if not content or not _matches_signature(content, file.content_type):
        raise HTTPException(415, "The file contents do not match the selected image or PDF type.")

    supplied_name = file.filename or "Archive item"
    safe_filename = PureWindowsPath(supplied_name).name.replace("\r", " ").replace("\n", " ").strip()[:512]
    suffix = Path(safe_filename).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES[file.content_type]:
        raise HTTPException(415, "The file extension does not match the selected image or PDF type.")
    category = category.strip().lower()
    if category not in CATEGORIES:
        raise HTTPException(422, "Choose a supported heritage type.")
    title = _clean(title) or _clean(Path(safe_filename).stem) or "Archive item"
    era, place_name, region = _clean(era), _clean(place_name), _clean(region)
    if len(title) > 300:
        raise HTTPException(422, "Title must contain 1–300 characters.")
    if era and len(era) > 120:
        raise HTTPException(422, "Era must be 120 characters or fewer.")
    if region and len(region) > 160:
        raise HTTPException(422, "Region must be 160 characters or fewer.")
    if place_name and len(place_name) > 240:
        raise HTTPException(422, "Place name must be 240 characters or fewer.")

    artifact_id = uuid.uuid4()
    stored_name = f"{artifact_id}{suffix}"
    (UPLOAD_DIR / stored_name).write_bytes(content)
    committed = False
    try:
        place = get_or_create_place(db, place_name, region, latitude, longitude) if place_name else None
        row = Artifact(id=artifact_id, title=title, original_filename=safe_filename or stored_name,
                       storage_path=stored_name, media_type=file.content_type, category=category,
                       era=era, status="queued", place=place, latitude=latitude, longitude=longitude)
        db.add(row)
        db.commit()
        committed = True
        db.refresh(row)
        try:
            process_artifact.delay(str(row.id))
        except Exception:
            logger.exception("Could not enqueue processing for artifact %s", row.id)
            row.status = "failed"
            row.error_message = "The processing queue is unavailable. Please try again later."
            db.commit()
        return artifact_payload(row)
    except Exception:
        db.rollback()
        if not committed:
            (UPLOAD_DIR / stored_name).unlink(missing_ok=True)
        raise


@app.get("/api/artifacts", response_model=list[ArtifactOut])
def list_artifacts(region: str | None = None, category: str | None = None, era: str | None = None,
                   limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0),
                   db: Session = Depends(get_db)):
    stmt = select(Artifact).outerjoin(Place, Artifact.place_id == Place.id).options(selectinload(Artifact.place))
    stmt = apply_filters(stmt, region, category, era)
    rows = list(db.scalars(stmt.order_by(Artifact.created_at.desc()).offset(offset).limit(limit)))
    return artifact_payloads(db, rows)


def _entities_payload(entities: dict | None) -> dict:
    """Stored entities JSON may predate a key, so read each one defensively."""
    entities = entities if isinstance(entities, dict) else {}
    return {"places": entities.get("places") or [], "dates": entities.get("dates") or [],
            "category": entities.get("category")}


@app.get("/api/artifacts/{artifact_id}", response_model=ArtifactDetailOut)
def get_artifact(artifact_id: uuid.UUID, db: Session = Depends(get_db)):
    row = db.scalar(select(Artifact).options(selectinload(Artifact.place)).where(Artifact.id == artifact_id))
    if not row:
        raise HTTPException(404, "Archive item not found")
    pages = db.execute(
        select(Passage.page_number, Passage.original_text, Passage.translated_text, Passage.entities)
        .where(Passage.artifact_id == artifact_id).order_by(Passage.page_number)
    ).all()
    summary = PageSummary(len(pages), pages[0].original_text, pages[0].translated_text) if pages else NO_PAGES
    return {**artifact_payload(row, summary),
            "pages": [{"page_number": page.page_number, "original_text": page.original_text,
                       "translated_text": page.translated_text, "entities": _entities_payload(page.entities)}
                      for page in pages]}


@app.get("/api/facets", response_model=FacetsOut)
def facets(db: Session = Depends(get_db)):
    """Filter options for the UI, taken from the data that actually exists."""
    regions = db.scalars(union(
        select(Place.region).where(func.trim(Place.region) != ""),
        select(MapFeature.region).where(func.trim(MapFeature.region) != ""),
    )).all()
    eras = db.scalars(select(Artifact.era).distinct().where(func.trim(Artifact.era) != "")).all()
    return {"regions": sorted(regions, key=str.casefold), "eras": sorted(eras, key=str.casefold),
            "categories": list(CATEGORIES)}


def _geography_point(longitude, latitude):
    """A WGS84 point as PostGIS geography, so distances are in metres on the globe."""
    return func.geography(func.ST_SetSRID(func.ST_MakePoint(longitude, latitude), 4326))


def search_candidates_statement(vector: list[float], region: str | None, category: str | None, era: str | None,
                                candidate_limit: int, lat: float | None = None, lon: float | None = None,
                                radius_km: float = 25) -> Select:
    """Nearest passages by cosine distance, filtered, optionally within radius_km of (lat, lon)."""
    distance = Passage.embedding.cosine_distance(vector)
    stmt = (select(Passage.artifact_id, Passage.page_number, Passage.original_text, Passage.translated_text,
                   distance.label("distance"))
            .join(Artifact, Passage.artifact_id == Artifact.id)
            .outerjoin(Place, Artifact.place_id == Place.id)
            .where(Passage.embedding.is_not(None)))
    stmt = apply_filters(stmt, region, category, era)
    if lat is not None and lon is not None:
        # The artifact's own coordinates win; otherwise fall back to its place's point.
        # ST_MakePoint returns NULL when the artifact has no coordinates, so COALESCE moves on.
        artifact_point = func.geography(func.coalesce(
            func.ST_SetSRID(func.ST_MakePoint(Artifact.longitude, Artifact.latitude), 4326), Place.geom))
        query_point = _geography_point(lon, lat)
        stmt = (stmt.where(func.ST_DWithin(artifact_point, query_point, radius_km * 1000))
                .add_columns((func.ST_Distance(artifact_point, query_point) / 1000).label("distance_km")))
    return stmt.order_by(distance).limit(candidate_limit)


@app.get("/api/search", response_model=list[SearchHitOut])
def search(q: str = Query(min_length=2, max_length=1000), region: str | None = None, category: str | None = None,
           era: str | None = None, limit: int = Query(20, ge=1, le=50),
           lat: float | None = Query(None, ge=-90, le=90), lon: float | None = Query(None, ge=-180, le=180),
           radius_km: float = Query(25, ge=1, le=500), db: Session = Depends(get_db)):
    # Validate before embedding: the embedding model call is the expensive part.
    if (lat is None) != (lon is None):
        raise HTTPException(422, "Provide both lat and lon, or neither.")
    vector = embed_text(q)
    candidate_limit = limit * SEARCH_CANDIDATES_PER_RESULT
    # An HNSW index scan returns at most hnsw.ef_search rows (default 40), which would
    # silently cap the candidate pool; raise it for this transaction only.
    db.execute(text("SELECT set_config('hnsw.ef_search', :value, true)"), {"value": str(max(40, candidate_limit))})
    rows = db.execute(search_candidates_statement(vector, region, category, era, candidate_limit, lat, lon, radius_km))
    candidates = [Candidate(artifact_id=row.artifact_id, page_number=row.page_number, original_text=row.original_text,
                            translated_text=row.translated_text, distance=float(row.distance),
                            distance_km=float(row.distance_km) if lat is not None else None)
                  for row in rows]
    hits = rerank(q, candidates, limit)

    artifact_ids = [hit.candidate.artifact_id for hit in hits]
    artifacts = {row.id: row for row in db.scalars(
        select(Artifact).options(selectinload(Artifact.place)).where(Artifact.id.in_(artifact_ids)))}
    summaries = load_page_summaries(db, artifact_ids)
    return [{"artifact": artifact_payload(artifacts[hit.candidate.artifact_id],
                                          summaries.get(hit.candidate.artifact_id, NO_PAGES)),
             "original_text": hit.candidate.original_text, "translated_text": hit.candidate.translated_text,
             "page_number": hit.candidate.page_number, "score": round(hit.score, 4),
             "semantic_score": round(hit.semantic_score, 4),
             "distance_km": round(hit.candidate.distance_km, 4) if hit.candidate.distance_km is not None else None}
            for hit in hits if hit.candidate.artifact_id in artifacts]  # skip items deleted mid-request


@app.get("/api/map", response_model=MapOut)
def map_items(region: str | None = None, category: str | None = None, era: str | None = None,
              db: Session = Depends(get_db)):
    latitude = func.coalesce(Artifact.latitude, func.ST_Y(Place.geom))
    longitude = func.coalesce(Artifact.longitude, func.ST_X(Place.geom))
    artifact_stmt = (select(Artifact, latitude, longitude)
                     .outerjoin(Place, Artifact.place_id == Place.id)
                     .options(selectinload(Artifact.place))
                     .where(Artifact.status == "ready", latitude.is_not(None), longitude.is_not(None)))
    artifact_rows = db.execute(apply_filters(artifact_stmt, region, category, era)).all()

    feature_stmt = (select(MapFeature.id, MapFeature.title, MapFeature.feature_type, MapFeature.description,
                           func.ST_AsGeoJSON(MapFeature.geom), Artifact)
                    .outerjoin(Artifact, MapFeature.artifact_id == Artifact.id)
                    .options(selectinload(Artifact.place)))
    feature_rows = db.execute(apply_filters(feature_stmt, region, category, era,
                                            region_column=MapFeature.region)).all()

    linked = [row[0] for row in artifact_rows] + [row[-1] for row in feature_rows if row[-1] is not None]
    summaries = load_page_summaries(db, (artifact.id for artifact in linked))

    def payload(artifact: Artifact) -> dict:
        return artifact_payload(artifact, summaries.get(artifact.id, NO_PAGES))

    return {"artifacts": [{"latitude": lat, "longitude": lng, "artifact": payload(artifact)}
                          for artifact, lat, lng in artifact_rows],
            "features": [{"id": feature_id, "title": title, "kind": kind, "description": description,
                          "geometry": json.loads(geojson), "artifact": payload(artifact) if artifact else None}
                         for feature_id, title, kind, description, geojson, artifact in feature_rows]}
