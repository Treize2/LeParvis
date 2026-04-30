"""Persistence pipeline for scraped data: dedupe, upsert, and audit."""
from __future__ import annotations

from datetime import datetime
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Celebration, Church
from ..services.slug import slugify, unique_slug
from .base import ScrapedCelebration, ScrapedChurch, ScrapeResult


class IngestionPipeline:
    """Persist a stream of `ScrapeResult` into the database, with traceability."""

    def __init__(self, db: Session):
        self.db = db
        self.created_churches = 0
        self.updated_churches = 0
        self.created_celebrations = 0
        self.updated_celebrations = 0
        self.errors: list[str] = []
        self.samples: list[dict] = []

    def run(self, results: Iterable[ScrapeResult]) -> None:
        for result in results:
            try:
                church = self._upsert_church(result.church)
                for cel in result.celebrations:
                    self._upsert_celebration(church, cel)
                if len(self.samples) < 5:
                    self.samples.append({
                        "name": church.name,
                        "city": church.city,
                        "celebrations": len(result.celebrations),
                    })
            except Exception as exc:  # noqa: BLE001
                self.errors.append(f"{result.church.name}: {exc}")
        self.db.commit()

    # ---- private helpers ------------------------------------------------

    def _upsert_church(self, scraped: ScrapedChurch) -> Church:
        church: Church | None = None

        # Match by source identifier first (most reliable).
        if scraped.source and scraped.source_url:
            church = self.db.execute(
                select(Church).where(
                    Church.source == scraped.source,
                    Church.source_url == scraped.source_url,
                )
            ).scalar_one_or_none()

        # Fall back to (name + postal_code/city).
        if church is None and scraped.name:
            stmt = select(Church).where(Church.name == scraped.name)
            if scraped.postal_code:
                stmt = stmt.where(Church.postal_code == scraped.postal_code)
            elif scraped.city:
                stmt = stmt.where(Church.city == scraped.city)
            church = self.db.execute(stmt).scalar_one_or_none()

        if church is None:
            slug_base = scraped.name + (f"-{scraped.city}" if scraped.city else "")
            slug = unique_slug(
                slug_base,
                exists=lambda s: self.db.execute(
                    select(Church.id).where(Church.slug == s)
                ).first() is not None,
            )
            church = Church(slug=slug)
            self.db.add(church)
            self.created_churches += 1
        else:
            self.updated_churches += 1

        for field in (
            "name", "type", "community", "address", "city", "postal_code", "country",
            "latitude", "longitude", "diocese", "website", "phone", "email",
            "description", "image_url", "source", "source_url",
        ):
            value = getattr(scraped, field, None)
            if value is None:
                continue
            current = getattr(church, field, None)
            # Don't blindly overwrite manual edits with shorter scraped data.
            if current and isinstance(current, str) and len(current) > len(str(value)):
                continue
            setattr(church, field, value)

        church.last_seen_at = datetime.utcnow()
        self.db.flush()
        return church

    def _upsert_celebration(self, church: Church, scraped: ScrapedCelebration) -> Celebration:
        existing = self.db.execute(
            select(Celebration).where(
                Celebration.church_id == church.id,
                Celebration.type == scraped.type,
                Celebration.day_of_week.is_(scraped.day_of_week) if scraped.day_of_week is None else Celebration.day_of_week == scraped.day_of_week,
                Celebration.start_time.is_(scraped.start_time) if scraped.start_time is None else Celebration.start_time == scraped.start_time,
                Celebration.rite == scraped.rite,
            )
        ).scalar_one_or_none()

        if existing is None:
            celebration = Celebration(
                church_id=church.id,
                type=scraped.type,
                rite=scraped.rite,
                language=scraped.language,
                day_of_week=scraped.day_of_week,
                start_time=scraped.start_time,
                end_time=scraped.end_time,
                recurrence_rule=scraped.recurrence_rule,
                notes=scraped.notes,
                confidence=scraped.confidence,
                source=scraped.source,
                source_url=scraped.source_url,
                last_seen_at=datetime.utcnow(),
            )
            self.db.add(celebration)
            self.created_celebrations += 1
            return celebration

        # Update fields when a higher-confidence reading arrives.
        if scraped.confidence >= existing.confidence:
            existing.end_time = scraped.end_time or existing.end_time
            existing.recurrence_rule = scraped.recurrence_rule or existing.recurrence_rule
            existing.notes = scraped.notes or existing.notes
            existing.language = scraped.language or existing.language
            existing.confidence = max(existing.confidence, scraped.confidence)
            existing.source = scraped.source or existing.source
            existing.source_url = scraped.source_url or existing.source_url
        existing.last_seen_at = datetime.utcnow()
        self.updated_celebrations += 1
        return existing
