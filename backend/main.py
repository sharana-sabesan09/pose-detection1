import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from rag.loader import load_clinical_guidelines
import routers.auth as auth
import routers.sessions as sessions
import routers.reports as reports
import routers.exports as exports

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load in a thread so /health responds immediately during cold boot.
    # Agents degrade gracefully (LLM-only) until the index is ready.
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, load_clinical_guidelines)
    yield


app = FastAPI(title="Sentinel Backend", lifespan=lifespan)

app.include_router(auth.router)
app.include_router(sessions.router)
app.include_router(reports.router)
app.include_router(exports.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
