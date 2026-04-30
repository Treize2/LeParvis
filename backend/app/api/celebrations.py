from datetime import time

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Celebration, Church
from ..schemas import CelebrationCreate, CelebrationOut
from ..services.ics import celebration_to_ics

router = APIRouter(prefix="/api/celebrations", tags=["celebrations"])


@router.get("", response_model=list[CelebrationOut])
def list_celebrations(
    type: list[str] | None = Query(default=None),
    rite: list[str] | None = Query(default=None),
    day_of_week: int | None = Query(default=None, ge=0, le=6),
    after: time | None = None,
    before: time | None = None,
    church_id: int | None = None,
    limit: int = Query(default=100, le=500),
    db: Session = Depends(get_db),
):
    stmt = select(Celebration)
    if type:
        stmt = stmt.where(Celebration.type.in_(type))
    if rite:
        stmt = stmt.where(Celebration.rite.in_(rite))
    if day_of_week is not None:
        stmt = stmt.where(Celebration.day_of_week == day_of_week)
    if after is not None:
        stmt = stmt.where(Celebration.start_time >= after)
    if before is not None:
        stmt = stmt.where(Celebration.start_time <= before)
    if church_id:
        stmt = stmt.where(Celebration.church_id == church_id)
    stmt = stmt.order_by(Celebration.day_of_week.is_(None), Celebration.day_of_week, Celebration.start_time).limit(limit)
    return db.execute(stmt).scalars().all()


@router.post("", response_model=CelebrationOut, status_code=201)
def create_celebration(payload: CelebrationCreate, db: Session = Depends(get_db)):
    church = db.get(Church, payload.church_id)
    if church is None:
        raise HTTPException(status_code=404, detail="Church not found")
    celebration = Celebration(**payload.model_dump())
    db.add(celebration)
    db.commit()
    db.refresh(celebration)
    return celebration


@router.get("/{celebration_id}/ics")
def export_ics(celebration_id: int, db: Session = Depends(get_db)):
    celebration = db.get(Celebration, celebration_id)
    if celebration is None:
        raise HTTPException(status_code=404, detail="Celebration not found")
    church = db.get(Church, celebration.church_id)
    payload = celebration_to_ics(celebration, church)
    filename = f"celebration-{celebration_id}.ics"
    return Response(
        content=payload,
        media_type="text/calendar",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
