from celery import Celery

from .settings import BROKER_URL

celery_app = Celery("heritagelens", broker=BROKER_URL, backend=BROKER_URL)
celery_app.conf.update(task_track_started=True, task_acks_late=True, worker_prefetch_multiplier=1)


@celery_app.task(name="heritage.process_artifact", autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def process_artifact(artifact_id: str) -> None:
    from .pipeline import run_pipeline
    run_pipeline(artifact_id)
