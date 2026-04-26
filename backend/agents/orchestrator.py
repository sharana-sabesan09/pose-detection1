import logging
from sqlalchemy.ext.asyncio import AsyncSession
from schemas.session import IntakeInput
from agents.intake import run_intake
from agents.pose_analysis import run_pose_analysis
from agents.fall_risk import run_fall_risk
from agents.reinjury_risk import run_reinjury_risk
from agents.reporter import run_reporter
from agents.progress import run_progress
from utils.audit import write_audit
from sqlalchemy import select, func
from db.models import Session
from schemas.exercise import ExerciseSessionResult

logger = logging.getLogger(__name__)


async def run_session_pipeline(
    session_id: str,
    patient_id: str,
    intake_data: IntakeInput,
    db: AsyncSession,
) -> dict:
    results = {}
    failed_agents: list[str] = []

    try:
        intake_output = await run_intake(intake_data, db)
        results["intake"] = intake_output.model_dump()
    except Exception as e:
        logger.error("intake agent failed: %s", e)
        failed_agents.append("intake")
        await write_audit("orchestrator", "pipeline_error", patient_id, "intake", db)
        await db.commit()
        return {"failed_agents": failed_agents, **results}

    try:
        pose_output = await run_pose_analysis(session_id, db, patient_id=patient_id)
        results["pose_analysis"] = pose_output.model_dump()
    except Exception as e:
        logger.error("pose_analysis agent failed: %s", e)
        failed_agents.append("pose_analysis")
        await write_audit("orchestrator", "pipeline_error", patient_id, "pose_analysis", db)
        await db.commit()
        return {"failed_agents": failed_agents, **results}

    try:
        # Sequential — both share the same db session; concurrent gather would cause
        # illegal concurrent commits on the same session.
        fall_output = await run_fall_risk(intake_output, pose_output, patient_id, session_id, db)
        reinjury_output = await run_reinjury_risk(patient_id, session_id, pose_output, db)
        results["fall_risk"] = fall_output.model_dump()
        results["reinjury_risk"] = reinjury_output.model_dump()
    except Exception as e:
        logger.error("risk agents failed: %s", e)
        failed_agents.extend(["fall_risk", "reinjury_risk"])
        await write_audit("orchestrator", "pipeline_error", patient_id, "risk_agents", db)
        await db.commit()
        return {"failed_agents": failed_agents, **results}

    try:
        reporter_output = await run_reporter(
            session_id, patient_id, intake_output, pose_output, fall_output, reinjury_output, db
        )
        results["reporter"] = reporter_output.model_dump()
    except Exception as e:
        logger.error("reporter agent failed: %s", e)
        failed_agents.append("reporter")
        await write_audit("orchestrator", "pipeline_error", patient_id, "reporter", db)
        await db.commit()
        return {"failed_agents": failed_agents, **results}

    try:
        count_result = await db.execute(
            select(func.count(Session.id)).where(Session.patient_id == patient_id)
        )
        session_count = count_result.scalar()
        if session_count >= 3:
            progress_output = await run_progress(patient_id, db)
            results["progress"] = progress_output.model_dump()
    except Exception as e:
        logger.error("progress agent failed: %s", e)
        failed_agents.append("progress")
        await write_audit("orchestrator", "pipeline_error", patient_id, "progress", db)

    # Single commit for everything accumulated across all agents.
    await db.commit()

    if failed_agents:
        results["failed_agents"] = failed_agents

    return results


async def run_exercise_pipeline(
    result: ExerciseSessionResult,
    session_id: str,
    patient_id: str | None,
) -> dict:
    """
    Exercise session pipeline — runs the exercise_reporter directly from mobile data.

    Creates its own db session because it runs as an asyncio background task
    after the HTTP 201 response has already been returned to the mobile app.
    Only calls progress_agent if the patient has 3+ linked sessions.
    """
    from agents.exercise_reporter import run_exercise_reporter
    from db.session import AsyncSessionLocal

    pid = patient_id or "anonymous"
    results: dict = {}
    failed_agents: list[str] = []

    async with AsyncSessionLocal() as db:
        try:
            reporter_output = await run_exercise_reporter(result, session_id, pid, db)
            results["exercise_reporter"] = reporter_output.model_dump()
        except Exception as e:
            logger.error("exercise_reporter agent failed: %s", e)
            failed_agents.append("exercise_reporter")
            await write_audit("orchestrator", "pipeline_error", pid, "exercise_reporter", db)
            await db.commit()
            return {"failed_agents": failed_agents}

        if patient_id:
            try:
                count_result = await db.execute(
                    select(func.count(Session.id)).where(Session.patient_id == patient_id)
                )
                if (count_result.scalar() or 0) >= 3:
                    progress_output = await run_progress(patient_id, db)
                    results["progress"] = progress_output.model_dump()
            except Exception as e:
                logger.error("progress agent failed (exercise pipeline): %s", e)
                failed_agents.append("progress")
                await write_audit("orchestrator", "pipeline_error", pid, "progress", db)

        await db.commit()

    if failed_agents:
        results["failed_agents"] = failed_agents
    return results
