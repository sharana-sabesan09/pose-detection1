import asyncio
import logging
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from config import settings

logger = logging.getLogger(__name__)

engine = create_async_engine(settings.DATABASE_URL, echo=False, pool_pre_ping=True)

AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def init_db():
    """Create all tables — used in dev (SQLite). In prod, run Alembic instead."""
    from db.models import Base
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def run_migrations() -> None:
    """Run alembic upgrade head in a thread so the async event loop isn't blocked.

    This is a startup-time safety net: Railway's releaseCommand is the primary
    path, but if it was skipped or failed, this guarantees the schema is current
    before the health check passes and traffic is accepted.
    """
    from alembic.config import Config
    from alembic import command
    import os

    alembic_cfg = Config(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "alembic.ini")))
    # Override the URL so it always matches what the app is using.
    alembic_cfg.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

    def _upgrade():
        command.upgrade(alembic_cfg, "head")

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _upgrade)
    logger.info("Alembic migrations applied (or already current).")


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
