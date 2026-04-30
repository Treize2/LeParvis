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


settings = Settings()
