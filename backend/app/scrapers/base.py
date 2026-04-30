from __future__ import annotations

import abc
import hashlib
import json
import os
import time as _time
from dataclasses import asdict, dataclass, field
from datetime import datetime, time
from typing import Iterable
from urllib.robotparser import RobotFileParser

import httpx

from ..config import settings


@dataclass
class ScrapedChurch:
    name: str
    type: str = "parish"
    community: str | None = None
    address: str | None = None
    city: str | None = None
    postal_code: str | None = None
    country: str = "FR"
    latitude: float | None = None
    longitude: float | None = None
    diocese: str | None = None
    website: str | None = None
    phone: str | None = None
    email: str | None = None
    description: str | None = None
    image_url: str | None = None
    source: str | None = None
    source_url: str | None = None
    external_id: str | None = None  # used to dedupe across runs


@dataclass
class ScrapedCelebration:
    type: str
    rite: str = "ordinary"
    language: str | None = None
    day_of_week: int | None = None
    start_time: time | None = None
    end_time: time | None = None
    recurrence_rule: str | None = None
    notes: str | None = None
    confidence: float = 0.5
    source: str | None = None
    source_url: str | None = None


@dataclass
class ScrapeResult:
    church: ScrapedChurch
    celebrations: list[ScrapedCelebration] = field(default_factory=list)


class Scraper(abc.ABC):
    """Base interface for a source-specific scraper."""

    name: str = "base"

    def __init__(self, client: httpx.AsyncClient | None = None):
        self._client = client
        self._owns_client = client is None

    async def __aenter__(self) -> "Scraper":
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=settings.scraper_timeout,
                headers={"User-Agent": settings.scraper_user_agent},
                follow_redirects=True,
            )
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    @abc.abstractmethod
    async def fetch(self, *args, **kwargs) -> Iterable[ScrapeResult]:
        ...

    # ---- Helpers --------------------------------------------------------

    async def _get(self, url: str, **kwargs) -> httpx.Response:
        cached = _cache_read(url)
        if cached is not None:
            return cached
        assert self._client is not None
        await _polite_delay()
        response = await self._client.get(url, **kwargs)
        response.raise_for_status()
        _cache_write(url, response)
        return response

    @staticmethod
    def can_fetch(url: str, user_agent: str = settings.scraper_user_agent) -> bool:
        """Check robots.txt compliance. Failures are treated as 'allowed'
        (many small parish websites do not host a robots.txt)."""
        try:
            from urllib.parse import urlparse

            parsed = urlparse(url)
            robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
            rp = RobotFileParser()
            rp.set_url(robots_url)
            rp.read()
            return rp.can_fetch(user_agent, url)
        except Exception:
            return True


# ---------- Polite client helpers ----------------------------------------

_LAST_REQUEST_AT = 0.0


async def _polite_delay(min_interval: float = 0.4) -> None:
    """Throttle sequential requests to be a courteous client."""
    global _LAST_REQUEST_AT
    elapsed = _time.monotonic() - _LAST_REQUEST_AT
    if elapsed < min_interval:
        import asyncio

        await asyncio.sleep(min_interval - elapsed)
    _LAST_REQUEST_AT = _time.monotonic()


def _cache_path(url: str) -> str:
    digest = hashlib.sha1(url.encode()).hexdigest()
    os.makedirs(settings.scraper_cache_dir, exist_ok=True)
    return os.path.join(settings.scraper_cache_dir, f"{digest}.json")


def _cache_read(url: str, ttl_seconds: int = 24 * 3600) -> httpx.Response | None:
    path = _cache_path(url)
    if not os.path.exists(path):
        return None
    if _time.time() - os.path.getmtime(path) > ttl_seconds:
        return None
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    request = httpx.Request("GET", url)
    return httpx.Response(
        status_code=data["status_code"],
        headers=data["headers"],
        content=data["text"].encode("utf-8"),
        request=request,
    )


def _cache_write(url: str, response: httpx.Response) -> None:
    path = _cache_path(url)
    payload = {
        "status_code": response.status_code,
        "headers": dict(response.headers),
        "text": response.text,
        "fetched_at": datetime.utcnow().isoformat(),
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f)


def to_dict(obj) -> dict:
    return asdict(obj)
