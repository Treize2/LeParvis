"""Adapter for the messes.info / egliseinfo.catholique.fr open API.

Notes
-----
The public endpoint returns a JSON document listing churches around a
geographic point with their next celebrations. The exact field names below
follow the historic egliseinfo schema; if a field is missing on a record we
fall back gracefully (the pipeline will downgrade the confidence).

This adapter is **defensive**: any HTTP or parsing failure is caught and
surfaced through the IngestionPipeline `errors` collection.
"""
from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, time

import httpx

from ..config import settings
from .base import ScrapedCelebration, ScrapedChurch, Scraper, ScrapeResult

CHURCH_TYPE_MAPPING = {
    "PAROISSE": "parish",
    "CATHEDRALE": "cathedral",
    "BASILIQUE": "basilica",
    "MONASTERE": "monastery",
    "ABBAYE": "abbey",
    "PRIEURE": "priory",
    "SANCTUAIRE": "shrine",
    "CHAPELLE": "chapel",
    "ORATOIRE": "oratory",
    "SEMINAIRE": "seminary",
}


CELEBRATION_TYPE_MAPPING = {
    "messe": "mass",
    "laudes": "lauds",
    "vepres": "vespers",
    "complies": "compline",
    "adoration": "adoration",
    "confession": "confession",
    "chapelet": "chaplet",
    "vigile": "vigil",
}


class MessesInfoScraper(Scraper):
    name = "messes_info"

    async def fetch(
        self,
        latitude: float,
        longitude: float,
        radius_km: float = 10.0,
        limit: int = 25,
    ) -> Iterable[ScrapeResult]:
        url = f"{settings.messes_info_api_base}/places"
        params = {
            "latitude": latitude,
            "longitude": longitude,
            "rayon": int(radius_km * 1000),  # in metres, per legacy API
            "limit": limit,
        }
        try:
            response = await self._get(url, params=params)
        except httpx.HTTPStatusError as exc:
            # Surface the upstream status + body so admins can see what changed.
            sample = (exc.response.text or "")[:300].replace("\n", " ")
            raise RuntimeError(
                f"messes.info HTTP {exc.response.status_code} on {exc.request.url}: {sample}"
            ) from exc
        except httpx.HTTPError as exc:
            raise RuntimeError(
                f"messes.info network error on {url} ({type(exc).__name__}): {exc}"
            ) from exc

        try:
            payload = response.json()
        except ValueError as exc:
            sample = response.text[:300].replace("\n", " ")
            raise RuntimeError(
                f"messes.info returned non-JSON ({response.headers.get('content-type', '?')}): {sample}"
            ) from exc

        records = payload if isinstance(payload, list) else payload.get("places", [])
        if not isinstance(records, list):
            raise RuntimeError(
                f"messes.info: unexpected JSON shape, "
                f"expected a list or {{places: [...]}}, got keys={list(payload)[:8] if isinstance(payload, dict) else type(payload).__name__}"
            )

        results: list[ScrapeResult] = []
        for record in records:
            try:
                results.append(self._parse_record(record))
            except Exception as exc:  # noqa: BLE001
                # Skip the record but keep going; the pipeline will log it.
                results.append(
                    ScrapeResult(
                        church=ScrapedChurch(
                            name=str(record.get("name", "Inconnu")) + f" [parse error: {exc}]",
                            source=self.name,
                        ),
                        celebrations=[],
                    )
                )
                continue
        return results

    # ---- parsing --------------------------------------------------------

    def _parse_record(self, record: dict) -> ScrapeResult:
        kind = (record.get("kind") or record.get("type") or "PAROISSE").upper()
        church_type = CHURCH_TYPE_MAPPING.get(kind, "parish")

        location = record.get("location", {}) or {}
        coords = record.get("coordinates") or location.get("coordinates") or {}

        church = ScrapedChurch(
            name=record.get("name") or "Lieu non nommé",
            type=church_type,
            address=record.get("address") or location.get("address"),
            city=record.get("city") or location.get("city"),
            postal_code=record.get("postal_code") or location.get("postal_code"),
            country=(record.get("country") or "FR")[:2].upper(),
            latitude=coords.get("latitude") or coords.get("lat"),
            longitude=coords.get("longitude") or coords.get("lng"),
            diocese=record.get("diocese"),
            website=record.get("website") or record.get("url"),
            phone=record.get("phone"),
            email=record.get("email"),
            description=record.get("description"),
            source=self.name,
            source_url=record.get("source_url") or record.get("permalink"),
            external_id=str(record.get("id") or record.get("slug") or ""),
        )

        celebrations: list[ScrapedCelebration] = []
        for cel in record.get("celebrations", []) or []:
            celebrations.append(self._parse_celebration(cel))
        return ScrapeResult(church=church, celebrations=[c for c in celebrations if c])

    def _parse_celebration(self, cel: dict) -> ScrapedCelebration | None:
        raw_type = (cel.get("type") or cel.get("kind") or "messe").lower()
        ctype = CELEBRATION_TYPE_MAPPING.get(raw_type, "other")

        start: time | None = None
        if cel.get("start_time"):
            try:
                start = datetime.strptime(cel["start_time"], "%H:%M").time()
            except ValueError:
                start = None
        end: time | None = None
        if cel.get("end_time"):
            try:
                end = datetime.strptime(cel["end_time"], "%H:%M").time()
            except ValueError:
                end = None

        day_of_week = cel.get("day_of_week")
        if isinstance(day_of_week, str):
            day_of_week = {
                "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
                "friday": 4, "saturday": 5, "sunday": 6,
            }.get(day_of_week.lower())

        rite = "extraordinary" if cel.get("tridentine") else "ordinary"
        return ScrapedCelebration(
            type=ctype,
            rite=rite,
            language=cel.get("language"),
            day_of_week=day_of_week,
            start_time=start,
            end_time=end,
            recurrence_rule=cel.get("rrule"),
            notes=cel.get("notes"),
            confidence=0.9,
            source=self.name,
            source_url=cel.get("source_url"),
        )
