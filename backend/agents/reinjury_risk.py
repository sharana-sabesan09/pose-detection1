import json
from openai import AsyncOpenAI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from config import settings
from db.models import SessionScore, Session
from schemas.session import PoseAnalysisOutput, ReinjuryRiskOutput
from agents.hipaa import hipaa_wrap
from utils.audit import write_audit
import uuid
from datetime import datetime

_client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
_MODEL = "gpt-4o"


async def run_reinjury_risk(
    patient_id: str,
    session_id: str,
    pose: PoseAnalysisOutput,
    db: AsyncSession,
) -> ReinjuryRiskOutput:
    result = await db.execute(
        select(SessionScore)
        .join(Session, SessionScore.session_id == Session.id)
        .where(Session.patient_id == patient_id)
        .order_by(SessionScore.created_at.desc())
        .limit(5)
    )
    recent_scores = result.scalars().all()

    fall_trend = [s.fall_risk_score for s in recent_scores if s.fall_risk_score is not None]
    rom_trend = [s.rom_score for s in recent_scores if s.rom_score is not None]

    fall_rising = len(fall_trend) >= 2 and fall_trend[0] > fall_trend[-1]
    rom_falling = len(rom_trend) >= 2 and rom_trend[0] < rom_trend[-1]

    prompt = f"""Patient trend data (most recent first):
Fall risk scores: {fall_trend}
ROM scores: {rom_trend}
Fall risk trending up: {fall_rising}
ROM trending down: {rom_falling}

Current session:
ROM score: {pose.rom_score}
Flagged joints: {pose.flagged_joints}

Assess reinjury risk based on trends and return a JSON object with exactly:
{{
  "score": <float 0-100>,
  "trend": "<improving|stable|worsening>",
  "reasoning": "<clinical reasoning>"
}}
Output only valid JSON."""

    response = await _client.chat.completions.create(
        model=_MODEL,
        max_tokens=512,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = response.choices[0].message.content.strip()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}") + 1
        data = json.loads(raw[start:end])

    output = ReinjuryRiskOutput(**data)

    safe_reasoning = await hipaa_wrap(
        content=output.reasoning,
        actor="reinjury_risk_agent",
        patient_id=patient_id,
        data_type="reinjury_risk_output",
        db=db,
    )
    output.reasoning = safe_reasoning

    result = await db.execute(
        select(SessionScore).where(SessionScore.session_id == session_id)
    )
    score_row = result.scalars().first()
    if score_row:
        score_row.reinjury_risk_score = output.score
    else:
        score_row = SessionScore(
            id=str(uuid.uuid4()),
            session_id=session_id,
            reinjury_risk_score=output.score,
            created_at=datetime.utcnow(),
        )
        db.add(score_row)
    await db.commit()

    await write_audit("reinjury_risk_agent", "assess_reinjury_risk", patient_id, "reinjury_risk_score", db)
    return output
