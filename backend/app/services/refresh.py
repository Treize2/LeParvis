"""Refresh every previously-imported parish by re-running its source scraper.

Each church refresh becomes a child `ImportRun` of a single parent run, so the
admin sees the batch as one entry that can be expanded.
"""
from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Church, ImportRun
from ..scrapers import IngestionPipeline, get_scraper_for_url
from ..scrapers.paroisse_html import ParoisseHtmlScraper
from ..scrapers.rendered_html import RenderedHtmlScraper
from .imports import track_import

logger = logging.getLogger(__name__)


async def refresh_all(db: Session, triggered_by: str = "admin") -> ImportRun:
    """Re-scrape every church that has a `source_url`. Returns the parent run.

    The parent is created up-front with status='pending'; each child is a
    full ImportRun tied via `parent_run_id`. Aggregated counters land on
    the parent once every child is done.
    """
    parent = ImportRun(
        kind="scheduled_refresh",
        status="pending",
        triggered_by=triggered_by,
    )
    db.add(parent)
    db.commit()
    db.refresh(parent)

    candidates = db.execute(
        select(Church).where(Church.source_url.is_not(None))
    ).scalars().all()

    total_created_cels = 0
    total_updated_cels = 0
    total_errors = 0

    for church in candidates:
        url = church.source_url
        if not url:
            continue
        try:
            await _refresh_one(db, church, url, parent_run_id=parent.id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("refresh failed for church %s (%s): %s", church.id, url, exc)
            total_errors += 1

    # Re-read children to aggregate.
    children = db.query(ImportRun).filter(ImportRun.parent_run_id == parent.id).all()
    succeeded = sum(1 for c in children if c.status == "success")
    failed = sum(1 for c in children if c.status == "error")
    total_created_cels = sum(c.celebrations_created for c in children)
    total_updated_cels = sum(c.celebrations_updated for c in children)
    total_errors = sum(c.errors_count for c in children) + total_errors

    parent.churches_updated = len(children)
    parent.celebrations_created = total_created_cels
    parent.celebrations_updated = total_updated_cels
    parent.errors_count = total_errors
    parent.fetched = len(children)
    parent.status = "success" if failed == 0 else ("partial" if succeeded else "error")
    parent.output = {
        "candidates": len(candidates),
        "succeeded": succeeded,
        "failed": failed,
    }
    from datetime import datetime
    parent.finished_at = datetime.utcnow()
    db.commit()
    db.refresh(parent)
    return parent


async def _refresh_one(
    db: Session,
    church: Church,
    url: str,
    *,
    parent_run_id: int,
) -> ImportRun:
    """Run the URL scraper for one church inside a child ImportRun."""
    scraper_cls = get_scraper_for_url(url)
    if scraper_cls not in (ParoisseHtmlScraper, RenderedHtmlScraper):
        scraper_cls = ParoisseHtmlScraper

    async def runner(run_id: int) -> IngestionPipeline:
        pipeline = IngestionPipeline(db, run_id=run_id)
        try:
            async with scraper_cls() as scraper:
                results = list(await scraper.fetch(url, force=True))
            # Force every result to attach to *this* church.
            for r in results:
                r.church.name = church.name
                r.church.source_url = url
            pipeline.run(results)
        except Exception as exc:  # noqa: BLE001
            pipeline.errors.append(f"{church.name}: {exc}")
        return pipeline

    return await track_import(
        db,
        kind="url",
        runner=runner,
        triggered_by="scheduler",
        parent_run_id=parent_run_id,
        input_url=url,
    )
