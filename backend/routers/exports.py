"""
routers/exports.py — RECEIVES SESSION ARTIFACTS FROM THE PHONE AND WRITES THEM TO LAPTOP DISK.

The phone POSTs a JSON body with the final session schema and the
per-rep / raw-frame CSVs as plain strings. We dump them under
<repo>/exports/<session_id>/ on whatever machine is running the
backend, so the user can grab them off their laptop without ever
plugging into Xcode.

Auth: skipped while DEV_MODE is on (matches the rest of the dev flow).
"""

import csv
import io
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from config import settings
from db.session import get_db
from db.models import ExerciseSession, PoseFrame


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


# Numeric columns from the frame-level debug CSV that go into angles_json.
# "frame", "timestamp", and "side" are metadata, not angle values.
_FRAME_NUMERIC_COLS = {
    "knee_flex", "fppa", "trunk_lean", "trunk_flex",
    "pelvic_drop", "hip_adduction", "knee_offset",
    "midhip_x", "midhip_y", "velocity",
}


def _parse_frames_csv(csv_text: str) -> list[dict]:
    """Return a list of {timestamp, angles_json} dicts, one per frame row."""
    reader = csv.DictReader(io.StringIO(csv_text))
    rows = []
    for row in reader:
        ts_raw = row.get("timestamp", "")
        try:
            ts = float(ts_raw)
        except (ValueError, TypeError):
            continue  # skip malformed rows
        angles = {}
        for col in _FRAME_NUMERIC_COLS:
            raw = row.get(col, "")
            if raw:
                try:
                    angles[col] = float(raw)
                except ValueError:
                    pass
        if angles:
            rows.append({"timestamp": ts, "angles_json": angles})
    return rows


@router.post("/session", response_model=SessionExportResponse)
async def export_session(
    body: SessionExportRequest,
    db: AsyncSession = Depends(get_db),
) -> SessionExportResponse:
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

        # Also ingest frames into the DB so pose_analysis_agent can read them.
        # Look up the ExerciseSession by mobile_session_id to find the linked
        # Session UUID that PoseFrame rows must reference.
        result = await db.execute(
            select(ExerciseSession).where(
                ExerciseSession.mobile_session_id == body.session_id
            )
        )
        ex = result.scalars().first()
        if ex and ex.linked_session_id:
            frame_rows = _parse_frames_csv(body.frames_csv)
            for fr in frame_rows:
                db.add(PoseFrame(
                    id=str(uuid.uuid4()),
                    session_id=ex.linked_session_id,
                    timestamp=fr["timestamp"],
                    angles_json=fr["angles_json"],
                ))
            await db.commit()

    return SessionExportResponse(
        session_id=safe_id,
        written_to=str(out_dir),
        files=written,
    )
