"""
tools/render_calibration_batch.py

Render 4 overlay MP4s for a completed calibration batch stored in Postgres.

Requires:
  - GET /sessions/calibration/frames.csv (JWT)
  - local reference landmark CSVs for each step (1..4)

Default reference paths (create by extracting your 4 reference MP4s):
  references/calibration/01_left_sls/frames.csv
  references/calibration/02_right_sls/frames.csv
  references/calibration/03_left_lsd/frames.csv
  references/calibration/04_right_lsd/frames.csv
"""

from __future__ import annotations

import argparse
import os
import subprocess
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen


REF_BY_STEP = {
    1: "references/calibration/01_left_sls/frames.csv",
    2: "references/calibration/02_right_sls/frames.csv",
    3: "references/calibration/03_left_lsd/frames.csv",
    4: "references/calibration/04_right_lsd/frames.csv",
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
    ap.add_argument("--token", required=True, help="JWT access token for backend")
    ap.add_argument("--patient_id", required=True)
    ap.add_argument("--calibration_batch_id", required=True)
    ap.add_argument("--out_dir", default="exports/calibration_overlays")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--smooth_user", action="store_true")
    ap.add_argument("--mirror_debounce", type=int, default=8)
    args = ap.parse_args()

    base = args.base_url.rstrip("/")
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    for step in (1, 2, 3, 4):
        ref_path = Path(REF_BY_STEP[step])
        if not ref_path.is_file():
            raise SystemExit(f"Missing reference frames for step {step}: {ref_path}")

        q = urlencode(
            {
                "patientId": args.patient_id,
                "calibrationBatchId": args.calibration_batch_id,
                "calibrationStep": str(step),
            }
        )
        url = f"{base}/sessions/calibration/frames.csv?{q}"
        frames_bytes = _download(url, args.token)

        out_mp4 = out_dir / f"calibration_step{step}.mp4"
        frames_path = out_dir / f"step{step}_frames.csv"
        frames_path.write_bytes(frames_bytes)

        cmd = [
            os.fspath(Path(os.sys.executable)),
            "tools/render_overlay.py",
            "--frames",
            os.fspath(frames_path),
            "--reference_frames",
            os.fspath(ref_path),
            "--out",
            os.fspath(out_mp4),
            "--fps",
            str(args.fps),
            "--mirror_debounce",
            str(args.mirror_debounce),
        ]
        if args.smooth_user:
            cmd.append("--smooth_user")
        subprocess.check_call(cmd)
        print(f"Done → {out_mp4}", flush=True)


if __name__ == "__main__":
    main()
