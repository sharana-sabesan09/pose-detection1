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
    """Run alembic upgrade head as a subprocess before accepting traffic.

    Using a subprocess instead of the Python API so that:
    - stdout/stderr are captured and logged unconditionally
    - alembic.ini's fileConfig cannot suppress our output
    - asyncio nesting issues are avoided entirely
    """
    import subprocess
    import os
    import sys

    ini_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    env = {**os.environ, "DATABASE_URL": settings.DATABASE_URL}

    print(f"[migrations] running: alembic -c {ini_path} upgrade head", flush=True)
    print(f"[migrations] DATABASE_URL scheme: {settings.DATABASE_URL.split('://')[0]}", flush=True)

    result = await asyncio.create_subprocess_exec(
        sys.executable, "-m", "alembic", "-c", ini_path, "upgrade", "head",
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        cwd=os.path.dirname(ini_path),
    )
    stdout, _ = await result.communicate()
    output = stdout.decode(errors="replace").strip()
    if output:
        print(f"[migrations] {output}", flush=True)

    if result.returncode != 0:
        raise RuntimeError(f"alembic upgrade head failed (exit {result.returncode})")

    print("[migrations] schema is current", flush=True)


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
