"""
routers/exports.py — RECEIVES SESSION ARTIFACTS FROM THE PHONE AND WRITES THEM TO LAPTOP DISK.

The phone POSTs a JSON body with the final session schema and the
per-rep / raw-frame CSVs as plain strings. We dump them under
<repo>/exports/<session_id>/ on whatever machine is running the
backend, so the user can grab them off their laptop without ever
plugging into Xcode.

Auth: skipped while DEV_MODE is on (matches the rest of the dev flow).
"""

from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import settings


# Resolve <repo>/exports relative to this file. backend/routers/exports.py
# -> backend/routers/.. -> backend/.. -> repo root.
EXPORT_ROOT = (Path(__file__).resolve().parent.parent.parent / "exports").resolve()


router = APIRouter(prefix="/exports", tags=["exports"])


class SessionExportRequest(BaseModel):
    session_id: str
    summary_json: str          # full SessionSummary, already JSON-stringified
    reps_csv: Optional[str] = None
    frames_csv: Optional[str] = None
    reps_jsonl: Optional[str] = None  # one JSON object per line, one per rep


class SessionExportResponse(BaseModel):
    session_id: str
    written_to: str
    files: list[str]


@router.post("/session", response_model=SessionExportResponse)
async def export_session(body: SessionExportRequest) -> SessionExportResponse:
    if not settings.DEV_MODE:
        raise HTTPException(status_code=403, detail="exports endpoint is dev-only")

    # Defence in depth: never let a crafted session_id climb out of EXPORT_ROOT.
    safe_id = body.session_id.replace("/", "_").replace("\\", "_").replace("..", "_")
    if not safe_id:
        raise HTTPException(status_code=400, detail="session_id required")

    stamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    out_dir = (EXPORT_ROOT / f"{stamp}_{safe_id}").resolve()
    if EXPORT_ROOT not in out_dir.parents and out_dir != EXPORT_ROOT:
        raise HTTPException(status_code=400, detail="invalid session_id")
    out_dir.mkdir(parents=True, exist_ok=True)

    written: list[str] = []

    summary_path = out_dir / "session.json"
    summary_path.write_text(body.summary_json, encoding="utf-8")
    written.append(str(summary_path))

    if body.reps_csv:
        p = out_dir / "reps.csv"
        p.write_text(body.reps_csv, encoding="utf-8")
        written.append(str(p))

    if body.reps_jsonl:
        p = out_dir / "reps.jsonl"
        p.write_text(body.reps_jsonl, encoding="utf-8")
        written.append(str(p))

    if body.frames_csv:
        p = out_dir / "frames.csv"
        p.write_text(body.frames_csv, encoding="utf-8")
        written.append(str(p))

    return SessionExportResponse(
        session_id=safe_id,
        written_to=str(out_dir),
        files=written,
    )
