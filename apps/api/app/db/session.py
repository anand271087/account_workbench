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


def _is_transaction_mode_pooler(url: str) -> bool:
    """Supabase ships two poolers on the same hostname:
      - port 5432 = session mode (15-client cap on Free; allows prepared stmts)
      - port 6543 = transaction mode (~200-client cap; pgbouncer rotates the
        backend per transaction, so server-side prepared statements break)

    We detect the URL and adjust asyncpg's prepared-statement cache so the
    same code works against either pooler — flip DATABASE_URL on the host
    and we DTRT.
    """
    return ":6543/" in url


_tx_mode = _is_transaction_mode_pooler(_settings.database_url)
_stmt_cache = 0 if _tx_mode else 200

# pool_pre_ping costs an extra "SELECT 1" round-trip per checkout. With ~150ms
# RTT to the regional pooler that's a free 150ms tax on every API request.
# We rely on pool_recycle + the pooler's own health checks instead.
#
# Pool sizing:
#   - Session mode (:5432): cap is 15. Stay small (3+7=10).
#   - Transaction mode (:6543): cap is ~200. Can comfortably go higher.
engine = create_async_engine(
    _settings.database_url,
    pool_pre_ping=False,
    pool_recycle=180,           # recycle conns every 3 min so stale ones don't pile up
    pool_size=10 if _tx_mode else 3,
    max_overflow=20 if _tx_mode else 7,
    echo=False,
    connect_args={
        "statement_cache_size": _stmt_cache,
        "prepared_statement_cache_size": _stmt_cache,
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
