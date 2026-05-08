"""Settings loaded from environment via pydantic-settings.

Source of truth for every env var the API consumes. Fails loudly at startup
if a required key is missing — never silent fallbacks for secrets.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ---- Server ----
    api_port: int = 8000
    api_host: str = "0.0.0.0"
    log_level: str = "INFO"
    env: Literal["development", "staging", "production"] = "development"
    cors_origins: str = "http://localhost:5173"

    # ---- Supabase ----
    supabase_url: str = Field(..., description="Server-side Supabase URL")
    supabase_service_role_key: SecretStr = Field(..., description="Bypasses RLS — server-only")
    supabase_jwt_secret: SecretStr = Field(..., description="Verifies incoming user JWTs")
    database_url: str = Field(..., description="Direct Postgres URL for Alembic")

    # ---- Anthropic ----
    anthropic_api_key: SecretStr = Field(..., description="Claude API key")
    anthropic_model: str = "claude-sonnet-4-5"

    # ---- Redis / Celery ----
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"

    # ---- Observability ----
    sentry_dsn: str | None = None

    # ---- Rate limits (per IP per minute) ----
    rate_limit_auth: int = 100
    rate_limit_default: int = 1000

    # ---- AI cost cap (matrix Q5: yes, per-user-day) ----
    claude_user_daily_limit: int = 200  # AI calls per user per UTC day

    # ---- File upload ----
    max_upload_size_mb: int = 100
    allowed_doc_extensions: str = ".docx,.pdf,.txt,.vtt"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def allowed_extensions_list(self) -> list[str]:
        return [e.strip().lower() for e in self.allowed_doc_extensions.split(",") if e.strip()]


@lru_cache
def get_settings() -> Settings:
    """Cached settings singleton."""
    return Settings()
