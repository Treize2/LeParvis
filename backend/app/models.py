from datetime import datetime, time

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Church(Base):
    __tablename__ = "churches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    slug: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    type: Mapped[str] = mapped_column(String(32), index=True)
    community: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)

    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    city: Mapped[str | None] = mapped_column(String(120), index=True, nullable=True)
    postal_code: Mapped[str | None] = mapped_column(String(20), index=True, nullable=True)
    country: Mapped[str] = mapped_column(String(2), default="FR", index=True)

    latitude: Mapped[float | None] = mapped_column(Float, nullable=True, index=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True, index=True)

    diocese: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    website: Mapped[str | None] = mapped_column(String(512), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    email: Mapped[str | None] = mapped_column(String(120), nullable=True)

    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(512), nullable=True)

    source: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # The import that originally created this row — used for cascade delete
    # when the user wipes an import run from the admin.
    created_by_import_id: Mapped[int | None] = mapped_column(
        ForeignKey("import_runs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    celebrations: Mapped[list["Celebration"]] = relationship(
        back_populates="church", cascade="all, delete-orphan"
    )


class Celebration(Base):
    __tablename__ = "celebrations"
    __table_args__ = (
        UniqueConstraint(
            "church_id", "type", "day_of_week", "start_time", "rite",
            name="uq_celebration_slot",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    church_id: Mapped[int] = mapped_column(ForeignKey("churches.id", ondelete="CASCADE"), index=True)

    type: Mapped[str] = mapped_column(String(32), index=True)
    rite: Mapped[str] = mapped_column(String(32), default="ordinary", index=True)
    language: Mapped[str | None] = mapped_column(String(8), nullable=True)

    # day_of_week: 0=Monday … 6=Sunday ; null = quotidien / variable
    day_of_week: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    start_time: Mapped[time | None] = mapped_column(Time, nullable=True, index=True)
    end_time: Mapped[time | None] = mapped_column(Time, nullable=True)

    recurrence_rule: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.5)

    source: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # The import that created (or last touched) this row. Lets us delete
    # exactly the celebrations a given run added, without deleting the
    # parent church.
    created_by_import_id: Mapped[int | None] = mapped_column(
        ForeignKey("import_runs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    church: Mapped[Church] = relationship(back_populates="celebrations")


class ImportRun(Base):
    """One execution of an ingest pipeline — OSM import, single-URL scrape,
    or a scheduled refresh. Lets the admin see what happened, replay it,
    or undo it (cascade-delete the rows it created)."""

    __tablename__ = "import_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # osm | url | scheduled_refresh | reimport
    kind: Mapped[str] = mapped_column(String(32), index=True)

    # Snapshot of the input — enough to replay the run exactly.
    input_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    input_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    input_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    input_radius_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    input_render: Mapped[bool] = mapped_column(Boolean, default=False)
    input_force: Mapped[bool] = mapped_column(Boolean, default=False)
    input_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    input_hint_type: Mapped[str | None] = mapped_column(String(32), nullable=True)

    # pending | success | partial | error
    status: Mapped[str] = mapped_column(String(20), index=True, default="pending")

    fetched: Mapped[int] = mapped_column(Integer, default=0)
    churches_created: Mapped[int] = mapped_column(Integer, default=0)
    churches_updated: Mapped[int] = mapped_column(Integer, default=0)
    celebrations_created: Mapped[int] = mapped_column(Integer, default=0)
    celebrations_updated: Mapped[int] = mapped_column(Integer, default=0)
    errors_count: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Free-form JSON for samples / per-row error list / debug payload.
    output: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # admin | scheduler
    triggered_by: Mapped[str] = mapped_column(String(20), default="admin", index=True)
    # When this run is a child of a "refresh all" batch.
    parent_run_id: Mapped[int | None] = mapped_column(
        ForeignKey("import_runs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Suggestion(Base):
    __tablename__ = "suggestions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    church_id: Mapped[int | None] = mapped_column(
        ForeignKey("churches.id", ondelete="SET NULL"), nullable=True
    )
    payload: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    submitter_email: Mapped[str | None] = mapped_column(String(120), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
