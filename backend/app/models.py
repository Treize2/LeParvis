from datetime import datetime, time

from sqlalchemy import (
    JSON,
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

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    church: Mapped[Church] = relationship(back_populates="celebrations")


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
