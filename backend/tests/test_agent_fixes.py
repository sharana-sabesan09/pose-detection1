import json
import os
import sys
import types
import unittest
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("OPENAI_API_KEY", "sk-mock")
os.environ.setdefault("GEMINI_API_KEY", "test-gemini")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("CHROMA_PERSIST_DIR", "./chroma_db")
os.environ.setdefault("DEV_MODE", "True")

phi_scanner_stub = types.ModuleType("utils.phi_scanner")
phi_scanner_stub.scan_and_redact = lambda text: (text, [])
sys.modules.setdefault("utils.phi_scanner", phi_scanner_stub)

from agents.fall_risk import run_fall_risk
from agents.exercise_reporter import run_exercise_reporter
from agents.pose_analysis import run_pose_analysis
from agents.progress import run_progress
from agents.progress_salience import build_patient_timeline, compute_salience
from agents.reinjury_risk import run_reinjury_risk
from agents.reporter import run_reporter
from db.models import AccumulatedScore, AgentArtifact, Base, Exercise, Patient, PoseFrame, Session, SessionScore, Summary
from routers.sessions import _reporter_output_from_artifact
from schemas.exercise import ExerciseResult
from schemas.session import IntakeOutput


def _llm_response(payload: dict) -> SimpleNamespace:
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=json.dumps(payload))
            )
        ]
    )


def _artifact(
    artifact_id: str,
    session_id: str,
    patient_id: str,
    agent_name: str,
    metrics: dict,
    created_at: datetime,
) -> AgentArtifact:
    return AgentArtifact(
        id=artifact_id,
        session_id=session_id,
        patient_id=patient_id,
        agent_name=agent_name,
        artifact_kind=f"{agent_name}_output",
        artifact_json={"metrics": metrics},
        created_at=created_at,
        upstream_artifact_ids_json=[],
        data_coverage_json={"required_fields_present": True, "missing_fields": [], "notes": []},
    )


def _score(
    score_id: str,
    session_id: str,
    created_at: datetime,
    *,
    fall: float | None = None,
    reinjury: float | None = None,
    pain: float | None = None,
    rom: float | None = None,
) -> SessionScore:
    return SessionScore(
        id=score_id,
        session_id=session_id,
        fall_risk_score=fall,
        reinjury_risk_score=reinjury,
        pain_score=pain,
        rom_score=rom,
        created_at=created_at,
    )


def _exercise_payload(
    *,
    session_id: str,
    visit_id: str,
    patient_id: str,
    num_reps: int = 1,
) -> dict:
    return {
        "sessionId": session_id,
        "visitId": visit_id,
        "patientId": patient_id,
        "startedAtMs": 1000,
        "endedAtMs": 2000,
        "durationMs": 1000,
        "exercise": "squat",
        "numReps": num_reps,
        "summary": {
            "exercise": "squat",
            "reps": [
                {
                    "repId": 1,
                    "side": "left",
                    "timing": {
                        "startFrame": 0,
                        "bottomFrame": 5,
                        "endFrame": 10,
                        "durationMs": 500,
                    },
                    "features": {
                        "kneeFlexionDeg": 90,
                        "romRatio": 0.8,
                        "fppaPeak": 5,
                        "fppaAtDepth": 4,
                        "trunkLeanPeak": 2,
                        "trunkFlexPeak": 10,
                        "pelvicDropPeak": 3,
                        "pelvicShiftPeak": 1,
                        "hipAdductionPeak": 2,
                        "kneeOffsetPeak": 0.1,
                        "swayNorm": 0.02,
                        "smoothness": 0.9,
                    },
                    "errors": {
                        "kneeValgus": False,
                        "trunkLean": False,
                        "trunkFlex": False,
                        "pelvicDrop": False,
                        "pelvicShift": False,
                        "hipAdduction": False,
                        "kneeOverFoot": False,
                        "balance": False,
                    },
                    "score": {
                        "totalErrors": 0,
                        "classification": "good",
                    },
                    "confidence": 0.95,
                }
            ],
            "summary": {
                "numReps": num_reps,
                "avgDepth": 0.8,
                "minDepth": 0.7,
                "avgFppa": 2.0,
                "maxFppa": 5.0,
                "consistency": 0.9,
                "overallRating": "good",
            },
        },
    }


class AgentFixTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
        self.session_factory = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    async def asyncTearDown(self):
        await self.engine.dispose()

    async def test_pt_pipeline_skips_llms_and_marks_report_insufficient_without_pose_data(self):
        patient_id = "patient-quality"
        session_id = "session-quality"

        async with self.session_factory() as db:
            db.add(Patient(
                id=patient_id,
                metadata_json={"injured_joints": ["right_knee"], "rehab_phase": "mid", "injured_side": "right"},
            ))
            db.add(Session(
                id=session_id,
                patient_id=patient_id,
                started_at=datetime(2026, 4, 26, 10, 0, 0),
            ))
            db.add(_artifact(
                artifact_id="art-intake-quality",
                session_id=session_id,
                patient_id=patient_id,
                agent_name="intake_agent",
                metrics={"session_type": "treatment"},
                created_at=datetime(2026, 4, 26, 10, 1, 0),
            ))
            await db.commit()

            intake = IntakeOutput(
                normalized_pain_scores={"right_knee": 4.0},
                target_joints=["right_knee"],
                session_goals=["restore knee ROM"],
                session_type="treatment",
                injured_joints=["right_knee"],
                injured_side="right",
                rehab_phase="mid",
                contraindications=[],
                data_confidence="explicit",
            )

            identity_wrap = AsyncMock(side_effect=lambda **kwargs: kwargs["content"])
            with (
                patch("agents.fall_risk.retrieve_clinical_context", new=AsyncMock()) as rag_mock,
                patch("agents.fall_risk._client.chat.completions.create", new=AsyncMock()) as fall_llm,
                patch("agents.reinjury_risk._client.chat.completions.create", new=AsyncMock()) as reinjury_llm,
                patch("agents.reporter._client.chat.completions.create", new=AsyncMock()) as reporter_llm,
                patch("agents.fall_risk.hipaa_wrap", new=identity_wrap),
                patch("agents.reinjury_risk.hipaa_wrap", new=identity_wrap),
                patch("agents.reporter.hipaa_wrap", new=identity_wrap),
            ):
                pose_output = await run_pose_analysis(session_id, db, patient_id=patient_id)
                fall_output = await run_fall_risk(intake, pose_output, patient_id, session_id, db)
                reinjury_output = await run_reinjury_risk(patient_id, session_id, pose_output, db)
                reporter_output = await run_reporter(
                    session_id,
                    patient_id,
                    intake,
                    pose_output,
                    fall_output,
                    reinjury_output,
                    db,
                )
                await db.commit()

            rag_mock.assert_not_awaited()
            fall_llm.assert_not_awaited()
            reinjury_llm.assert_not_awaited()
            reporter_llm.assert_not_awaited()

            self.assertFalse(pose_output.data_sufficient)
            self.assertEqual(pose_output.data_coverage["missing_fields"], ["pose_frames"])
            self.assertEqual(fall_output.risk_level, "unknown")
            self.assertEqual(reinjury_output.trend, "unknown")
            self.assertEqual(reporter_output.reportability, "insufficient_data")
            self.assertIn("pose data", reporter_output.summary.lower())

            score_row = (
                await db.execute(select(SessionScore).where(SessionScore.session_id == session_id))
            ).scalars().one()
            self.assertIsNone(score_row.fall_risk_score)
            self.assertIsNone(score_row.reinjury_risk_score)
            self.assertEqual(score_row.pain_score, 4.0)
            self.assertIsNone(score_row.rom_score)

            reporter_artifact = (
                await db.execute(
                    select(AgentArtifact).where(
                        AgentArtifact.session_id == session_id,
                        AgentArtifact.agent_name == "reporter_agent",
                    )
                )
            ).scalars().one()
            self.assertEqual(
                reporter_artifact.artifact_json["metrics"]["reportability"],
                "insufficient_data",
            )
            self.assertIn(
                "pose_frames",
                reporter_artifact.data_coverage_json["missing_fields"],
            )

    async def test_pose_analysis_ignores_nonclinical_debug_fields_for_rom(self):
        patient_id = "patient-pose-debug"
        session_id = "session-pose-debug"

        async with self.session_factory() as db:
            db.add(Session(
                id=session_id,
                patient_id=patient_id,
                started_at=datetime(2026, 4, 26, 12, 0, 0),
            ))
            db.add_all([
                PoseFrame(
                    id="pose-debug-1",
                    session_id=session_id,
                    timestamp=1000.0,
                    angles_json={
                        "knee_flex": 10.0,
                        "midhip_x": 0.1,
                        "midhip_y": 0.2,
                        "velocity": 3.0,
                    },
                ),
                PoseFrame(
                    id="pose-debug-2",
                    session_id=session_id,
                    timestamp=2000.0,
                    angles_json={
                        "knee_flex": 40.0,
                        "midhip_x": 50.0,
                        "midhip_y": 60.0,
                        "velocity": 100.0,
                    },
                ),
            ])
            await db.commit()

            output = await run_pose_analysis(session_id, db, patient_id=patient_id)

            self.assertIn("knee_flex", output.joint_stats)
            self.assertNotIn("midhip_x", output.joint_stats)
            self.assertNotIn("midhip_y", output.joint_stats)
            self.assertNotIn("velocity", output.joint_stats)
            self.assertGreater(output.rom_score, 0.0)
            joined_notes = " ".join(output.data_coverage["notes"])
            self.assertIn("ignored non-clinical frame fields", joined_notes)

    async def test_build_patient_timeline_uses_exercise_injured_joint_rom(self):
        patient_id = "patient-exercise-rom"
        session_id = "exercise-linked-session"

        async with self.session_factory() as db:
            db.add(Patient(
                id=patient_id,
                metadata_json={"injured_joints": ["right_knee"], "rehab_phase": "functional"},
            ))
            db.add(Session(
                id=session_id,
                patient_id=patient_id,
                started_at=datetime(2026, 4, 20, 9, 0, 0),
            ))
            db.add(Exercise(
                id="exercise-row-rom",
                patient_id=patient_id,
                mobile_exercise_id="mobile-exercise-rom",
                exercise="squat",
                num_reps=1,
                started_at_ms=1000,
                ended_at_ms=2000,
                duration_ms=1000,
                linked_session_id=session_id,
                visit_id="visit-rom",
                injured_joint_rom={"joint": "right_knee", "rom": 72.5},
                created_at=datetime(2026, 4, 20, 9, 5, 0),
            ))
            await db.commit()

            timeline = await build_patient_timeline(patient_id, db)
            fact = timeline.sessions[0]

            self.assertEqual(fact.source_type, "exercise_session")
            self.assertEqual(fact.injured_joint_rom, {"right_knee": 72.5})

    async def test_exercise_reporter_reads_stored_metadata_and_surfaces_quality_fields(self):
        patient_id = "patient-exercise-report"
        session_id = "exercise-report-session"
        exercise_payload = _exercise_payload(
            session_id="mobile-exercise-report",
            visit_id="visit-exercise-report",
            patient_id=patient_id,
        )
        result = ExerciseResult(**exercise_payload)

        async with self.session_factory() as db:
            db.add(Session(
                id=session_id,
                patient_id=patient_id,
                started_at=datetime(2026, 4, 22, 8, 0, 0),
            ))
            db.add(Exercise(
                id="exercise-row-report",
                patient_id=patient_id,
                mobile_exercise_id=result.sessionId,
                exercise=result.exercise,
                num_reps=result.numReps,
                started_at_ms=result.startedAtMs,
                ended_at_ms=result.endedAtMs,
                duration_ms=result.durationMs,
                linked_session_id=session_id,
                visit_id=result.visitId,
                metadata_json={
                    "voice": {
                        "derived": {
                            "painScore": 4.0,
                            "painLocations": ["hip"],
                            "sessionGoals": ["strength"],
                            "subjectiveSummary": "Felt mild hip tightness today.",
                            "affectedSide": "right",
                        }
                    }
                },
                injured_joint_rom={"joint": "right_knee", "rom": 81.2},
                created_at=datetime(2026, 4, 22, 8, 1, 0),
            ))
            await db.commit()

            identity_wrap = AsyncMock(side_effect=lambda **kwargs: kwargs["content"])
            rag_result = SimpleNamespace(hit_count=0, context="", sources=[])
            llm_payload = {
                "summary": "Exercise report grounded in stored metadata.",
                "session_highlights": ["Depth was consistent."],
                "recommendations": ["Continue controlled squats."],
            }

            with (
                patch("agents.exercise_reporter.retrieve_clinical_context", new=AsyncMock(return_value=rag_result)),
                patch("agents.exercise_reporter._client.chat.completions.create", new=AsyncMock(return_value=_llm_response(llm_payload))),
                patch("agents.exercise_reporter.hipaa_wrap", new=identity_wrap),
            ):
                output = await run_exercise_reporter(result, session_id, patient_id, db)
                await db.commit()

            self.assertEqual(output.good_reps, 1)
            self.assertEqual(output.filtered_reps, 0)

            reporter_artifact = (
                await db.execute(
                    select(AgentArtifact).where(
                        AgentArtifact.session_id == session_id,
                        AgentArtifact.agent_name == "reporter_agent",
                    )
                )
            ).scalars().one()

            metrics = reporter_artifact.artifact_json["metrics"]
            self.assertEqual(metrics["good_reps"], 1)
            self.assertEqual(metrics["filtered_reps"], 0)
            self.assertIn("subjective_section", metrics["evidence_map"])
            self.assertIn("injured_joint_section", metrics["evidence_map"])

            mapped_output = _reporter_output_from_artifact(reporter_artifact)
            assert mapped_output is not None
            self.assertEqual(mapped_output.good_reps, 1)
            self.assertEqual(mapped_output.filtered_reps, 0)

    async def test_salience_uses_latest_per_session_rows_and_correct_metric_direction(self):
        patient_id = "patient-salience"
        base = datetime(2026, 4, 1, 9, 0, 0)

        async with self.session_factory() as db:
            db.add(Patient(
                id=patient_id,
                metadata_json={"injured_joints": ["right_knee"], "rehab_phase": "mid"},
            ))

            for index, session_id in enumerate(("salience-1", "salience-2", "salience-3"), start=1):
                db.add(Session(
                    id=session_id,
                    patient_id=patient_id,
                    started_at=base + timedelta(days=index - 1),
                ))

            db.add_all([
                _score("score-1", "salience-1", base + timedelta(hours=1), fall=80, reinjury=70, pain=7, rom=40),
                _score("score-2-old", "salience-2", base + timedelta(days=1, hours=1), fall=95, reinjury=90, pain=9, rom=20),
                _score("score-2-new", "salience-2", base + timedelta(days=1, hours=2), fall=60, reinjury=50, pain=5, rom=60),
                _score("score-3", "salience-3", base + timedelta(days=2, hours=1), fall=40, reinjury=30, pain=3, rom=80),
            ])

            db.add_all([
                Summary(
                    id="summary-2-old",
                    session_id="salience-2",
                    agent_name="reporter",
                    content="outdated summary",
                    created_at=base + timedelta(days=1, hours=1),
                ),
                Summary(
                    id="summary-2-new",
                    session_id="salience-2",
                    agent_name="reporter",
                    content="latest summary",
                    created_at=base + timedelta(days=1, hours=3),
                ),
                Summary(
                    id="summary-1",
                    session_id="salience-1",
                    agent_name="reporter",
                    content="baseline summary",
                    created_at=base + timedelta(hours=2),
                ),
                Summary(
                    id="summary-3",
                    session_id="salience-3",
                    agent_name="reporter",
                    content="recent summary",
                    created_at=base + timedelta(days=2, hours=2),
                ),
            ])

            db.add_all([
                _artifact("art-intake-1", "salience-1", patient_id, "intake_agent", {"session_type": "treatment"}, base + timedelta(minutes=1)),
                _artifact("art-pose-1", "salience-1", patient_id, "pose_analysis_agent", {"joint_stats": {"right_knee": {"rom": 40}}, "flagged_joints": []}, base + timedelta(minutes=2)),
                _artifact("art-fall-1", "salience-1", patient_id, "fall_risk_agent", {"score": 80}, base + timedelta(minutes=3)),
                _artifact("art-reinjury-1", "salience-1", patient_id, "reinjury_risk_agent", {"data_sufficient": True}, base + timedelta(minutes=4)),
                _artifact("art-reporter-1", "salience-1", patient_id, "reporter_agent", {"evidence_map": {"fall_risk_section": ["fall=80"]}}, base + timedelta(minutes=5)),
                _artifact("art-intake-2", "salience-2", patient_id, "intake_agent", {"session_type": "treatment"}, base + timedelta(days=1, minutes=1)),
                _artifact("art-pose-2", "salience-2", patient_id, "pose_analysis_agent", {"joint_stats": {"right_knee": {"rom": 60}}, "flagged_joints": []}, base + timedelta(days=1, minutes=2)),
                _artifact("art-fall-2", "salience-2", patient_id, "fall_risk_agent", {"score": 60}, base + timedelta(days=1, minutes=3)),
                _artifact("art-reinjury-2", "salience-2", patient_id, "reinjury_risk_agent", {"data_sufficient": True}, base + timedelta(days=1, minutes=4)),
                _artifact("art-reporter-2-old", "salience-2", patient_id, "reporter_agent", {"evidence_map": {"fall_risk_section": ["old evidence"]}}, base + timedelta(days=1, minutes=5)),
                _artifact("art-reporter-2-new", "salience-2", patient_id, "reporter_agent", {"evidence_map": {"fall_risk_section": ["latest evidence"]}}, base + timedelta(days=1, hours=3)),
                _artifact("art-intake-3", "salience-3", patient_id, "intake_agent", {"session_type": "treatment"}, base + timedelta(days=2, minutes=1)),
                _artifact("art-pose-3", "salience-3", patient_id, "pose_analysis_agent", {"joint_stats": {"right_knee": {"rom": 80}}, "flagged_joints": []}, base + timedelta(days=2, minutes=2)),
                _artifact("art-fall-3", "salience-3", patient_id, "fall_risk_agent", {"score": 40}, base + timedelta(days=2, minutes=3)),
                _artifact("art-reinjury-3", "salience-3", patient_id, "reinjury_risk_agent", {"data_sufficient": True}, base + timedelta(days=2, minutes=4)),
                _artifact("art-reporter-3", "salience-3", patient_id, "reporter_agent", {"evidence_map": {"fall_risk_section": ["fall=40"]}}, base + timedelta(days=2, minutes=5)),
            ])
            await db.commit()

            timeline = await build_patient_timeline(patient_id, db)
            session_two = next(fact for fact in timeline.sessions if fact.session_id == "salience-2")

            self.assertEqual(session_two.scores["fall_risk_score"], 60)
            self.assertEqual(session_two.reporter_summary, "latest summary")
            self.assertEqual(
                session_two.evidence_map,
                {"fall_risk_section": ["latest evidence"]},
            )
            self.assertIn("art-reporter-2-new", session_two.artifact_ids)
            self.assertNotIn("art-reporter-2-old", session_two.artifact_ids)

            salience = compute_salience(timeline)

            self.assertEqual(salience.salient_metrics["fall_risk_score"]["direction"], "improving")
            self.assertEqual(salience.salient_metrics["reinjury_risk_score"]["direction"], "improving")
            self.assertEqual(salience.salient_metrics["pain_score"]["direction"], "improving")
            self.assertTrue(salience.salient_artifact_ids)
            self.assertTrue(all(artifact_id.startswith("art-") for artifact_id in salience.salient_artifact_ids))
            self.assertNotIn("salience-2", salience.salient_artifact_ids)

    async def test_run_progress_uses_metric_specific_weights_and_artifact_provenance(self):
        patient_id = "patient-progress"
        base = datetime(2026, 4, 10, 9, 0, 0)

        async with self.session_factory() as db:
            db.add(Patient(
                id=patient_id,
                metadata_json={"injured_joints": ["right_knee"], "rehab_phase": "late"},
            ))

            for index, session_id in enumerate(("progress-1", "progress-2", "progress-3"), start=1):
                db.add(Session(
                    id=session_id,
                    patient_id=patient_id,
                    started_at=base + timedelta(days=index - 1),
                ))

            db.add_all([
                _score("progress-score-1", "progress-1", base + timedelta(hours=1), fall=90, reinjury=90, pain=7, rom=40),
                _score("progress-score-2", "progress-2", base + timedelta(days=1, hours=1), fall=None, reinjury=60, pain=5, rom=60),
                _score("progress-score-3", "progress-3", base + timedelta(days=2, hours=1), fall=30, reinjury=None, pain=3, rom=80),
            ])

            db.add_all([
                Summary(
                    id="progress-summary-1",
                    session_id="progress-1",
                    agent_name="reporter",
                    content="baseline session",
                    created_at=base + timedelta(hours=2),
                ),
                Summary(
                    id="progress-summary-2",
                    session_id="progress-2",
                    agent_name="reporter",
                    content="middle session",
                    created_at=base + timedelta(days=1, hours=2),
                ),
                Summary(
                    id="progress-summary-3",
                    session_id="progress-3",
                    agent_name="reporter",
                    content="latest session",
                    created_at=base + timedelta(days=2, hours=2),
                ),
            ])

            db.add_all([
                _artifact("prog-art-intake-1", "progress-1", patient_id, "intake_agent", {"session_type": "treatment"}, base + timedelta(minutes=1)),
                _artifact("prog-art-pose-1", "progress-1", patient_id, "pose_analysis_agent", {"joint_stats": {"right_knee": {"rom": 40}}, "flagged_joints": []}, base + timedelta(minutes=2)),
                _artifact("prog-art-fall-1", "progress-1", patient_id, "fall_risk_agent", {"score": 90}, base + timedelta(minutes=3)),
                _artifact("prog-art-reinjury-1", "progress-1", patient_id, "reinjury_risk_agent", {"data_sufficient": True}, base + timedelta(minutes=4)),
                _artifact("prog-art-reporter-1", "progress-1", patient_id, "reporter_agent", {"evidence_map": {"trend_section": ["fall=90"]}}, base + timedelta(minutes=5)),
                _artifact("prog-art-intake-2", "progress-2", patient_id, "intake_agent", {"session_type": "treatment"}, base + timedelta(days=1, minutes=1)),
                _artifact("prog-art-pose-2", "progress-2", patient_id, "pose_analysis_agent", {"joint_stats": {"right_knee": {"rom": 60}}, "flagged_joints": []}, base + timedelta(days=1, minutes=2)),
                _artifact("prog-art-fall-2", "progress-2", patient_id, "fall_risk_agent", {"score": None}, base + timedelta(days=1, minutes=3)),
                _artifact("prog-art-reinjury-2", "progress-2", patient_id, "reinjury_risk_agent", {"data_sufficient": True}, base + timedelta(days=1, minutes=4)),
                _artifact("prog-art-reporter-2", "progress-2", patient_id, "reporter_agent", {"evidence_map": {"trend_section": ["reinjury=60"]}}, base + timedelta(days=1, minutes=5)),
                _artifact("prog-art-intake-3", "progress-3", patient_id, "intake_agent", {"session_type": "treatment"}, base + timedelta(days=2, minutes=1)),
                _artifact("prog-art-pose-3", "progress-3", patient_id, "pose_analysis_agent", {"joint_stats": {"right_knee": {"rom": 80}}, "flagged_joints": []}, base + timedelta(days=2, minutes=2)),
                _artifact("prog-art-fall-3", "progress-3", patient_id, "fall_risk_agent", {"score": 30}, base + timedelta(days=2, minutes=3)),
                _artifact("prog-art-reinjury-3", "progress-3", patient_id, "reinjury_risk_agent", {"data_sufficient": True}, base + timedelta(days=2, minutes=4)),
                _artifact("prog-art-reporter-3", "progress-3", patient_id, "reporter_agent", {"evidence_map": {"trend_section": ["fall=30"]}}, base + timedelta(days=2, minutes=5)),
            ])
            await db.commit()

            expected_salience = compute_salience(await build_patient_timeline(patient_id, db))

            identity_wrap = AsyncMock(side_effect=lambda **kwargs: kwargs["content"])
            progress_payload = {
                "longitudinal_report": "Grounded progress summary.",
                "overall_trend": "improving",
                "milestones_reached": ["Lower fall risk"],
                "next_goals": ["Maintain ROM gains"],
                "evidence_citations": {"trend_section": ["progress-3: fall_risk_score changed by -60"]},
                "data_warnings": [],
            }

            with (
                patch("agents.progress._client.chat.completions.create", new=AsyncMock(return_value=_llm_response(progress_payload))),
                patch("agents.progress.hipaa_wrap", new=identity_wrap),
            ):
                output = await run_progress(patient_id, db)
                await db.commit()

            self.assertEqual(output.longitudinal_report, "Grounded progress summary.")

            accumulated = (
                await db.execute(select(AccumulatedScore).where(AccumulatedScore.patient_id == patient_id))
            ).scalars().one()
            self.assertAlmostEqual(accumulated.fall_risk_avg, 45.0, places=3)
            self.assertAlmostEqual(accumulated.reinjury_risk_avg, 72.0, places=3)

            progress_artifact = (
                await db.execute(
                    select(AgentArtifact).where(
                        AgentArtifact.patient_id == patient_id,
                        AgentArtifact.agent_name == "progress_agent",
                        AgentArtifact.session_id.is_(None),
                    )
                )
            ).scalars().one()
            self.assertEqual(
                progress_artifact.upstream_artifact_ids_json,
                expected_salience.salient_artifact_ids,
            )
            self.assertEqual(
                progress_artifact.artifact_json["metrics"]["salient_artifact_ids"],
                expected_salience.salient_artifact_ids,
            )
            self.assertTrue(all(artifact_id.startswith("prog-art-") for artifact_id in progress_artifact.upstream_artifact_ids_json))


class ExerciseSchemaTests(unittest.TestCase):
    def test_exercise_result_accepts_and_validates_calibration_fields(self):
        payload = {
            "sessionId": "mobile-session-1",
            "visitId": "visit-1",
            "startedAtMs": 1000,
            "endedAtMs": 2000,
            "durationMs": 1000,
            "exercise": "squat",
            "numReps": 0,
            "summary": {
                "exercise": "squat",
                "reps": [],
                "summary": {
                    "numReps": 0,
                    "avgDepth": 0,
                    "minDepth": 0,
                    "avgFppa": 0,
                    "maxFppa": 0,
                    "consistency": 0,
                    "overallRating": "insufficient",
                },
            },
            "patientId": "patient-1",
            "calibrationBatchId": "batch-1",
            "calibrationStep": 2,
        }

        parsed = ExerciseResult(**payload)
        self.assertEqual(parsed.calibrationBatchId, "batch-1")
        self.assertEqual(parsed.calibrationStep, 2)

        with self.assertRaises(ValidationError):
            ExerciseResult(**(payload | {"calibrationStep": 5}))

        with self.assertRaises(ValidationError):
            ExerciseResult(**({k: v for k, v in payload.items() if k != "calibrationBatchId"}))


if __name__ == "__main__":
    unittest.main()
