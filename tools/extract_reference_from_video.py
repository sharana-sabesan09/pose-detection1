"""
tools/extract_reference_from_video.py

Extract MediaPipe Pose landmarks from a reference MP4 into a frames.csv-style file:
  t,mode,lm0_x,lm0_y,lm0_z,lm0_v,...,lm32_v

Uses MediaPipe Tasks PoseLandmarker (mediapipe.tasks.*).
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path
from urllib.request import urlretrieve

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision


MODEL_URL_FULL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_full/float16/latest/pose_landmarker_full.task"
)


def _build_header() -> list[str]:
    cols = ["t", "mode"]
    for i in range(33):
        cols += [f"lm{i}_x", f"lm{i}_y", f"lm{i}_z", f"lm{i}_v"]
    return cols


def _ensure_model(model_path: Path) -> None:
    model_path.parent.mkdir(parents=True, exist_ok=True)
    if model_path.is_file():
        return
    print(f"Downloading pose landmarker model → {model_path} ...", flush=True)
    urlretrieve(MODEL_URL_FULL, str(model_path))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True, help="Path to input MP4")
    ap.add_argument("--out", required=True, help="Output CSV path")
    ap.add_argument("--mode", default="reference", help="CSV mode column value")
    ap.add_argument("--stride", type=int, default=1, help="Process every Nth frame")
    ap.add_argument("--max_frames", type=int, default=0, help="0 = no limit")
    ap.add_argument("--model", default="tools/models/pose_landmarker_full.task")
    args = ap.parse_args()

    video_path = Path(args.video).expanduser().resolve()
    if not video_path.is_file():
        raise SystemExit(f"Video not found: {video_path}")

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    model_path = Path(args.model).expanduser()
    _ensure_model(model_path)

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise SystemExit(f"Could not open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

    base_options = mp_python.BaseOptions(model_asset_path=str(model_path))
    options = mp_vision.PoseLandmarkerOptions(
        base_options=base_options,
        running_mode=mp_vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    written = 0
    with mp_vision.PoseLandmarker.create_from_options(options) as landmarker:
        with out_path.open("w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(_build_header())

            frame_idx = 0
            while True:
                ok, frame_bgr = cap.read()
                if not ok:
                    break
                if args.stride > 1 and (frame_idx % args.stride) != 0:
                    frame_idx += 1
                    continue

                t_ms = int((frame_idx / fps) * 1000.0)

                frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)
                res = landmarker.detect_for_video(mp_image, t_ms)

                row: list[object] = [t_ms, args.mode]
                if not res.pose_landmarks:
                    for _ in range(33):
                        row += ["", "", "", ""]
                else:
                    lms = res.pose_landmarks[0]
                    for i in range(33):
                        lm = lms[i]
                        row += [
                            f"{lm.x:.6f}",
                            f"{lm.y:.6f}",
                            f"{lm.z:.6f}",
                            f"{(lm.visibility if lm.visibility is not None else 0.0):.6f}",
                        ]
                w.writerow(row)
                written += 1
                frame_idx += 1
                if args.max_frames and written >= args.max_frames:
                    break

    cap.release()
    print(f"Wrote {written} frame(s) to {out_path}", flush=True)


if __name__ == "__main__":
    main()

