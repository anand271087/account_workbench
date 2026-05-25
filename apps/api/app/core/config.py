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

    # ---- Anthropic (direct) ----
    # Optional — set EITHER this OR ai_gateway_url. If both set, the gateway
    # wins (preferred path inside the Beroe VPC). If neither set, stubs run.
    anthropic_api_key: SecretStr | None = None
    anthropic_model: str = "claude-sonnet-4-5"

    # ---- Beroe Bifrost AI Gateway (Abi / Abi Plus) ----
    # OpenAI-compatible /v1/chat/completions endpoint deployed inside the VPC.
    # In local dev: aws ssm start-session port-fwd to localhost:8087, then
    # set AI_GATEWAY_URL=http://localhost:8087/v1. In prod: Karthick sets up
    # private DNS + IAM role and points AI_GATEWAY_URL at that.
    ai_gateway_url: str | None = None  # e.g. http://localhost:8087/v1
    ai_gateway_api_key: SecretStr | None = None  # optional x-bf-ak pin
    ai_gateway_model: str = "bedrock/eu.anthropic.claude-sonnet-4-7-20251101-v1:0"

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
    # Bug 6 — added .csv / .md / .markdown to the upload allow-list.
    allowed_doc_extensions: str = (
        ".docx,.doc,.pptx,.ppt,.xlsx,.xls,.pdf,.txt,.vtt,.eml,.csv,.md,.markdown"
    )

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
