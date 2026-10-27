from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import text

from .database import SessionLocal
from .models import Artifact, Passage, Place
from .settings import UPLOAD_DIR
from ml.pipeline import detect_language, embed_text, extract_entities, ocr_document, translate_to_english


def run_pipeline(artifact_id: str) -> None:
    db = SessionLocal()
    try:
        artifact = db.get(Artifact, UUID(artifact_id))
        if not artifact:
            return
        artifact.status = "processing"
        artifact.error_message = None
        db.commit()
        pages = ocr_document(UPLOAD_DIR / artifact.storage_path)
        if not pages:
            raise ValueError("No readable text was detected in this file.")
        db.query(Passage).filter(Passage.artifact_id == artifact.id).delete()
        for page_number, original in pages:
            language = detect_language(original)
            translated = translate_to_english(original, language)
            entities = extract_entities(original)
            searchable = "\n".join(filter(None, (original, translated)))
            db.add(Passage(artifact_id=artifact.id, page_number=page_number, original_text=original,
                           translated_text=translated, entities=entities, embedding=embed_text(searchable)))
            artifact.language = language
            if not artifact.era and entities["dates"]:
                artifact.era = entities["dates"][0]
            if artifact.category == "other" and entities["category"]:
                artifact.category = entities["category"]
        joined = "\n".join(text_value for _, text_value in pages)
        detected = extract_entities(joined)["places"]
        if not artifact.place and detected:
            place = db.query(Place).filter(Place.name.ilike(f"%{detected[0]}%")).first()
            if place:
                artifact.place = place
        artifact.status = "ready"
        artifact.processed_at = datetime.now(timezone.utc)
        db.commit()
    except Exception as exc:
        db.rollback()
        artifact = db.get(Artifact, UUID(artifact_id))
        if artifact:
            artifact.status = "failed"
            artifact.error_message = str(exc)[:800]
            db.commit()
        raise
    finally:
        db.close()
