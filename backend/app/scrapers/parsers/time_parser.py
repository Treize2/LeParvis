"""Heuristic parser for natural-language schedule strings (FR + EN).

Examples it understands:
    "Messe le dimanche à 10h30"
    "Laudes 7h, vêpres 18h15"
    "Mass on Sunday at 11:00"
    "Confessions du lundi au vendredi de 17h à 18h"
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import time

from unidecode import unidecode

# --- Vocabulaire -----------------------------------------------------------

CELEBRATION_KEYWORDS: dict[str, list[str]] = {
    "mass": ["messe", "eucharistie", "mass", "santa missa", "santa misa"],
    "lauds": ["laudes", "lauds", "office du matin"],
    "tierce": ["tierce", "tierces"],
    "sext": ["sexte"],
    "none_office": ["none", "office du milieu"],
    "vespers": ["vepres", "vespers", "vespres"],
    "compline": ["complies", "compline"],
    "office_of_readings": ["office des lectures", "matines"],
    "adoration": ["adoration", "exposition du saint sacrement", "saint-sacrement"],
    "confession": ["confession", "confessions", "sacrement de reconciliation"],
    "chaplet": ["chapelet", "rosaire", "rosary"],
    "vigil": ["vigile", "veillee", "vigil"],
}

DAY_INDEX: dict[str, int] = {
    "lundi": 0, "monday": 0,
    "mardi": 1, "tuesday": 1,
    "mercredi": 2, "wednesday": 2,
    "jeudi": 3, "thursday": 3,
    "vendredi": 4, "friday": 4,
    "samedi": 5, "saturday": 5,
    "dimanche": 6, "sunday": 6,
}

DAILY_KEYWORDS = ["chaque jour", "tous les jours", "quotidien", "quotidienne", "daily"]

RITE_HINTS: dict[str, list[str]] = {
    "extraordinary": ["forme extraordinaire", "rite tridentin", "tridentin", "messe en latin", "1962"],
    "byzantine": ["byzantin", "byzantine"],
    "dominican": ["rite dominicain"],
    "ambrosian": ["rite ambrosien", "ambrosien"],
}

LANG_HINTS: dict[str, list[str]] = {
    "la": ["latin", "en latin"],
    "en": ["english", "in english"],
    "it": ["italiano", "italien"],
    "es": ["espanol", "espagnol"],
    "fr": [],
}

TIME_PATTERN = re.compile(
    r"(?P<h>[0-2]?\d)\s*[h:](?P<m>[0-5]\d)?",
)


# --- API -------------------------------------------------------------------


@dataclass
class ParsedSlot:
    type: str
    day_of_week: int | None
    start_time: time | None
    rite: str = "ordinary"
    language: str | None = None
    notes: str | None = None
    confidence: float = 0.5


def _normalize(s: str) -> str:
    return unidecode(s).lower()


def _detect_celebration(text: str) -> str | None:
    for ctype, keywords in CELEBRATION_KEYWORDS.items():
        for kw in keywords:
            if kw in text:
                return ctype
    return None


def _detect_day(text: str) -> int | None:
    for name, idx in DAY_INDEX.items():
        if re.search(rf"\b{name}\b", text):
            return idx
    if any(k in text for k in DAILY_KEYWORDS):
        return None  # daily
    return None


def _detect_rite(text: str) -> str:
    for rite, hints in RITE_HINTS.items():
        if any(h in text for h in hints):
            return rite
    return "ordinary"


def _detect_language(text: str) -> str | None:
    for code, hints in LANG_HINTS.items():
        if any(h in text for h in hints):
            return code
    return None


def _extract_time(match: re.Match) -> time | None:
    try:
        h = int(match.group("h"))
        m = int(match.group("m") or 0)
        if h > 23 or m > 59:
            return None
        return time(hour=h, minute=m)
    except Exception:
        return None


def parse_schedule(raw: str) -> list[ParsedSlot]:
    """Best-effort extraction of one or more `(type, day, time)` slots
    from a free-form schedule string.

    Returns an empty list when no signal is found — callers should treat
    a low-confidence empty parse as "skip".
    """
    if not raw:
        return []

    text = _normalize(raw)
    rite = _detect_rite(text)
    language = _detect_language(text)

    slots: list[ParsedSlot] = []

    # Iterate sentence-like fragments (split on common separators)
    fragments = re.split(r"[\n\r;,•|]+", text)
    for fragment in fragments:
        fragment = fragment.strip()
        if not fragment:
            continue
        ctype = _detect_celebration(fragment)
        if ctype is None:
            continue
        day = _detect_day(fragment)
        for tmatch in TIME_PATTERN.finditer(fragment):
            tval = _extract_time(tmatch)
            if tval is None:
                continue
            slots.append(
                ParsedSlot(
                    type=ctype,
                    day_of_week=day,
                    start_time=tval,
                    rite=rite,
                    language=language,
                    notes=None,
                    confidence=0.7 if (day is not None or "dimanche" in fragment) else 0.55,
                )
            )

    return slots
