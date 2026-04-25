import json
import logging
import uuid
from datetime import datetime
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uagents import Agent, Context
from db.models import Summary, AccumulatedScore, SessionScore, Session as SessionModel
from schemas.session import ProgressOutput
from agents.hipaa import hipaa_wrap
from agents._client import openai_client as _client, OPENAI_MODEL as _MODEL
from agents.messages import ProgressRequest, ProgressResponse
from utils.audit import write_audit

logger = logging.getLogger(__name__)


async def run_progress(patient_id: str, db: AsyncSession) -> ProgressOutput:
    summaries_result = await db.execute(
        select(Summary)
        .join(SessionModel, Summary.session_id == SessionModel.id)
        .where(
            Summary.agent_name == "reporter",
            SessionModel.patient_id == patient_id,
        )
        .order_by(Summary.created_at.asc())
    )
    summaries = summaries_result.scalars().all()

    acc_result = await db.execute(
        select(AccumulatedScore).where(AccumulatedScore.patient_id == patient_id)
    )
    acc = acc_result.scalars().first()
    acc_data = {
        "fall_risk_avg": acc.fall_risk_avg if acc else None,
        "reinjury_risk_avg": acc.reinjury_risk_avg if acc else None,
    }

    all_summaries_text = "\n\n---\n\n".join(s.content for s in summaries)

    prompt = f"""All session summaries (oldest first):
{all_summaries_text}

Accumulated scores: {json.dumps(acc_data)}

Analyze longitudinal progress and return a JSON object with exactly:
{{
  "longitudinal_report": "<full longitudinal analysis>",
  "overall_trend": "<improving|stable|declining>",
  "milestones_reached": ["milestone1"],
  "next_goals": ["goal1"]
}}
Output only valid JSON."""

    response = await _client.chat.completions.create(
        model=_MODEL,
        max_tokens=1024,
        messages=[
            {"role": "system", "content": "You are a longitudinal physical therapy progress analyst."},
            {"role": "user", "content": prompt},
        ],
    )
    raw = response.choices[0].message.content.strip()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}") + 1
        data = json.loads(raw[start:end])

    output = ProgressOutput(**data)

    safe_json = await hipaa_wrap(
        content=json.dumps(data),
        actor="progress_agent",
        patient_id=patient_id,
        data_type="progress_output",
        db=db,
    )

    progress_row = Summary(
        id=str(uuid.uuid4()),
        session_id=None,
        agent_name="progress",
        content=output.longitudinal_report,
        created_at=datetime.utcnow(),
    )
    db.add(progress_row)

    # Recompute accumulated scores — weighted average of last 10 sessions (recency weight = 1/rank)
    scores_result = await db.execute(
        select(SessionScore)
        .join(SessionModel, SessionScore.session_id == SessionModel.id)
        .where(SessionModel.patient_id == patient_id)
        .order_by(SessionScore.created_at.desc())
        .limit(10)
    )
    recent_scores = scores_result.scalars().all()

    if recent_scores:
        total_weight = sum(1.0 / (i + 1) for i in range(len(recent_scores)))
        fall_wavg = sum(
            (s.fall_risk_score or 0) / (i + 1)
            for i, s in enumerate(recent_scores)
            if s.fall_risk_score is not None
        ) / total_weight if total_weight else None

        reinjury_wavg = sum(
            (s.reinjury_risk_score or 0) / (i + 1)
            for i, s in enumerate(recent_scores)
            if s.reinjury_risk_score is not None
        ) / total_weight if total_weight else None

        if acc:
            acc.fall_risk_avg = fall_wavg
            acc.reinjury_risk_avg = reinjury_wavg
            acc.updated_at = datetime.utcnow()
        else:
            acc = AccumulatedScore(
                id=str(uuid.uuid4()),
                patient_id=patient_id,
                fall_risk_avg=fall_wavg,
                reinjury_risk_avg=reinjury_wavg,
                updated_at=datetime.utcnow(),
            )
            db.add(acc)

    await db.flush()
    await write_audit("progress_agent", "generate_progress_report", patient_id, "progress_output", db)
    return output


progress_agent = Agent(name="progress-agent", seed="physio-progress-agent-sentinel-v1")


@progress_agent.on_message(model=ProgressRequest)
async def _handle_progress(ctx: Context, sender: str, msg: ProgressRequest):
    from db.session import AsyncSessionLocal
    try:
        async with AsyncSessionLocal() as db:
            output = await run_progress(msg.patient_id, db)
            await ctx.send(sender, ProgressResponse(
                patient_id=msg.patient_id, **output.model_dump()
            ))
    except Exception as e:
        logger.error("progress uagent error: %s", e)
        await ctx.send(sender, ProgressResponse(
            patient_id=msg.patient_id,
            longitudinal_report="", overall_trend="unknown",
            milestones_reached=[], next_goals=[],
            error=str(e),
        ))
