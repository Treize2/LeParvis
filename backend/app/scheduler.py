"""APScheduler-driven periodic refresh of all imported parishes.

Disabled when `LEPARVIS_REFRESH_INTERVAL_DAYS=0`. Otherwise a background
thread fires every N days. The first run is delayed by
`LEPARVIS_REFRESH_STARTUP_DELAY_MINUTES` to avoid hammering the DB during
deploy / restart loops.

The job spins up its own database session — `get_db()`'s yield-style
dependency is for FastAPI request scope only.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta

from apscheduler.schedulers.background import BackgroundScheduler

from .config import settings
from .database import SessionLocal
from .services.refresh import refresh_all

logger = logging.getLogger(__name__)
_scheduler: BackgroundScheduler | None = None


def _job() -> None:
    """The scheduled refresh entry-point. Async-safe even though APScheduler
    runs us in a worker thread — we create our own event loop."""
    db = SessionLocal()
    try:
        logger.info("Scheduled refresh starting")
        run = asyncio.run(refresh_all(db, triggered_by="scheduler"))
        logger.info(
            "Scheduled refresh done: run=%s status=%s churches=%s errors=%s",
            run.id, run.status, run.churches_updated, run.errors_count,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Scheduled refresh crashed")
    finally:
        db.close()


def start_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        return
    days = settings.refresh_interval_days
    if days <= 0:
        logger.info("Scheduled refresh disabled (LEPARVIS_REFRESH_INTERVAL_DAYS=0)")
        return

    _scheduler = BackgroundScheduler(timezone="UTC")
    next_run = datetime.utcnow() + timedelta(minutes=settings.refresh_startup_delay_minutes)
    _scheduler.add_job(
        _job,
        "interval",
        days=days,
        next_run_time=next_run,
        id="leparvis_refresh",
        replace_existing=True,
        max_instances=1,  # don't pile up if a run takes too long
        coalesce=True,
    )
    _scheduler.start()
    logger.info(
        "Scheduled refresh registered: every %sd, first run at %s UTC",
        days, next_run.isoformat(timespec="seconds"),
    )


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is None:
        return
    _scheduler.shutdown(wait=False)
    _scheduler = None
