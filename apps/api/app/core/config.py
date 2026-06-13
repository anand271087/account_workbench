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
    # 13-Jun TEMPORARY default — point the in-VPC Bifrost ALB so the dev
    # server uses real AI without the team having to set AI_GATEWAY_URL
    # yet. The Beroe dev box is inside the VPC, so it reaches this internal
    # ALB directly (no SSM tunnel needed). Any env that sets AI_GATEWAY_URL
    # explicitly still wins (local dev uses http://localhost:8087/v1 via the
    # tunnel; tests set it empty in conftest). REMOVE once the team sets the
    # gateway URL in the dev server's environment.
    ai_gateway_url: str | None = (
        "http://internal-Internal-facing-ALB-bifrost-dev-1209860262.eu-west-1.elb.amazonaws.com:8087/v1"
    )
    # 13-Jun TEMPORARY default — Bifrost gateway access key, forwarded as
    # the `x-bf-ak` header (see services/llm.py). Required by the dev ALB;
    # without it the gateway rejects the call. Env still overrides. REMOVE
    # once the team sets AI_GATEWAY_API_KEY in the dev server's environment.
    ai_gateway_api_key: SecretStr | None = SecretStr("beroe-bedrock-dev-for-csm")  # x-bf-ak
    ai_gateway_model: str = "bedrock/eu.anthropic.claude-opus-4-5-20251101-v1:0"

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

    # ---- Redshift (Intelligence & Reports) ----
    # Same SSM-tunnel pattern as Bifrost. Tunnel auto-spawns on FastAPI
    # startup; redshift-connector pool talks to localhost over it.
    aws_access_key_id: SecretStr | None = None
    aws_secret_access_key: SecretStr | None = None
    aws_default_region: str = "us-east-1"
    aws_profile: str | None = None

    redshift_autostart_tunnel: bool = True
    redshift_ssm_target: str | None = None
    redshift_ssm_document: str = "AWS-StartPortForwardingSessionToRemoteHost"
    redshift_ssm_remote_host: str | None = None
    redshift_ssm_remote_port: int = 5439
    redshift_ssm_local_port: int = 5439

    redshift_host: str = "localhost"
    redshift_port: int = 5439
    redshift_db: str | None = None
    redshift_user: str | None = None
    redshift_password: SecretStr | None = None
    redshift_sslmode: str = "require"

    @property
    def redshift_configured(self) -> bool:
        return all([
            self.redshift_db,
            self.redshift_user,
            self.redshift_password,
        ])

    # ---- Bifrost SSM tunnel (infra for the AI gateway above) ----
    # Mirrors the Redshift SSM tunnel but uses the simpler
    # `AWS-StartPortForwardingSession` doc — direct EC2 port-forward,
    # no jump-to-remote-host. This block is ONLY about opening the
    # tunnel; the LLM helper (services/llm.py) still finds the gateway
    # via the AI_GATEWAY_URL setting above.
    #
    # Three deployment shapes:
    #   (A) Local / Render outside VPC → BIFROST_SSM_TARGET set +
    #       autostart=true. Tunnel auto-spawns on app start; set
    #       AI_GATEWAY_URL=http://localhost:8087/v1.
    #   (B) Production inside the VPC → BIFROST_AUTOSTART_TUNNEL=false.
    #       No tunnel; set AI_GATEWAY_URL=http://<bifrost-vpc-host>:8087/v1.
    #   (C) Off → leave BIFROST_SSM_TARGET empty. The LLM helper falls
    #       back to direct Anthropic (if ANTHROPIC_API_KEY is set) or
    #       stubs.
    #
    # Bifrost may use a separate AWS account/profile from Redshift —
    # the user's command uses `--profile bifrost-dev` in eu-west-1.
    # Falls back to the shared aws_* settings above if unset.
    bifrost_aws_access_key_id: SecretStr | None = None
    bifrost_aws_secret_access_key: SecretStr | None = None
    bifrost_aws_region: str | None = None
    bifrost_aws_profile: str | None = None

    bifrost_autostart_tunnel: bool = True
    bifrost_ssm_target: str | None = None
    bifrost_ssm_document: str = "AWS-StartPortForwardingSession"
    bifrost_ssm_remote_port: int = 8087
    bifrost_ssm_local_port: int = 8087

    # Used by the smoke-test probe + tunnel-up detection. These match
    # the local port that the SSM tunnel forwards to. Production
    # deploys inside the VPC can leave them at defaults — the smoke
    # test then hits the configured AI_GATEWAY_URL directly.
    bifrost_host: str = "localhost"
    bifrost_port: int = 8087

    @property
    def bifrost_configured(self) -> bool:
        """True when either the tunnel target OR the in-VPC URL is set."""
        return bool(self.ai_gateway_url) or bool(self.bifrost_ssm_target)

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
