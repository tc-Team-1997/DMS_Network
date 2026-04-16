import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from .config import settings


def _engine_kwargs() -> dict:
    url = settings.DATABASE_URL
    if url.startswith("sqlite"):
        return {"connect_args": {"check_same_thread": False}}
    # Production-grade pool defaults for Postgres/MySQL; override via env.
    return {
        "pool_size":     int(os.environ.get("DB_POOL_SIZE", 10)),
        "max_overflow":  int(os.environ.get("DB_MAX_OVERFLOW", 20)),
        "pool_timeout":  int(os.environ.get("DB_POOL_TIMEOUT", 30)),
        "pool_recycle":  int(os.environ.get("DB_POOL_RECYCLE", 1800)),
        "pool_pre_ping": True,
        "future":        True,
    }


engine = create_engine(settings.DATABASE_URL, **_engine_kwargs())
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ─────────── Optional async engine (for endpoints that benefit from it) ───────────
async_engine = None
AsyncSessionLocal = None


def _maybe_init_async():
    """Initialize async engine + session if an async driver is installed.

    Use asyncpg for Postgres (`postgresql+asyncpg://…`) or aiosqlite for SQLite
    (`sqlite+aiosqlite://…`). Silently no-op otherwise; sync endpoints keep working.
    """
    global async_engine, AsyncSessionLocal
    try:
        from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    except Exception:
        return
    url = settings.DATABASE_URL
    async_url = None
    if url.startswith("postgresql+asyncpg://") or url.startswith("sqlite+aiosqlite://"):
        async_url = url
    elif url.startswith("postgresql://"):
        async_url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    elif url.startswith("sqlite:///"):
        async_url = url.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
    if not async_url:
        return
    try:
        async_engine = create_async_engine(async_url, pool_pre_ping=True)
        AsyncSessionLocal = async_sessionmaker(bind=async_engine, expire_on_commit=False)
    except Exception:
        async_engine = None
        AsyncSessionLocal = None


_maybe_init_async()


async def get_async_db():
    if AsyncSessionLocal is None:
        raise RuntimeError("Async DB not configured — install asyncpg or aiosqlite")
    async with AsyncSessionLocal() as db:
        yield db
