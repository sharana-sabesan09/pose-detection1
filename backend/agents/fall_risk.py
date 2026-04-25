import json
from openai import AsyncOpenAI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from config import settings
from db.models import SessionScore
from schemas.session import IntakeOutput, PoseAnalysisOutput, FallRiskOutput
from rag.retriever import retrieve_clinical_context
from agents.hipaa import hipaa_wrap
from utils.audit import write_audit
import uuid
from datetime import datetime

_client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
_MODEL = "gpt-4o"


async def run_fall_risk(
    intake: IntakeOutput,
    pose: PoseAnalysisOutput,
    patient_id: str,
    session_id: str,
    db: AsyncSession,
) -> FallRiskOutput:
    query = f"fall risk assessment {' '.join(pose.flagged_joints)} pain {json.dumps(intake.normalized_pain_scores)}"
    clinical_context = await retrieve_clinical_context(query)

    prompt = f"""Intake Data:
Target joints: {intake.target_joints}
Pain scores: {json.dumps(intake.normalized_pain_scores)}
Session goals: {intake.session_goals}

Pose Analysis:
ROM score: {pose.rom_score}
Flagged joints (low ROM): {pose.flagged_joints}
Joint stats: {json.dumps(pose.joint_stats, indent=2)}

Clinical Guidelines:
{clinical_context}

Assess fall risk and return a JSON object with exactly:
{{
  "score": <float 0-100>,
  "risk_level": "<low|medium|high>",
  "reasoning": "<clinical reasoning>",
  "contributing_factors": ["factor1", "factor2"]
}}
Output only valid JSON."""

    response = await _client.chat.completions.create(
        model=_MODEL,
        max_tokens=1024,
        messages=[
            {"role": "system", "content": "You are a clinical fall risk assessor. Output only valid JSON."},
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

    output = FallRiskOutput(**data)

    safe_reasoning = await hipaa_wrap(
        content=output.reasoning,
        actor="fall_risk_agent",
        patient_id=patient_id,
        data_type="fall_risk_output",
        db=db,
    )
    output.reasoning = safe_reasoning

    result = await db.execute(
        select(SessionScore).where(SessionScore.session_id == session_id)
    )
    score_row = result.scalars().first()
    if score_row:
        score_row.fall_risk_score = output.score
    else:
        score_row = SessionScore(
            id=str(uuid.uuid4()),
            session_id=session_id,
            fall_risk_score=output.score,
            created_at=datetime.utcnow(),
        )
        db.add(score_row)
    await db.commit()

    await write_audit("fall_risk_agent", "assess_fall_risk", patient_id, "fall_risk_score", db)
    return output
