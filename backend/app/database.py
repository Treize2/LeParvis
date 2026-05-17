from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from . import models  # noqa: F401  (register models)

    Base.metadata.create_all(bind=engine)
    _migrate_existing_tables()


def _migrate_existing_tables() -> None:
    """Apply ALTER TABLE for columns that were added after the initial
    create_all() — SQLAlchemy's create_all is idempotent for whole tables
    but never modifies existing ones. Each ALTER is guarded by a column
    existence check so it's safe to run on every startup."""
    from sqlalchemy import inspect, text

    insp = inspect(engine)
    existing_tables = set(insp.get_table_names())

    def _has_col(table: str, col: str) -> bool:
        if table not in existing_tables:
            return True  # create_all will (or did) build it from scratch
        return any(c["name"] == col for c in insp.get_columns(table))

    alters: list[str] = []
    if not _has_col("churches", "created_by_import_id"):
        alters.append("ALTER TABLE churches ADD COLUMN created_by_import_id INTEGER")
    if not _has_col("celebrations", "created_by_import_id"):
        alters.append("ALTER TABLE celebrations ADD COLUMN created_by_import_id INTEGER")

    if not alters:
        return
    with engine.begin() as conn:
        for stmt in alters:
            conn.execute(text(stmt))
