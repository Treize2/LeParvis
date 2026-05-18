"""Aggregated statistics for the admin dashboard.

Single SQL pass per metric, no in-memory iteration of the full catalog —
this stays cheap even with tens of thousands of churches.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from ..models import Celebration, Church, ImportRun, Suggestion


def compute_stats(db: Session) -> dict[str, Any]:
    return {
        "overview": _overview(db),
        "churches_by_type": _bucket(db, Church.type),
        "churches_by_community": _bucket(db, Church.community, drop_null=True),
        "churches_by_source": _bucket(db, Church.source, drop_null=True),
        "top_dioceses": _bucket(db, Church.diocese, drop_null=True, limit=10),
        "top_cities": _bucket(db, Church.city, drop_null=True, limit=10),
        "celebrations_by_type": _bucket(db, Celebration.type),
        "celebrations_by_rite": _bucket(db, Celebration.rite),
        "celebrations_by_day": _celebrations_by_day(db),
        "celebrations_by_hour": _celebrations_by_hour(db),
        "imports_by_status": _bucket(db, ImportRun.status),
        "imports_by_kind": _bucket(db, ImportRun.kind),
        "imports_timeseries": _imports_timeseries(db, days=30),
        "freshness": _freshness(db),
    }


def _overview(db: Session) -> dict[str, Any]:
    total_churches = db.scalar(select(func.count(Church.id))) or 0
    total_celebrations = db.scalar(select(func.count(Celebration.id))) or 0
    with_celebrations = db.scalar(
        select(func.count(func.distinct(Celebration.church_id)))
    ) or 0
    with_website = db.scalar(
        select(func.count(Church.id)).where(Church.website.is_not(None), Church.website != "")
    ) or 0
    with_phone = db.scalar(
        select(func.count(Church.id)).where(Church.phone.is_not(None), Church.phone != "")
    ) or 0
    with_email = db.scalar(
        select(func.count(Church.id)).where(Church.email.is_not(None), Church.email != "")
    ) or 0
    with_coords = db.scalar(
        select(func.count(Church.id)).where(Church.latitude.is_not(None), Church.longitude.is_not(None))
    ) or 0
    imports_total = db.scalar(select(func.count(ImportRun.id))) or 0
    seven_days_ago = datetime.utcnow() - timedelta(days=7)
    imports_last_7d = db.scalar(
        select(func.count(ImportRun.id)).where(ImportRun.started_at >= seven_days_ago)
    ) or 0
    suggestions_pending = db.scalar(
        select(func.count(Suggestion.id)).where(Suggestion.status == "pending")
    ) or 0
    return {
        "total_churches": total_churches,
        "total_celebrations": total_celebrations,
        "churches_with_celebrations": with_celebrations,
        "celebrations_per_church": (
            round(total_celebrations / total_churches, 2) if total_churches else 0
        ),
        "coverage_celebrations_pct": (
            round(with_celebrations * 100 / total_churches, 1) if total_churches else 0
        ),
        "coverage_website_pct": (
            round(with_website * 100 / total_churches, 1) if total_churches else 0
        ),
        "coverage_phone_pct": (
            round(with_phone * 100 / total_churches, 1) if total_churches else 0
        ),
        "coverage_email_pct": (
            round(with_email * 100 / total_churches, 1) if total_churches else 0
        ),
        "coverage_coords_pct": (
            round(with_coords * 100 / total_churches, 1) if total_churches else 0
        ),
        "with_website": with_website,
        "with_phone": with_phone,
        "with_email": with_email,
        "with_coords": with_coords,
        "imports_total": imports_total,
        "imports_last_7d": imports_last_7d,
        "suggestions_pending": suggestions_pending,
    }


def _bucket(
    db: Session,
    column,
    drop_null: bool = False,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    """SELECT column, COUNT(*) GROUP BY column ORDER BY count DESC."""
    stmt = select(column.label("k"), func.count().label("n")).group_by(column)
    if drop_null:
        stmt = stmt.where(column.is_not(None), column != "")
    stmt = stmt.order_by(func.count().desc())
    if limit:
        stmt = stmt.limit(limit)
    rows = db.execute(stmt).all()
    return [{"key": r.k, "count": r.n} for r in rows]


def _celebrations_by_day(db: Session) -> list[dict[str, Any]]:
    """Index 0=Monday … 6=Sunday. NULL day_of_week (quotidien/variable)
    is bucketed under the special key 'any'."""
    rows = db.execute(
        select(Celebration.day_of_week, func.count())
        .group_by(Celebration.day_of_week)
    ).all()
    counts = {i: 0 for i in range(7)}
    any_day = 0
    for day, n in rows:
        if day is None:
            any_day = n
        elif 0 <= day <= 6:
            counts[day] = n
    return [
        *[{"key": i, "count": counts[i]} for i in range(7)],
        {"key": "any", "count": any_day},
    ]


def _celebrations_by_hour(db: Session) -> list[dict[str, Any]]:
    """Histogram by start hour (0..23). NULL start times are skipped.

    We pull start_time values and bucket in Python — engine-agnostic,
    and cheap enough at admin-dashboard scale."""
    buckets = {h: 0 for h in range(24)}
    rows = db.execute(
        select(Celebration.start_time).where(Celebration.start_time.is_not(None))
    ).all()
    for (start,) in rows:
        if start is None:
            continue
        h = getattr(start, "hour", None)
        if h is None:
            continue
        if 0 <= h < 24:
            buckets[h] += 1
    return [{"key": h, "count": buckets[h]} for h in range(24)]


def _imports_timeseries(db: Session, days: int = 30) -> list[dict[str, Any]]:
    """One row per day for the last N days: runs + errors counts.

    Fills missing days with zeros so the chart shows a continuous timeline."""
    cutoff = datetime.utcnow().date() - timedelta(days=days - 1)
    rows = db.execute(
        select(
            func.date(ImportRun.started_at).label("d"),
            func.count().label("n"),
            func.sum(case((ImportRun.status == "error", 1), else_=0)).label("err"),
            func.sum(case((ImportRun.status == "success", 1), else_=0)).label("ok"),
        )
        .where(func.date(ImportRun.started_at) >= cutoff)
        .group_by("d")
    ).all()
    by_day: dict[str, dict[str, int]] = defaultdict(lambda: {"runs": 0, "errors": 0, "success": 0})
    for d, n, err, ok in rows:
        by_day[str(d)] = {"runs": int(n or 0), "errors": int(err or 0), "success": int(ok or 0)}
    series: list[dict[str, Any]] = []
    today = date.today()
    for i in range(days):
        d = today - timedelta(days=days - 1 - i)
        key = d.isoformat()
        v = by_day.get(key, {"runs": 0, "errors": 0, "success": 0})
        series.append({"date": key, **v})
    return series


def _freshness(db: Session) -> dict[str, int]:
    """How many churches haven't been re-confirmed by a scrape recently."""
    now = datetime.utcnow()
    stale_30 = db.scalar(
        select(func.count(Church.id)).where(
            Church.last_seen_at < now - timedelta(days=30)
        )
    ) or 0
    stale_90 = db.scalar(
        select(func.count(Church.id)).where(
            Church.last_seen_at < now - timedelta(days=90)
        )
    ) or 0
    fresh_7 = db.scalar(
        select(func.count(Church.id)).where(
            Church.last_seen_at >= now - timedelta(days=7)
        )
    ) or 0
    never_seen = db.scalar(
        select(func.count(Church.id)).where(Church.last_seen_at.is_(None))
    ) or 0
    return {
        "fresh_7d": fresh_7,
        "stale_30d": stale_30,
        "stale_90d": stale_90,
        "never_seen": never_seen,
    }
