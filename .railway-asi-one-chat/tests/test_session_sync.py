import os
import sys
import types
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

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

from db.models import AgentArtifact, Base, PoseFrame, Session
from routers.sessions import end_session, replace_frame_features, start_session
from schemas.report import FrameFeaturesCsvRequest, SessionStartRequest
from schemas.session import IntakeInput


FRAME_HEADER = (
    "frame,timestamp,knee_flex,fppa,trunk_lean,trunk_flex,pelvic_drop,"
    "hip_adduction,knee_offset,midhip_x,midhip_y,velocity,side\n"
)


class SessionSyncRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
        self.session_factory = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    async def asyncTearDown(self):
        await self.engine.dispose()

    async def test_start_session_accepts_client_session_id_idempotently(self):
        started_at = datetime(2026, 4, 26, 10, 30, tzinfo=timezone.utc)
        session_id = "0f4a4b6a-6b89-4fd7-9fd4-6b4471d3d2b1"

        async with self.session_factory() as db:
            first = await start_session(
                SessionStartRequest(
                    session_id=session_id,
                    patient_id="patient-sync-test",
                    pt_plan="initial plan",
                    started_at=started_at,
                ),
                db=db,
                _user={"user_id": "test", "role": "admin"},
            )
            second = await start_session(
                SessionStartRequest(
                    session_id=session_id,
                    patient_id="patient-sync-test",
                    pt_plan="updated plan",
                    started_at=started_at,
                ),
                db=db,
                _user={"user_id": "test", "role": "admin"},
            )

            sessions = (await db.execute(select(Session))).scalars().all()

        self.assertEqual(first.session_id, session_id)
        self.assertEqual(second.session_id, session_id)
        self.assertEqual(len(sessions), 1)
        self.assertEqual(sessions[0].pt_plan, "updated plan")
        self.assertEqual(sessions[0].started_at, started_at.replace(tzinfo=None))

    async def test_replace_frame_features_is_retry_safe(self):
        session_id = "8fb92b9f-4579-49aa-9a4f-303df2dbe94c"

        async with self.session_factory() as db:
            await start_session(
                SessionStartRequest(
                    session_id=session_id,
                    patient_id="patient-frame-test",
                    pt_plan="plan",
                ),
                db=db,
                _user={"user_id": "test", "role": "admin"},
            )

            first_upload = FRAME_HEADER + (
                "0,1000,10,1,2,3,4,5,0.1,0.0,0.1,1,left\n"
                "1,2000,20,2,3,4,5,6,0.2,0.1,0.2,2,left\n"
            )
            first_response = await replace_frame_features(
                session_id,
                FrameFeaturesCsvRequest(frame_features_csv=first_upload),
                db=db,
                _user={"user_id": "test", "role": "admin"},
            )
            self.assertEqual(first_response, {"status": "ok", "stored": 2})

            retry_upload = FRAME_HEADER + "0,3000,30,3,4,5,6,7,0.3,0.2,0.3,3,right\n"
            retry_response = await replace_frame_features(
                session_id,
                FrameFeaturesCsvRequest(frame_features_csv=retry_upload),
                db=db,
                _user={"user_id": "test", "role": "admin"},
            )
            frames = (
                await db.execute(
                    select(PoseFrame)
                    .where(PoseFrame.session_id == session_id)
                    .order_by(PoseFrame.timestamp)
                )
            ).scalars().all()

        self.assertEqual(retry_response, {"status": "ok", "stored": 1})
        self.assertEqual(len(frames), 1)
        self.assertEqual(frames[0].timestamp, 3000.0)
        self.assertEqual(frames[0].angles_json["knee_flex"], 30.0)
        self.assertEqual(frames[0].angles_json["velocity"], 3.0)

    async def test_end_session_returns_existing_reporter_output_without_rerunning_pipeline(self):
        session_id = "5b31f7ca-c4a1-49da-a2c3-0015156f2f0c"
        ended_at = datetime(2026, 4, 26, 11, 15, tzinfo=timezone.utc)

        async with self.session_factory() as db:
            await start_session(
                SessionStartRequest(
                    session_id=session_id,
                    patient_id="patient-reporter-test",
                    pt_plan="seed plan",
                ),
                db=db,
                _user={"user_id": "test", "role": "admin"},
            )
            db.add(AgentArtifact(
                id="artifact-reporter-sync-test",
                session_id=session_id,
                patient_id="patient-reporter-test",
                agent_name="reporter_agent",
                artifact_kind="reporter_output",
                artifact_json={
                    "metrics": {
                        "summary": "Existing synced summary",
                        "session_highlights": ["steady form"],
                        "recommendations": ["repeat this plan"],
                        "evidence_map": {"recommendations_section": ["rom_score=82"]},
                        "reportability": "reportable",
                    }
                },
                upstream_artifact_ids_json=[],
                data_coverage_json={"required_fields_present": True},
            ))
            await db.commit()

            with patch("routers.sessions.run_session_pipeline", new_callable=AsyncMock) as run_pipeline:
                response = await end_session(
                    session_id,
                    IntakeInput(
                        session_id=session_id,
                        patient_id="patient-reporter-test",
                        pt_plan="final synced plan",
                        pain_scores={"knee_flexion": 3},
                        user_input="Overall feel: good.",
                        session_type="treatment",
                        ended_at=ended_at,
                    ),
                    db=db,
                    _user={"user_id": "test", "role": "admin"},
                )
                run_pipeline.assert_not_awaited()

            session = (
                await db.execute(select(Session).where(Session.id == session_id))
            ).scalars().one()

        self.assertEqual(response.summary, "Existing synced summary")
        self.assertEqual(response.session_highlights, ["steady form"])
        self.assertEqual(response.recommendations, ["repeat this plan"])
        self.assertEqual(session.pt_plan, "final synced plan")
        self.assertEqual(session.ended_at, ended_at.replace(tzinfo=None))


if __name__ == "__main__":
    unittest.main()
