"""
tools/render_overlay.py — render pose overlay to MP4 without a simulator.

Usage:
    python tools/render_overlay.py --frames path/to/frames.csv --out overlay.mp4

frames.csv format (from buildLandmarkCsv):
    t,mode,lm0_x,lm0_y,lm0_z,lm0_v,lm1_x,lm1_y,lm1_z,lm1_v,...,lm32_v

Output:
    MP4 with two skeletons overlaid on a dark background:
      - Dashed white/orange/red  → reference (ideal squat, loops)
      - Solid cyan               → user (from your frames.csv)
"""

import argparse
import csv
import math
import sys
from pathlib import Path

import cv2
import numpy as np

# ── Canvas ────────────────────────────────────────────────────────────────────
WIDTH  = 720
HEIGHT = 1280
FPS    = 30
BG     = (18, 18, 18)  # near-black

# ── Skeleton connections (mirrors src/engine/landmarks.ts) ────────────────────
CONNECTIONS = [
    (11, 12), (11, 23), (12, 24), (23, 24),   # torso
    (23, 25), (25, 27), (27, 29),              # left leg
    (24, 26), (26, 28), (28, 30),              # right leg
    (11, 13), (13, 15),                        # left arm
    (12, 14), (14, 16),                        # right arm
]

# ── Colours (BGR) ─────────────────────────────────────────────────────────────
LIVE_COLOR  = (255, 212,   0)   # cyan
GHOST_BASE  = (200, 200, 200)   # white
COLOR_WARN  = (  0, 152, 255)   # orange
COLOR_BAD   = ( 54,  67, 244)   # red
THRESH_WARN = 0.08
THRESH_BAD  = 0.15
MIN_VIS     = 0.2

# ── Reference squat (Python translation of references/squat.ts) ───────────────
def _lm(x, y):
    return {"x": x, "y": y, "z": 0.0, "v": 1.0}

STAND = {
     0: _lm(0.50, 0.08),   7: _lm(0.46, 0.09),   8: _lm(0.54, 0.09),
    11: _lm(0.41, 0.22),  12: _lm(0.59, 0.22),
    13: _lm(0.37, 0.37),  14: _lm(0.63, 0.37),
    15: _lm(0.35, 0.52),  16: _lm(0.65, 0.52),
    23: _lm(0.44, 0.55),  24: _lm(0.56, 0.55),
    25: _lm(0.44, 0.72),  26: _lm(0.56, 0.72),
    27: _lm(0.44, 0.88),  28: _lm(0.56, 0.88),
    29: _lm(0.43, 0.91),  30: _lm(0.57, 0.91),
}
SQUAT_POS = {
     0: _lm(0.50, 0.40),   7: _lm(0.46, 0.41),   8: _lm(0.54, 0.41),
    11: _lm(0.38, 0.52),  12: _lm(0.62, 0.52),
    13: _lm(0.32, 0.66),  14: _lm(0.68, 0.66),
    15: _lm(0.30, 0.78),  16: _lm(0.70, 0.78),
    23: _lm(0.42, 0.68),  24: _lm(0.58, 0.68),
    25: _lm(0.38, 0.78),  26: _lm(0.62, 0.78),
    27: _lm(0.44, 0.88),  28: _lm(0.56, 0.88),
    29: _lm(0.43, 0.91),  30: _lm(0.57, 0.91),
}
_CENTRE = _lm(0.5, 0.5)

def _build_ref_frame(t):
    frame = []
    for i in range(33):
        s = STAND.get(i, _CENTRE)
        q = SQUAT_POS.get(i, _CENTRE)
        frame.append({
            "x": s["x"] + (q["x"] - s["x"]) * t,
            "y": s["y"] + (q["y"] - s["y"]) * t,
            "v": 1.0,
        })
    return frame

def build_reference_cycle(n=60):
    return [
        _build_ref_frame((1 - math.cos(i / (n - 1) * math.pi)) / 2)
        for i in range(n)
    ]

# ── CSV parser ────────────────────────────────────────────────────────────────
def load_frames_csv(path: str):
    frames = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            lms = []
            for i in range(33):
                try:
                    lms.append({
                        "x": float(row.get(f"lm{i}_x") or 0),
                        "y": float(row.get(f"lm{i}_y") or 0),
                        "v": float(row.get(f"lm{i}_v") or 0),
                    })
                except ValueError:
                    lms.append({"x": 0.5, "y": 0.5, "v": 0.0})
            frames.append(lms)
    return frames

# ── Deviation colour ──────────────────────────────────────────────────────────
def deviation_color(ref, live):
    if live is None or live["v"] < MIN_VIS:
        return GHOST_BASE
    d = math.sqrt((ref["x"] - live["x"]) ** 2 + (ref["y"] - live["y"]) ** 2)
    if d >= THRESH_BAD:  return COLOR_BAD
    if d >= THRESH_WARN: return COLOR_WARN
    return GHOST_BASE

def bone_color(a, b, ref, live):
    ca = deviation_color(ref[a], live[a] if live else None)
    cb = deviation_color(ref[b], live[b] if live else None)
    if ca == COLOR_BAD  or cb == COLOR_BAD:  return COLOR_BAD
    if ca == COLOR_WARN or cb == COLOR_WARN: return COLOR_WARN
    return GHOST_BASE

# ── Draw helpers ──────────────────────────────────────────────────────────────
def px(lm):
    return (int(lm["x"] * WIDTH), int(lm["y"] * HEIGHT))

def draw_skeleton(img, landmarks, color, solid=True, joint_r=5, bone_w=2):
    for a, b in CONNECTIONS:
        la, lb = landmarks[a], landmarks[b]
        if la["v"] < MIN_VIS or lb["v"] < MIN_VIS:
            continue
        pa, pb = px(la), px(lb)
        if solid:
            cv2.line(img, pa, pb, color, bone_w, cv2.LINE_AA)
        else:
            # dashed line
            _draw_dashed(img, pa, pb, color, bone_w)
    for lm in landmarks:
        if lm["v"] < MIN_VIS:
            continue
        cv2.circle(img, px(lm), joint_r, color, -1, cv2.LINE_AA)

def draw_ghost_skeleton(img, ref, live):
    for a, b in CONNECTIONS:
        la, lb = ref[a], ref[b]
        col = bone_color(a, b, ref, live)
        _draw_dashed(img, px(la), px(lb), col, 2)
    for i, lm in enumerate(ref):
        col = deviation_color(lm, live[i] if live else None)
        cv2.circle(img, px(lm), 4, col, -1, cv2.LINE_AA)

def _draw_dashed(img, p1, p2, color, thickness, dash=10, gap=7):
    dx = p2[0] - p1[0]
    dy = p2[1] - p1[1]
    length = math.sqrt(dx * dx + dy * dy)
    if length == 0:
        return
    ux, uy = dx / length, dy / length
    pos = 0.0
    drawing = True
    while pos < length:
        seg = dash if drawing else gap
        end = min(pos + seg, length)
        if drawing:
            x1 = int(p1[0] + ux * pos)
            y1 = int(p1[1] + uy * pos)
            x2 = int(p1[0] + ux * end)
            y2 = int(p1[1] + uy * end)
            cv2.line(img, (x1, y1), (x2, y2), color, thickness, cv2.LINE_AA)
        pos += seg
        drawing = not drawing

# ── Legend ────────────────────────────────────────────────────────────────────
def draw_legend(img):
    items = [
        (GHOST_BASE, "Reference (good form)"),
        (COLOR_WARN, "Mild deviation"),
        (COLOR_BAD,  "Large deviation"),
        (LIVE_COLOR, "Your pose"),
    ]
    x0, y0 = 20, HEIGHT - 120
    for color, label in items:
        cv2.circle(img, (x0 + 8, y0 + 8), 6, color, -1, cv2.LINE_AA)
        cv2.putText(img, label, (x0 + 22, y0 + 13),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1, cv2.LINE_AA)
        y0 += 24

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--frames", required=True, help="Path to frames.csv")
    parser.add_argument("--out",    default="overlay.mp4", help="Output MP4 path")
    parser.add_argument("--fps",    type=int, default=FPS)
    args = parser.parse_args()

    print(f"Loading user frames from {args.frames} ...")
    user_frames = load_frames_csv(args.frames)
    if not user_frames:
        sys.exit("No frames found in CSV.")
    print(f"  {len(user_frames)} user frames loaded.")

    ref_cycle = build_reference_cycle(60)
    print(f"  {len(ref_cycle)}-frame reference cycle built.")

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(args.out, fourcc, args.fps, (WIDTH, HEIGHT))

    for i, user_lms in enumerate(user_frames):
        ref_lms = ref_cycle[i % len(ref_cycle)]

        frame = np.full((HEIGHT, WIDTH, 3), BG, dtype=np.uint8)
        draw_ghost_skeleton(frame, ref_lms, user_lms)
        draw_skeleton(frame, user_lms, LIVE_COLOR, solid=True, joint_r=5, bone_w=2)
        draw_legend(frame)

        frame_num = f"frame {i+1}/{len(user_frames)}"
        cv2.putText(frame, frame_num, (20, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (120, 120, 120), 1, cv2.LINE_AA)

        writer.write(frame)

    writer.release()
    print(f"Done → {args.out}  ({len(user_frames)} frames @ {args.fps}fps)")

if __name__ == "__main__":
    main()
