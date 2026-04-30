from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas import IngestArea, IngestReport, IngestUrlRequest
from ..scrapers import IngestionPipeline, get_scraper_for_url
from ..scrapers.messes_info import MessesInfoScraper
from ..scrapers.paroisse_html import ParoisseHtmlScraper

router = APIRouter(prefix="/api/ingest", tags=["ingest"])


@router.post("/messesinfo", response_model=IngestReport)
async def ingest_messes_info(area: IngestArea, db: Session = Depends(get_db)):
    pipeline = IngestionPipeline(db)
    fetched = 0
    try:
        async with MessesInfoScraper() as scraper:
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


@router.post("/url", response_model=IngestReport)
async def ingest_url(request: IngestUrlRequest, db: Session = Depends(get_db)):
    scraper_cls = get_scraper_for_url(request.url)
    pipeline = IngestionPipeline(db)
    fetched = 0
    try:
        async with scraper_cls() as scraper:
            if isinstance(scraper, ParoisseHtmlScraper):
                results = list(await scraper.fetch(request.url, hint_type=request.hint_type))
            else:
                raise HTTPException(
                    status_code=400,
                    detail="This URL is handled by a domain-specific scraper. Use the dedicated endpoint.",
                )
        fetched = len(results)
        pipeline.run(results)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
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
