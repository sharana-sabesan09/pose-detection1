import json
import logging
import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uagents import Agent, Context

from agents._client import openai_client as _client, OPENAI_MODEL as _MODEL
from agents.hipaa import hipaa_wrap
from agents.messages import PatientAdviceRequestMessage, PatientAdviceResponseMessage
from db.models import AccumulatedScore, Patient, Session as SessionModel, SessionScore, Summary
from rag.retriever import retrieve_clinical_context
from schemas.advice import PatientAdviceResponse
from utils.audit import write_audit

logger = logging.getLogger(__name__)

_DISCLAIMER = (
    "This is supportive guidance, not a diagnosis. "
    "If pain is severe, worsening, or accompanied by red-flag symptoms, seek urgent medical care."
)


async def run_patient_advisor(
    patient_id: str,
    question: str,
    db: AsyncSession,
) -> PatientAdviceResponse:
    patient_result = await db.execute(select(Patient).where(Patient.id == patient_id))
    patient = patient_result.scalars().first()
    if not patient:
        return PatientAdviceResponse(
            answer="I could not find a patient record for that question.",
            safety_level="unknown",
            urgent_flags=[],
            next_steps=["Confirm the patient record exists before asking for personalized advice."],
            disclaimer=_DISCLAIMER,
        )

    sessions_result = await db.execute(
        select(SessionModel)
        .where(SessionModel.patient_id == patient_id)
        .order_by(SessionModel.started_at.desc())
        .limit(5)
    )
    sessions = sessions_result.scalars().all()
    session_ids = [s.id for s in sessions]

    summaries_by_session: dict[str, str] = {}
    scores_by_session: dict[str, dict] = {}

    if session_ids:
        summary_result = await db.execute(
            select(Summary)
            .where(
                Summary.session_id.in_(session_ids),
                Summary.agent_name == "reporter",
            )
            .order_by(Summary.created_at.desc())
        )
        for row in summary_result.scalars().all():
            if row.session_id and row.session_id not in summaries_by_session:
                summaries_by_session[row.session_id] = row.content

        score_result = await db.execute(
            select(SessionScore).where(SessionScore.session_id.in_(session_ids))
        )
        for row in score_result.scalars().all():
            scores_by_session[row.session_id] = {
                "fall_risk_score": row.fall_risk_score,
                "reinjury_risk_score": row.reinjury_risk_score,
                "pain_score": row.pain_score,
                "rom_score": row.rom_score,
            }

    acc_result = await db.execute(
        select(AccumulatedScore).where(AccumulatedScore.patient_id == patient_id)
    )
    accumulated = acc_result.scalars().first()

    recent_session_context = [
        {
            "session_id": session.id,
            "started_at": session.started_at.isoformat(),
            "ended_at": session.ended_at.isoformat() if session.ended_at else None,
            "summary": summaries_by_session.get(session.id),
            "scores": scores_by_session.get(session.id, {}),
        }
        for session in sessions
    ]

    rag_query = f"physical therapy patient advice {question}"
    rag_result = await retrieve_clinical_context(rag_query)
    clinical_block = (
        f"Clinical guidance context:\n{rag_result.context}"
        if rag_result.hit_count > 0
        else "No clinical guidelines available for this question."
    )

    prompt = f"""You are a cautious physical therapy support agent.

Patient metadata:
{json.dumps(patient.metadata_json or {}, indent=2)}

Accumulated scores:
{json.dumps({
    "fall_risk_avg": accumulated.fall_risk_avg if accumulated else None,
    "reinjury_risk_avg": accumulated.reinjury_risk_avg if accumulated else None,
}, indent=2)}

Recent session context:
{json.dumps(recent_session_context, indent=2)}

Patient question:
{question}

{clinical_block}

Write supportive patient guidance grounded in the data above.
Do not diagnose.
Do not claim measurements that are not present.
Escalate clearly if the question suggests red-flag symptoms.

Return JSON with exactly:
{{
  "answer": "<patient-facing answer>",
  "safety_level": "<routine|soon|urgent|emergency>",
  "urgent_flags": ["flag1"],
  "next_steps": ["step1", "step2"],
  "disclaimer": "{_DISCLAIMER}"
}}
Output only valid JSON."""

    response = await _client.chat.completions.create(
        model=_MODEL,
        max_tokens=1024,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a conservative physical therapy guidance assistant. "
                    "You can use patient session history, but you must not diagnose, "
                    "promise safety, or invent missing data. Output only valid JSON."
                ),
            },
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

    output = PatientAdviceResponse(**data)

    safe_json = await hipaa_wrap(
        content=json.dumps(data),
        actor="patient_advisor_agent",
        patient_id=patient_id,
        data_type="patient_advice",
        db=db,
    )

    db.add(Summary(
        id=str(uuid.uuid4()),
        session_id=None,
        agent_name="patient_advisor",
        content=output.answer,
        created_at=datetime.utcnow(),
    ))
    await db.flush()
    await write_audit("patient_advisor_agent", "answer_patient_question", patient_id, "patient_advice", db)
    return output


patient_advisor_agent = Agent(name="patient-advisor-agent", seed="physio-patient-advisor-agent-sentinel-v1")


@patient_advisor_agent.on_message(model=PatientAdviceRequestMessage)
async def _handle_patient_advice(ctx: Context, sender: str, msg: PatientAdviceRequestMessage):
    from db.session import AsyncSessionLocal
    try:
        async with AsyncSessionLocal() as db:
            output = await run_patient_advisor(msg.patient_id, msg.question, db)
            await db.commit()
            await ctx.send(sender, PatientAdviceResponseMessage(
                request_id=msg.request_id,
                patient_id=msg.patient_id,
                answer=output.answer,
                safety_level=output.safety_level,
                urgent_flags=output.urgent_flags,
                next_steps=output.next_steps,
                disclaimer=output.disclaimer,
            ))
    except Exception as e:
        logger.error("patient_advisor uagent error: %s", e)
        await ctx.send(sender, PatientAdviceResponseMessage(
            request_id=msg.request_id,
            patient_id=msg.patient_id,
            answer="I could not answer that question right now.",
            safety_level="unknown",
            urgent_flags=[],
            next_steps=["Try again later or contact your clinician directly."],
            disclaimer=_DISCLAIMER,
            error=str(e),
        ))
