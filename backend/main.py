from contextlib import asynccontextmanager
from fastapi import FastAPI
from rag.loader import load_clinical_guidelines
import routers.auth as auth
import routers.sessions as sessions
import routers.reports as reports


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_clinical_guidelines()
    yield


app = FastAPI(title="Sentinel Backend", lifespan=lifespan)

app.include_router(auth.router)
app.include_router(sessions.router)
app.include_router(reports.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
