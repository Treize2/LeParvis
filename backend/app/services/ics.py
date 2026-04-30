from datetime import date, datetime, timedelta

from ics import Calendar, Event
from ics.grammar.parse import ContentLine

from ..models import Celebration, Church


_DAY_NAMES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]


def celebration_to_ics(celebration: Celebration, church: Church) -> str:
    """Render a recurring celebration as an iCalendar payload (single event with RRULE)."""
    cal = Calendar()
    event = Event()

    label_map = {
        "mass": "Messe",
        "lauds": "Laudes",
        "vespers": "Vêpres",
        "compline": "Complies",
        "adoration": "Adoration",
        "confession": "Confessions",
        "chaplet": "Chapelet",
        "vigil": "Vigile",
    }
    label = label_map.get(celebration.type, celebration.type.title())
    event.name = f"{label} — {church.name}"
    event.location = ", ".join(filter(None, [church.address, church.city]))
    if church.website:
        event.url = church.website
    if celebration.notes:
        event.description = celebration.notes

    today = date.today()
    if celebration.day_of_week is not None:
        delta = (celebration.day_of_week - today.weekday()) % 7
        anchor_day = today + timedelta(days=delta)
    else:
        anchor_day = today

    start_time = celebration.start_time or datetime.min.time().replace(hour=8)
    event.begin = datetime.combine(anchor_day, start_time)
    end_time = celebration.end_time or (datetime.combine(anchor_day, start_time) + timedelta(minutes=45)).time()
    event.end = datetime.combine(anchor_day, end_time)

    if celebration.day_of_week is not None:
        rrule = f"FREQ=WEEKLY;BYDAY={_DAY_NAMES[celebration.day_of_week]}"
    else:
        rrule = "FREQ=DAILY"
    event.extra.append(ContentLine(name="RRULE", value=rrule))

    cal.events.add(event)
    return cal.serialize()
