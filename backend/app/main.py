import json
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, text
from geoalchemy2.elements import WKTElement

from .database import SessionLocal, initialize_database
from .models import Artifact, MapFeature, Passage, Place
from .schemas import ArtifactOut
from .settings import CORS_ORIGINS, MAX_UPLOAD_BYTES, UPLOAD_DIR
from .worker import process_artifact
from ml.pipeline import embed_text

app = FastAPI(title="HeritageLens API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


@app.on_event("startup")
def startup():
    initialize_database()


def artifact_payload(db, row: Artifact) -> dict:
    passage = db.query(Passage).filter(Passage.artifact_id == row.id).order_by(Passage.page_number).first()
    return {"id": row.id, "title": row.title, "original_filename": row.original_filename, "media_type": row.media_type,
            "category": row.category, "era": row.era, "language": row.language, "status": row.status,
            "error_message": row.error_message, "latitude": row.latitude, "longitude": row.longitude,
            "created_at": row.created_at, "place": row.place, "original_text": passage.original_text if passage else None,
            "translated_text": passage.translated_text if passage else None,
            "image_url": f"/uploads/{row.storage_path}"}


@app.get("/health")
def health():
    with SessionLocal() as db:
        db.execute(text("SELECT 1"))
    return {"status": "ok"}


@app.post("/api/artifacts", response_model=ArtifactOut)
async def upload_artifact(file: UploadFile = File(...), title: str | None = Form(None), category: str = Form("other"),
                          era: str | None = Form(None), place_name: str | None = Form(None), region: str | None = Form(None),
                          latitude: float | None = Form(None), longitude: float | None = Form(None)):
    allowed = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
    if file.content_type not in allowed:
        raise HTTPException(415, "Upload a JPEG, PNG, WebP image, or PDF.")
    if (latitude is None) != (longitude is None) or (latitude is not None and not (-90 <= latitude <= 90 and -180 <= longitude <= 180)):
        raise HTTPException(422, "Provide both valid latitude and longitude values.")
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File exceeds the 25 MB upload limit.")
    artifact_id = uuid.uuid4()
    suffix = Path(file.filename or "upload").suffix.lower()
    stored_name = f"{artifact_id}{suffix}"
    (UPLOAD_DIR / stored_name).write_bytes(content)
    db = SessionLocal()
    committed = False
    try:
        place = db.query(Place).filter(Place.name.ilike(place_name)).first() if place_name else None
        if place_name and not place:
            place = Place(name=place_name, region=region)
            if latitude is not None:
                place.geom = WKTElement(f"POINT({longitude} {latitude})", srid=4326)
            db.add(place)
            db.flush()
        row = Artifact(id=artifact_id, title=title or Path(file.filename or "Archive item").stem,
                       original_filename=file.filename or stored_name, storage_path=stored_name,
                       media_type=file.content_type or "application/octet-stream", category=category,
                       era=era, status="queued", place=place, latitude=latitude, longitude=longitude)
        db.add(row)
        db.commit()
        committed = True
        db.refresh(row)
        try:
            process_artifact.delay(str(row.id))
        except Exception as exc:
            row.status = "failed"
            row.error_message = f"Could not enqueue processing job: {str(exc)[:700]}"
            db.commit()
        return artifact_payload(db, row)
    except Exception:
        db.rollback()
        if not committed:
            (UPLOAD_DIR / stored_name).unlink(missing_ok=True)
        raise
    finally:
        db.close()


@app.get("/api/artifacts", response_model=list[ArtifactOut])
def list_artifacts(region: str | None = None, category: str | None = None, era: str | None = None,
                   limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    db = SessionLocal()
    try:
        query = db.query(Artifact).outerjoin(Place)
        if region:
            query = query.filter(Place.region.ilike(f"%{region}%"))
        if category:
            query = query.filter(Artifact.category == category)
        if era:
            query = query.filter(Artifact.era.ilike(f"%{era}%"))
        rows = query.order_by(Artifact.created_at.desc()).offset(offset).limit(limit).all()
        return [artifact_payload(db, row) for row in rows]
    finally:
        db.close()


@app.get("/api/artifacts/{artifact_id}", response_model=ArtifactOut)
def get_artifact(artifact_id: uuid.UUID):
    db = SessionLocal()
    try:
        row = db.get(Artifact, artifact_id)
        if not row:
            raise HTTPException(404, "Archive item not found")
        return artifact_payload(db, row)
    finally:
        db.close()


@app.get("/api/search")
def search(q: str = Query(min_length=2), region: str | None = None, category: str | None = None, era: str | None = None,
          limit: int = Query(20, ge=1, le=50)):
    vector = embed_text(q)
    db = SessionLocal()
    try:
        distance = Passage.embedding.cosine_distance(vector)
        query = db.query(Passage, Artifact).join(Artifact).outerjoin(Place, Artifact.place_id == Place.id).filter(Passage.embedding.is_not(None))
        if region:
            query = query.filter(Place.region.ilike(f"%{region}%"))
        if category:
            query = query.filter(Artifact.category == category)
        if era:
            query = query.filter(Artifact.era.ilike(f"%{era}%"))
        rows = query.add_columns(distance).order_by(distance).limit(limit).all()
        return [{"artifact": artifact_payload(db, artifact), "original_text": passage.original_text,
                 "translated_text": passage.translated_text, "page_number": passage.page_number,
                 "score": round(1 - float(distance_value), 4)}
                for passage, artifact, distance_value in rows]
    finally:
        db.close()


@app.get("/api/map")
def map_items(region: str | None = None, category: str | None = None, era: str | None = None):
    db = SessionLocal()
    try:
        query = db.query(Artifact, Place, func.ST_Y(Place.geom), func.ST_X(Place.geom)).join(Place, Artifact.place_id == Place.id).filter(Artifact.status == "ready")
        if region:
            query = query.filter(Place.region.ilike(f"%{region}%"))
        if category:
            query = query.filter(Artifact.category == category)
        if era:
            query = query.filter(Artifact.era.ilike(f"%{era}%"))
        rows = query.all()
        artifacts = [{"id": str(a.id), "title": a.title, "category": a.category, "era": a.era,
                      "latitude": a.latitude if a.latitude is not None else lat,
                      "longitude": a.longitude if a.longitude is not None else lng,
                      "place": p.name, "image_url": f"/uploads/{a.storage_path}",
                      "artifact": artifact_payload(db, a)} for a, p, lat, lng in rows]
        features_query = db.query(MapFeature, Artifact).outerjoin(Artifact, MapFeature.artifact_id == Artifact.id)
        if region:
            features_query = features_query.filter(MapFeature.region.ilike(f"%{region}%"))
        if category:
            features_query = features_query.filter(Artifact.category == category)
        if era:
            features_query = features_query.filter(Artifact.era.ilike(f"%{era}%"))
        features = [{"id": str(feature.id), "title": feature.title, "kind": feature.feature_type,
                     "description": feature.description, "geometry": json.loads(geojson),
                     "artifact": artifact_payload(db, artifact) if artifact else None}
                    for feature, artifact, geojson in features_query.add_columns(func.ST_AsGeoJSON(MapFeature.geom)).all()]
        return {"artifacts": artifacts, "features": features}
    finally:
        db.close()
