"""
tools/render_latest_from_server.py

Fetch the latest stored landmark frames CSV from the backend Postgres DB
and render an overlay MP4 against an exercise reference.

Assumes backend has:
  GET /sessions/latest/frames.csv?exercise=<exercise>
and returns frames.csv format.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import tempfile
from pathlib import Path
from urllib.request import Request, urlopen


REF_MAP = {
    "single_leg_squat": "references/single_leg_squat/frames.csv",
    "lateral_step_down": "references/lateral_step_down/frames.csv",
}


def _download(url: str, token: str | None) -> bytes:
    req = Request(url)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urlopen(req) as r:  # noqa: S310 - local dev tool
        return r.read()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base_url", default="http://127.0.0.1:8000")
    ap.add_argument("--exercise", required=True)
    ap.add_argument("--token", default=None, help="JWT access token for backend")
    ap.add_argument("--out", default="latest_overlay.mp4")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--smooth_user", action="store_true")
    ap.add_argument("--mirror_debounce", type=int, default=8)
    args = ap.parse_args()

    ref = REF_MAP.get(args.exercise)
    if not ref:
        raise SystemExit(f"Unknown exercise={args.exercise}. Update REF_MAP.")
    ref_path = Path(ref)
    if not ref_path.is_file():
        raise SystemExit(f"Missing reference frames: {ref_path}")

    base = args.base_url.rstrip("/")
    frames_url = f"{base}/sessions/latest/frames.csv?exercise={args.exercise}"

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as td:
        frames_path = Path(td) / "frames.csv"
        frames_path.write_bytes(_download(frames_url, args.token))

        cmd = [
            os.fspath(Path(os.sys.executable)),
            "tools/render_overlay.py",
            "--frames",
            os.fspath(frames_path),
            "--reference_frames",
            os.fspath(ref_path),
            "--out",
            os.fspath(out_path),
            "--fps",
            str(args.fps),
            "--mirror_debounce",
            str(args.mirror_debounce),
        ]
        if args.smooth_user:
            cmd.append("--smooth_user")
        subprocess.check_call(cmd)


if __name__ == "__main__":
    main()

