from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas import IngestArea, IngestReport, IngestUrlRequest
from ..scrapers import IngestionPipeline, get_scraper_for_url
from ..scrapers.osm_overpass import OsmOverpassScraper
from ..scrapers.paroisse_html import ParoisseHtmlScraper

router = APIRouter(prefix="/api/ingest", tags=["ingest"])


async def _ingest_area(area: IngestArea, db: Session) -> IngestReport:
    pipeline = IngestionPipeline(db)
    fetched = 0
    try:
        async with OsmOverpassScraper() as scraper:
            results = list(await scraper.fetch(
                latitude=area.latitude,
                longitude=area.longitude,
                radius_km=area.radius_km,
                limit=area.limit,
            ))
        fetched = len(results)
        pipeline.run(results)
    except Exception as exc:  # noqa: BLE001
        pipeline.errors.append(str(exc))
    return IngestReport(
        fetched=fetched,
        created_churches=pipeline.created_churches,
        updated_churches=pipeline.updated_churches,
        created_celebrations=pipeline.created_celebrations,
        updated_celebrations=pipeline.updated_celebrations,
        errors=pipeline.errors,
        samples=pipeline.samples,
    )


@router.post("/osm", response_model=IngestReport)
async def ingest_osm(area: IngestArea, db: Session = Depends(get_db)):
    """Find Catholic places of worship in a radius via OpenStreetMap Overpass.

    Populates the church catalogue (no celebration times — use /api/ingest/url
    on individual parish websites for schedules).
    """
    return await _ingest_area(area, db)


# Backward-compat alias for the old messes.info endpoint. The upstream API
# disappeared; we now serve the same payload from OSM Overpass.
@router.post("/messesinfo", response_model=IngestReport, deprecated=True)
async def ingest_messes_info_alias(area: IngestArea, db: Session = Depends(get_db)):
    return await _ingest_area(area, db)


@router.post("/url", response_model=IngestReport)
async def ingest_url(request: IngestUrlRequest, db: Session = Depends(get_db)):
    scraper_cls = get_scraper_for_url(request.url)
    pipeline = IngestionPipeline(db)
    fetched = 0
    try:
        async with scraper_cls() as scraper:
            if isinstance(scraper, ParoisseHtmlScraper):
                results = list(await scraper.fetch(
                    request.url,
                    hint_type=request.hint_type,
                    force=request.force,
                ))
            else:
                raise HTTPException(
                    status_code=400,
                    detail="This URL is handled by a domain-specific scraper. Use the dedicated endpoint.",
                )
        fetched = len(results)
        pipeline.run(results)
    except PermissionError as exc:
        # Distinct status code so the frontend can offer a "force" retry.
        raise HTTPException(
            status_code=451,  # Unavailable For Legal Reasons — semantically closest
            detail={
                "error": "robots_disallowed",
                "url": request.url,
                "message": str(exc),
                "hint": "Renvoie la requête avec `force=true` si tu acceptes la responsabilité.",
            },
        ) from exc
    except Exception as exc:  # noqa: BLE001
        pipeline.errors.append(str(exc))
    return IngestReport(
        fetched=fetched,
        created_churches=pipeline.created_churches,
        updated_churches=pipeline.updated_churches,
        created_celebrations=pipeline.created_celebrations,
        updated_celebrations=pipeline.updated_celebrations,
        errors=pipeline.errors,
        samples=pipeline.samples,
    )
