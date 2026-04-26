import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from rag.loader import load_clinical_guidelines
from db.session import run_migrations
import routers.auth as auth
import routers.patients as patients
import routers.sessions as sessions
import routers.reports as reports
import routers.exports as exports
import routers.tts as tts

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure schema is current before accepting traffic.  Railway's
    # releaseCommand is the fast path; this is the safety net for cases where
    # it was skipped, failed silently, or the first deploy predated the command.
    await run_migrations()

    # Load in a thread so /health responds immediately during cold boot.
    # Agents degrade gracefully (LLM-only) until the index is ready.
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, load_clinical_guidelines)
    yield


app = FastAPI(title="Sentinel Backend", lifespan=lifespan)

app.include_router(auth.router)
app.include_router(patients.router)
app.include_router(sessions.router)
app.include_router(reports.router)
app.include_router(exports.router)
app.include_router(tts.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
