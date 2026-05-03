"""Generic HTML scraper for parish / monastery websites.

Strategy
--------
1. Try JSON-LD structured data (`schema.org/Event`).
2. Fall back to plain-text heuristics (``time_parser.parse_schedule``)
   on the body content of pages that look like schedule pages.
3. Extract church metadata from `<title>`, `<meta>`, and Open Graph tags.

This is intentionally permissive: it is much better to ingest a low-confidence
draft for an admin to review than to ingest nothing.
"""
from __future__ import annotations

from collections.abc import Iterable
from urllib.parse import urlparse

from bs4 import BeautifulSoup

from .base import ScrapedCelebration, ScrapedChurch, Scraper, ScrapeResult
from .parsers.jsonld_parser import parse_jsonld_events
from .parsers.time_parser import parse_schedule

SCHEDULE_KEYWORDS = ["horaire", "messes", "celebrations", "office", "schedule", "vepres", "laudes"]


class ParoisseHtmlScraper(Scraper):
    name = "paroisse_html"

    async def fetch(
        self,
        url: str,
        hint_type: str | None = None,
        force: bool = False,
    ) -> Iterable[ScrapeResult]:
        if not force and not Scraper.can_fetch(url):
            raise PermissionError(f"robots.txt forbids fetching {url}")
        response = await self._get(url)
        html = response.text

        church = self._extract_church(html, url, hint_type)
        celebrations = list(self._extract_celebrations(html, url))

        return [ScrapeResult(church=church, celebrations=celebrations)]

    # ---- extraction -----------------------------------------------------

    def _extract_church(self, html: str, url: str, hint_type: str | None) -> ScrapedChurch:
        soup = BeautifulSoup(html, "lxml")
        title_tag = soup.find("title")
        og_title = soup.find("meta", attrs={"property": "og:title"})
        og_image = soup.find("meta", attrs={"property": "og:image"})
        og_desc = soup.find("meta", attrs={"property": "og:description"})

        name = (og_title.get("content") if og_title else None) or (title_tag.get_text(strip=True) if title_tag else urlparse(url).hostname)

        # Address can sometimes be found inside structured data ; fallback: keep None.
        return ScrapedChurch(
            name=name or "Site paroissial",
            type=hint_type or "parish",
            description=og_desc.get("content") if og_desc else None,
            image_url=og_image.get("content") if og_image else None,
            website=url,
            source=self.name,
            source_url=url,
        )

    def _extract_celebrations(self, html: str, url: str) -> Iterable[ScrapedCelebration]:
        # 1) JSON-LD has the highest confidence.
        emitted = False
        for cel in parse_jsonld_events(html, source_url=url):
            emitted = True
            yield cel
        if emitted:
            return

        # 2) Heuristic: scan visible text in sections likely to hold a schedule.
        soup = BeautifulSoup(html, "lxml")
        candidate_text_blocks: list[str] = []
        for tag in soup.find_all(["section", "article", "div", "ul", "p"]):
            text = tag.get_text("\n", strip=True)
            if not text:
                continue
            lowered = text.lower()
            if any(k in lowered for k in SCHEDULE_KEYWORDS):
                candidate_text_blocks.append(text)

        # If nothing matched, take the body text as last resort.
        if not candidate_text_blocks:
            body = soup.find("body")
            candidate_text_blocks = [body.get_text("\n", strip=True)] if body else []

        seen: set[tuple] = set()
        for block in candidate_text_blocks:
            for slot in parse_schedule(block):
                key = (slot.type, slot.day_of_week, slot.start_time)
                if key in seen:
                    continue
                seen.add(key)
                yield ScrapedCelebration(
                    type=slot.type,
                    rite=slot.rite,
                    language=slot.language,
                    day_of_week=slot.day_of_week,
                    start_time=slot.start_time,
                    notes=slot.notes,
                    confidence=slot.confidence,
                    source=self.name,
                    source_url=url,
                )
