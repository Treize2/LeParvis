from datetime import time

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import Celebration, Church
from ..schemas import CelebrationOut, ChurchOut, SearchResponse, SearchResultItem
from ..services.geo import bounding_box, haversine_km

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("", response_model=SearchResponse)
def search(
    q: str | None = None,
    type: list[str] | None = Query(default=None, description="Filter by church type"),
    community: list[str] | None = Query(default=None),
    celebration_type: list[str] | None = Query(default=None),
    rite: list[str] | None = Query(default=None),
    language: str | None = None,
    day_of_week: int | None = Query(default=None, ge=0, le=6),
    after: time | None = None,
    before: time | None = None,
    city: str | None = None,
    postal_code: str | None = None,
    diocese: str | None = None,
    country: str | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
    radius_km: float | None = Query(default=None, gt=0, le=300),
    limit: int = Query(default=50, le=200),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    """Unified search: combines church and celebration filters and (optionally) a radius."""

    stmt = select(Church).options(selectinload(Church.celebrations))

    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Church.name.ilike(like), Church.description.ilike(like), Church.city.ilike(like)))
    if type:
        stmt = stmt.where(Church.type.in_(type))
    if community:
        stmt = stmt.where(Church.community.in_(community))
    if city:
        stmt = stmt.where(Church.city.ilike(city))
    if postal_code:
        stmt = stmt.where(Church.postal_code == postal_code)
    if diocese:
        stmt = stmt.where(Church.diocese.ilike(f"%{diocese}%"))
    if country:
        stmt = stmt.where(Church.country == country.upper())

    if latitude is not None and longitude is not None and radius_km:
        min_lat, max_lat, min_lon, max_lon = bounding_box(latitude, longitude, radius_km)
        stmt = stmt.where(
            Church.latitude.is_not(None),
            Church.longitude.is_not(None),
            Church.latitude.between(min_lat, max_lat),
            Church.longitude.between(min_lon, max_lon),
        )

    churches = db.execute(stmt).scalars().unique().all()

    # Filter / score celebrations in Python (small set after spatial pre-filter)
    has_celebration_filter = any([
        celebration_type, rite, language, day_of_week is not None, after, before,
    ])

    items: list[SearchResultItem] = []
    for church in churches:
        matched: list[Celebration] = []
        for cel in church.celebrations:
            if celebration_type and cel.type not in celebration_type:
                continue
            if rite and cel.rite not in rite:
                continue
            if language and (cel.language or "").lower() != language.lower():
                continue
            if day_of_week is not None and cel.day_of_week not in (day_of_week, None):
                continue
            if after and cel.start_time and cel.start_time < after:
                continue
            if before and cel.start_time and cel.start_time > before:
                continue
            matched.append(cel)

        if has_celebration_filter and not matched:
            continue

        distance = None
        if latitude is not None and longitude is not None and church.latitude and church.longitude:
            distance = round(haversine_km(latitude, longitude, church.latitude, church.longitude), 2)
            if radius_km and distance > radius_km:
                continue

        items.append(
            SearchResultItem(
                church=ChurchOut.model_validate(church),
                matched_celebrations=[CelebrationOut.model_validate(c) for c in matched or church.celebrations],
                distance_km=distance,
            )
        )

    if latitude is not None and longitude is not None:
        items.sort(key=lambda i: (i.distance_km is None, i.distance_km or 0))

    total = len(items)
    return SearchResponse(total=total, items=items[offset : offset + limit])
