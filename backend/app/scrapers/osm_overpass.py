"""OpenStreetMap Overpass adapter — finds Catholic places of worship by area.

OSM has very rich data on Catholic places (parishes, monasteries, abbeys,
basilicas, chapels, oratories, sanctuaries…). It is a free, public,
no-key API. The trade-off vs. messes.info is that OSM does **not** publish
celebration times: this scraper only seeds the church catalogue. Schedules
must come from the per-URL parish scraper (or manual entry).

Overpass QL reference: https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL
Tagging guide:          https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dplace_of_worship
"""
from __future__ import annotations

from collections.abc import Iterable

import httpx

from .base import ScrapedChurch, Scraper, ScrapeResult

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Map OSM `building=*` and `place_of_worship:type=*` values to our taxonomy.
# Anything not listed defaults to `parish` (a regular Catholic church).
BUILDING_TO_TYPE: dict[str, str] = {
    "cathedral": "cathedral",
    "basilica": "basilica",
    "chapel": "chapel",
    "monastery": "monastery",
    "abbey": "abbey",
    "priory": "priory",
    "shrine": "shrine",
    "oratory": "oratory",
    "convent": "convent",
    "collegiate": "collegiate",
    "seminary": "seminary",
    "church": "parish",
}


class OsmOverpassScraper(Scraper):
    """Catholic place-of-worship lookup via the Overpass API."""

    name = "osm_overpass"
    QUERY_TIMEOUT = 25  # server-side, in seconds

    async def fetch(
        self,
        latitude: float,
        longitude: float,
        radius_km: float = 10.0,
        limit: int = 100,
    ) -> Iterable[ScrapeResult]:
        radius_m = int(radius_km * 1000)
        ql = (
            f"[out:json][timeout:{self.QUERY_TIMEOUT}];"
            f"("
            f'  node["amenity"="place_of_worship"]["religion"="christian"]["denomination"="catholic"](around:{radius_m},{latitude},{longitude});'
            f'  way["amenity"="place_of_worship"]["religion"="christian"]["denomination"="catholic"](around:{radius_m},{latitude},{longitude});'
            f'  relation["amenity"="place_of_worship"]["religion"="christian"]["denomination"="catholic"](around:{radius_m},{latitude},{longitude});'
            f");"
            f"out center tags;"
        )

        try:
            assert self._client is not None
            response = await self._client.post(
                OVERPASS_URL,
                data={"data": ql},
                timeout=60.0,
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            sample = (exc.response.text or "")[:300].replace("\n", " ")
            raise RuntimeError(
                f"Overpass HTTP {exc.response.status_code} on {exc.request.url}: {sample}"
            ) from exc
        except httpx.HTTPError as exc:
            raise RuntimeError(
                f"Overpass network error ({type(exc).__name__}): {exc}"
            ) from exc

        try:
            payload = response.json()
        except ValueError as exc:
            raise RuntimeError(
                f"Overpass returned non-JSON ({response.headers.get('content-type','?')}): "
                f"{response.text[:200]}"
            ) from exc

        elements = payload.get("elements") or []
        results: list[ScrapeResult] = []
        for el in elements[:limit]:
            try:
                results.append(self._parse_element(el))
            except Exception as exc:  # noqa: BLE001
                # Surface the element that failed so the admin sees it in the report.
                results.append(
                    ScrapeResult(
                        church=ScrapedChurch(
                            name=f"OSM element {el.get('id', '?')} (parse error: {exc})",
                            source=self.name,
                            external_id=f"{el.get('type')}/{el.get('id')}",
                        ),
                        celebrations=[],
                    )
                )
        return results

    # ---- Parsing --------------------------------------------------------

    def _parse_element(self, el: dict) -> ScrapeResult:
        tags = el.get("tags", {}) or {}

        # Coordinates: nodes have lat/lon directly; ways/relations expose `center`.
        lat = el.get("lat")
        lon = el.get("lon")
        if lat is None or lon is None:
            center = el.get("center") or {}
            lat = center.get("lat")
            lon = center.get("lon")

        # Name: French preferred, then default `name`, else fall back gracefully.
        name = tags.get("name:fr") or tags.get("name") or tags.get("alt_name") or "Lieu sans nom"

        # Type detection: `building=*` is the most reliable, then fall back to
        # `place_of_worship:type=*` if present.
        church_type = (
            BUILDING_TO_TYPE.get(tags.get("building", ""))
            or BUILDING_TO_TYPE.get(tags.get("place_of_worship:type", ""))
            or "parish"
        )

        # Address: combine OSM addr:* tags. They are not always all present.
        address_bits = [tags.get("addr:housenumber"), tags.get("addr:street")]
        address = " ".join(b for b in address_bits if b) or None

        # Contact info — the `contact:*` namespace is preferred over plain tags.
        website = tags.get("contact:website") or tags.get("website") or None
        phone = tags.get("contact:phone") or tags.get("phone") or None
        email = tags.get("contact:email") or tags.get("email") or None

        # Country: OSM uses ISO codes occasionally, default to FR for our scope.
        country = (tags.get("addr:country") or "FR")[:2].upper()

        osm_type = el.get("type", "node")
        osm_id = el.get("id")
        external_id = f"osm/{osm_type}/{osm_id}"
        source_url = f"https://www.openstreetmap.org/{osm_type}/{osm_id}" if osm_id else None

        church = ScrapedChurch(
            name=name,
            type=church_type,
            address=address,
            city=tags.get("addr:city"),
            postal_code=tags.get("addr:postcode"),
            country=country,
            latitude=lat,
            longitude=lon,
            website=website,
            phone=phone,
            email=email,
            description=tags.get("description") or tags.get("description:fr"),
            source=self.name,
            source_url=source_url,
            external_id=external_id,
        )

        # OSM does not carry mass schedules; ingest the place only.
        return ScrapeResult(church=church, celebrations=[])
