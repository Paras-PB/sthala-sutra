import logging
from uuid import UUID

from celery import Celery
from celery.exceptions import WorkerLostError
from celery.signals import task_failure
from sqlalchemy import update

from .database import SessionLocal, engine
from .models import Artifact
from .settings import BROKER_URL

logger = logging.getLogger(__name__)
WORKER_LOST_MESSAGE = "The worker ran out of resources while processing this file."

celery_app = Celery("sthalasutra", broker=BROKER_URL)
celery_app.conf.update(
    task_ignore_result=True,  # nothing reads task results; status lives in the artifacts table
    task_acks_late=True,
    # If the child process is killed (e.g. OOM), acknowledge the message instead of
    # requeueing it, so one oversized file cannot be redelivered forever and block the queue.
    task_reject_on_worker_lost=False,
    task_acks_on_failure_or_timeout=True,
    worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True,
    task_serializer="json",
    accept_content=["json"],
)


# The task name stays "heritage.process_artifact" so messages already in the queue still route.
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
                    status="queued", progress=None,
                    error_message=f"Processing failed; retry {self.request.retries + 1} is scheduled."
                ))
                db.commit()
            raise self.retry(exc=exc, countdown=min(2 ** (self.request.retries + 1), 300))
        raise


@task_failure.connect
def mark_artifact_failed_on_worker_loss(sender=None, exception=None, args=None, **_) -> None:
    """Mark the artifact failed when its worker child died mid-task.

    A killed child cannot run run_pipeline's own error handling, so Celery reports the
    WorkerLostError from the parent worker process, which is where this handler runs.
    """
    if not isinstance(exception, WorkerLostError) or getattr(sender, "name", None) != process_artifact.name or not args:
        return
    logger.error("Worker lost while processing artifact %s", args[0])
    with engine.begin() as conn:
        conn.execute(update(Artifact).where(Artifact.id == UUID(args[0])).values(
            status="failed", error_message=WORKER_LOST_MESSAGE, progress=None
        ))
    # The parent forks replacement children; don't let them inherit this pooled connection.
    engine.dispose()
