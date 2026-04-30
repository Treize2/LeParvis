"""Match a URL to the right scraper implementation."""
from __future__ import annotations

from urllib.parse import urlparse

from .base import Scraper
from .messes_info import MessesInfoScraper
from .paroisse_html import ParoisseHtmlScraper

# Domain-specific scrapers are tried first (longest-match), then we fall back
# to the generic parish HTML scraper.
DOMAIN_SCRAPERS: dict[str, type[Scraper]] = {
    "messes.info": MessesInfoScraper,
    "egliseinfo.catholique.fr": MessesInfoScraper,
    "api.egliseinfo.catholique.fr": MessesInfoScraper,
}


def get_scraper_for_url(url: str) -> type[Scraper]:
    host = (urlparse(url).hostname or "").lower()
    for domain, scraper in DOMAIN_SCRAPERS.items():
        if host == domain or host.endswith("." + domain):
            return scraper
    return ParoisseHtmlScraper
