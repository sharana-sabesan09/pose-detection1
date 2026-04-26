import asyncio
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from db.session import get_db
from db.models import Session, PoseFrame, ExerciseSession, RepAnalysis, Patient
from schemas.session import IntakeInput, ReporterOutput
from schemas.report import SessionStartRequest, SessionStartResponse, FrameRequest
from schemas.exercise import ExerciseSessionResult, ExerciseSessionResponse
from schemas.voice import VoiceMetadataExtractRequest, VoiceMetadataExtractResponse
from agents.orchestrator import run_session_pipeline, run_exercise_pipeline
from routers.auth import require_jwt
from utils.frame_csv import parse_frame_features_csv
from utils.voice_metadata import build_session_metadata_from_voice

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
