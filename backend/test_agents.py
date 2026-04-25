"""
Integration test: feed real squat session data from message.txt and
message (1).txt through each agent stage in the HTTP pipeline.

Purpose
-------
These two files are actual outputs from the mobile app — processed squat
analysis results with per-rep biomechanical features, error flags, and
confidence scores.  This script adapts them to the format each agent
expects, runs every stage, prints inputs and outputs side-by-side, and
exposes the architectural gaps between what the agents consume and what
the mobile app actually produces.

Usage
-----
    cd backend
    python test_agents.py                        # mock mode — no API calls
    OPENAI_API_KEY=sk-... python test_agents.py  # live mode — real LLM calls

Requires the project deps to be installed (uv sync).
"""

import asyncio
import json
import os
import statistics
import uuid
from datetime import datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# DB bootstrap (in-memory SQLite so the test is self-contained)
# ---------------------------------------------------------------------------
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("OPENAI_API_KEY", os.environ.get("OPENAI_API_KEY", "sk-mock"))
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("CHROMA_PERSIST_DIR", "./chroma_db")
os.environ.setdefault("DEV_MODE", "True")

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from db.models import Base, Patient, Session, PoseFrame, ExerciseSession, RepAnalysis
from schemas.session import IntakeInput, IntakeOutput, PoseAnalysisOutput, FallRiskOutput, ReinjuryRiskOutput
from schemas.exercise import ExerciseSessionResult

LIVE = os.environ.get("OPENAI_API_KEY", "sk-mock") != "sk-mock"

# ---------------------------------------------------------------------------
# Load the two real session files
# ---------------------------------------------------------------------------
HERE = Path(__file__).parent

def _load(filename: str) -> dict:
    p = HERE / filename
    if not p.exists():
        raise FileNotFoundError(f"{p} not found — run from backend/")
    return json.loads(p.read_text(encoding="utf-8"))


session_data_a = _load("message.txt")          # 13 reps
session_data_b = _load("message (1).txt")      # 20 reps

# ---------------------------------------------------------------------------
# Translation helpers — exercise data → agent pipeline inputs
#
# This is the lossy mapping that reveals the architectural gap.
# Every translation comment marks information that is thrown away or
# approximated.
# ---------------------------------------------------------------------------

def _derive_pain_scores(reps: list[dict]) -> dict:
    """
    Approximate pain scores from biomechanical error frequencies.

    LOSS: Pain scores should come from the patient, not from error counts.
    High-frequency errors → higher assumed discomfort, but there is no
    ground truth here.  A patient might perform with errors but no pain,
    or have pain with few visible errors.
    """
    counts = {
        "knee_valgus": 0, "trunk_flex": 0, "pelvic_drop": 0,
        "hip_adduction": 0, "trunk_lean": 0, "knee_over_foot": 0,
    }
    for r in reps:
        e = r["errors"]
        if e["kneeValgus"]:   counts["knee_valgus"] += 1
        if e["trunkFlex"]:    counts["trunk_flex"] += 1
        if e["pelvicDrop"]:   counts["pelvic_drop"] += 1
        if e["hipAdduction"]: counts["hip_adduction"] += 1
        if e["trunkLean"]:    counts["trunk_lean"] += 1
        if e["kneeOverFoot"]: counts["knee_over_foot"] += 1

    n = max(len(reps), 1)
    return {
        "knee_medial":  round((counts["knee_valgus"]   / n) * 7, 1),
        "lower_back":   round((counts["trunk_flex"]    / n) * 6, 1),
        "hip":          round((counts["pelvic_drop"]   / n) * 5, 1),
        "hip_adductor": round((counts["hip_adduction"] / n) * 5, 1),
        "ankle":        0.0,
    }


def _build_pose_frames(session_id: str, reps: list[dict]) -> list[PoseFrame]:
    """
    Synthesize PoseFrame rows from per-rep features.

    LOSS: PoseFrames are supposed to be raw per-frame angle snapshots.
    We only have per-rep peak and average values — these are aggregated
    and lossy.  The pose_analysis agent will never see:
      - intra-rep angle trajectory (only the peak values survive)
      - pelvicShiftPeak (no matching joint in _EXPECTED_ROM)
      - fppaPeak / fppaAtDepth (frontal plane projection — no agent slot)
      - swayNorm (balance sway — falls outside the joint angle model)
      - kneeOffsetPeak (3-D offset, no angle equivalent)
      - per-rep confidence (all reps treated equally regardless of quality)
    """
    frames = []
    for i, rep in enumerate(reps):
        f = rep["features"]
        # Approximation: treat peak flexion as the "bottom frame" angle,
        # trunkFlexPeak as lumbar flexion, trunkLeanPeak as forward hip lean.
        # hip_flexion approximated as 180 - kneeFlexionDeg (rough inverse
        # for a squat posture).
        angles = {
            "knee_flexion":        round(f["kneeFlexionDeg"], 2),
            "lumbar_flexion":      round(f["trunkFlexPeak"], 2),
            "hip_flexion":         round(max(0.0, 180.0 - f["kneeFlexionDeg"]), 2),
            # No good mapping for these — they are silently dropped:
            # fppaPeak, fppaAtDepth, pelvicDropPeak, pelvicShiftPeak,
            # hipAdductionPeak, kneeOffsetPeak, swayNorm, smoothness, romRatio
        }
        frames.append(PoseFrame(
            id=str(uuid.uuid4()),
            session_id=session_id,
            timestamp=float(i),
            angles_json=angles,
        ))
    return frames


def _build_intake_input(session_id: str, session_data: dict) -> IntakeInput:
    """
    Construct an IntakeInput from session metadata.

    LOSS: The exercise session has no subjective pain scores, no PT plan,
    and no patient narrative — all three are required by the intake agent.
    We infer them from the error distribution.  Any PT-provided context
    (diagnosis, precautions, treatment goals) is absent.
    """
    reps = session_data["summary"]["reps"]
    pain_scores = _derive_pain_scores(reps)
    summary = session_data["summary"]["summary"]

    user_input = (
        f"Performed {summary['numReps']} squats. "
        f"Average depth: {summary['avgDepth']:.1f} degrees. "
        f"Consistency score: {summary['consistency']:.2f}. "
        f"Overall rating: {summary['overallRating']}."
    )

    return IntakeInput(
        session_id=session_id,
        patient_id="test-patient-01",
        pt_plan="Squat rehabilitation program — lower limb strengthening",
        pain_scores=pain_scores,
        user_input=user_input,
    )


# ---------------------------------------------------------------------------
# In-process agent runner (bypasses Fetch.ai Bureau, calls functions directly)
# ---------------------------------------------------------------------------

async def run_all(engine, session_data: dict, label: str):
    print(f"\n{'='*70}")
    print(f"SESSION: {label}")
    print(f"  sessionId: {session_data['sessionId']}")
    print(f"  exercise:  {session_data['exercise']}")
    print(f"  numReps:   {session_data['numReps']}")
    print(f"  rating:    {session_data['summary']['summary']['overallRating']}")
    print(f"  consistency: {session_data['summary']['summary']['consistency']:.3f}")
    print(f"{'='*70}")

    AsyncSession = async_sessionmaker(engine, expire_on_commit=False)

    async with AsyncSession() as db:
        # ---------------------------------------------------------------
        # Persist patient + PT session + synthetic frames to DB
        # ---------------------------------------------------------------
        patient_id = "test-patient-01"
        session_id = str(uuid.uuid4())

        # Both sessions share the same patient — only insert once.
        from sqlalchemy import select as _select
        existing_patient = (await db.execute(
            _select(Patient).where(Patient.id == patient_id)
        )).scalars().first()
        if not existing_patient:
            db.add(Patient(id=patient_id, created_at=datetime.utcnow()))

        pt_session = Session(
            id=session_id,
            patient_id=patient_id,
            pt_plan="Squat rehabilitation program",
            started_at=datetime.utcnow(),
        )
        db.add(pt_session)

        reps = session_data["summary"]["reps"]
        for frame in _build_pose_frames(session_id, reps):
            db.add(frame)

        await db.commit()

        # Also persist as ExerciseSession + RepAnalysis (the new schema path)
        ex_session = ExerciseSession(
            id=str(uuid.uuid4()),
            patient_id=patient_id,
            mobile_session_id=session_data["sessionId"],
            exercise=session_data["exercise"],
            num_reps=session_data["numReps"],
            started_at_ms=session_data["startedAtMs"],
            ended_at_ms=session_data["endedAtMs"],
            duration_ms=session_data["durationMs"],
            summary_json=session_data["summary"]["summary"],
        )
        db.add(ex_session)
        await db.flush()

        for rep in reps:
            f = rep["features"]
            e = rep["errors"]
            db.add(RepAnalysis(
                id=str(uuid.uuid4()),
                exercise_session_id=ex_session.id,
                rep_id=rep["repId"],
                side=rep["side"],
                start_frame=rep["timing"]["startFrame"],
                bottom_frame=rep["timing"]["bottomFrame"],
                end_frame=rep["timing"]["endFrame"],
                rep_duration_ms=rep["timing"]["durationMs"],
                knee_flexion_deg=f["kneeFlexionDeg"],
                rom_ratio=f["romRatio"],
                fppa_peak=f["fppaPeak"],
                fppa_at_depth=f["fppaAtDepth"],
                trunk_lean_peak=f["trunkLeanPeak"],
                trunk_flex_peak=f["trunkFlexPeak"],
                pelvic_drop_peak=f["pelvicDropPeak"],
                pelvic_shift_peak=f["pelvicShiftPeak"],
                hip_adduction_peak=f["hipAdductionPeak"],
                knee_offset_peak=f["kneeOffsetPeak"],
                sway_norm=f["swayNorm"],
                smoothness=f["smoothness"],
                knee_valgus=e["kneeValgus"],
                trunk_lean=e["trunkLean"],
                trunk_flex=e["trunkFlex"],
                pelvic_drop=e["pelvicDrop"],
                pelvic_shift=e["pelvicShift"],
                hip_adduction=e["hipAdduction"],
                knee_over_foot=e["kneeOverFoot"],
                balance=e["balance"],
                total_errors=rep["score"]["totalErrors"],
                classification=rep["score"]["classification"],
                confidence=rep["confidence"],
            ))

        await db.commit()

        # ---------------------------------------------------------------
        # STAGE 1 — Intake agent
        # ---------------------------------------------------------------
        from agents.intake import run_intake

        intake_input = _build_intake_input(session_id, session_data)

        print(f"\n[INTAKE] Input:")
        print(f"  pt_plan:      {intake_input.pt_plan}")
        print(f"  pain_scores:  {intake_input.pain_scores}")
        print(f"  user_input:   {intake_input.user_input}")
        print(f"  NOTE: pain_scores are inferred from error frequencies, not reported by patient")

        if LIVE:
            intake_output = await run_intake(intake_input, db)
            print(f"\n[INTAKE] Output:")
            print(f"  normalized_pain_scores: {intake_output.normalized_pain_scores}")
            print(f"  target_joints: {intake_output.target_joints}")
            print(f"  session_goals: {intake_output.session_goals}")
        else:
            # Mock: construct plausible output manually from the input data
            intake_output = IntakeOutput(
                normalized_pain_scores=intake_input.pain_scores,
                target_joints=["knee", "lower_back", "hip"],
                session_goals=[
                    "Reduce knee valgus during squat",
                    "Improve trunk stability",
                    "Increase squat depth consistently",
                ],
            )
            print(f"\n[INTAKE] Output (mock):")
            print(f"  normalized_pain_scores: {intake_output.normalized_pain_scores}")
            print(f"  target_joints: {intake_output.target_joints}")
            print(f"  session_goals: {intake_output.session_goals}")

        await db.commit()

        # ---------------------------------------------------------------
        # STAGE 2 — Pose analysis agent
        # ---------------------------------------------------------------
        from agents.pose_analysis import run_pose_analysis

        print(f"\n[POSE ANALYSIS] Input: {len(reps)} synthetic frames from rep peak values")
        print(f"  Known joints in frames: knee_flexion, lumbar_flexion, hip_flexion")
        print(f"  DROPPED features: fppaPeak, pelvicDropPeak, pelvicShiftPeak,")
        print(f"                    hipAdductionPeak, kneeOffsetPeak, swayNorm, smoothness")

        pose_output = await run_pose_analysis(session_id, db)

        print(f"\n[POSE ANALYSIS] Output:")
        print(f"  rom_score:      {pose_output.rom_score}")
        print(f"  flagged_joints: {pose_output.flagged_joints}")
        print(f"  joint_stats keys: {list(pose_output.joint_stats.keys())}")

        # Show what the raw data actually tells us that pose_analysis can't see
        print(f"\n[POSE ANALYSIS] What the raw data shows (not visible to agent):")
        knee_valgus_rate = sum(1 for r in reps if r["errors"]["kneeValgus"]) / len(reps)
        trunk_flex_rate  = sum(1 for r in reps if r["errors"]["trunkFlex"])  / len(reps)
        pelvic_drop_rate = sum(1 for r in reps if r["errors"]["pelvicDrop"]) / len(reps)
        avg_confidence   = statistics.mean(r["confidence"] for r in reps)
        short_reps       = [r for r in reps if r["timing"]["durationMs"] < 200]
        zero_hip         = [r for r in reps if r["features"]["hipAdductionPeak"] == 0]

        print(f"  kneeValgus error rate:  {knee_valgus_rate:.0%} of reps")
        print(f"  trunkFlex error rate:   {trunk_flex_rate:.0%} of reps")
        print(f"  pelvicDrop error rate:  {pelvic_drop_rate:.0%} of reps")
        print(f"  avg rep confidence:     {avg_confidence:.3f}")
        if short_reps:
            print(f"  suspect reps (<200ms):  {len(short_reps)} — {[r['repId'] for r in short_reps]}")
            print(f"    (likely noise detections; agent treats them equally)")
        if zero_hip:
            print(f"  reps with hipAdduction=0: {len(zero_hip)} — landmark lost during capture")
            print(f"    (agent would interpret 0 as a real measurement)")

        await db.commit()

        # ---------------------------------------------------------------
        # STAGE 3 — Fall risk agent
        # ---------------------------------------------------------------
        from agents.fall_risk import run_fall_risk

        print(f"\n[FALL RISK] Input:")
        print(f"  target_joints:  {intake_output.target_joints}")
        print(f"  rom_score:      {pose_output.rom_score}")
        print(f"  flagged_joints: {pose_output.flagged_joints}")
        print(f"  NOTE: swayNorm (best balance proxy) never reaches this agent")
        print(f"  NOTE: balance error flag never reaches this agent")

        if LIVE:
            fall_output = await run_fall_risk(intake_output, pose_output, patient_id, session_id, db)
            print(f"\n[FALL RISK] Output:")
            print(f"  score:       {fall_output.score}")
            print(f"  risk_level:  {fall_output.risk_level}")
            print(f"  reasoning:   {fall_output.reasoning[:120]}...")
            print(f"  factors:     {fall_output.contributing_factors}")
        else:
            sway_vals = [r["features"]["swayNorm"] for r in reps]
            avg_sway  = statistics.mean(sway_vals)
            balance_err = sum(1 for r in reps if r["errors"]["balance"]) / len(reps)
            fall_output = FallRiskOutput(
                score=35.0,
                risk_level="medium",
                reasoning=(
                    "ROM score is below normal; multiple joints flagged. "
                    "NOTE (mock): actual swayNorm avg is {:.4f}, balance error rate {:.0%} — "
                    "these signals are unavailable to this agent.".format(avg_sway, balance_err)
                ),
                contributing_factors=["reduced_knee_flexion", "lumbar_stiffness"],
            )
            print(f"\n[FALL RISK] Output (mock):")
            print(f"  score:      {fall_output.score}")
            print(f"  risk_level: {fall_output.risk_level}")
            print(f"  raw swayNorm values the agent never sees: {[round(v, 4) for v in sway_vals]}")

        await db.commit()

        # ---------------------------------------------------------------
        # STAGE 4 — Reinjury risk agent
        # ---------------------------------------------------------------
        from agents.reinjury_risk import run_reinjury_risk

        print(f"\n[REINJURY RISK] Input:")
        print(f"  rom_score:      {pose_output.rom_score}")
        print(f"  flagged_joints: {pose_output.flagged_joints}")
        print(f"  NOTE: looks up SessionScore history — empty for first session")
        print(f"  NOTE: consistency ({session_data['summary']['summary']['consistency']:.3f}) "
              f"not visible to agent")

        if LIVE:
            reinjury_output = await run_reinjury_risk(patient_id, session_id, pose_output, db)
            print(f"\n[REINJURY RISK] Output:")
            print(f"  score:     {reinjury_output.score}")
            print(f"  trend:     {reinjury_output.trend}")
            print(f"  reasoning: {reinjury_output.reasoning[:120]}...")
        else:
            reinjury_output = ReinjuryRiskOutput(
                score=30.0,
                trend="stable",
                reasoning="Insufficient history (first session) to assess trend. Mock output.",
            )
            print(f"\n[REINJURY RISK] Output (mock):")
            print(f"  score: {reinjury_output.score}, trend: {reinjury_output.trend}")
            print(f"  (trend cannot be meaningful with 0 prior SessionScore rows)")

        await db.commit()

        # ---------------------------------------------------------------
        # STAGE 5 — Reporter agent
        # ---------------------------------------------------------------
        from agents.reporter import run_reporter

        print(f"\n[REPORTER] Input: synthesised from all prior stages")
        print(f"  NOTE: reporter never sees kneeValgus rate, fppa, confidence,")
        print(f"        per-side analysis, or rep-level smoothness")

        if LIVE:
            reporter_output = await run_reporter(
                session_id, patient_id,
                intake_output, pose_output, fall_output, reinjury_output,
                db,
            )
            print(f"\n[REPORTER] Output:")
            print(f"  summary: {reporter_output.summary[:200]}...")
            print(f"  highlights: {reporter_output.session_highlights}")
            print(f"  recommendations: {reporter_output.recommendations}")
        else:
            from schemas.session import ReporterOutput
            reporter_output = ReporterOutput(
                summary=(
                    f"Session recorded {session_data['numReps']} reps of {session_data['exercise']} "
                    f"with overall rating '{session_data['summary']['summary']['overallRating']}'. "
                    f"ROM score {pose_output.rom_score:.1f}. Fall risk medium. (mock)"
                ),
                session_highlights=["Reduced knee flexion ROM", "Lumbar stiffness flagged"],
                recommendations=["Focus on knee alignment cues", "Core activation exercises"],
            )
            print(f"\n[REPORTER] Output (mock):")
            print(f"  summary: {reporter_output.summary}")

        await db.commit()

        # ---------------------------------------------------------------
        # STAGE 6 — Progress agent (skipped: needs ≥3 sessions)
        # ---------------------------------------------------------------
        print(f"\n[PROGRESS] Skipped — requires ≥3 sessions in DB for patient")
        print(f"  NOTE: even with 3 sessions, progress agent works on reporter")
        print(f"        text summaries, not on structured rep_analyses rows")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    mode = "LIVE (OpenAI API)" if LIVE else "MOCK (no API calls — set OPENAI_API_KEY for live)"
    print(f"\nMode: {mode}")
    print(f"Sessions loaded: message.txt ({session_data_a['numReps']} reps), "
          f"message (1).txt ({session_data_b['numReps']} reps)")

    await run_all(engine, session_data_a, "message.txt — 13 reps")
    await run_all(engine, session_data_b, "message (1).txt — 20 reps")

    print(f"\n{'='*70}")
    print("DONE — see AGENT_ARCHITECTURE_NOTES.md for analysis")
    print('='*70)


if __name__ == "__main__":
    asyncio.run(main())
