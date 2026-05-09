"""Async SQLAlchemy session factory.

Single engine + sessionmaker per app instance. Used by FastAPI dependency.

Celery workers use a NullPool engine (`new_worker_session`) so each task
gets a fresh connection — `asyncio.run()` creates a new event loop on
every call, and pooled connections from a previous loop cannot be re-used.
"""

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from app.core.config import get_settings

_settings = get_settings()

# Session-mode pooler (port 5432) lets asyncpg keep server-side prepared
# statements across queries — roughly halves per-query cost vs the
# transaction-mode pooler (port 6543) which forced statement_cache_size=0.
#
# pool_pre_ping costs an extra "SELECT 1" round-trip per checkout. With ~150ms
# RTT to the regional pooler that's a free 150ms tax on every API request.
# We rely on pool_recycle + the pooler's own health checks instead.
engine = create_async_engine(
    _settings.database_url,
    pool_pre_ping=False,
    pool_recycle=180,           # recycle conns every 3 min so stale ones don't pile up
    # Supabase's session-mode pooler caps at 15 clients per project. We share
    # those 15 with the Celery worker (NullPool, ~2 conns) and any local dev
    # processes. Keep the API at 3 + 7 = 10 max to leave room.
    pool_size=3,
    max_overflow=7,
    echo=False,
    connect_args={
        "statement_cache_size": 200,
        "prepared_statement_cache_size": 200,
    },
)

SessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding an async session."""
    async with SessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


def new_worker_engine() -> AsyncEngine:
    """Fresh NullPool engine — call this *inside* the asyncio.run() coroutine
    so the connection is created on the current event loop.

    Session-mode pooler tolerates statement caching, but workers open a fresh
    conn per task anyway so the cache wouldn't hit. Keep cache=0 for clarity.
    """
    return create_async_engine(
        _settings.database_url,
        poolclass=NullPool,
        echo=False,
        connect_args={"statement_cache_size": 0, "prepared_statement_cache_size": 0},
    )


def new_worker_session(engine_: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(
        bind=engine_, class_=AsyncSession, expire_on_commit=False, autoflush=False,
    )
