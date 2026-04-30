from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import Church
from ..schemas import ChurchCreate, ChurchDetail, ChurchOut
from ..services.slug import slugify, unique_slug

router = APIRouter(prefix="/api/churches", tags=["churches"])


@router.get("", response_model=list[ChurchOut])
def list_churches(
    q: str | None = None,
    type: list[str] | None = Query(default=None),
    community: list[str] | None = Query(default=None),
    city: str | None = None,
    diocese: str | None = None,
    country: str | None = None,
    limit: int = Query(default=50, le=200),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    stmt = select(Church)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Church.name.ilike(like), Church.city.ilike(like)))
    if type:
        stmt = stmt.where(Church.type.in_(type))
    if community:
        stmt = stmt.where(Church.community.in_(community))
    if city:
        stmt = stmt.where(Church.city.ilike(city))
    if diocese:
        stmt = stmt.where(Church.diocese.ilike(f"%{diocese}%"))
    if country:
        stmt = stmt.where(Church.country == country.upper())
    stmt = stmt.order_by(Church.name).limit(limit).offset(offset)
    return db.execute(stmt).scalars().all()


@router.get("/{church_id}", response_model=ChurchDetail)
def get_church(church_id: int, db: Session = Depends(get_db)):
    stmt = select(Church).options(selectinload(Church.celebrations)).where(Church.id == church_id)
    church = db.execute(stmt).scalar_one_or_none()
    if church is None:
        raise HTTPException(status_code=404, detail="Church not found")
    return church


@router.post("", response_model=ChurchOut, status_code=201)
def create_church(payload: ChurchCreate, db: Session = Depends(get_db)):
    base = payload.slug or slugify(payload.name)
    slug = unique_slug(
        base,
        exists=lambda s: db.execute(select(Church.id).where(Church.slug == s)).first() is not None,
    )
    church = Church(
        **payload.model_dump(exclude={"slug"}),
        slug=slug,
        last_seen_at=datetime.utcnow() if payload.source else None,
    )
    db.add(church)
    db.commit()
    db.refresh(church)
    return church
