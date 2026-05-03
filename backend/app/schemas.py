from datetime import datetime, time
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class CelebrationBase(BaseModel):
    type: str
    rite: str = "ordinary"
    language: str | None = None
    day_of_week: int | None = Field(default=None, ge=0, le=6)
    start_time: time | None = None
    end_time: time | None = None
    recurrence_rule: str | None = None
    notes: str | None = None
    confidence: float = 0.5
    source: str | None = None
    source_url: str | None = None


class CelebrationCreate(CelebrationBase):
    church_id: int


class CelebrationOut(CelebrationBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    church_id: int
    last_seen_at: datetime | None = None


class ChurchBase(BaseModel):
    name: str
    type: str
    community: str | None = None
    address: str | None = None
    city: str | None = None
    postal_code: str | None = None
    country: str = "FR"
    latitude: float | None = None
    longitude: float | None = None
    diocese: str | None = None
    website: str | None = None
    phone: str | None = None
    email: str | None = None
    description: str | None = None
    image_url: str | None = None


class ChurchCreate(ChurchBase):
    slug: str | None = None
    source: str | None = None
    source_url: str | None = None


class ChurchOut(ChurchBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    slug: str
    source: str | None = None
    source_url: str | None = None
    last_seen_at: datetime | None = None


class ChurchDetail(ChurchOut):
    celebrations: list[CelebrationOut] = []


class SearchResultItem(BaseModel):
    church: ChurchOut
    matched_celebrations: list[CelebrationOut]
    distance_km: float | None = None


class SearchResponse(BaseModel):
    total: int
    items: list[SearchResultItem]


class IngestUrlRequest(BaseModel):
    url: str
    church_id: int | None = None
    hint_type: str | None = None
    # When True, ignore the site's robots.txt. The user takes legal /
    # ethical responsibility — this is intended for one-off manual ingestion
    # of explicitly public pages (mass schedules) that the parish wants
    # discoverable but whose webmaster set a too-broad robots.txt.
    force: bool = False


class IngestArea(BaseModel):
    latitude: float
    longitude: float
    radius_km: float = 10.0
    limit: int = 25


class IngestReport(BaseModel):
    fetched: int
    created_churches: int
    updated_churches: int
    created_celebrations: int
    updated_celebrations: int
    errors: list[str] = []
    samples: list[dict[str, Any]] = []


class SuggestionCreate(BaseModel):
    church_id: int | None = None
    payload: dict
    submitter_email: str | None = None
    notes: str | None = None
