"""APScheduler-driven periodic refresh of all imported parishes.

Disabled when `LEPARVIS_REFRESH_INTERVAL_DAYS=0`. Otherwise a background
thread fires every N days. The first run is delayed by
`LEPARVIS_REFRESH_STARTUP_DELAY_MINUTES` to avoid hammering the DB during
deploy / restart loops.

The job spins up its own database session — `get_db()`'s yield-style
dependency is for FastAPI request scope only.

This module also exposes runtime controls (pause / resume / reschedule /
status) used by the admin UI, and an in-memory ring buffer of the last
500 log records emitted by the scheduler + refresh code so the admin
page can show them without shelling into the host.
"""
from __future__ import annotations

import asyncio
import collections
import logging
from datetime import datetime, timedelta

from apscheduler.schedulers.background import BackgroundScheduler

from .config import settings
from .database import SessionLocal
from .services.refresh import refresh_all

logger = logging.getLogger(__name__)
_scheduler: BackgroundScheduler | None = None
_JOB_ID = "leparvis_refresh"

# Ring buffer of recent log records — captured from app.scheduler,
# app.services.refresh, and app.services.imports loggers. Exposed via
# the admin /scheduler/logs endpoint.
_log_buffer: collections.deque[dict] = collections.deque(maxlen=500)
_LOG_LOGGERS = ("app.scheduler", "app.services.refresh", "app.services.imports")
_log_capture_installed = False


class _BufferHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        _log_buffer.append({
            "ts": datetime.utcfromtimestamp(record.created).isoformat(timespec="seconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        })


def _install_log_capture() -> None:
    global _log_capture_installed
    if _log_capture_installed:
        return
    handler = _BufferHandler()
    handler.setLevel(logging.INFO)
    for name in _LOG_LOGGERS:
        lg = logging.getLogger(name)
        lg.setLevel(logging.INFO)
        if not any(isinstance(h, _BufferHandler) for h in lg.handlers):
            lg.addHandler(handler)
    _log_capture_installed = True


def get_logs(limit: int = 200, level: str | None = None) -> list[dict]:
    items = list(_log_buffer)
    if level:
        level = level.upper()
        items = [i for i in items if i["level"] == level]
    return items[-limit:]


def get_status() -> dict:
    """Snapshot of the scheduler — what the admin needs to show buttons."""
    enabled = settings.refresh_interval_days > 0
    base = {
        "enabled": enabled,
        "running": False,
        "paused": False,
        "interval_days": settings.refresh_interval_days,
        "startup_delay_minutes": settings.refresh_startup_delay_minutes,
        "next_run_at": None,
        "job_id": _JOB_ID,
    }
    if _scheduler is None:
        return base
    base["running"] = _scheduler.running
    job = _scheduler.get_job(_JOB_ID)
    if job is None:
        return base
    base["paused"] = job.next_run_time is None
    base["next_run_at"] = job.next_run_time.isoformat() if job.next_run_time else None
    return base


def pause_job() -> dict:
    if _scheduler is None:
        raise RuntimeError("Scheduler not running")
    _scheduler.pause_job(_JOB_ID)
    logger.info("Scheduler paused via admin")
    return get_status()


def resume_job() -> dict:
    if _scheduler is None:
        raise RuntimeError("Scheduler not running")
    _scheduler.resume_job(_JOB_ID)
    logger.info("Scheduler resumed via admin")
    return get_status()


def reschedule(interval_days: int) -> dict:
    """Change the cadence at runtime. Resets state to env defaults on restart."""
    if interval_days < 1:
        raise ValueError("interval_days must be >= 1")
    if _scheduler is None:
        raise RuntimeError("Scheduler not running")
    _scheduler.reschedule_job(_JOB_ID, trigger="interval", days=interval_days)
    settings.refresh_interval_days = interval_days
    logger.info("Scheduler rescheduled to %s day(s)", interval_days)
    return get_status()


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
    _install_log_capture()
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
        id=_JOB_ID,
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
