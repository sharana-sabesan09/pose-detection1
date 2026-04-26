import logging
import uuid
from uagents import Agent, Context, Model
from config import settings
from agents.messages import (
    IntakeRequest, IntakeResponse,
    PoseRequest, PoseResponse,
    FallRiskRequest, FallRiskResponse,
    ReinjuryRiskRequest, ReinjuryRiskResponse,
    ReporterRequest, ReporterResponse,
    ProgressRequest, ProgressResponse,
    PatientAdviceRequestMessage, PatientAdviceResponseMessage,
)

logger = logging.getLogger(__name__)


# External interface models (unchanged — used by Agentverse/external callers)
class SessionQueryMessage(Model):
    session_id: str
    patient_id: str
    query_type: str  # "session" | "progress"


class SessionResponseMessage(Model):
    summary: str
    scores: dict
    status: str


class PatientAdviceQueryMessage(Model):
    request_id: str | None = None
    patient_id: str
    question: str


class PatientAdviceResultMessage(Model):
    request_id: str
    answer: str
    safety_level: str
    urgent_flags: list[str]
    next_steps: list[str]
    disclaimer: str
    status: str


# Per-session pipeline state, keyed by session_id
_sessions: dict[str, dict] = {}
# Progress queries keyed by patient_id → original sender
_progress_pending: dict[str, str] = {}
_advice_pending: dict[str, str] = {}

physio_agent = Agent(
    name="physio-orchestrator",
    mailbox=settings.AGENTVERSE_MAILBOX_KEY,
)


@physio_agent.on_message(model=SessionQueryMessage)
async def _on_query(ctx: Context, sender: str, msg: SessionQueryMessage):
    from agents.intake import intake_agent
    from agents.progress import progress_agent

    if msg.query_type == "progress":
        _progress_pending[msg.patient_id] = sender
        await ctx.send(progress_agent.address, ProgressRequest(patient_id=msg.patient_id))
    else:
        _sessions[msg.session_id] = {
            "sender": sender,
            "patient_id": msg.patient_id,
            "awaiting": set(),
        }
        await ctx.send(intake_agent.address, IntakeRequest(
            session_id=msg.session_id,
            patient_id=msg.patient_id,
            pt_plan="",
            pain_scores={},
            user_input="",
        ))


@physio_agent.on_message(model=PatientAdviceQueryMessage)
async def _on_patient_advice_query(ctx: Context, sender: str, msg: PatientAdviceQueryMessage):
    from agents.patient_advisor import patient_advisor_agent

    request_id = msg.request_id or str(uuid.uuid4())
    _advice_pending[request_id] = sender
    await ctx.send(patient_advisor_agent.address, PatientAdviceRequestMessage(
        request_id=request_id,
        patient_id=msg.patient_id,
        question=msg.question,
    ))


@physio_agent.on_message(model=IntakeResponse)
async def _on_intake(ctx: Context, sender: str, msg: IntakeResponse):
    from agents.pose_analysis import pose_agent

    state = _sessions.get(msg.session_id)
    if not state:
        return
    if msg.error:
        await _fail(ctx, msg.session_id, f"intake: {msg.error}")
        return

    state["intake"] = {
        "normalized_pain_scores": msg.normalized_pain_scores,
        "target_joints": msg.target_joints,
        "session_goals": msg.session_goals,
    }
    await ctx.send(pose_agent.address, PoseRequest(
        session_id=msg.session_id, patient_id=state["patient_id"]
    ))


@physio_agent.on_message(model=PoseResponse)
async def _on_pose(ctx: Context, sender: str, msg: PoseResponse):
    from agents.fall_risk import fall_risk_agent
    from agents.reinjury_risk import reinjury_agent

    state = _sessions.get(msg.session_id)
    if not state:
        return
    if msg.error:
        await _fail(ctx, msg.session_id, f"pose: {msg.error}")
        return

    state["pose"] = {
        "rom_score": msg.rom_score,
        "joint_stats": msg.joint_stats,
        "flagged_joints": msg.flagged_joints,
    }
    state["awaiting"] = {"fall_risk", "reinjury_risk"}

    await ctx.send(fall_risk_agent.address, FallRiskRequest(
        session_id=msg.session_id,
        patient_id=state["patient_id"],
        intake=state["intake"],
        pose=state["pose"],
    ))
    await ctx.send(reinjury_agent.address, ReinjuryRiskRequest(
        session_id=msg.session_id,
        patient_id=state["patient_id"],
        pose=state["pose"],
    ))


@physio_agent.on_message(model=FallRiskResponse)
async def _on_fall_risk(ctx: Context, sender: str, msg: FallRiskResponse):
    state = _sessions.get(msg.session_id)
    if not state:
        return
    if msg.error:
        await _fail(ctx, msg.session_id, f"fall_risk: {msg.error}")
        return

    state["fall_risk"] = {
        "score": msg.score,
        "risk_level": msg.risk_level,
        "reasoning": msg.reasoning,
        "contributing_factors": msg.contributing_factors,
    }
    state["awaiting"].discard("fall_risk")
    await _maybe_report(ctx, msg.session_id)


@physio_agent.on_message(model=ReinjuryRiskResponse)
async def _on_reinjury_risk(ctx: Context, sender: str, msg: ReinjuryRiskResponse):
    state = _sessions.get(msg.session_id)
    if not state:
        return
    if msg.error:
        await _fail(ctx, msg.session_id, f"reinjury_risk: {msg.error}")
        return

    state["reinjury_risk"] = {
        "score": msg.score,
        "trend": msg.trend,
        "reasoning": msg.reasoning,
    }
    state["awaiting"].discard("reinjury_risk")
    await _maybe_report(ctx, msg.session_id)


async def _maybe_report(ctx: Context, session_id: str) -> None:
    from agents.reporter import reporter_agent

    state = _sessions.get(session_id)
    if not state or state["awaiting"]:
        return

    await ctx.send(reporter_agent.address, ReporterRequest(
        session_id=session_id,
        patient_id=state["patient_id"],
        intake=state["intake"],
        pose=state["pose"],
        fall_risk=state["fall_risk"],
        reinjury_risk=state["reinjury_risk"],
    ))


@physio_agent.on_message(model=ReporterResponse)
async def _on_reporter(ctx: Context, sender: str, msg: ReporterResponse):
    from sqlalchemy import select, func
    from db.models import Session
    from agents.progress import progress_agent

    state = _sessions.get(msg.session_id)
    if not state:
        return
    if msg.error:
        await _fail(ctx, msg.session_id, f"reporter: {msg.error}")
        return

    state["reporter"] = {
        "summary": msg.summary,
        "session_highlights": msg.session_highlights,
        "recommendations": msg.recommendations,
    }

    # Check if patient has 3+ sessions for progress report
    try:
        from db.session import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(func.count(Session.id)).where(Session.patient_id == state["patient_id"])
            )
            count = result.scalar()
        if count >= 3:
            await ctx.send(progress_agent.address, ProgressRequest(
                patient_id=state["patient_id"]
            ))
            # Store session_id so we can match the progress response back
            _progress_pending[state["patient_id"]] = ("__pipeline__", msg.session_id)
            return
    except Exception as e:
        logger.error("session count check failed: %s", e)

    await _finish(ctx, msg.session_id)


@physio_agent.on_message(model=ProgressResponse)
async def _on_progress(ctx: Context, sender: str, msg: ProgressResponse):
    pending = _progress_pending.pop(msg.patient_id, None)
    if pending is None:
        return

    if isinstance(pending, tuple):
        # Came from pipeline — finish the session
        _, session_id = pending
        state = _sessions.get(session_id)
        if state:
            state["progress"] = {
                "longitudinal_report": msg.longitudinal_report,
                "overall_trend": msg.overall_trend,
            }
        await _finish(ctx, session_id)
    else:
        # Came from external progress-only query
        original_sender = pending
        await ctx.send(original_sender, SessionResponseMessage(
            summary=msg.longitudinal_report,
            scores={"overall_trend": msg.overall_trend},
            status="ok" if not msg.error else f"error: {msg.error}",
        ))


@physio_agent.on_message(model=PatientAdviceResponseMessage)
async def _on_patient_advice(ctx: Context, sender: str, msg: PatientAdviceResponseMessage):
    original_sender = _advice_pending.pop(msg.request_id, None)
    if not original_sender:
        return

    await ctx.send(original_sender, PatientAdviceResultMessage(
        request_id=msg.request_id,
        answer=msg.answer,
        safety_level=msg.safety_level,
        urgent_flags=msg.urgent_flags,
        next_steps=msg.next_steps,
        disclaimer=msg.disclaimer,
        status="ok" if not msg.error else f"error: {msg.error}",
    ))


async def _finish(ctx: Context, session_id: str) -> None:
    state = _sessions.pop(session_id, None)
    if not state:
        return
    reporter = state.get("reporter", {})
    await ctx.send(state["sender"], SessionResponseMessage(
        summary=reporter.get("summary", ""),
        scores={
            "fall_risk": state.get("fall_risk", {}),
            "reinjury_risk": state.get("reinjury_risk", {}),
            "pose_analysis": state.get("pose", {}),
            "progress": state.get("progress", {}),
        },
        status="ok",
    ))


async def _fail(ctx: Context, session_id: str, reason: str) -> None:
    state = _sessions.pop(session_id, None)
    if not state:
        return
    logger.error("pipeline failed for session %s: %s", session_id, reason)
    await ctx.send(state["sender"], SessionResponseMessage(
        summary="", scores={}, status=f"error: {reason}"
    ))
