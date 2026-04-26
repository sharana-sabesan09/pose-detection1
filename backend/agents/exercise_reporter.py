"""
exercise_reporter.py — Direct clinical pipeline for mobile exercise sessions.

Replaces the lossy intake → pose_analysis → fall_risk → reinjury_risk → reporter
chain for exercise data.  The mobile app already computes 12 biomechanical
features per rep with per-rep confidence scores; this agent reads that data
natively instead of re-deriving a subset from raw pose frames.

Pipeline:
  1. Filter reps: confidence >= MIN_CONFIDENCE, durationMs >= MIN_DURATION_MS
  2. Guard hipAdductionPeak == 0  (landmark-loss sentinel — treat as missing)
  3. Compute per-feature stats and error frequencies from good reps
  4. Derive numeric scores directly from the exercise data
  5. Retrieve clinical guidelines via RAG, keyed on dominant error patterns
  6. Call LLM to synthesise a structured clinical summary
  7. Write Summary (agent_name="reporter") + SessionScore rows
"""

import json
import logging
import statistics
import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agents.hipaa import hipaa_wrap
from agents._client import gemini_client as _client, GEMINI_MODEL as _MODEL
from db.models import Session, SessionScore, Summary
from rag.retriever import retrieve_clinical_context
from schemas.exercise import ExerciseSessionResult
from schemas.session import ExerciseReporterOutput
from utils.audit import write_audit

logger = logging.getLogger(__name__)

# Rep quality gates
_MIN_CONFIDENCE = 0.7
_MIN_DURATION_MS = 300.0

# Pelvic drop threshold above which fall risk rises (degrees)
_PELVIC_DROP_CLINICAL_THRESHOLD = 10.0
# sway_norm above which balance is clinically relevant
_SWAY_CLINICAL_THRESHOLD = 0.05


def _safe_mean(values: list[float]) -> float | None:
    clean = [v for v in values if v is not None]
    return statistics.mean(clean) if clean else None


def _safe_std(values: list[float]) -> float | None:
    clean = [v for v in values if v is not None]
    return statistics.stdev(clean) if len(clean) >= 2 else None


def _compute_exercise_stats(result: ExerciseSessionResult) -> dict:
    """
    Filter reps, guard sentinel values, compute aggregate stats.

    Returns a rich context dict with error rates, feature stats, and
    derived numeric scores for fall risk, reinjury risk, and ROM.
    """
    all_reps = result.summary.reps

    good_reps = [
        r for r in all_reps
        if r.confidence >= _MIN_CONFIDENCE and r.timing.durationMs >= _MIN_DURATION_MS
    ]
    filtered_count = len(all_reps) - len(good_reps)

    if not good_reps:
        return {
            "good_rep_count": 0,
            "filtered_rep_count": filtered_count,
            "error_rates": {},
            "feature_stats": {},
            "sway_norm_mean": None,
            "pelvic_drop_mean": None,
            "rom_score": 0.0,
            "fall_risk_score": 50.0,
            "reinjury_risk_score": 50.0,
            "top_errors": [],
            "consistency": result.summary.summary.consistency,
        }

    n = len(good_reps)

    # ── Error frequencies ────────────────────────────────────────────────────
    error_rates = {
        "kneeValgus":   sum(1 for r in good_reps if r.errors.kneeValgus) / n,
        "trunkLean":    sum(1 for r in good_reps if r.errors.trunkLean) / n,
        "trunkFlex":    sum(1 for r in good_reps if r.errors.trunkFlex) / n,
        "pelvicDrop":   sum(1 for r in good_reps if r.errors.pelvicDrop) / n,
        "pelvicShift":  sum(1 for r in good_reps if r.errors.pelvicShift) / n,
        "hipAdduction": sum(1 for r in good_reps if r.errors.hipAdduction) / n,
        "kneeOverFoot": sum(1 for r in good_reps if r.errors.kneeOverFoot) / n,
        "balance":      sum(1 for r in good_reps if r.errors.balance) / n,
    }
    top_errors = sorted(
        [(k, v) for k, v in error_rates.items() if v >= 0.5],
        key=lambda x: x[1],
        reverse=True,
    )

    # ── Feature stats ────────────────────────────────────────────────────────
    def feat_stats(values: list[float], exclude_zero: bool = False) -> dict:
        """Compute mean/std, optionally skipping zeros (landmark-loss sentinel)."""
        clean = [v for v in values if v is not None and (not exclude_zero or v != 0.0)]
        if not clean:
            return {"mean": None, "std": None, "n": 0}
        return {
            "mean": round(statistics.mean(clean), 3),
            "std": round(_safe_std(clean) or 0.0, 3),
            "n": len(clean),
        }

    feature_stats = {
        "kneeFlexionDeg":  feat_stats([r.features.kneeFlexionDeg for r in good_reps]),
        "romRatio":        feat_stats([r.features.romRatio for r in good_reps]),
        "fppaPeak":        feat_stats([r.features.fppaPeak for r in good_reps]),
        "trunkFlexPeak":   feat_stats([r.features.trunkFlexPeak for r in good_reps]),
        "pelvicDropPeak":  feat_stats([r.features.pelvicDropPeak for r in good_reps]),
        "swayNorm":        feat_stats([r.features.swayNorm for r in good_reps]),
        "smoothness":      feat_stats([r.features.smoothness for r in good_reps]),
        # exclude_zero=True: hipAdductionPeak=0 is a landmark-loss sentinel, not a real measurement
        "hipAdductionPeak": feat_stats(
            [r.features.hipAdductionPeak for r in good_reps], exclude_zero=True
        ),
    }

    sway_mean = feature_stats["swayNorm"]["mean"]
    pelvic_drop_mean = feature_stats["pelvicDropPeak"]["mean"]
    rom_ratio_mean = feature_stats["romRatio"]["mean"]

    # ── ROM score (0–100) ────────────────────────────────────────────────────
    # romRatio is already normalised to a 120° target (1.0 = full depth)
    rom_score = min(100.0, round((rom_ratio_mean or 0.0) * 100, 1))

    # ── Fall risk score (0–100) ──────────────────────────────────────────────
    # Components:
    #   swayNorm  — 0–0.05 is safe; above 0.05 is clinically significant (40 pts)
    #   pelvicDrop — 0–20° range; >10° is clinically significant (30 pts)
    #   balance errors — direct balance failure rate (30 pts)
    sway_component = min(1.0, (sway_mean or 0.0) / _SWAY_CLINICAL_THRESHOLD) * 40
    pelvic_component = min(1.0, (pelvic_drop_mean or 0.0) / (_PELVIC_DROP_CLINICAL_THRESHOLD * 2)) * 30
    balance_component = error_rates["balance"] * 30
    fall_risk_score = round(sway_component + pelvic_component + balance_component, 1)

    # ── Reinjury risk score (0–100) ──────────────────────────────────────────
    # Components:
    #   consistency — low consistency = high intra-session variance = compensatory patterns (50 pts)
    #   mean error rate — how many error types are firing per rep on average (30 pts)
    #   poor-rep rate — proportion of good reps classified "poor" (20 pts)
    consistency = result.summary.summary.consistency
    poor_rate = sum(1 for r in good_reps if r.score.classification == "poor") / n
    mean_error_rate = sum(error_rates.values()) / len(error_rates) if error_rates else 0.0
    reinjury_risk_score = round(
        (1.0 - consistency) * 50 + mean_error_rate * 30 + poor_rate * 20, 1
    )

    return {
        "good_rep_count": n,
        "filtered_rep_count": filtered_count,
        "error_rates": {k: round(v, 3) for k, v in error_rates.items()},
        "feature_stats": feature_stats,
        "sway_norm_mean": sway_mean,
        "pelvic_drop_mean": pelvic_drop_mean,
        "rom_score": rom_score,
        "fall_risk_score": fall_risk_score,
        "reinjury_risk_score": reinjury_risk_score,
        "top_errors": [{"error": k, "rate": round(v, 3)} for k, v in top_errors],
        "consistency": consistency,
    }


async def run_exercise_reporter(
    result: ExerciseSessionResult,
    session_id: str,
    patient_id: str | None,
    db: AsyncSession,
) -> ExerciseReporterOutput:
    """
    Run the exercise reporter pipeline for a single session.

    Writes a Summary row (agent_name="reporter") and a SessionScore row so
    that the progress_agent and reinjury_risk_agent can read longitudinal data.
    """
    stats = _compute_exercise_stats(result)

    # RAG query keyed on dominant errors so guidelines are exercise-specific
    error_terms = " ".join(e["error"] for e in stats["top_errors"]) or "squat biomechanics"
    rag_query = f"{result.exercise} exercise rehabilitation {error_terms}"
    rag_result = await retrieve_clinical_context(rag_query)
    clinical_context = (
        f"Clinical guidelines:\n{rag_result.context}"
        if rag_result.hit_count > 0
        else "No clinical guidelines available for this exercise."
    )

    # Past reporter summaries for longitudinal context
    past_text = "No previous summaries."
    if patient_id:
        past_result = await db.execute(
            select(Summary)
            .join(Session, Summary.session_id == Session.id)
            .where(
                Summary.agent_name == "reporter",
                Session.patient_id == patient_id,
            )
            .order_by(Summary.created_at.desc())
            .limit(3)
        )
        past_rows = past_result.scalars().all()
        if past_rows:
            past_text = "\n\n---\n\n".join(s.content for s in past_rows)

    prompt = f"""Exercise Session: {result.exercise}
Good reps analysed: {stats['good_rep_count']} of {result.numReps} total
Filtered out: {stats['filtered_rep_count']} reps (confidence < {_MIN_CONFIDENCE} or duration < {_MIN_DURATION_MS} ms)

Error frequencies (proportion of good reps, 0–1):
{json.dumps(stats['error_rates'], indent=2)}

Dominant errors present on >50% of reps: {[e['error'] for e in stats['top_errors']]}

Biomechanical feature means (from good reps only):
- ROM ratio (normalised depth, 1.0 = full 120° squat): {stats['feature_stats']['romRatio']['mean']}
- Knee flexion deg: {stats['feature_stats']['kneeFlexionDeg']['mean']}
- FPPA peak (valgus proxy, deg): {stats['feature_stats']['fppaPeak']['mean']}
- Trunk flex peak (deg): {stats['feature_stats']['trunkFlexPeak']['mean']}
- Pelvic drop peak (deg, >10° clinically significant): {stats['pelvic_drop_mean']}
- Sway norm (0=stable, >0.05 clinically significant): {stats['sway_norm_mean']}
- Smoothness (0–1): {stats['feature_stats']['smoothness']['mean']}

Session-level:
- Consistency (1=all reps identical, lower=compensatory variance): {stats['consistency']}
- Overall rating from mobile app: {result.summary.summary.overallRating}

Derived scores:
- ROM score: {stats['rom_score']}/100
- Fall risk score: {stats['fall_risk_score']}/100
- Reinjury risk score: {stats['reinjury_risk_score']}/100

Clinical guidelines context:
{clinical_context}

Previous session summaries:
{past_text}

Write a structured clinical summary grounded in the actual measurements above.
Call out the dominant error patterns, what the biomechanical numbers indicate,
and give specific rehabilitation recommendations. Do not include patient names.
Return a JSON object with exactly:
{{
  "summary": "<full clinical summary paragraph>",
  "session_highlights": ["highlight1", "highlight2", "highlight3"],
  "recommendations": ["recommendation1", "recommendation2"]
}}
Output only valid JSON."""

    response = await _client.chat.completions.create(
        model=_MODEL,
        max_tokens=1024,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a physical therapy exercise session analyst. "
                    "Ground your analysis in the actual biomechanical measurements provided — "
                    "do not invent or assume data not given. Output only valid JSON."
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

    output = ExerciseReporterOutput(
        summary=data["summary"],
        session_highlights=data["session_highlights"],
        recommendations=data["recommendations"],
        fall_risk_score=stats["fall_risk_score"],
        reinjury_risk_score=stats["reinjury_risk_score"],
        rom_score=stats["rom_score"],
        good_reps=stats["good_rep_count"],
        filtered_reps=stats["filtered_rep_count"],
    )

    pid = patient_id or "anonymous"

    await hipaa_wrap(
        content=json.dumps(data),
        actor="exercise_reporter_agent",
        patient_id=pid,
        data_type="exercise_reporter_output",
        db=db,
    )

    # Summary row — agent_name="reporter" so progress_agent picks it up via its query
    db.add(Summary(
        id=str(uuid.uuid4()),
        session_id=session_id,
        agent_name="reporter",
        content=output.summary,
        created_at=datetime.utcnow(),
    ))

    # SessionScore — bridges exercise sessions into the longitudinal trend pipeline
    score_result = await db.execute(
        select(SessionScore).where(SessionScore.session_id == session_id)
    )
    score_row = score_result.scalars().first()
    if score_row:
        score_row.fall_risk_score = output.fall_risk_score
        score_row.reinjury_risk_score = output.reinjury_risk_score
        score_row.rom_score = output.rom_score
    else:
        db.add(SessionScore(
            id=str(uuid.uuid4()),
            session_id=session_id,
            fall_risk_score=output.fall_risk_score,
            reinjury_risk_score=output.reinjury_risk_score,
            rom_score=output.rom_score,
            created_at=datetime.utcnow(),
        ))

    await db.flush()
    await write_audit(
        "exercise_reporter_agent", "generate_exercise_report", pid, "exercise_report", db
    )
    return output
