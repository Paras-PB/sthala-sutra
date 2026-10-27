from uuid import UUID

from celery import Celery
from sqlalchemy import update

from .database import SessionLocal
from .models import Artifact
from .settings import BROKER_URL

celery_app = Celery("heritagelens", broker=BROKER_URL, backend=BROKER_URL)
celery_app.conf.update(task_track_started=True, task_acks_late=True, worker_prefetch_multiplier=1)


@celery_app.task(bind=True, name="heritage.process_artifact", max_retries=3)
def process_artifact(self, artifact_id: str) -> None:
    from .pipeline import run_pipeline

    try:
        run_pipeline(artifact_id)
    except Exception as exc:
        # Invalid input and missing source files will not improve by retrying.
        if isinstance(exc, (ValueError, FileNotFoundError)):
            raise
        # Keep the user-visible state honest while Celery schedules another attempt.
        if self.request.retries < self.max_retries:
            with SessionLocal() as db:
                db.execute(update(Artifact).where(Artifact.id == UUID(artifact_id)).values(
                    status="queued", error_message=f"Processing failed; retry {self.request.retries + 1} is scheduled."
                ))
                db.commit()
            raise self.retry(exc=exc, countdown=min(2 ** (self.request.retries + 1), 300))
        raise
