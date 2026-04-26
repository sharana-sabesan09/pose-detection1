import os
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

from db.models import Base, ExerciseSession
from routers.sessions import store_exercise_result
from schemas.exercise import ExerciseSessionResult
from schemas.voice import VoiceMetadataExtractRequest
from utils.voice_metadata import build_session_metadata_from_voice


def _discard_task(coro):
    coro.close()
    return None


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

        body = ExerciseSessionResult.model_validate(
            {
                "sessionId": "voice-metadata-test-session",
                "startedAtMs": 1000,
                "endedAtMs": 2000,
                "durationMs": 1000,
                "exercise": "squat",
                "numReps": 1,
                "summary": {
                    "exercise": "squat",
                    "reps": [
                        {
                            "repId": 1,
                            "side": "right",
                            "timing": {
                                "startFrame": 1,
                                "bottomFrame": 2,
                                "endFrame": 3,
                                "durationMs": 500,
                            },
                            "features": {
                                "kneeFlexionDeg": 90.0,
                                "romRatio": 0.75,
                                "fppaPeak": 20.0,
                                "fppaAtDepth": 15.0,
                                "trunkLeanPeak": 10.0,
                                "trunkFlexPeak": 25.0,
                                "pelvicDropPeak": 4.0,
                                "pelvicShiftPeak": 0.05,
                                "hipAdductionPeak": 8.0,
                                "kneeOffsetPeak": 0.2,
                                "swayNorm": 0.01,
                                "smoothness": 100.0,
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
                        "numReps": 1,
                        "avgDepth": 90.0,
                        "minDepth": 90.0,
                        "avgFppa": 20.0,
                        "maxFppa": 20.0,
                        "consistency": 1.0,
                        "overallRating": "good",
                    },
                },
                "patientId": "patient-voice-test",
                "sessionMetadata": metadata.model_dump(),
            }
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
                    select(ExerciseSession).where(
                        ExerciseSession.mobile_session_id == "voice-metadata-test-session"
                    )
                )
            ).scalars().one()

        self.assertEqual(response.sessionId, "voice-metadata-test-session")
        self.assertIsNotNone(stored.metadata_json)
        self.assertEqual(stored.metadata_json["voice"]["derived"]["painScore"], 4.0)
        self.assertEqual(stored.metadata_json["voice"]["derived"]["painLocations"], ["hip"])
        self.assertEqual(stored.metadata_json["voice"]["derived"]["sessionGoals"], ["strength"])


if __name__ == "__main__":
    unittest.main()
