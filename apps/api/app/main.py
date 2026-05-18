"""FastAPI application entry point.

M1: skeleton with health check and CORS only. Auth/RBAC lands in M2.
"""

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.routes import accounts as account_routes
from app.routes import auth as auth_routes
from app.routes import contacts as contact_routes
from app.routes import documents as document_routes
from app.routes import engagement as engagement_routes
from app.routes import favorites as favorite_routes
from app.routes import cs_goals as cs_goals_routes
from app.routes import cs_onboarding as cs_onboarding_routes
from app.routes import lookups as lookup_routes
from app.routes import checkpoints as checkpoint_routes
from app.routes import delivery_renewal as delivery_renewal_routes
from app.routes import meeting_brief as meeting_brief_routes
from app.routes import metrics as metric_routes
from app.routes import intel_news as intel_news_routes
from app.routes import plays as play_routes
from app.routes import signals as signal_routes
from app.routes import signing as signing_routes
from app.routes import solutioning as solutioning_routes
from app.routes import success_contract as success_contract_routes
from app.routes import users as user_routes
from app.routes import vdd as vdd_routes
# Importing audit_writer triggers @event.listens_for registration.
from app.services import audit_writer  # noqa: F401


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """App lifespan — startup and shutdown hooks."""
    yield
    # Future: graceful shutdown of pools.


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Beroe AWB API",
        version="0.1.0",
        description="Backend for the Beroe Account Workbench",
        lifespan=lifespan,
        docs_url="/docs" if settings.env != "production" else None,
        redoc_url="/redoc" if settings.env != "production" else None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    )

    @app.get("/health", tags=["meta"])
    async def health() -> JSONResponse:
        return JSONResponse({"status": "ok", "env": settings.env, "version": "0.1.0"})

    app.include_router(auth_routes.router)
    app.include_router(account_routes.router)
    app.include_router(user_routes.router)
    app.include_router(engagement_routes.router)
    app.include_router(engagement_routes.ai_router)
    app.include_router(lookup_routes.router)
    app.include_router(contact_routes.account_router)
    app.include_router(contact_routes.contact_router)
    app.include_router(document_routes.account_router)
    app.include_router(document_routes.document_router)
    app.include_router(document_routes.job_router)
    app.include_router(solutioning_routes.router)
    app.include_router(signing_routes.router)
    app.include_router(cs_onboarding_routes.router)
    app.include_router(cs_goals_routes.account_router)
    app.include_router(cs_goals_routes.goal_router)
    app.include_router(success_contract_routes.router)
    app.include_router(vdd_routes.router)
    app.include_router(metric_routes.account_router)
    app.include_router(metric_routes.metric_router)
    app.include_router(checkpoint_routes.account_router)
    app.include_router(checkpoint_routes.checkpoint_router)
    app.include_router(delivery_renewal_routes.router)
    app.include_router(play_routes.account_router)
    app.include_router(play_routes.play_router)
    app.include_router(signal_routes.account_router)
    app.include_router(signal_routes.signal_router)
    app.include_router(signal_routes.activity_router)
    app.include_router(intel_news_routes.account_router)
    app.include_router(intel_news_routes.intel_router)
    app.include_router(meeting_brief_routes.router)
    app.include_router(favorite_routes.router)

    return app


app = create_app()
