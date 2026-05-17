from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas import IngestArea, IngestReport, IngestUrlRequest
from ..scrapers import IngestionPipeline, get_scraper_for_url
from ..scrapers.osm_overpass import OsmOverpassScraper
from ..scrapers.paroisse_html import ParoisseHtmlScraper
from ..scrapers.parsers.jsonld_parser import parse_jsonld_events
from ..scrapers.parsers.time_parser import parse_schedule
from ..scrapers.rendered_html import RenderedHtmlScraper, url_likely_needs_rendering
from ..services.imports import track_import

router = APIRouter(prefix="/api/ingest", tags=["ingest"])


async def _ingest_area(area: IngestArea, db: Session) -> IngestReport:
    async def runner(run_id: int) -> IngestionPipeline:
        pipeline = IngestionPipeline(db, run_id=run_id)
        try:
            async with OsmOverpassScraper() as scraper:
                results = list(await scraper.fetch(
                    latitude=area.latitude,
                    longitude=area.longitude,
                    radius_km=area.radius_km,
                    limit=area.limit,
                ))
            pipeline.run(results)
        except Exception as exc:  # noqa: BLE001
            pipeline.errors.append(str(exc))
        return pipeline

    run = await track_import(
        db,
        kind="osm",
        runner=runner,
        input_latitude=area.latitude,
        input_longitude=area.longitude,
        input_radius_km=area.radius_km,
        input_limit=area.limit,
    )
    # The pipeline lives only inside runner(); re-read counters off the run.
    return IngestReport(
        fetched=run.fetched,
        created_churches=run.churches_created,
        updated_churches=run.churches_updated,
        created_celebrations=run.celebrations_created,
        updated_celebrations=run.celebrations_updated,
        errors=(run.output or {}).get("errors", []) or ([run.error_message] if run.error_message else []),
        samples=(run.output or {}).get("samples", []),
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
    # Pick the scraper: render flag forces headless Chromium; otherwise
    # fall back to the registry's choice (currently ParoisseHtmlScraper for
    # any non-domain-specific URL).
    if request.render:
        scraper_cls = RenderedHtmlScraper
    else:
        scraper_cls = get_scraper_for_url(request.url)

    raised: dict[str, Exception] = {}

    async def runner(run_id: int) -> IngestionPipeline:
        pipeline = IngestionPipeline(db, run_id=run_id)
        try:
            async with scraper_cls() as scraper:
                if isinstance(scraper, ParoisseHtmlScraper | RenderedHtmlScraper):
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
            pipeline.run(results)
        except PermissionError as exc:
            raised["robots"] = exc
            pipeline.errors.append(f"robots_disallowed: {exc}")
        except ValueError as exc:
            # Scraper-side validation (e.g. messes.info list URL refused).
            # Record the error in the run + surface as 400 below.
            raised["bad_url"] = exc
            pipeline.errors.append(str(exc))
        except Exception as exc:  # noqa: BLE001
            pipeline.errors.append(str(exc))
        return pipeline

    run = await track_import(
        db,
        kind="url",
        runner=runner,
        input_url=request.url,
        input_render=request.render,
        input_force=request.force,
        input_hint_type=request.hint_type,
    )

    if "robots" in raised:
        # Surface the 451 to the frontend after the run is recorded.
        raise HTTPException(
            status_code=451,
            detail={
                "error": "robots_disallowed",
                "url": request.url,
                "message": str(raised["robots"]),
                "hint": "Renvoie la requête avec `force=true` si tu acceptes la responsabilité.",
            },
        )

    if "bad_url" in raised:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "unsupported_url",
                "url": request.url,
                "message": str(raised["bad_url"]),
            },
        )

    return IngestReport(
        fetched=run.fetched,
        created_churches=run.churches_created,
        updated_churches=run.churches_updated,
        created_celebrations=run.celebrations_created,
        updated_celebrations=run.celebrations_updated,
        errors=(run.output or {}).get("errors", []) or ([run.error_message] if run.error_message else []),
        samples=(run.output or {}).get("samples", []),
    )


@router.post("/preview")
async def preview_url(request: IngestUrlRequest):
    """Diagnose an ingest target *without* writing to the database.

    Returns:
      - mode: 'http' or 'rendered' depending on request.render
      - http: status code (or 200 when rendered), content-type, length
      - jsonld_events: count of schema.org/Event entries detected
      - candidates: text fragments that contain schedule keywords (truncated)
      - parsed_from_body: the slots that would be persisted
      - hints: per-source advice (e.g. 'site is a SPA, retry with render=true')

    Use this to understand why a particular parish page yields zero schedules.
    """
    html: str
    status: int
    content_type: str | None
    hints: list[str] = []

    if request.render:
        try:
            renderer = RenderedHtmlScraper()
            html, _ = await renderer.render(request.url)
            status = 200
            content_type = "text/html (rendered)"
        except PermissionError as exc:
            raise HTTPException(status_code=451, detail=str(exc)) from exc
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=502, detail=f"render failed: {exc}") from exc
    else:
        async with ParoisseHtmlScraper() as scraper:
            try:
                response = await scraper._get(request.url)  # noqa: SLF001 — diagnostic
            except PermissionError as exc:
                raise HTTPException(status_code=451, detail=str(exc)) from exc
            except Exception as exc:  # noqa: BLE001
                raise HTTPException(status_code=502, detail=f"fetch failed: {exc}") from exc
        html = response.text
        status = response.status_code
        content_type = response.headers.get("content-type")

        if url_likely_needs_rendering(request.url):
            hints.append(
                "Ce site est connu pour rendre ses horaires en JavaScript "
                "(SPA). Réessaie avec `render: true` pour utiliser un "
                "navigateur headless."
            )

    jsonld_events = list(parse_jsonld_events(html, source_url=request.url))

    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")
    keywords = [
        "horaire", "messe", "celebration", "office", "vepres", "laudes",
        "adoration", "confession",
    ]
    candidates: list[str] = []
    for tag in soup.find_all(["section", "article", "div", "ul", "p", "table"]):
        text = tag.get_text("\n", strip=True)
        if not text:
            continue
        lowered = text.lower()
        if any(k in lowered for k in keywords):
            candidates.append(text[:600])
        if len(candidates) >= 10:
            break

    body_text = (soup.find("body") or soup).get_text("\n", strip=True)
    parsed_from_body = parse_schedule(body_text)

    if not request.render and not jsonld_events and not parsed_from_body and len(html) < 50_000:
        hints.append(
            "L'HTML reçu est court et ne contient ni JSON-LD ni motif "
            "horaire reconnu. Si le site charge ses données après chargement, "
            "réessaie avec `render: true`."
        )

    return {
        "mode": "rendered" if request.render else "http",
        "http": {
            "status": status,
            "content_type": content_type,
            "bytes": len(html),
        },
        "jsonld_events": len(jsonld_events),
        "candidates": candidates,
        "parsed_from_body": [
            {
                "type": s.type,
                "day_of_week": s.day_of_week,
                "start_time": s.start_time.isoformat() if s.start_time else None,
                "rite": s.rite,
                "confidence": s.confidence,
            }
            for s in parsed_from_body
        ][:50],
        "hints": hints,
    }
