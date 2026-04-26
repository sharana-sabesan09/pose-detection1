"""
Batch speech-to-text utility using ElevenLabs.

Writes transcription artifacts to:
  exports/user_transcriptions/

Usage examples:
  cd backend
  uv run python scripts/transcribe_with_elevenlabs.py --audio-url "https://.../file.mp3"
  uv run python scripts/transcribe_with_elevenlabs.py --audio-file "/absolute/path/to/audio.m4a"
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from urllib.request import urlopen

from dotenv import load_dotenv
from elevenlabs.client import ElevenLabs


def _repo_root() -> Path:
    # .../backend/scripts/transcribe_with_elevenlabs.py -> repo root is parents[2]
    return Path(__file__).resolve().parents[2]


def _load_audio_bytes(audio_url: str | None, audio_file: str | None) -> tuple[BytesIO, str]:
    if bool(audio_url) == bool(audio_file):
        raise ValueError("Provide exactly one of --audio-url or --audio-file.")

    if audio_url:
        with urlopen(audio_url) as resp:  # noqa: S310 - URL is explicitly user-provided input
            payload = resp.read()
        return BytesIO(payload), audio_url

    file_path = Path(audio_file).expanduser().resolve()
    if not file_path.exists():
        raise FileNotFoundError(f"Audio file not found: {file_path}")
    return BytesIO(file_path.read_bytes()), str(file_path)


def _to_jsonable(obj):
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    if hasattr(obj, "dict"):
        return obj.dict()
    if isinstance(obj, dict):
        return obj
    return {"raw": str(obj)}


def _extract_text(payload: dict) -> str:
    for key in ("text", "transcript", "normalized_text"):
        val = payload.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return json.dumps(payload, ensure_ascii=False)


def main() -> None:
    parser = argparse.ArgumentParser(description="Transcribe audio with ElevenLabs Speech-to-Text.")
    parser.add_argument("--audio-url", type=str, default=None, help="Public URL to an audio file.")
    parser.add_argument("--audio-file", type=str, default=None, help="Local path to an audio file.")
    parser.add_argument("--model-id", type=str, default="scribe_v2", help="ElevenLabs STT model.")
    parser.add_argument("--language-code", type=str, default="eng", help="Language code (e.g., eng).")
    parser.add_argument("--diarize", action="store_true", help="Enable speaker diarization.")
    parser.add_argument(
        "--tag-audio-events",
        action="store_true",
        help="Tag events like laughter/applause in the transcript payload.",
    )
    args = parser.parse_args()

    load_dotenv(_repo_root() / "backend" / ".env")
    api_key = os.getenv("ELEVENLABS_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("Missing ELEVENLABS_API_KEY in backend/.env")

    audio_data, source = _load_audio_bytes(args.audio_url, args.audio_file)
    client = ElevenLabs(api_key=api_key)

    transcription = client.speech_to_text.convert(
        file=audio_data,
        model_id=args.model_id,
        tag_audio_events=args.tag_audio_events,
        language_code=args.language_code,
        diarize=args.diarize,
    )

    transcription_payload = _to_jsonable(transcription)
    transcript_text = _extract_text(transcription_payload)

    out_dir = _repo_root() / "exports" / "user_transcriptions"
    out_dir.mkdir(parents=True, exist_ok=True)

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%fZ")
    json_path = out_dir / f"{stamp}_transcription.json"
    text_path = out_dir / f"{stamp}_transcription.txt"

    record = {
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "modelId": args.model_id,
        "languageCode": args.language_code,
        "diarize": args.diarize,
        "tagAudioEvents": args.tag_audio_events,
        "transcription": transcription_payload,
    }

    json_path.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    text_path.write_text(transcript_text + "\n", encoding="utf-8")

    print(f"Saved JSON: {json_path}")
    print(f"Saved text: {text_path}")
    print("Transcript:")
    print(transcript_text)


if __name__ == "__main__":
    main()

