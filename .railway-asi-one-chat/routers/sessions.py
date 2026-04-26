import asyncio
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete, select
from db.session import get_db
from db.models import (
    AgentArtifact,
    Exercise,
    MultiExerciseSessionArchive,
    Patient,
    PoseFrame,
    RepAnalysis,
    Session,
)
from schemas.session import IntakeInput, ReporterOutput
from schemas.report import (
    FrameFeaturesCsvRequest,
    FrameRequest,
    SessionStartRequest,
    SessionStartResponse,
)
from schemas.exercise import ExerciseResult, ExerciseResponse, MultiExerciseArchivePayload
from schemas.voice import VoiceMetadataExtractRequest, VoiceMetadataExtractResponse
from agents.orchestrator import run_session_pipeline, run_exercise_pipeline
from routers.auth import require_jwt
from utils.frame_csv import parse_frame_features_csv
from utils.landmarks_csv import parse_landmarks_csv
from fastapi.responses import PlainTextResponse
from utils.voice_metadata import build_session_metadata_from_voice
from fastapi.responses import StreamingResponse
from schemas.artifact import ExerciseSessionArtifactResponse

router = APIRouter(prefix="/sessions", tags=["sessions"])


async def _ensure_patient_exists(patient_id: str | None, db: AsyncSession) -> None:
    if not patient_id:
        return
    existing = await db.execute(select(Patient).where(Patient.id == patient_id))
    if existing.scalars().first():
        return
    db.add(Patient(id=patient_id, created_at=datetime.utcnow(), updated_at=datetime.utcnow()))
    await db.flush()


def _utc_naive(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _reporter_output_from_artifact(artifact: AgentArtifact | None) -> ReporterOutput | None:
    if not artifact:
        return None
    metrics = artifact.artifact_json.get("metrics", {})
    summary = metrics.get("summary")
    if not summary:
        return None
    return ReporterOutput(
        summary=summary,
        session_highlights=metrics.get("session_highlights", []),
        recommendations=metrics.get("recommendations", []),
        evidence_map=metrics.get("evidence_map", {}),
        reportability=metrics.get("reportability", "unknown"),
        data_coverage=artifact.data_coverage_json or {},
    )


async def _load_existing_reporter_output(
    session_id: str,
    db: AsyncSession,
) -> ReporterOutput | None:
    artifact_result = await db.execute(
        select(AgentArtifact)
        .where(
            AgentArtifact.session_id == session_id,
            AgentArtifact.agent_name == "reporter_agent",
            AgentArtifact.artifact_kind == "reporter_output",
        )
        .order_by(AgentArtifact.created_at.desc())
        .limit(1)
    )
    return _reporter_output_from_artifact(artifact_result.scalars().first())


@router.post("/start", response_model=SessionStartResponse)
async def start_session(
    body: SessionStartRequest,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_jwt),
):
    await _ensure_patient_exists(body.patient_id, db)
    requested_session_id = body.session_id or str(uuid.uuid4())
    existing = await db.execute(select(Session).where(Session.id == requested_session_id))
    session = existing.scalars().first()
    if session:
        session.patient_id = body.patient_id
        if body.pt_plan is not None:
            session.pt_plan = body.pt_plan
        if body.started_at is not None:
            session.started_at = _utc_naive(body.started_at) or session.started_at
        await db.commit()
        return SessionStartResponse(session_id=session.id)

    session = Session(
        id=requested_session_id,
        patient_id=body.patient_id,
        pt_plan=body.pt_plan,
        started_at=_utc_naive(body.started_at) or datetime.utcnow(),
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


@router.post("/{session_id}/frame-features")
async def replace_frame_features(
    session_id: str,
    body: FrameFeaturesCsvRequest,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_jwt),
):
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalars().first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    rows = parse_frame_features_csv(body.frame_features_csv)
    await db.execute(delete(PoseFrame).where(PoseFrame.session_id == session_id))
    for fr in rows:
        db.add(PoseFrame(
            id=str(uuid.uuid4()),
            session_id=session_id,
            timestamp=fr["timestamp"],
            angles_json=fr["angles_json"],
        ))
    await db.commit()
    return {"status": "ok", "stored": len(rows)}


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

    session.patient_id = body.patient_id
    session.pt_plan = body.pt_plan
    session.ended_at = _utc_naive(body.ended_at) or session.ended_at or datetime.utcnow()
    await db.commit()

    existing_reporter = await _load_existing_reporter_output(session_id, db)
    if existing_reporter:
        return existing_reporter

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


@router.post("/exercise-result", response_model=ExerciseResponse, status_code=201)
async def store_exercise_result(
    body: ExerciseResult,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_jwt),
):
    existing = await db.execute(
        select(Exercise).where(Exercise.mobile_exercise_id == body.sessionId)
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

    # Older mobile builds may not send visitId yet. Fall back to sessionId so
    # legacy uploads still get a non-null value (each row becomes its own
    # one-row visit, matching today's behaviour) while new uploads share a
    # real visit_id across the visit.
    visit_id = body.visitId or body.sessionId
    injured_joint_rom = body.injuredJointRom.model_dump() if body.injuredJointRom else None

    exercise_row = Exercise(
        id=str(uuid.uuid4()),
        patient_id=body.patientId,
        mobile_exercise_id=body.sessionId,
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
        calibration_batch_id=body.calibrationBatchId,
        calibration_step=body.calibrationStep,
        linked_session_id=linked_session.id,
        visit_id=visit_id,
        injured_joint_rom=injured_joint_rom,
    )
    db.add(exercise_row)
    await db.flush()

    for rep in body.summary.reps:
        db.add(RepAnalysis(
            id=str(uuid.uuid4()),
            exercise_id=exercise_row.id,
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
    exercise_id = exercise_row.id
    await db.commit()

    # Fire the exercise pipeline as a background task — returns 201 immediately,
    # agents run concurrently without blocking the mobile app.
    asyncio.create_task(
        run_exercise_pipeline(body, linked_session_id, body.patientId)
    )

    return ExerciseResponse(
        id=exercise_id,
        sessionId=body.sessionId,
        visitId=visit_id,
        exercise=body.exercise,
        numReps=body.numReps,
        overallRating=body.summary.summary.overallRating,
        linkedSessionId=linked_session_id,
    )


@router.post("/multi-exercise-archive", status_code=201)
async def store_multi_exercise_archive(
    body: MultiExerciseArchivePayload,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_jwt),
):
    """Archive the full MultiExerciseSession JSON for one recording visit.

    TODO(longitudinal): a future longitudinal report agent will read this
    table. No current route or agent reads it. Idempotent on visit_id —
    a repeat POST returns ``{"status": "exists"}`` instead of 409.
    """
    existing = await db.execute(
        select(MultiExerciseSessionArchive).where(
            MultiExerciseSessionArchive.visit_id == body.visitId
        )
    )
    if existing.scalars().first():
        return {"status": "exists", "visitId": body.visitId}

    await _ensure_patient_exists(body.patientId, db)
    db.add(MultiExerciseSessionArchive(
        id=str(uuid.uuid4()),
        visit_id=body.visitId,
        patient_id=body.patientId,
        started_at_ms=body.startedAtMs,
        ended_at_ms=body.endedAtMs,
        duration_ms=body.durationMs,
        payload_json=body.payload,
    ))
    await db.commit()
    return {"status": "stored", "visitId": body.visitId}


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
        select(Exercise)
        .where(Exercise.exercise == exercise)
        .order_by(Exercise.created_at.desc())
        .limit(1)
    )
    exercise_row = result.scalars().first()
    if not exercise_row or not exercise_row.linked_session_id:
        raise HTTPException(status_code=404, detail="no stored session with linked frames")

    frames_result = await db.execute(
        select(PoseFrame)
        .where(PoseFrame.session_id == exercise_row.linked_session_id)
        .where(PoseFrame.landmarks_json.isnot(None))
        .order_by(PoseFrame.timestamp)
    )
    frames = frames_result.scalars().all()
    if not frames:
        raise HTTPException(status_code=404, detail="no landmark frames stored for latest session")
    return _build_landmarks_csv_from_frames(frames, mode=exercise)


@router.get("/calibration/frames.csv", response_class=PlainTextResponse)
async def calibration_landmark_frames_csv(
    patientId: str,
    calibrationBatchId: str,
    calibrationStep: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_jwt),
):
    if calibrationStep < 1 or calibrationStep > 4:
        raise HTTPException(status_code=422, detail="calibrationStep must be 1..4")

    result = await db.execute(
        select(Exercise)
        .where(Exercise.exercise == exercise)
        .order_by(Exercise.created_at.desc())
        .limit(1)
    )
    exercise_row = result.scalars().first()
    if not exercise_row or not exercise_row.linked_session_id:
        raise HTTPException(status_code=404, detail="no stored session with linked frames")

    frames_result = await db.execute(
        select(PoseFrame)
        .where(PoseFrame.session_id == exercise_row.linked_session_id)
        .where(PoseFrame.landmarks_json.isnot(None))
        .order_by(PoseFrame.timestamp)
    )
    frames = frames_result.scalars().all()
    if not frames:
        raise HTTPException(status_code=404, detail="no landmark frames stored for latest session")
    return _build_landmarks_csv_from_frames(frames, mode=exercise)
