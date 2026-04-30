"""Pytest setup: redirect every test session to a disposable SQLite file.

Must run **before** any `app.*` import so that the SQLAlchemy engine is built
against the test DB rather than the developer's local one.
"""
import os
import tempfile

import pytest

_fd, _DB_PATH = tempfile.mkstemp(prefix="leparvis-test-", suffix=".db")
os.close(_fd)
os.environ["LEPARVIS_DATABASE_URL"] = f"sqlite:///{_DB_PATH}"
os.environ["LEPARVIS_SCRAPER_CACHE_DIR"] = tempfile.mkdtemp(prefix="leparvis-cache-")


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app.main import app
    from app.seed import seed

    seed()
    with TestClient(app) as c:
        yield c


def pytest_sessionfinish(session, exitstatus):  # noqa: ARG001
    try:
        os.unlink(_DB_PATH)
    except OSError:
        pass
