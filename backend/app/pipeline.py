import logging
from datetime import datetime, timezone
from typing import NamedTuple
from uuid import UUID

from sqlalchemy import update

from .database import SessionLocal
from .models import Artifact, Passage, Place
from .settings import UPLOAD_DIR
from ml.pipeline import (ProcessingError, detect_language, embed_text, extract_entities, most_common_language,
                         ocr_document, translate_to_english)

logger = logging.getLogger(__name__)
INTERNAL_ERROR_MESSAGE = "Processing failed because of an internal error. Try uploading again."


class PageResult(NamedTuple):
    page_number: int
    original: str
    translated: str | None
    language: str
    entities: dict
    embedding: list[float]


def _set_progress(artifact_id: UUID, progress: str, preview_path: str | None = None) -> None:
    """Commit a progress line in its own short transaction so the UI's polling sees it now.

    This is a column-level UPDATE, so it never touches passages, and the main session
    (which never assigns `progress` until the end) cannot overwrite it with a stale value.
    """
    values: dict[str, str] = {"progress": progress[:120]}
    if preview_path:
        values["preview_path"] = preview_path
    with SessionLocal() as db:
        db.execute(update(Artifact).where(Artifact.id == artifact_id).values(**values))
        db.commit()


def run_pipeline(artifact_id: str) -> None:
    artifact_uuid = UUID(artifact_id)
    db = SessionLocal()
    try:
        artifact = db.get(Artifact, artifact_uuid)
        if not artifact:
            return
        artifact.status = "processing"
        artifact.error_message = None
        artifact.progress = "Starting"
        db.commit()
        known_places = [name for (name,) in db.query(Place.name).all()]
        db.commit()  # end the read transaction; OCR and translation can take minutes

        preview_name = f"{artifact.id}.preview.jpg"

        def report_page(number: int, total: int) -> None:
            _set_progress(artifact.id, f"Reading page {number} of {total}",
                          preview_path=preview_name if number == 1 else None)

        pages = ocr_document(UPLOAD_DIR / artifact.storage_path, on_page=report_page,
                             preview_to=UPLOAD_DIR / preview_name)
        if not pages:
            raise ProcessingError("No readable text was detected in this file.")

        # Do all slow model work first, then replace passages in one short transaction.
        results: list[PageResult] = []
        for index, (page_number, original) in enumerate(pages, start=1):
            language = detect_language(original)
            if language != "en":
                _set_progress(artifact.id, f"Translating page {index} of {len(pages)}")
            translated = translate_to_english(original, language)
            _set_progress(artifact.id, f"Indexing page {index} of {len(pages)}")
            searchable = original if translated in (None, original) else f"{original}\n{translated}"
            entities = extract_entities(searchable, known_places)
            results.append(PageResult(page_number, original, translated, language, entities, embed_text(searchable)))

        _set_progress(artifact.id, "Saving search index")
        db.query(Passage).filter(Passage.artifact_id == artifact.id).delete()
        for page in results:
            db.add(Passage(artifact_id=artifact.id, page_number=page.page_number, original_text=page.original,
                           translated_text=page.translated, entities=page.entities, embedding=page.embedding))
        dates = [date for page in results for date in page.entities["dates"]]
        categories = [page.entities["category"] for page in results if page.entities["category"]]
        places = list(dict.fromkeys(place for page in results for place in page.entities["places"]))
        artifact.language = most_common_language(page.language for page in results)
        if not artifact.era and dates:
            artifact.era = dates[0]
        if artifact.category == "other" and categories:
            artifact.category = categories[0]
        if not artifact.place and places:
            place = db.query(Place).filter(Place.name == places[0]).first()
            if place:
                artifact.place = place
        artifact.preview_path = preview_name
        artifact.progress = None
        artifact.status = "ready"
        artifact.processed_at = datetime.now(timezone.utc)
        db.commit()
    except Exception as exc:
        db.rollback()
        if isinstance(exc, ProcessingError):
            # Deliberate messages about the uploaded file; library ValueErrors stay internal.
            logger.warning("Artifact %s could not be processed: %s", artifact_id, exc)
            message = str(exc)[:800]
        else:
            # Driver and library errors can reveal internals, so keep them in the logs only.
            logger.exception("Processing failed for artifact %s", artifact_id)
            message = INTERNAL_ERROR_MESSAGE
        artifact = db.get(Artifact, artifact_uuid)
        if artifact:
            artifact.status = "failed"
            artifact.error_message = message
            artifact.progress = None
            db.commit()
        raise
    finally:
        db.close()
