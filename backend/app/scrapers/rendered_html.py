"""Headless-browser scraper for JS-rendered parish pages.

Use case
--------
Sites that hydrate their schedules client-side (messes.info uses GWT-RPC,
some parish CMS use React/Vue) ship an HTML skeleton with no schedule data.
The plain `ParoisseHtmlScraper` sees only the loading shell. This scraper
opens the URL in headless Chromium, waits for the network to quiet down,
then runs the same JSON-LD + heuristic parsers against the hydrated DOM.

Trade-offs
----------
- Much heavier than ParoisseHtmlScraper: ~3-8 s per page vs <1 s.
- Adds ~400 MB to the Docker image (the Chromium binary).
- Therefore opt-in: callers must pass `render=True` on /api/ingest/url.

The Playwright import is lazy so that environments without Chromium
installed (CI, local dev, tests) still load the rest of the codebase.
"""
from __future__ import annotations

from collections.abc import Iterable
from urllib.parse import urlparse

from bs4 import BeautifulSoup

from .base import ScrapedCelebration, ScrapedChurch, Scraper, ScrapeResult
from .parsers.jsonld_parser import parse_jsonld_events
from .parsers.time_parser import parse_schedule

# Sites that ship a pure JS shell — recognised by the registry so the
# admin UI can flag them as "needs rendering".
SPA_DOMAINS = {
    "messes.info",
    "www.messes.info",
}


class RenderedHtmlScraper(Scraper):
    """Render a page in headless Chromium then run the regular parsers."""

    name = "rendered_html"

    # Hard bounds: pages that take longer are almost certainly broken.
    GOTO_TIMEOUT_MS = 30_000
    POST_NETWORK_IDLE_WAIT_MS = 1_200

    BROWSER_USER_AGENT = (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 "
        "(KHTML, like Gecko) Version/16.5 Safari/605.1.15"
    )

    # URL patterns that we refuse to ingest as a single church because
    # they're list/search pages aggregating many parishes. Importing them
    # would yield one fake "church" with the page title (e.g. "Recherche
    # d'horaires - 78150 MessesInfo") and a soup of unrelated celebration
    # times scraped from snippets.
    KNOWN_LIST_URL_PATTERNS = {
        "messes.info": ("/horaires/",),
        "www.messes.info": ("/horaires/",),
    }

    async def fetch(
        self,
        url: str,
        hint_type: str | None = None,
        force: bool = False,
    ) -> Iterable[ScrapeResult]:
        if not force and not Scraper.can_fetch(url):
            raise PermissionError(f"robots.txt forbids fetching {url}")

        self._reject_known_list_urls(url)

        html, title = await self._render(url)

        church = ScrapedChurch(
            name=self._extract_church_name(html, title, url),
            type=hint_type or "parish",
            website=url,
            source=self.name,
            source_url=url,
        )

        celebrations: list[ScrapedCelebration] = list(
            parse_jsonld_events(html, source_url=url)
        )

        if not celebrations:
            soup = BeautifulSoup(html, "lxml")
            body = soup.find("body")
            text = body.get_text("\n", strip=True) if body else ""
            seen: set[tuple] = set()
            for slot in parse_schedule(text):
                key = (slot.type, slot.day_of_week, slot.start_time)
                if key in seen:
                    continue
                seen.add(key)
                celebrations.append(
                    ScrapedCelebration(
                        type=slot.type,
                        rite=slot.rite,
                        language=slot.language,
                        day_of_week=slot.day_of_week,
                        start_time=slot.start_time,
                        confidence=slot.confidence,
                        source=self.name,
                        source_url=url,
                    )
                )

        return [ScrapeResult(church=church, celebrations=celebrations)]

    @classmethod
    def _reject_known_list_urls(cls, url: str) -> None:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        prefixes = cls.KNOWN_LIST_URL_PATTERNS.get(host)
        if not prefixes:
            return
        path = parsed.path or ""
        if any(path.startswith(p) for p in prefixes):
            raise ValueError(
                "Cette URL messes.info est une page de résultats qui liste "
                "plusieurs paroisses, pas une fiche unique. Va sur la fiche "
                "d'une paroisse spécifique (clique sur son nom dans la liste) "
                "et copie son URL ici. Pour découvrir les paroisses d'une "
                "zone, utilise plutôt l'import OpenStreetMap."
            )

    @staticmethod
    def _extract_church_name(html: str, page_title: str, url: str) -> str:
        """Prefer the first h1 over <title> — messes.info titles are
        often 'Recherche d'horaires - 78150 | MessesInfo', useless as a
        parish identity. Cleans known suffixes when we do fall back."""
        soup = BeautifulSoup(html, "lxml")
        h1 = soup.find("h1")
        if h1:
            name = h1.get_text(" ", strip=True)
            if name:
                return name
        if page_title:
            for suffix in (" | MessesInfo", " - MessesInfo", " - Messes.info",
                           " | Messes.info"):
                if page_title.endswith(suffix):
                    page_title = page_title[: -len(suffix)].strip()
                    break
            return page_title
        return urlparse(url).hostname or "Site paroissial"

    async def render(self, url: str) -> tuple[str, str]:
        """Public alias used by the preview endpoint."""
        return await self._render(url)

    async def _render(self, url: str) -> tuple[str, str]:
        # Lazy import — keep test environments and CI Chromium-free.
        try:
            from playwright.async_api import async_playwright
        except ImportError as exc:
            raise RuntimeError(
                "playwright is not installed in this environment. "
                "Install it with `pip install playwright` and run "
                "`playwright install --with-deps chromium`."
            ) from exc

        async with async_playwright() as p:
            browser = await p.chromium.launch(
                # --no-sandbox is required when running as root inside Docker.
                # --disable-dev-shm-usage avoids /dev/shm exhaustion on small
                # containers (the default 64 MB is too small for Chromium).
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            try:
                context = await browser.new_context(
                    user_agent=self.BROWSER_USER_AGENT,
                    viewport={"width": 1280, "height": 900},
                    locale="fr-FR",
                    timezone_id="Europe/Paris",
                )
                page = await context.new_page()
                try:
                    await page.goto(
                        url,
                        wait_until="networkidle",
                        timeout=self.GOTO_TIMEOUT_MS,
                    )
                except Exception:
                    # Some pages never reach networkidle (long-polling, ads,
                    # analytics). Fall back to DOMContentLoaded + a beat.
                    await page.goto(
                        url,
                        wait_until="domcontentloaded",
                        timeout=self.GOTO_TIMEOUT_MS,
                    )
                await page.wait_for_timeout(self.POST_NETWORK_IDLE_WAIT_MS)
                html = await page.content()
                title = await page.title()
            finally:
                await browser.close()
        return html, title or ""


def url_likely_needs_rendering(url: str) -> bool:
    """Suggest render=True when the host is a known SPA."""
    host = (urlparse(url).hostname or "").lower()
    if not host:
        return False
    if host in SPA_DOMAINS:
        return True
    return any(host.endswith("." + d) for d in SPA_DOMAINS)
