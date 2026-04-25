import json
import uuid
from openai import AsyncOpenAI
from datetime import datetime
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from config import settings
from db.models import Summary, SessionScore, Session
from schemas.session import (
    IntakeOutput, PoseAnalysisOutput, FallRiskOutput,
    ReinjuryRiskOutput, ReporterOutput,
)
from agents.hipaa import hipaa_wrap
from utils.audit import write_audit

_client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
_MODEL = "gpt-4o"


async def run_reporter(
    session_id: str,
    patient_id: str,
    intake: IntakeOutput,
    pose: PoseAnalysisOutput,
    fall_risk: FallRiskOutput,
    reinjury_risk: ReinjuryRiskOutput,
    db: AsyncSession,
) -> ReporterOutput:
    result = await db.execute(
        select(Summary)
        .join(Session, Summary.session_id == Session.id)
        .where(
            Summary.agent_name == "reporter",
            Session.patient_id == patient_id,
        )
        .order_by(Summary.created_at.desc())
        .limit(3)
    )
    past_summaries = result.scalars().all()
    past_text = "\n\n---\n\n".join(s.content for s in past_summaries) if past_summaries else "No previous summaries."

    prompt = f"""Session Data:
Target joints: {intake.target_joints}
Pain scores: {json.dumps(intake.normalized_pain_scores)}
Session goals: {intake.session_goals}
ROM score: {pose.rom_score}
Flagged joints: {pose.flagged_joints}
Fall risk: {fall_risk.score} ({fall_risk.risk_level}) — {fall_risk.contributing_factors}
Reinjury risk: {reinjury_risk.score} (trend: {reinjury_risk.trend})

Previous summaries for context:
{past_text}

Write a structured clinical summary. Do not include patient names or identifiers.
Return a JSON object with exactly:
{{
  "summary": "<full clinical summary paragraph>",
  "session_highlights": ["highlight1", "highlight2"],
  "recommendations": ["recommendation1", "recommendation2"]
}}
Output only valid JSON."""

    response = await _client.chat.completions.create(
        model=_MODEL,
        max_tokens=1024,
        messages=[
            {"role": "system", "content": "You are a physical therapy session reporter. Write a structured clinical summary. Do not include patient names or identifiers."},
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

    output = ReporterOutput(**data)

    safe_json = await hipaa_wrap(
        content=json.dumps(data),
        actor="reporter_agent",
        patient_id=patient_id,
        data_type="reporter_output",
        db=db,
    )

    summary_row = Summary(
        id=str(uuid.uuid4()),
        session_id=session_id,
        agent_name="reporter",
        content=output.summary,
        created_at=datetime.utcnow(),
    )
    db.add(summary_row)

    score_result = await db.execute(
        select(SessionScore).where(SessionScore.session_id == session_id)
    )
    score_row = score_result.scalars().first()
    pain_avg = sum(intake.normalized_pain_scores.values()) / len(intake.normalized_pain_scores) if intake.normalized_pain_scores else 0.0

    if score_row:
        score_row.pain_score = pain_avg
        score_row.rom_score = pose.rom_score
    else:
        score_row = SessionScore(
            id=str(uuid.uuid4()),
            session_id=session_id,
            pain_score=pain_avg,
            rom_score=pose.rom_score,
            created_at=datetime.utcnow(),
        )
        db.add(score_row)

    await db.commit()
    await write_audit("reporter_agent", "generate_report", patient_id, "session_report", db)
    return output
