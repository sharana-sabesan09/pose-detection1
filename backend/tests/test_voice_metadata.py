import os
import sys
import types
import unittest
from unittest.mock import patch

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

from db.models import Base, Exercise, MultiExerciseSessionArchive
from routers.sessions import store_exercise_result, store_multi_exercise_archive
from schemas.exercise import ExerciseResult, MultiExerciseArchivePayload
from schemas.voice import VoiceMetadataExtractRequest
from utils.voice_metadata import build_session_metadata_from_voice


def _discard_task(coro):
    coro.close()
    return None


def _exercise_payload(session_id: str, **overrides):
    payload = {
        "sessionId": session_id,
        "visitId": f"{session_id}-visit",
        "injuredJointRom": {"joint": "right_knee", "rom": 0.75},
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
        "patientId": "patient-voice-test",
        "repsCsv": "rep_id,score\n1,good\n",
        "frameFeaturesCsv": (
            "timestamp,knee_flex,fppa,trunk_lean,trunk_flex,pelvic_drop,"
            "hip_adduction,knee_offset,midhip_x,midhip_y,velocity\n"
            "0,10,20,30,40,50,60,70,80,90,100\n"
        ),
        "framesCsv": "t,mode,lm0_x,lm0_y,lm0_z,lm0_v\n0,squat,0.1,0.2,0.3,0.9\n",
        "calibrationBatchId": "batch-1",
        "calibrationStep": 2,
    }
    payload.update(overrides)
    return payload


class VoiceMetadataTests(unittest.IsolatedAsyncioTestCase):
    async def test_extracts_voice_metadata_from_transcript(self):
        normalized, metadata = build_session_metadata_from_voice(
            VoiceMetadataExtractRequest(
                transcript=" Left knee pain is 6/10 and I feel dizzy. I am using a cane and want better balance. ",
                stage="pre_session",
                locale="en-US",
            )
        )

        self.assertEqual(
            normalized,
            "Left knee pain is 6/10 and I feel dizzy. I am using a cane and want better balance.",
        )
        self.assertIsNotNone(metadata.voice)
        self.assertEqual(metadata.voice.derived.painScore, 6.0)
        self.assertEqual(metadata.voice.derived.painLocations, ["knee"])
        self.assertEqual(metadata.voice.derived.symptoms, ["pain", "dizziness"])
        self.assertEqual(metadata.voice.derived.affectedSide, "left")
        self.assertEqual(metadata.voice.derived.assistiveDevice, "cane")
        self.assertEqual(metadata.voice.derived.sessionGoals, ["balance"])
        self.assertEqual(metadata.voice.derived.redFlags, ["dizziness"])

    async def test_stores_session_metadata_on_exercise_session(self):
        engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
        session_factory = async_sessionmaker(engine, expire_on_commit=False)

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        normalized, metadata = build_session_metadata_from_voice(
            VoiceMetadataExtractRequest(
                transcript="Right hip pain 4 out of 10 with some stiffness. I want to improve strength.",
                stage="post_session",
                locale="en-US",
            )
        )
        self.assertTrue(normalized.startswith("Right hip pain"))

        body = ExerciseResult.model_validate(
            _exercise_payload(
                "voice-metadata-test-session",
                visitId="visit-voice-metadata-test",
                sessionMetadata=metadata.model_dump(),
            )
        )

        async with session_factory() as db:
            with patch("routers.sessions.asyncio.create_task", side_effect=_discard_task):
                response = await store_exercise_result(
                    body,
                    db=db,
                    _user={"user_id": "test", "role": "admin"},
                )

            stored = (
                await db.execute(
                    select(Exercise).where(
                        Exercise.mobile_exercise_id == "voice-metadata-test-session"
                    )
                )
            ).scalars().one()

        self.assertEqual(response.sessionId, "voice-metadata-test-session")
        self.assertEqual(response.visitId, "visit-voice-metadata-test")
        self.assertEqual(stored.visit_id, "visit-voice-metadata-test")
        self.assertEqual(stored.injured_joint_rom, {"joint": "right_knee", "rom": 0.75})
        self.assertIsNotNone(stored.metadata_json)
        self.assertEqual(stored.metadata_json["voice"]["derived"]["painScore"], 4.0)
        self.assertEqual(stored.metadata_json["voice"]["derived"]["painLocations"], ["hip"])
        self.assertEqual(stored.metadata_json["voice"]["derived"]["sessionGoals"], ["strength"])

    async def test_store_exercise_result_tolerates_missing_optional_attrs(self):
        engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
        session_factory = async_sessionmaker(engine, expire_on_commit=False)

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        body = ExerciseResult.model_validate(
            _exercise_payload("exercise-missing-attrs")
        )
        for attr in (
            "visitId",
            "injuredJointRom",
            "sessionMetadata",
            "repsCsv",
            "frameFeaturesCsv",
            "framesCsv",
            "calibrationBatchId",
            "calibrationStep",
        ):
            delattr(body, attr)

        async with session_factory() as db:
            with patch("routers.sessions.asyncio.create_task", side_effect=_discard_task):
                response = await store_exercise_result(
                    body,
                    db=db,
                    _user={"user_id": "test", "role": "admin"},
                )

            stored = (
                await db.execute(
                    select(Exercise).where(
                        Exercise.mobile_exercise_id == "exercise-missing-attrs"
                    )
                )
            ).scalars().one()

        self.assertEqual(response.sessionId, "exercise-missing-attrs")
        self.assertEqual(response.visitId, "exercise-missing-attrs")
        self.assertEqual(stored.visit_id, "exercise-missing-attrs")
        self.assertIsNone(stored.injured_joint_rom)
        self.assertIsNone(stored.metadata_json)
        self.assertIsNone(stored.reps_csv)
        self.assertIsNone(stored.frame_features_csv)
        self.assertIsNone(stored.frames_csv)
        self.assertIsNone(stored.calibration_batch_id)
        self.assertIsNone(stored.calibration_step)

    async def test_multi_exercise_archive_idempotent(self):
        engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
        session_factory = async_sessionmaker(engine, expire_on_commit=False)

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        body = MultiExerciseArchivePayload(
            visitId="visit-archive-test",
            startedAtMs=1000.0,
            endedAtMs=2000.0,
            durationMs=1000.0,
            patientId=None,
            payload={
                "sessionId": "visit-archive-test",
                "patient": {"patientId": None, "injuredJoint": {"name": "right_knee", "romByExercise": {}}},
                "exercises": [],
            },
        )

        async with session_factory() as db:
            first = await store_multi_exercise_archive(
                body, db=db, _user={"user_id": "test", "role": "admin"}
            )
            self.assertEqual(first, {"status": "stored", "visitId": "visit-archive-test"})

            archived = (
                await db.execute(
                    select(MultiExerciseSessionArchive).where(
                        MultiExerciseSessionArchive.visit_id == "visit-archive-test"
                    )
                )
            ).scalars().one()
            self.assertEqual(archived.visit_id, "visit-archive-test")
            self.assertEqual(archived.payload_json["sessionId"], "visit-archive-test")

            second = await store_multi_exercise_archive(
                body, db=db, _user={"user_id": "test", "role": "admin"}
            )
            self.assertEqual(second, {"status": "exists", "visitId": "visit-archive-test"})

        # Confirm no Summary or SessionScore rows were created — the
        # archive endpoint must not trigger any agent pipeline.
        from db.models import Summary, SessionScore
        async with session_factory() as db:
            self.assertEqual(
                (await db.execute(select(Summary))).scalars().all(),
                [],
            )
            self.assertEqual(
                (await db.execute(select(SessionScore))).scalars().all(),
                [],
            )


if __name__ == "__main__":
    unittest.main()
