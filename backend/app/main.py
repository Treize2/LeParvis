from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import admin, celebrations, churches, ingest, meta, search, suggestions
from .config import settings
from .database import init_db
from .scheduler import start_scheduler, stop_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    start_scheduler()
    try:
        yield
    finally:
        stop_scheduler()


app = FastAPI(
    title="LeParvis API",
    version="0.1.0",
    description=(
        "Recherche d'horaires de célébrations catholiques. "
        "Filtres par type de lieu (paroisse, monastère, basilique…), "
        "type de célébration (messe, laudes, vêpres…), rite, communauté, jour, heure et géolocalisation."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(meta.router)
app.include_router(churches.router)
app.include_router(celebrations.router)
app.include_router(search.router)
app.include_router(ingest.router)
app.include_router(suggestions.router)
app.include_router(admin.router)


@app.get("/")
def root():
    return {
        "name": "LeParvis",
        "docs": "/docs",
        "endpoints": [
            "/api/meta/taxonomy",
            "/api/search",
            "/api/churches",
            "/api/celebrations",
            "/api/ingest/messesinfo",
            "/api/ingest/url",
        ],
    }


@app.get("/health")
def health():
    return {"status": "ok"}
