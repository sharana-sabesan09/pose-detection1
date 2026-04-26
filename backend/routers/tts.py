"""
routers/tts.py — TEXT-TO-SPEECH PROXY

The phone calls POST /tts/speak with a text string.
We proxy it through ElevenLabs TTS and return the MP3 audio as base64
so the phone can play it via the WebView HTML5 Audio API without needing
any native audio library.

Why proxy through the backend instead of calling ElevenLabs directly from
the phone? The API key stays on the server — never in the app bundle.
"""

import base64
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from elevenlabs.client import ElevenLabs

from config import settings

router = APIRouter(prefix="/tts", tags=["tts"])


def _client() -> ElevenLabs:
    if not settings.ELEVENLABS_API_KEY:
        raise HTTPException(status_code=503, detail="ELEVENLABS_API_KEY not configured")
    return ElevenLabs(api_key=settings.ELEVENLABS_API_KEY)


class SpeakRequest(BaseModel):
    text: str
    voice_id: str | None = None   # override per-request; falls back to config


@router.post("/speak")
async def speak(body: SpeakRequest) -> JSONResponse:
    voice_id = body.voice_id or settings.ELEVENLABS_VOICE_ID
    try:
        audio_generator = _client().text_to_speech.convert(
            voice_id=voice_id,
            text=body.text,
            model_id="eleven_multilingual_v2",
            output_format="mp3_44100_128",
        )
        audio_bytes = b"".join(audio_generator)
        audio_b64   = base64.b64encode(audio_bytes).decode("utf-8")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"ElevenLabs error: {e}") from e
    return JSONResponse({"audio_b64": audio_b64})


@router.get("/scribe-token")
async def scribe_token() -> JSONResponse:
    """Single-use ElevenLabs token for client-side realtime STT (scribe_v2_realtime)."""
    try:
        token = _client().tokens.single_use.create("realtime_scribe")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"ElevenLabs error: {e}") from e
    return JSONResponse({"token": token.value if hasattr(token, "value") else str(token)})
