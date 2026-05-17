from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="LEPARVIS_", extra="ignore")

    database_url: str = "sqlite:///./leparvis.db"
    cors_origins: list[str] = ["*"]

    # Scraper
    scraper_user_agent: str = "LeParvisBot/0.1 (+contact@leparvis.example)"
    scraper_timeout: float = 15.0
    scraper_max_concurrency: int = 4
    scraper_cache_dir: str = ".scraper_cache"

    # Sources
    messes_info_api_base: str = "https://api.egliseinfo.catholique.fr/api/v1"

    # Admin — set LEPARVIS_ADMIN_TOKEN to enable the /api/admin/* endpoints.
    # When unset, admin is disabled and every admin call returns 503.
    admin_token: str = ""

    # Background refresh of every previously-imported parish. 0 disables it
    # (manual refresh via the admin button still works). Default = weekly.
    refresh_interval_days: int = 7
    # On boot the scheduler waits this long before the first run (avoids
    # hammering the DB during a deploy / restart loop).
    refresh_startup_delay_minutes: int = 15


settings = Settings()
