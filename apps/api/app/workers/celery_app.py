"""Celery app for background AI tasks (M7).

We keep this module thin — the API process imports it solely to enqueue
work via `.delay()`, while the standalone worker process imports it as
its app factory. Tasks themselves live in `app.workers.tasks`.

Why a dedicated Celery process and not BackgroundTasks:
- AI extraction can take 30s+ for a long PDF; we don't want to hold an
  HTTP request open or starve a worker.
- Retries, dead-letter visibility, and concurrent worker scaling all live
  in Celery for free.
"""

from __future__ import annotations

from celery import Celery

from app.core.config import get_settings


def _build_app() -> Celery:
    s = get_settings()
    app = Celery(
        "beroe_awb",
        broker=s.celery_broker_url,
        backend=s.celery_result_backend,
        include=["app.workers.tasks"],
    )
    # Keep results small — payloads are stored in Postgres `jobs.result`.
    app.conf.update(
        task_serializer="json",
        result_serializer="json",
        accept_content=["json"],
        timezone="UTC",
        enable_utc=True,
        task_track_started=True,
        task_acks_late=True,                  # don't lose work on worker crash mid-task
        worker_prefetch_multiplier=1,         # AI tasks are CPU-light but I/O-heavy; keep one in flight per worker
        broker_connection_retry_on_startup=True,
        task_default_retry_delay=10,
        task_default_max_retries=2,
    )
    return app


celery_app = _build_app()
