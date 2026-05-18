"""Admin API: edit, delete, merge, re-import.

Every endpoint requires `Authorization: Bearer <LEPARVIS_ADMIN_TOKEN>`.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..auth import require_admin
from ..database import get_db
from ..models import Celebration, Church, ImportRun, Suggestion
from ..schemas import (
    CelebrationOut,
    CelebrationUpdate,
    ChurchDetail,
    ChurchUpdate,
    ImportRunDetail,
    ImportRunOut,
    LogEntry,
    MergeReport,
    RefreshReport,
    SchedulerStatus,
    SchedulerUpdate,
)
from ..scrapers import IngestionPipeline
from ..scrapers.paroisse_html import ParoisseHtmlScraper
from ..services.imports import cascade_delete_run, track_import
from ..services.refresh import refresh_all
from ..services.stats import compute_stats

router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)


# ---- Auth probe -----------------------------------------------------------


@router.post("/login")
async def login():
    """Returns 200 if the bearer token is valid (the dependency does the check)."""
    return {"status": "ok"}


# ---- Churches -------------------------------------------------------------


@router.get("/churches/{church_id}", response_model=ChurchDetail)
def get_church(church_id: int, db: Session = Depends(get_db)):
    stmt = select(Church).options(selectinload(Church.celebrations)).where(Church.id == church_id)
    church = db.execute(stmt).scalar_one_or_none()
    if church is None:
        raise HTTPException(status_code=404, detail="Church not found")
    return church


@router.patch("/churches/{church_id}", response_model=ChurchDetail)
def update_church(
    church_id: int,
    payload: ChurchUpdate,
    db: Session = Depends(get_db),
):
    church = db.get(Church, church_id)
    if church is None:
        raise HTTPException(status_code=404, detail="Church not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(church, field, value)
    db.commit()
    db.refresh(church)
    return church


@router.delete("/churches/{church_id}", status_code=204)
def delete_church(church_id: int, db: Session = Depends(get_db)):
    church = db.get(Church, church_id)
    if church is None:
        raise HTTPException(status_code=404, detail="Church not found")
    db.delete(church)
    db.commit()
    return None


@router.post("/churches/{church_id}/merge-into/{target_id}", response_model=MergeReport)
def merge_church_into(
    church_id: int,
    target_id: int,
    db: Session = Depends(get_db),
):
    """Move every celebration of `church_id` to `target_id`, then delete the source.

    Celebrations that would collide with an existing slot on the target
    (same type/day/start_time/rite) are dropped from the source. Missing
    fields on the target are filled in from the source — but explicit values
    on the target are never overwritten.
    """
    if church_id == target_id:
        raise HTTPException(status_code=400, detail="Source and target must differ")

    source = db.get(Church, church_id)
    target = db.get(Church, target_id)
    if source is None or target is None:
        raise HTTPException(status_code=404, detail="Church(es) not found")

    # 1. Fill empty fields on target from source. We never overwrite explicit values.
    for field in (
        "name", "type", "community", "address", "city", "postal_code", "country",
        "latitude", "longitude", "diocese", "website", "phone", "email",
        "description", "image_url",
    ):
        if not getattr(target, field, None):
            v = getattr(source, field, None)
            if v is not None:
                setattr(target, field, v)
    target.updated_at = datetime.utcnow()

    # 2. Move celebrations one by one, deduping on the unique slot.
    # We assign through the `church` relationship rather than mutating
    # `church_id` directly: the latter trips delete-orphan cascade and
    # the celebration would be silently deleted at flush time.
    moved = 0
    deleted_dups = 0
    existing_slots = {
        (c.type, c.day_of_week, c.start_time, c.rite)
        for c in target.celebrations
    }
    for cel in list(source.celebrations):
        key = (cel.type, cel.day_of_week, cel.start_time, cel.rite)
        if key in existing_slots:
            db.delete(cel)
            deleted_dups += 1
        else:
            cel.church = target
            existing_slots.add(key)
            moved += 1

    # 3. Re-point any suggestions that referenced the source.
    db.query(Suggestion).filter(Suggestion.church_id == source.id).update(
        {Suggestion.church_id: target.id}
    )

    db.flush()
    db.delete(source)
    db.commit()

    return MergeReport(
        target_id=target.id,
        moved_celebrations=moved,
        deleted_duplicate_celebrations=deleted_dups,
        deleted_church_id=church_id,
    )


# ---- Celebrations ---------------------------------------------------------


@router.patch("/celebrations/{celebration_id}", response_model=CelebrationOut)
def update_celebration(
    celebration_id: int,
    payload: CelebrationUpdate,
    db: Session = Depends(get_db),
):
    cel = db.get(Celebration, celebration_id)
    if cel is None:
        raise HTTPException(status_code=404, detail="Celebration not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(cel, field, value)
    db.commit()
    db.refresh(cel)
    return cel


@router.delete("/celebrations/{celebration_id}", status_code=204)
def delete_celebration(celebration_id: int, db: Session = Depends(get_db)):
    cel = db.get(Celebration, celebration_id)
    if cel is None:
        raise HTTPException(status_code=404, detail="Celebration not found")
    db.delete(cel)
    db.commit()
    return None


# ---- Re-import ------------------------------------------------------------


@router.post("/churches/{church_id}/reimport")
async def reimport_from_website(
    church_id: int,
    force: bool = False,
    render: bool = False,
    db: Session = Depends(get_db),
):
    """Re-run the URL scraper on the church's `website` and merge results.

    `render=true` swaps the plain httpx client for headless Chromium —
    use it on SPA sites (messes.info, etc.) that load schedules in JS.
    """
    church = db.get(Church, church_id)
    if church is None:
        raise HTTPException(status_code=404, detail="Church not found")
    if not church.website:
        raise HTTPException(
            status_code=400,
            detail="No `website` URL on this church — fill it in before reimport.",
        )

    from ..scrapers.rendered_html import RenderedHtmlScraper

    scraper_cls = RenderedHtmlScraper if render else ParoisseHtmlScraper

    pipeline = IngestionPipeline(db)
    try:
        async with scraper_cls() as scraper:
            results = list(await scraper.fetch(church.website, force=force))
        # Force every result to point to *this* church so we don't create duplicates.
        for r in results:
            r.church.name = church.name
            r.church.source_url = church.website
            for cel in r.celebrations:
                cel.source_url = church.website
        pipeline.run(results)
    except PermissionError as exc:
        raise HTTPException(
            status_code=451,
            detail={"error": "robots_disallowed", "message": str(exc)},
        ) from exc
    except Exception as exc:  # noqa: BLE001
        pipeline.errors.append(str(exc))

    return {
        "fetched": 1,
        "created_celebrations": pipeline.created_celebrations,
        "updated_celebrations": pipeline.updated_celebrations,
        "errors": pipeline.errors,
    }


# ---- Suggestions ----------------------------------------------------------


@router.get("/suggestions")
def list_suggestions(status: str | None = None, db: Session = Depends(get_db)):
    stmt = select(Suggestion).order_by(Suggestion.created_at.desc())
    if status:
        stmt = stmt.where(Suggestion.status == status)
    rows = db.execute(stmt).scalars().all()
    return [
        {
            "id": s.id,
            "church_id": s.church_id,
            "payload": s.payload,
            "status": s.status,
            "submitter_email": s.submitter_email,
            "notes": s.notes,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
        for s in rows
    ]


@router.post("/suggestions/{suggestion_id}/{action}")
def review_suggestion(
    suggestion_id: int,
    action: str,
    db: Session = Depends(get_db),
):
    if action not in {"approve", "reject"}:
        raise HTTPException(status_code=400, detail="action must be 'approve' or 'reject'")
    suggestion = db.get(Suggestion, suggestion_id)
    if suggestion is None:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    suggestion.status = "approved" if action == "approve" else "rejected"
    db.commit()
    return {"id": suggestion.id, "status": suggestion.status}


# ---- Imports --------------------------------------------------------------


@router.get("/imports", response_model=list[ImportRunOut])
def list_imports(
    status: str | None = None,
    kind: str | None = None,
    parent_only: bool = True,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    """List recent import runs, newest first.

    Defaults to top-level runs (children of a scheduled refresh stay hidden
    unless `parent_only=false`)."""
    stmt = select(ImportRun).order_by(ImportRun.started_at.desc()).limit(limit)
    if parent_only:
        stmt = stmt.where(ImportRun.parent_run_id.is_(None))
    if status:
        stmt = stmt.where(ImportRun.status == status)
    if kind:
        stmt = stmt.where(ImportRun.kind == kind)
    return db.execute(stmt).scalars().all()


@router.get("/imports/{run_id}", response_model=ImportRunDetail)
def get_import(run_id: int, db: Session = Depends(get_db)):
    run = db.get(ImportRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Import run not found")
    return run


@router.get("/imports/{run_id}/children", response_model=list[ImportRunOut])
def list_import_children(run_id: int, db: Session = Depends(get_db)):
    parent = db.get(ImportRun, run_id)
    if parent is None:
        raise HTTPException(status_code=404, detail="Import run not found")
    return db.execute(
        select(ImportRun)
        .where(ImportRun.parent_run_id == run_id)
        .order_by(ImportRun.started_at.asc())
    ).scalars().all()


@router.delete("/imports/{run_id}", status_code=200)
def delete_import(run_id: int, db: Session = Depends(get_db)):
    """Cascade-delete: removes the run, every church it created, every
    standalone celebration it added, and any child runs (recursively)."""
    run = db.get(ImportRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Import run not found")
    summary = cascade_delete_run(db, run)
    return {
        "deleted_run_id": run_id,
        "deleted_churches": summary["churches"],
        "deleted_celebrations": summary["celebrations"],
    }


@router.post("/imports/{run_id}/rerun", response_model=ImportRunOut)
async def rerun_import(run_id: int, db: Session = Depends(get_db)):
    """Replay the same input as a previous run, recording a new ImportRun.

    Only `osm` and `url` kinds can be replayed directly. For
    `scheduled_refresh`, use POST /imports/refresh-now instead.
    """
    run = db.get(ImportRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Import run not found")

    if run.kind == "osm":
        from ..schemas import IngestArea
        from .ingest import _ingest_area  # local import to avoid cycle

        await _ingest_area(
            IngestArea(
                latitude=run.input_latitude or 0.0,
                longitude=run.input_longitude or 0.0,
                radius_km=run.input_radius_km or 10.0,
                limit=run.input_limit or 25,
            ),
            db,
        )
    elif run.kind == "url":
        if not run.input_url:
            raise HTTPException(status_code=400, detail="Run has no URL to replay")
        from ..schemas import IngestUrlRequest
        from .ingest import ingest_url  # local import to avoid cycle

        await ingest_url(
            IngestUrlRequest(
                url=run.input_url,
                render=run.input_render,
                force=run.input_force,
                hint_type=run.input_hint_type,
            ),
            db,
        )
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot rerun a {run.kind} run. Use refresh-now for batch refreshes.",
        )

    # The newest run is the one we just created.
    newest = db.execute(
        select(ImportRun).order_by(ImportRun.id.desc()).limit(1)
    ).scalar_one()
    return newest


@router.post("/imports/refresh-now", response_model=RefreshReport)
async def refresh_now(db: Session = Depends(get_db)):
    """Trigger an immediate batch refresh of every imported parish.

    Same code path as the scheduled job (just triggered_by='admin').
    Returns the parent run + per-status counts.
    """
    parent = await refresh_all(db, triggered_by="admin")
    children = db.query(ImportRun).filter(ImportRun.parent_run_id == parent.id).all()
    succeeded = sum(1 for c in children if c.status == "success")
    failed = sum(1 for c in children if c.status == "error")
    return RefreshReport(
        parent_run_id=parent.id,
        churches_refreshed=len(children),
        succeeded=succeeded,
        failed=failed,
    )


# ---- Scheduler ------------------------------------------------------------


@router.get("/scheduler", response_model=SchedulerStatus)
def scheduler_status():
    from ..scheduler import get_status
    return get_status()


@router.post("/scheduler/pause", response_model=SchedulerStatus)
def scheduler_pause():
    from ..scheduler import pause_job
    try:
        return pause_job()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/scheduler/resume", response_model=SchedulerStatus)
def scheduler_resume():
    from ..scheduler import resume_job
    try:
        return resume_job()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.patch("/scheduler", response_model=SchedulerStatus)
def scheduler_reschedule(payload: SchedulerUpdate):
    """Change the cadence at runtime. The change is volatile — it resets to
    LEPARVIS_REFRESH_INTERVAL_DAYS on next server restart."""
    from ..scheduler import reschedule
    try:
        return reschedule(payload.interval_days)
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/scheduler/logs", response_model=list[LogEntry])
def scheduler_logs(limit: int = 200, level: str | None = None):
    from ..scheduler import get_logs
    return get_logs(limit=limit, level=level)


# ---- Stats ----------------------------------------------------------------


@router.get("/stats")
def admin_stats(db: Session = Depends(get_db)):
    """Aggregated dashboard payload for the admin stats view.

    Returns coverage / freshness KPIs plus every distribution the dashboard
    needs (by type, day, hour, source, diocese, status, etc.). All counts
    are recomputed at request time — cheap enough at our scale."""
    return compute_stats(db)
