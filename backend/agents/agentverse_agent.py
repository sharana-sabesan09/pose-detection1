import asyncio
import logging
from uagents import Agent, Context, Model
from config import settings
from schemas.session import IntakeInput

logger = logging.getLogger(__name__)


class SessionQueryMessage(Model):
    session_id: str
    patient_id: str
    query_type: str  # "session" | "progress"


class SessionResponseMessage(Model):
    summary: str
    scores: dict
    status: str


physio_agent = Agent(
    name="physio-orchestrator",
    mailbox=settings.AGENTVERSE_MAILBOX_KEY,
)


@physio_agent.on_message(model=SessionQueryMessage)
async def handle_session_query(ctx: Context, sender: str, msg: SessionQueryMessage):
    from db.session import AsyncSessionLocal
    from agents.orchestrator import run_session_pipeline
    from agents.progress import run_progress

    try:
        async with AsyncSessionLocal() as db:
            if msg.query_type == "progress":
                output = await run_progress(msg.patient_id, db)
                await ctx.send(sender, SessionResponseMessage(
                    summary=output.longitudinal_report,
                    scores={"overall_trend": output.overall_trend},
                    status="ok",
                ))
            else:
                intake_data = IntakeInput(
                    session_id=msg.session_id,
                    patient_id=msg.patient_id,
                    pt_plan="",
                    pain_scores={},
                    user_input="",
                )
                results = await run_session_pipeline(msg.session_id, msg.patient_id, intake_data, db)
                summary = results.get("reporter", {}).get("summary", "No summary available.")
                scores = {
                    k: results.get(k, {})
                    for k in ("fall_risk", "reinjury_risk", "pose_analysis")
                }
                await ctx.send(sender, SessionResponseMessage(
                    summary=summary,
                    scores=scores,
                    status="ok",
                ))
    except Exception as e:
        logger.error("uAgent pipeline error: %s", e)
        await ctx.send(sender, SessionResponseMessage(
            summary="",
            scores={},
            status=f"error: {e}",
        ))
