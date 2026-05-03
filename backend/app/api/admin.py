"""Admin API: edit, delete, merge, re-import.

Every endpoint requires `Authorization: Bearer <LEPARVIS_ADMIN_TOKEN>`.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..auth import require_admin
from ..database import get_db
from ..models import Celebration, Church, Suggestion
from ..schemas import (
    CelebrationOut,
    CelebrationUpdate,
    ChurchDetail,
    ChurchUpdate,
    MergeReport,
)
from ..scrapers import IngestionPipeline
from ..scrapers.paroisse_html import ParoisseHtmlScraper

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
