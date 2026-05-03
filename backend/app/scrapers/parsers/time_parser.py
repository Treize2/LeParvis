"""Heuristic parser for natural-language schedule strings (FR + EN).

Examples it understands:
    "Messe le dimanche à 10h30"
    "Laudes 7h, vêpres 18h15"
    "Mass on Sunday at 11:00"
    "Confessions du lundi au vendredi de 17h à 18h"
    "Dimanche : messes à 9h, 10h30 et 18h"
    "18 h 30" (with internal spaces)
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import time

from unidecode import unidecode

# --- Vocabulaire -----------------------------------------------------------

CELEBRATION_KEYWORDS: dict[str, list[str]] = {
    "mass": ["messe", "messes", "eucharistie", "mass", "santa missa", "santa misa"],
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
    "vigil": ["vigile", "veillee", "vigil", "messe anticipee"],
}

DAY_INDEX: dict[str, int] = {
    "lundi": 0, "lundis": 0, "lun": 0, "monday": 0,
    "mardi": 1, "mardis": 1, "mar": 1, "tuesday": 1,
    "mercredi": 2, "mercredis": 2, "mer": 2, "wednesday": 2,
    "jeudi": 3, "jeudis": 3, "jeu": 3, "thursday": 3,
    "vendredi": 4, "vendredis": 4, "ven": 4, "friday": 4,
    "samedi": 5, "samedis": 5, "sam": 5, "saturday": 5,
    "dimanche": 6, "dimanches": 6, "dim": 6, "sunday": 6,
}

DAILY_KEYWORDS = ["chaque jour", "tous les jours", "quotidien", "quotidienne", "daily"]

# "Du lundi au vendredi", "lundi à vendredi", "lundi-vendredi"
DAY_RANGE_PATTERN = re.compile(
    r"\b(?:du\s+)?(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s*"
    r"(?:au|a|à|–|-|to)\s*"
    r"(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b"
)

# "en semaine" → Mon-Fri, "week-end" → Sat-Sun
WEEKDAYS_KEYWORDS = ["en semaine", "jours de semaine", "weekdays", "lun-ven", "mar-ven"]
WEEKEND_KEYWORDS = ["week-end", "weekend", "sam-dim"]

RITE_HINTS: dict[str, list[str]] = {
    "extraordinary": [
        "forme extraordinaire", "rite tridentin", "tridentin",
        "messe en latin", "1962", "missel de saint pie v",
    ],
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

# Loose: accepts "18h30", "18 h 30", "18:30", "18 H 30", and isolated "18h".
TIME_PATTERN = re.compile(
    r"(?<![\d.,])(?P<h>[0-2]?\d)\s*[hH:]\s*(?P<m>[0-5]\d)?\b",
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
            if re.search(rf"\b{re.escape(kw)}\b", text):
                return ctype
    return None


def _detect_days(text: str) -> list[int]:
    """Return the list of weekday indices implied by the fragment.

    Handles single days, day ranges ('du lundi au vendredi'), and the
    'en semaine' / 'week-end' shorthands. Returns an empty list when no
    day signal is found.
    """
    days: set[int] = set()

    if any(k in text for k in WEEKDAYS_KEYWORDS):
        days.update({0, 1, 2, 3, 4})
    if any(k in text for k in WEEKEND_KEYWORDS):
        days.update({5, 6})

    for m in DAY_RANGE_PATTERN.finditer(text):
        a = DAY_INDEX.get(m.group(1))
        b = DAY_INDEX.get(m.group(2))
        if a is None or b is None:
            continue
        if a <= b:
            days.update(range(a, b + 1))
        else:
            # Wrap around (rare: "samedi au mardi")
            days.update(range(a, 7))
            days.update(range(0, b + 1))

    if not days:
        for name, idx in DAY_INDEX.items():
            if re.search(rf"\b{name}\b", text):
                days.add(idx)

    return sorted(days)


def _is_daily(text: str) -> bool:
    return any(k in text for k in DAILY_KEYWORDS)


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

    The parser walks fragments separated by line-breaks, semicolons, or
    pipes (commas are deliberately kept intact: "messe à 10h, 11h, 18h"
    is one celebration with three times). Inside a fragment it looks for
    a celebration keyword, a day or day-range, and one or more times.

    When a fragment lacks an explicit type or day, the parser inherits
    the most recent context — a paragraph like

        Dimanche :
        - Messe à 10h30
        - Vêpres à 18h

    yields (mass, Sun, 10:30) + (vespers, Sun, 18:00) even though the
    second line never mentions Sunday.
    """
    if not raw:
        return []

    text = _normalize(raw)
    rite = _detect_rite(text)

    slots: list[ParsedSlot] = []

    current_type: str | None = None
    current_days: list[int] = []
    current_daily = False

    fragments = re.split(r"[\n\r;|]+", text)
    for fragment in fragments:
        # Trim whitespace + bullet/dash leading characters that prefix list items.
        fragment = fragment.strip().lstrip("-•· \t").rstrip()
        if not fragment:
            continue

        frag_type = _detect_celebration(fragment)
        frag_days = _detect_days(fragment)
        frag_daily = _is_daily(fragment)
        # Language is detected per-fragment to avoid 'espagnol' mentioned once
        # on a 'multilingue' note flagging every mass on the page as Spanish.
        language = _detect_language(fragment)

        # Inherit when missing
        ctype = frag_type or current_type
        days = frag_days or current_days
        daily = frag_daily or current_daily

        if ctype:
            for tmatch in TIME_PATTERN.finditer(fragment):
                tval = _extract_time(tmatch)
                if tval is None:
                    continue
                if days:
                    confidence = 0.75 if frag_days else 0.6
                    for d in days:
                        slots.append(
                            ParsedSlot(
                                type=ctype, day_of_week=d, start_time=tval,
                                rite=rite, language=language,
                                confidence=confidence,
                            )
                        )
                else:
                    # No day at all — only emit if 'daily' was hinted, else
                    # downgrade confidence so the upsert pipeline can ignore.
                    confidence = 0.55 if daily else 0.4
                    slots.append(
                        ParsedSlot(
                            type=ctype, day_of_week=None, start_time=tval,
                            rite=rite, language=language,
                            confidence=confidence,
                        )
                    )

        # Update rolling context for subsequent fragments
        if frag_type:
            current_type = frag_type
        if frag_days:
            current_days = frag_days
        elif frag_daily:
            current_days = []
            current_daily = True

    return slots
