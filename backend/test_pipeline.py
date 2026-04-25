"""
Run with:  python test_pipeline.py
Tests the full agent pipeline with a mocked DB — no PostgreSQL needed.
Requires a real OPENAI_API_KEY in .env.
"""
import asyncio
import uuid
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

# ── Fake data ──────────────────────────────────────────────────────────────────

SESSION_ID = str(uuid.uuid4())
PATIENT_ID = str(uuid.uuid4())

FAKE_POSE_FRAMES = [
    MagicMock(
        session_id=SESSION_ID,
        timestamp=float(i),
        angles_json={
            "rep_id": i + 1,
            "side": "left",
            "features": {
                "knee_flexion_deg": 55.0 + i * 2,
                "rom_ratio": 0.41 + i * 0.02,
                "fppa_deg": 12.0 - i * 0.5,
                "trunk_lean_deg": 9.0,
                "trunk_flex_deg": 22.0,
                "trunk_rotation_deg": 5.0,
                "pelvic_drop_deg": 7.0,
                "pelvic_shift_norm": 0.11,
                "pelvic_rotation_deg": 4.5,
                "hip_adduction_deg": 13.0,
                "sway_norm": 0.08,
                "smoothness": 0.014,
            },
            "errors": {
                "trunk_lean": False,
                "trunk_rotation": False,
                "trunk_flex": False,
                "pelvic_shift": i < 6,
                "pelvic_rotation": False,
                "pelvic_drop": i < 7,
                "hip_adduction": True,
                "hip_ir_proxy": True,
                "knee_valgus": i < 5,
                "knee_over_foot": i < 4,
                "balance": True,
            },
            "score": {
                "total_errors": 5,
                "classification": "poor" if i < 5 else "moderate",
            },
        },
    )
    for i in range(10)
]

FAKE_SESSION_SCORES = [
    MagicMock(
        session_id=SESSION_ID,
        fall_risk_score=42.0,
        reinjury_risk_score=30.0,
        rom_score=65.0,
        pain_score=4.0,
        created_at=datetime.utcnow(),
    )
]

FAKE_SUMMARIES = [
    MagicMock(
        session_id=SESSION_ID,
        agent_name="reporter",
        content="Patient showed moderate ROM improvement in knee flexion. Fall risk remains medium.",
        created_at=datetime.utcnow(),
    )
]


# ── Mock DB session factory ────────────────────────────────────────────────────

def make_mock_db(pose_frames=None, session_scores=None, summaries=None, session_count=1):
    db = AsyncMock()

    def execute_side_effect(query):
        result = MagicMock()
        q = str(query)

        if "pose_frames" in q.lower() or "PoseFrame" in repr(query):
            result.scalars.return_value.all.return_value = pose_frames or FAKE_POSE_FRAMES
            result.scalars.return_value.first.return_value = (pose_frames or FAKE_POSE_FRAMES)[0] if pose_frames else FAKE_POSE_FRAMES[0]
        elif "session_scores" in q.lower() or "SessionScore" in repr(query):
            result.scalars.return_value.all.return_value = session_scores or FAKE_SESSION_SCORES
            result.scalars.return_value.first.return_value = None  # triggers insert path
        elif "summaries" in q.lower() or "Summary" in repr(query):
            result.scalars.return_value.all.return_value = summaries or FAKE_SUMMARIES
        elif "accumulated_scores" in q.lower() or "AccumulatedScore" in repr(query):
            result.scalars.return_value.first.return_value = None
        elif "func.count" in repr(query) or "count" in q.lower():
            result.scalar.return_value = session_count
        else:
            result.scalars.return_value.all.return_value = []
            result.scalars.return_value.first.return_value = None
            result.scalar.return_value = 0

        return result

    db.execute = AsyncMock(side_effect=execute_side_effect)
    db.commit = AsyncMock()
    db.add = MagicMock()
    return db


# ── Individual agent tests ─────────────────────────────────────────────────────

async def test_intake():
    print("\n── intake agent ──────────────────────────")
    from schemas.session import IntakeInput
    from agents.intake import run_intake

    db = make_mock_db()
    with patch("utils.phi_scanner.scan_and_redact", return_value=("redacted", [])):
        output = await run_intake(IntakeInput(
            session_id=SESSION_ID,
            patient_id=PATIENT_ID,
            pt_plan="Knee rehabilitation post ACL repair. Focus on ROM and strength.",
            pain_scores={"knee": 6, "hip": 2},
            user_input="My knee feels stiff in the morning and hurts during stairs.",
        ), db)

    print(f"  normalized_pain_scores: {output.normalized_pain_scores}")
    print(f"  target_joints:          {output.target_joints}")
    print(f"  session_goals:          {output.session_goals}")
    return output


async def test_pose_analysis():
    print("\n── pose analysis agent ───────────────────")
    from agents.pose_analysis import run_pose_analysis

    db = make_mock_db()
    output = await run_pose_analysis(SESSION_ID, db)

    print(f"  rom_score:      {output.rom_score}")
    print(f"  flagged_joints: {output.flagged_joints}")
    print(f"  joint_stats keys: {list(output.joint_stats.keys())}")
    return output


async def test_fall_risk(intake_output, pose_output):
    print("\n── fall risk agent ───────────────────────")
    from agents.fall_risk import run_fall_risk

    db = make_mock_db()
    with patch("rag.retriever.retrieve_clinical_context", new=AsyncMock(return_value="Clinical context: patients with limited knee ROM (< 40% of expected) have elevated fall risk.")):
        with patch("utils.phi_scanner.scan_and_redact", return_value=("redacted", [])):
            output = await run_fall_risk(intake_output, pose_output, PATIENT_ID, SESSION_ID, db)

    print(f"  score:      {output.score}")
    print(f"  risk_level: {output.risk_level}")
    print(f"  factors:    {output.contributing_factors}")
    return output


async def test_reinjury_risk(pose_output):
    print("\n── reinjury risk agent ───────────────────")
    from agents.reinjury_risk import run_reinjury_risk

    db = make_mock_db()
    with patch("utils.phi_scanner.scan_and_redact", return_value=("redacted", [])):
        output = await run_reinjury_risk(PATIENT_ID, SESSION_ID, pose_output, db)

    print(f"  score: {output.score}")
    print(f"  trend: {output.trend}")
    return output


async def test_reporter(intake_output, pose_output, fall_output, reinjury_output):
    print("\n── reporter agent ────────────────────────")
    from agents.reporter import run_reporter

    db = make_mock_db()
    with patch("utils.phi_scanner.scan_and_redact", return_value=("redacted", [])):
        output = await run_reporter(
            SESSION_ID, PATIENT_ID,
            intake_output, pose_output, fall_output, reinjury_output,
            db,
        )

    print(f"  summary (truncated): {output.summary[:120]}...")
    print(f"  highlights: {output.session_highlights}")
    print(f"  recommendations: {output.recommendations}")
    return output


async def test_progress():
    print("\n── progress agent ────────────────────────")
    from agents.progress import run_progress

    db = make_mock_db(session_count=4)
    with patch("utils.phi_scanner.scan_and_redact", return_value=("redacted", [])):
        output = await run_progress(PATIENT_ID, db)

    print(f"  overall_trend:      {output.overall_trend}")
    print(f"  milestones_reached: {output.milestones_reached}")
    print(f"  next_goals:         {output.next_goals}")
    return output


# ── Full pipeline ──────────────────────────────────────────────────────────────

async def test_full_pipeline():
    print("\n══ FULL PIPELINE TEST ════════════════════")
    from agents.orchestrator import run_session_pipeline
    from schemas.session import IntakeInput

    db = make_mock_db(session_count=4)
    with patch("rag.retriever.retrieve_clinical_context", new=AsyncMock(return_value="Clinical context placeholder.")):
        with patch("utils.phi_scanner.scan_and_redact", return_value=("redacted", [])):
            results = await run_session_pipeline(
                session_id=SESSION_ID,
                patient_id=PATIENT_ID,
                intake_data=IntakeInput(
                    session_id=SESSION_ID,
                    patient_id=PATIENT_ID,
                    pt_plan="Knee rehabilitation post ACL repair.",
                    pain_scores={"knee": 6, "hip": 2},
                    user_input="Knee feels stiff, hurts on stairs.",
                ),
                db=db,
            )

    print("\nPipeline results:")
    for key, val in results.items():
        if key == "failed_agents":
            print(f"  failed_agents: {val}")
        else:
            print(f"  [{key}] ✓")
    return results


# ── Entry point ────────────────────────────────────────────────────────────────

async def main():
    print("Loading config...")
    from config import settings
    if not settings.OPENAI_API_KEY or settings.OPENAI_API_KEY.startswith("sk-..."):
        print("ERROR: Set a real OPENAI_API_KEY in backend/.env before running tests.")
        return

    print(f"Using model: gpt-4o | Session: {SESSION_ID[:8]}... | Patient: {PATIENT_ID[:8]}...")

    intake = await test_intake()
    pose = await test_pose_analysis()
    fall = await test_fall_risk(intake, pose)
    reinjury = await test_reinjury_risk(pose)
    reporter = await test_reporter(intake, pose, fall, reinjury)
    await test_progress()
    await test_full_pipeline()

    print("\n✓ All agents passed\n")


if __name__ == "__main__":
    asyncio.run(main())
