import asyncio
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from db.session import get_db
from db.models import Session, PoseFrame, ExerciseSession, RepAnalysis, Patient, ExerciseSessionArtifact
from schemas.session import IntakeInput, ReporterOutput
from schemas.report import SessionStartRequest, SessionStartResponse, FrameRequest
from schemas.exercise import ExerciseSessionResult, ExerciseSessionResponse
from schemas.voice import VoiceMetadataExtractRequest, VoiceMetadataExtractResponse
from agents.orchestrator import run_session_pipeline, run_exercise_pipeline
from routers.auth import require_jwt
from utils.frame_csv import parse_frame_features_csv
from utils.landmarks_csv import parse_landmarks_csv
from fastapi.responses import PlainTextResponse
from utils.voice_metadata import build_session_metadata_from_voice
from fastapi.responses import StreamingResponse
from schemas.artifact import ExerciseSessionArtifactResponse
from datetime import timezone

router = APIRouter(prefix="/sessions", tags=["sessions"])


async def _ensure_patient_exists(patient_id: str | None, db: AsyncSession) -> None:
    if not patient_id:
        return
    existing = await db.execute(select(Patient).where(Patient.id == patient_id))
    if existing.scalars().first():
        return
    db.add(Patient(id=patient_id, created_at=datetime.utcnow(), updated_at=datetime.utcnow()))
    await db.flush()


@router.post("/start", response_model=SessionStartResponse)
async def start_session(
    body: SessionStartRequest,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_jwt),
):
    await _ensure_patient_exists(body.patient_id, db)
    session = Session(
        id=str(uuid.uuid4()),
        patient_id=body.patient_id,
        pt_plan=body.pt_plan,
        started_at=datetime.utcnow(),
    )
    db.add(session)
    await db.commit()
    return SessionStartResponse(session_id=session.id)


@router.post("/{session_id}/frame")
async def add_frame(
    session_id: str,
    body: FrameRequest,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_jwt),
):
    frame = PoseFrame(
        id=str(uuid.uuid4()),
        session_id=session_id,
        timestamp=body.timestamp,
        angles_json=body.angles_json,
    )
    db.add(frame)
    await db.commit()
    return {"status": "ok"}


@router.post("/{session_id}/end", response_model=ReporterOutput)
async def end_session(
    session_id: str,
    body: IntakeInput,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_jwt),
):
    await _ensure_patient_exists(body.patient_id, db)
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalars().first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.ended_at = datetime.utcnow()
    await db.commit()

    pipeline_result = await run_session_pipeline(
        session_id=session_id,
        patient_id=body.patient_id,
        intake_data=body,
        db=db,
    )

    reporter = pipeline_result.get("reporter")
    if not reporter:
        raise HTTPException(status_code=500, detail="Pipeline failed")

    return ReporterOutput(**reporter)


@router.post("/voice-metadata/extract", response_model=VoiceMetadataExtractResponse)
async def extract_voice_metadata(
    body: VoiceMetadataExtractRequest,
    _user=Depends(require_jwt),
):
    normalized, session_metadata = build_session_metadata_from_voice(body)
    return VoiceMetadataExtractResponse(
        normalizedTranscript=normalized,
        sessionMetadata=session_metadata,
    )


@router.post("/exercise-result", response_model=ExerciseSessionResponse, status_code=201)
async def store_exercise_result(
    body: ExerciseSessionResult,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_jwt),
):
    existing = await db.execute(
        select(ExerciseSession).where(ExerciseSession.mobile_session_id == body.sessionId)
    )
    if existing.scalars().first():
        raise HTTPException(status_code=409, detail="Session already stored")

    await _ensure_patient_exists(body.patientId, db)

    # Companion Session row so PoseFrame records (raw frames) have somewhere
    # to live and pose_analysis_agent can read them through the normal path.
    # patient_id may be None for anonymous exercise sessions.
    linked_session = Session(
        id=str(uuid.uuid4()),
        patient_id=body.patientId,
        started_at=datetime.utcfromtimestamp(body.startedAtMs / 1000),
        ended_at=datetime.utcfromtimestamp(body.endedAtMs / 1000),
    )
    db.add(linked_session)
    await db.flush()

    exercise_session = ExerciseSession(
        id=str(uuid.uuid4()),
        patient_id=body.patientId,
        mobile_session_id=body.sessionId,
        exercise=body.exercise,
        num_reps=body.numReps,
        started_at_ms=body.startedAtMs,
        ended_at_ms=body.endedAtMs,
        duration_ms=body.durationMs,
        summary_json=body.summary.summary.model_dump(),
        metadata_json=body.sessionMetadata.model_dump() if body.sessionMetadata else None,
        reps_csv=body.repsCsv,
        frame_features_csv=body.frameFeaturesCsv,
        frames_csv=body.framesCsv,
        linked_session_id=linked_session.id,
    )
    db.add(exercise_session)
    await db.flush()

    for rep in body.summary.reps:
        db.add(RepAnalysis(
            id=str(uuid.uuid4()),
            exercise_session_id=exercise_session.id,
            rep_id=rep.repId,
            side=rep.side,
            start_frame=rep.timing.startFrame,
            bottom_frame=rep.timing.bottomFrame,
            end_frame=rep.timing.endFrame,
            rep_duration_ms=rep.timing.durationMs,
            knee_flexion_deg=rep.features.kneeFlexionDeg,
            rom_ratio=rep.features.romRatio,
            fppa_peak=rep.features.fppaPeak,
            fppa_at_depth=rep.features.fppaAtDepth,
            trunk_lean_peak=rep.features.trunkLeanPeak,
            trunk_flex_peak=rep.features.trunkFlexPeak,
            pelvic_drop_peak=rep.features.pelvicDropPeak,
            pelvic_shift_peak=rep.features.pelvicShiftPeak,
            hip_adduction_peak=rep.features.hipAdductionPeak,
            knee_offset_peak=rep.features.kneeOffsetPeak,
            sway_norm=rep.features.swayNorm,
            smoothness=rep.features.smoothness,
            knee_valgus=rep.errors.kneeValgus,
            trunk_lean=rep.errors.trunkLean,
            trunk_flex=rep.errors.trunkFlex,
            pelvic_drop=rep.errors.pelvicDrop,
            pelvic_shift=rep.errors.pelvicShift,
            hip_adduction=rep.errors.hipAdduction,
            knee_over_foot=rep.errors.kneeOverFoot,
            balance=rep.errors.balance,
            total_errors=rep.score.totalErrors,
            classification=rep.score.classification,
            confidence=rep.confidence,
        ))

    if body.frameFeaturesCsv:
        for fr in parse_frame_features_csv(body.frameFeaturesCsv):
            db.add(PoseFrame(
                id=str(uuid.uuid4()),
                session_id=linked_session.id,
                timestamp=fr["timestamp"],
                angles_json=fr["angles_json"],
            ))

    # Optional raw landmarks CSV (used for overlay rendering / debugging).
    if body.framesCsv:
        for fr in parse_landmarks_csv(body.framesCsv):
            db.add(PoseFrame(
                id=str(uuid.uuid4()),
                session_id=linked_session.id,
                timestamp=fr["timestamp"],
                angles_json={},  # allowed to be empty JSON
                landmarks_json=fr["landmarks_json"],
            ))

    linked_session_id = linked_session.id  # capture before commit expires the ORM object
    await db.commit()

    # Fire the exercise pipeline as a background task — returns 201 immediately,
    # agents run concurrently without blocking the mobile app.
    asyncio.create_task(
        run_exercise_pipeline(body, linked_session_id, body.patientId)
    )

    return ExerciseSessionResponse(
        id=exercise_session.id,
        sessionId=exercise_session.mobile_session_id,
        exercise=exercise_session.exercise,
        numReps=exercise_session.num_reps,
        overallRating=body.summary.summary.overallRating,
        linkedSessionId=linked_session_id,
    )


def _build_landmarks_csv_from_frames(frames: list[PoseFrame], mode: str) -> str:
    header = ["t", "mode"]
    for i in range(33):
        header += [f"lm{i}_x", f"lm{i}_y", f"lm{i}_z", f"lm{i}_v"]
    import io
    import csv as _csv
    out = io.StringIO()
    w = _csv.writer(out)
    w.writerow(header)
    for f in frames:
        row = [f.timestamp, mode]
        lms = f.landmarks_json or []
        for i in range(33):
            lm = lms[i] if i < len(lms) and isinstance(lms[i], dict) else {}
            row += [lm.get("x", ""), lm.get("y", ""), lm.get("z", ""), lm.get("visibility", "")]
        w.writerow(row)
    return out.getvalue()


@router.get("/latest/frames.csv", response_class=PlainTextResponse)
async def latest_landmark_frames_csv(
    exercise: str,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_jwt),
):
    result = await db.execute(
        select(ExerciseSession)
        .where(ExerciseSession.exercise == exercise)
        .order_by(ExerciseSession.created_at.desc())
        .limit(1)
    )
    ex = result.scalars().first()
    if not ex or not ex.linked_session_id:
        raise HTTPException(status_code=404, detail="no stored session with linked frames")

    frames_result = await db.execute(
        select(PoseFrame)
        .where(PoseFrame.session_id == ex.linked_session_id)
        .where(PoseFrame.landmarks_json.isnot(None))
        .order_by(PoseFrame.timestamp)
    )
    frames = frames_result.scalars().all()
    if not frames:
        raise HTTPException(status_code=404, detail="no landmark frames stored for latest session")
    return _build_landmarks_csv_from_frames(frames, mode=exercise)


@router.post(
    "/{exercise_session_id}/artifacts",
    response_model=ExerciseSessionArtifactResponse,
    status_code=201,
)
async def upload_exercise_session_artifact(
    exercise_session_id: str,
    artifactType: str = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_jwt),
):
    result = await db.execute(select(ExerciseSession).where(ExerciseSession.id == exercise_session_id))
    ex = result.scalars().first()
    if not ex:
        raise HTTPException(status_code=404, detail="exercise session not found")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="empty upload")
    content_type = file.content_type or "application/octet-stream"

    art = ExerciseSessionArtifact(
        id=str(uuid.uuid4()),
        exercise_session_id=exercise_session_id,
        artifact_type=artifactType,
        content_type=content_type,
        bytes=content,
        size_bytes=len(content),
    )
    db.add(art)
    await db.commit()

    return ExerciseSessionArtifactResponse(
        id=art.id,
        exerciseSessionId=art.exercise_session_id,
        artifactType=art.artifact_type,
        contentType=art.content_type,
        sizeBytes=art.size_bytes,
        createdAt=art.created_at.replace(tzinfo=timezone.utc).isoformat(),
    )


@router.get("/{exercise_session_id}/artifacts/{artifact_id}")
async def download_exercise_session_artifact(
    exercise_session_id: str,
    artifact_id: str,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_jwt),
):
    result = await db.execute(
        select(ExerciseSessionArtifact)
        .where(ExerciseSessionArtifact.id == artifact_id)
        .where(ExerciseSessionArtifact.exercise_session_id == exercise_session_id)
    )
    art = result.scalars().first()
    if not art:
        raise HTTPException(status_code=404, detail="artifact not found")

    headers = {"Content-Length": str(art.size_bytes)}
    return StreamingResponse(
        iter([art.bytes]),
        media_type=art.content_type,
        headers=headers,
    )


@router.get("/latest/overlay.mp4")
async def latest_overlay_mp4(
    exercise: str,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_jwt),
):
    result = await db.execute(
        select(ExerciseSession)
        .where(ExerciseSession.exercise == exercise)
        .order_by(ExerciseSession.created_at.desc())
        .limit(1)
    )
    ex = result.scalars().first()
    if not ex:
        raise HTTPException(status_code=404, detail="no stored exercise session")

    art_result = await db.execute(
        select(ExerciseSessionArtifact)
        .where(ExerciseSessionArtifact.exercise_session_id == ex.id)
        .where(ExerciseSessionArtifact.artifact_type == "overlay_mp4")
        .order_by(ExerciseSessionArtifact.created_at.desc())
        .limit(1)
    )
    art = art_result.scalars().first()
    if not art:
        raise HTTPException(status_code=404, detail="no overlay artifact stored for latest session")

    headers = {"Content-Length": str(art.size_bytes)}
    return StreamingResponse(iter([art.bytes]), media_type=art.content_type, headers=headers)
