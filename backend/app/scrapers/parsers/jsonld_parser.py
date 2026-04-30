"""Extract Catholic celebrations from `schema.org` JSON-LD blocks.

Many parish CMS (Notre-Dame en ligne, ParoissesNet, ChurchSuite, etc.) embed
events as `schema.org/Event`. This parser walks the JSON, identifies relevant
events, and converts them to ScrapedCelebration objects.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, time
from typing import Any, Iterable

from bs4 import BeautifulSoup

from ..base import ScrapedCelebration
from .time_parser import CELEBRATION_KEYWORDS, _normalize


def extract_jsonld_blocks(html: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "lxml")
    blocks: list[dict[str, Any]] = []
    for tag in soup.find_all("script", attrs={"type": "application/ld+json"}):
        try:
            data = json.loads(tag.string or "{}")
        except (json.JSONDecodeError, TypeError):
            continue
        if isinstance(data, list):
            blocks.extend(d for d in data if isinstance(d, dict))
        elif isinstance(data, dict):
            blocks.append(data)
    return blocks


def _is_event(node: dict) -> bool:
    t = node.get("@type")
    if isinstance(t, list):
        return any("Event" in x for x in t)
    return isinstance(t, str) and "Event" in t


def _detect_type(name: str | None, description: str | None) -> str | None:
    text = _normalize(" ".join(filter(None, [name, description])))
    for ctype, keywords in CELEBRATION_KEYWORDS.items():
        if any(kw in text for kw in keywords):
            return ctype
    return None


def _to_time(value: str | None) -> time | None:
    if not value:
        return None
    try:
        # Common forms: ISO 8601 or "HH:MM"
        if "T" in value:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).time()
        m = re.match(r"(\d{1,2}):(\d{2})", value)
        if m:
            return time(int(m.group(1)), int(m.group(2)))
    except Exception:
        return None
    return None


def _to_dow(value: str | None) -> int | None:
    if not value:
        return None
    mapping = {
        "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
        "friday": 4, "saturday": 5, "sunday": 6,
    }
    return mapping.get(value.lower().split("/")[-1])


def parse_jsonld_events(html: str, source_url: str | None = None) -> Iterable[ScrapedCelebration]:
    for block in extract_jsonld_blocks(html):
        nodes: list[dict] = []
        if "@graph" in block and isinstance(block["@graph"], list):
            nodes.extend(n for n in block["@graph"] if isinstance(n, dict))
        else:
            nodes.append(block)

        for node in nodes:
            if not _is_event(node):
                continue
            ctype = _detect_type(node.get("name"), node.get("description"))
            if ctype is None:
                continue
            start = node.get("startDate")
            day_of_week: int | None = None
            start_time: time | None = None
            if isinstance(start, str):
                try:
                    dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
                    day_of_week = dt.weekday()
                    start_time = dt.time()
                except ValueError:
                    pass

            # Some sites use eventSchedule: { byDay, startTime }
            schedule = node.get("eventSchedule") or {}
            if isinstance(schedule, dict):
                if start_time is None:
                    start_time = _to_time(schedule.get("startTime"))
                if day_of_week is None:
                    by_day = schedule.get("byDay")
                    if isinstance(by_day, list) and by_day:
                        day_of_week = _to_dow(by_day[0])
                    elif isinstance(by_day, str):
                        day_of_week = _to_dow(by_day)

            yield ScrapedCelebration(
                type=ctype,
                day_of_week=day_of_week,
                start_time=start_time,
                notes=node.get("description"),
                source="jsonld",
                source_url=source_url,
                confidence=0.85,
            )
