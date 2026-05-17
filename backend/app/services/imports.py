"""Helpers that wrap an ingestion run with an `ImportRun` row.

The admin can then list every past run, see what each one created, replay it,
or cascade-delete the rows it produced.

`track_import()` is the contract: callers hand it a coroutine that takes a
`run_id` and returns an `IngestionPipeline` (after it's done writing). It
takes care of the bookkeeping — creating the run record before, populating
status/counts/output after, and rolling status to 'error' on exception.
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from ..models import Celebration, Church, ImportRun
from ..scrapers.pipeline import IngestionPipeline


async def track_import(
    db: Session,
    *,
    kind: str,
    runner: Callable[[int], Awaitable[IngestionPipeline]],
    triggered_by: str = "admin",
    parent_run_id: int | None = None,
    input_url: str | None = None,
    input_latitude: float | None = None,
    input_longitude: float | None = None,
    input_radius_km: float | None = None,
    input_render: bool = False,
    input_force: bool = False,
    input_limit: int | None = None,
    input_hint_type: str | None = None,
) -> ImportRun:
    """Create an ImportRun, call `runner(run_id)`, then persist results.

    `runner` must accept the new run's id (so the IngestionPipeline can tag
    rows with `created_by_import_id`) and return the pipeline instance it
    used. We read the counters off of it for the run record.
    """
    run = ImportRun(
        kind=kind,
        status="pending",
        triggered_by=triggered_by,
        parent_run_id=parent_run_id,
        input_url=input_url,
        input_latitude=input_latitude,
        input_longitude=input_longitude,
        input_radius_km=input_radius_km,
        input_render=input_render,
        input_force=input_force,
        input_limit=input_limit,
        input_hint_type=input_hint_type,
        started_at=datetime.utcnow(),
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    try:
        pipeline = await runner(run.id)
    except Exception as exc:  # noqa: BLE001
        run.status = "error"
        run.error_message = str(exc)
        run.finished_at = datetime.utcnow()
        db.commit()
        db.refresh(run)
        return run

    output: dict[str, Any] = {
        "samples": pipeline.samples,
        "errors": pipeline.errors[:50],  # cap so a runaway parser doesn't blow up JSON
    }
    run.fetched = pipeline.fetched
    run.churches_created = pipeline.created_churches
    run.churches_updated = pipeline.updated_churches
    run.celebrations_created = pipeline.created_celebrations
    run.celebrations_updated = pipeline.updated_celebrations
    run.errors_count = len(pipeline.errors)
    run.error_message = pipeline.errors[0] if pipeline.errors else None
    run.output = output

    if pipeline.errors and pipeline.created_churches == 0 and pipeline.updated_churches == 0:
        run.status = "error"
    elif pipeline.errors:
        run.status = "partial"
    else:
        run.status = "success"

    run.finished_at = datetime.utcnow()
    db.commit()
    db.refresh(run)
    return run


def cascade_delete_run(db: Session, run: ImportRun) -> dict[str, int]:
    """Delete every row this run created, then the run itself.

    - Churches with `created_by_import_id == run.id` get deleted; their
      celebrations cascade via the ORM relationship.
    - Standalone celebrations with `created_by_import_id == run.id` (added
      to existing churches by a refresh run) get deleted explicitly so they
      don't survive after the run record is gone.
    - Child runs (a refresh-all parent with per-church children) get cleaned
      up first, recursively.
    """
    deleted_churches = 0
    deleted_celebrations = 0

    # Recurse into child runs first (e.g. scheduled_refresh batches).
    children = db.query(ImportRun).filter(ImportRun.parent_run_id == run.id).all()
    for child in children:
        sub = cascade_delete_run(db, child)
        deleted_churches += sub["churches"]
        deleted_celebrations += sub["celebrations"]

    # Standalone celebrations (added to churches that aren't being deleted).
    orphan_cels = db.query(Celebration).filter(
        Celebration.created_by_import_id == run.id
    ).all()
    for cel in orphan_cels:
        db.delete(cel)
        deleted_celebrations += 1

    # Churches created by this run — their own celebrations cascade.
    churches = db.query(Church).filter(
        Church.created_by_import_id == run.id
    ).all()
    for church in churches:
        deleted_celebrations += len(church.celebrations)
        db.delete(church)
        deleted_churches += 1

    db.delete(run)
    db.commit()
    return {"churches": deleted_churches, "celebrations": deleted_celebrations}
