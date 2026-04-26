"""
tools/render_overlay.py

Render an MP4 overlay from a landmark CSV (frames.csv) and a reference landmark CSV.

Supports:
- silhouette render (filled mannequin)
- green ghost reference
- optional stance mirroring via reps.csv (preferred) or ankle heuristic + debounce
"""

from __future__ import annotations

import argparse
import csv
import math
import sys
from pathlib import Path

import cv2
import numpy as np

WIDTH = 720
HEIGHT = 1280
BG = (18, 18, 18)
MIN_VIS = 0.2

LIVE_COLOR = (0, 0, 255)  # red (BGR)
GHOST_COLOR = (60, 220, 60)  # green


def px(lm):
    return (int(lm["x"] * WIDTH), int(lm["y"] * HEIGHT))


def load_landmark_csv(path: str):
    frames = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            lms = []
            for i in range(33):
                try:
                    lms.append(
                        {
                            "x": float(row.get(f"lm{i}_x") or 0),
                            "y": float(row.get(f"lm{i}_y") or 0),
                            "v": float(row.get(f"lm{i}_v") or 0),
                        }
                    )
                except ValueError:
                    lms.append({"x": 0.5, "y": 0.5, "v": 0.0})
            frames.append(lms)
    return frames


# left/right swap with flip x
_LR_PARTNER = list(range(33))
for a, b in (
    (1, 4),
    (2, 5),
    (3, 6),
    (7, 8),
    (9, 10),
    (11, 12),
    (13, 14),
    (15, 16),
    (17, 18),
    (19, 20),
    (21, 22),
    (23, 24),
    (25, 26),
    (27, 28),
    (29, 30),
    (31, 32),
):
    _LR_PARTNER[a], _LR_PARTNER[b] = b, a


def mirror_pose_lr(lms):
    out = []
    for i in range(33):
        src = lms[_LR_PARTNER[i]]
        out.append({"x": 1.0 - src["x"], "y": src["y"], "v": src["v"]})
    return out


def load_reps_segments(path: str):
    segs = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                start = int(float(row.get("start_frame") or ""))
                end = int(float(row.get("end_frame") or ""))
            except ValueError:
                continue
            side = (row.get("side") or "left").strip().lower()
            if side not in ("left", "right"):
                side = "left"
            segs.append({"start": start, "end": end, "side": side})
    segs.sort(key=lambda s: s["start"])
    return segs


class MirrorDebounce:
    def __init__(self, stable_frames: int = 6):
        self.stable_frames = max(1, int(stable_frames))
        self.state = False
        self._cand = None
        self._n = 0

    def update(self, desired: bool) -> bool:
        if desired == self.state:
            self._cand = None
            self._n = 0
            return self.state
        if self._cand != desired:
            self._cand = desired
            self._n = 1
            return self.state
        self._n += 1
        if self._n >= self.stable_frames:
            self.state = bool(desired)
            self._cand = None
            self._n = 0
        return self.state


def stance_mirror_from_reps(frame_idx: int, segments) -> bool:
    if not segments:
        return False
    for seg in segments:
        if seg["start"] <= frame_idx <= seg["end"]:
            return seg["side"] == "right"
    if frame_idx < segments[0]["start"]:
        return segments[0]["side"] == "right"
    if frame_idx > segments[-1]["end"]:
        return segments[-1]["side"] == "right"
    return False


def stance_mirror_from_ankles(user_lms) -> bool:
    try:
        ly, ry = float(user_lms[27]["y"]), float(user_lms[28]["y"])
        lv, rv = float(user_lms[27]["v"]), float(user_lms[28]["v"])
    except Exception:
        return False
    if lv < 0.15 or rv < 0.15:
        return False
    return ry > ly + 0.03


def _draw_capsule(img, p1, p2, color, thickness: int):
    cv2.line(img, p1, p2, color, thickness, cv2.LINE_AA)
    cv2.circle(img, p1, thickness // 2, color, -1, cv2.LINE_AA)
    cv2.circle(img, p2, thickness // 2, color, -1, cv2.LINE_AA)


def draw_body_silhouette(img, landmarks, color, alpha: float = 1.0):
    overlay = img.copy()

    def ok(i: int) -> bool:
        return landmarks[i]["v"] >= MIN_VIS

    # torso
    if ok(11) and ok(12) and ok(23) and ok(24):
        ls_p, rs_p = px(landmarks[11]), px(landmarks[12])
        lh_p, rh_p = px(landmarks[23]), px(landmarks[24])
        wl = (int(lh_p[0] * 0.65 + ls_p[0] * 0.35), int(lh_p[1] * 0.65 + ls_p[1] * 0.35))
        wr = (int(rh_p[0] * 0.65 + rs_p[0] * 0.35), int(rh_p[1] * 0.65 + rs_p[1] * 0.35))
        torso_pts = np.array([ls_p, rs_p, wr, rh_p, lh_p, wl], dtype=np.int32)
        cv2.fillConvexPoly(overlay, torso_pts, color, cv2.LINE_AA)

    # head (bigger + closer)
    if ok(0):
        nose_p = px(landmarks[0])
        head_p = (nose_p[0], int(nose_p[1] + 22))
        cv2.circle(overlay, head_p, 34, color, -1, cv2.LINE_AA)

    # limbs
    limbs = [
        (11, 13, 22),
        (13, 15, 16),
        (12, 14, 22),
        (14, 16, 16),
        (23, 25, 30),
        (25, 27, 26),
        (27, 29, 22),
        (24, 26, 30),
        (26, 28, 26),
        (28, 30, 22),
    ]
    for a, b, t in limbs:
        if ok(a) and ok(b):
            _draw_capsule(overlay, px(landmarks[a]), px(landmarks[b]), color, t)
    for i, r in ((15, 10), (16, 10), (29, 12), (30, 12)):
        if ok(i):
            cv2.circle(overlay, px(landmarks[i]), r, color, -1, cv2.LINE_AA)

    if alpha >= 0.999:
        img[:, :] = overlay
    else:
        cv2.addWeighted(overlay, float(alpha), img, 1.0 - float(alpha), 0.0, dst=img)


def smooth_pose(prev, curr, alpha: float = 0.75):
    if prev is None:
        return curr
    out = []
    for i in range(33):
        p, c = prev[i], curr[i]
        cv = float(c.get("v", 0))
        pv = float(p.get("v", 0))
        if cv < MIN_VIS:
            out.append(p if pv >= MIN_VIS else c)
            continue
        out.append(
            {
                "x": p["x"] * alpha + c["x"] * (1 - alpha),
                "y": p["y"] * alpha + c["y"] * (1 - alpha),
                "v": max(cv, pv),
            }
        )
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", required=True)
    ap.add_argument("--reference_frames", required=True)
    ap.add_argument("--out", default="overlay.mp4")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--reps", default=None)
    ap.add_argument("--smooth_user", action="store_true")
    ap.add_argument("--mirror_debounce", type=int, default=8)
    args = ap.parse_args()

    user_frames = load_landmark_csv(args.frames)
    if not user_frames:
        sys.exit("No user frames.")
    ref_cycle = load_landmark_csv(args.reference_frames)
    if not ref_cycle:
        sys.exit("No reference frames.")

    rep_segments = load_reps_segments(args.reps) if args.reps else []
    mirror_filter = MirrorDebounce(args.mirror_debounce)

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(args.out, fourcc, args.fps, (WIDTH, HEIGHT))

    prev_user = None
    for i, user_lms in enumerate(user_frames):
        if args.smooth_user:
            user_lms = smooth_pose(prev_user, user_lms)
            prev_user = user_lms

        ref_lms = ref_cycle[i % len(ref_cycle)]
        if rep_segments:
            mirror = stance_mirror_from_reps(i, rep_segments)
        else:
            mirror = mirror_filter.update(stance_mirror_from_ankles(user_lms))
        if mirror:
            ref_lms = mirror_pose_lr(ref_lms)

        frame = np.full((HEIGHT, WIDTH, 3), BG, dtype=np.uint8)
        draw_body_silhouette(frame, ref_lms, GHOST_COLOR, alpha=0.35)
        draw_body_silhouette(frame, user_lms, LIVE_COLOR, alpha=1.0)
        writer.write(frame)

    writer.release()
    print(f"Done → {args.out}", flush=True)


if __name__ == "__main__":
    main()

"""
tools/render_overlay.py — render pose overlay to MP4 without a simulator.

Usage:
    python tools/render_overlay.py --frames path/to/frames.csv --out overlay.mp4
    python tools/render_overlay.py --frames frames.csv --out out.mp4 --reference bilateral

For single_leg, the ghost is left-stance by default. It is mirrored (right-stance) when:
    • --reps path/to/reps.csv is set (or reps.csv sits next to frames.csv), using each rep's
      `side` field and `start_frame`/`end_frame` to pick the leg for that rep; or
    • with no reps file: inferred per frame from which ankle is lower on screen (stance foot).

frames.csv format (from buildLandmarkCsv):
    t,mode,lm0_x,lm0_y,lm0_z,lm0_v,lm1_x,lm1_y,lm1_z,lm1_v,...,lm32_v

Output:
    MP4 with two skeletons overlaid on a dark background:
      - Dashed white/orange/red  → reference (loops; see --reference)
      - Solid cyan               → user (from your frames.csv)

Reference modes (--reference):
    single_leg  — clinical single-leg squat test (Physiopedia): non-stance hip ~45° flexion,
                 non-stance knee ~90° flexion, arms straight forward with hands clasped,
                 squat to ~60° stance knee flexion then return. See:
                 https://www.physio-pedia.com/Single_Leg_Squat_Test
                 Keyframes live in SINGLE_LEG_STAND / SINGLE_LEG_BOTTOM below (tweak there).
    bilateral   — ideal two-legged squat (legacy; matches references/squat.ts)
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

# Reference (ghost) colour (BGR)
GHOST_COLOR = (60, 220, 60)  # green

# ── Reference poses ───────────────────────────────────────────────────────────
def _lm(x, y, v=1.0):
    return {"x": x, "y": y, "z": 0.0, "v": v}

_CENTRE = _lm(0.5, 0.5)

# Bilateral squat (Python translation of references/squat.ts)
BILATERAL_STAND = {
     0: _lm(0.50, 0.08),   7: _lm(0.46, 0.09),   8: _lm(0.54, 0.09),
    11: _lm(0.41, 0.22),  12: _lm(0.59, 0.22),
    13: _lm(0.37, 0.37),  14: _lm(0.63, 0.37),
    15: _lm(0.35, 0.52),  16: _lm(0.65, 0.52),
    23: _lm(0.44, 0.55),  24: _lm(0.56, 0.55),
    25: _lm(0.44, 0.72),  26: _lm(0.56, 0.72),
    27: _lm(0.44, 0.88),  28: _lm(0.56, 0.88),
    29: _lm(0.43, 0.91),  30: _lm(0.57, 0.91),
}
BILATERAL_SQUAT = {
     0: _lm(0.50, 0.40),   7: _lm(0.46, 0.41),   8: _lm(0.54, 0.41),
    11: _lm(0.38, 0.52),  12: _lm(0.62, 0.52),
    13: _lm(0.32, 0.66),  14: _lm(0.68, 0.66),
    15: _lm(0.30, 0.78),  16: _lm(0.70, 0.78),
    23: _lm(0.42, 0.68),  24: _lm(0.58, 0.68),
    25: _lm(0.38, 0.78),  26: _lm(0.62, 0.78),
    27: _lm(0.44, 0.88),  28: _lm(0.56, 0.88),
    29: _lm(0.43, 0.91),  30: _lm(0.57, 0.91),
}

# ── Clinical single-leg squat (Physiopedia “Single Leg Squat Test”) ───────────
# Source (procedure text): https://www.physio-pedia.com/Single_Leg_Squat_Test
#   • Stance on one leg; free leg lifted in front: hip ~45° flexion, free knee ~90° flexion.
#   • Arms straight out in front, hands clasped together.
#   • Squat until ~60° stance knee flexion, then return (partial squat, not full pistol).
# Implementation: two key poses in normalized image space (y down). Only listed
# indices are interpolated; others stay at _CENTRE. Anatomical LEFT = stance leg.
# To adjust the ghost: edit SINGLE_LEG_STAND (top of motion) and SINGLE_LEG_BOTTOM
# (≈60° stance flexion). Motion path is cosine-smoothed in build_reference_cycle().
SINGLE_LEG_STAND = {
     0: _lm(0.50, 0.10),
     7: _lm(0.47, 0.11),   8: _lm(0.53, 0.11),
    11: _lm(0.43, 0.22),  12: _lm(0.57, 0.22),
    13: _lm(0.46, 0.30),  14: _lm(0.54, 0.30),
    15: _lm(0.495, 0.36), 16: _lm(0.505, 0.36),
    23: _lm(0.47, 0.55),  24: _lm(0.54, 0.56),
    25: _lm(0.48, 0.72),  26: _lm(0.54, 0.47),
    27: _lm(0.49, 0.88),  28: _lm(0.54, 0.56),
    29: _lm(0.48, 0.91),  30: _lm(0.55, 0.58),
}
SINGLE_LEG_BOTTOM = {
     0: _lm(0.50, 0.12),
     7: _lm(0.47, 0.13),   8: _lm(0.53, 0.13),
    11: _lm(0.43, 0.24),  12: _lm(0.57, 0.24),
    13: _lm(0.46, 0.32),  14: _lm(0.54, 0.32),
    15: _lm(0.495, 0.40), 16: _lm(0.505, 0.40),
    23: _lm(0.48, 0.60),  24: _lm(0.54, 0.58),
    25: _lm(0.51, 0.74),  26: _lm(0.54, 0.48),
    27: _lm(0.50, 0.88),  28: _lm(0.54, 0.57),
    29: _lm(0.49, 0.91),  30: _lm(0.55, 0.59),
}


def _build_ref_frame(t, stand: dict, squat: dict):
    frame = []
    for i in range(33):
        s = stand.get(i, _CENTRE)
        q = squat.get(i, _CENTRE)
        frame.append({
            "x": s["x"] + (q["x"] - s["x"]) * t,
            "y": s["y"] + (q["y"] - s["y"]) * t,
            "v": 1.0,
        })
    return frame


def build_reference_cycle(n=60, kind: str = "single_leg"):
    if kind == "bilateral":
        stand, squat = BILATERAL_STAND, BILATERAL_SQUAT
    else:
        stand, squat = SINGLE_LEG_STAND, SINGLE_LEG_BOTTOM
    denom = max(1, n - 1)
    return [
        _build_ref_frame((1 - math.cos(i / denom * math.pi)) / 2, stand, squat)
        for i in range(n)
    ]


def load_reference_frames_csv(path: str):
    """
    Load a landmark CSV in the same format as frames.csv, returning PoseFrame[].
    Only x/y/v are used by the renderer; z is ignored.
    """
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

# ── MediaPipe left/right mirror (anatomical swap + flip x) ───────────────────
# partner[i] = index to read from when building the mirrored pose at index i.
_LR_PARTNER = list(range(33))
for a, b in (
    (1, 4), (2, 5), (3, 6), (7, 8), (9, 10), (11, 12), (13, 14), (15, 16),
    (17, 18), (19, 20), (21, 22), (23, 24), (25, 26), (27, 28), (29, 30), (31, 32),
):
    _LR_PARTNER[a], _LR_PARTNER[b] = b, a


def mirror_pose_lr(lms):
    """Left/right swap with horizontal flip (reference was authored left-stance)."""
    out = []
    for i in range(33):
        src = lms[_LR_PARTNER[i]]
        out.append({
            "x": 1.0 - src["x"],
            "y": src["y"],
            "v": src["v"],
        })
    return out


def load_reps_segments(path: str) -> list[dict]:
    """
    Load app-style reps.csv rows: need start_frame, end_frame, side (left/right).
    Returns sorted list of {start, end, side}.
    """
    segs = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            def _int(key_variants):
                for k in key_variants:
                    raw = row.get(k)
                    if raw is not None and str(raw).strip() != "":
                        try:
                            return int(float(raw))
                        except ValueError:
                            pass
                return None

            start = _int(("start_frame", "startFrame"))
            end = _int(("end_frame", "endFrame"))
            if start is None or end is None:
                continue
            side = (row.get("side") or "left").strip().lower()
            if side not in ("left", "right"):
                side = "left"
            segs.append({"start": start, "end": end, "side": side})
    segs.sort(key=lambda s: s["start"])
    return segs


def stance_mirror_from_reps(frame_idx: int, segments: list[dict]) -> bool:
    """True = mirror reference (right stance rep)."""
    if not segments:
        return False
    for seg in segments:
        if seg["start"] <= frame_idx <= seg["end"]:
            return seg["side"] == "right"
    if frame_idx < segments[0]["start"]:
        return segments[0]["side"] == "right"
    if frame_idx > segments[-1]["end"]:
        return segments[-1]["side"] == "right"
    return False


def stance_mirror_from_ankles(user_lms) -> bool:
    """
    Heuristic: stance foot is closer to the ground (larger y in image coords).
    Reference is left-stance → mirror when right ankle is clearly lower than left.
    """
    try:
        ly = float(user_lms[27]["y"])
        ry = float(user_lms[28]["y"])
        lv = float(user_lms[27].get("v", 1))
        rv = float(user_lms[28].get("v", 1))
    except (IndexError, KeyError, TypeError, ValueError):
        return False
    if lv < 0.15 or rv < 0.15:
        return False
    margin = 0.03
    return ry > ly + margin


# ── Temporal smoothing helpers ────────────────────────────────────────────────
def smooth_pose(prev, curr, alpha: float = 0.75):
    """
    Exponential moving average to reduce jitter.
    - Only smooths landmarks with decent visibility; otherwise holds prev.
    alpha closer to 1.0 = smoother (more inertia).
    """
    if prev is None:
        return curr
    out = []
    for i in range(33):
        p = prev[i]
        c = curr[i]
        cv = float(c.get("v", 0))
        pv = float(p.get("v", 0))
        if cv < MIN_VIS:
            out.append(p if pv >= MIN_VIS else c)
            continue
        out.append({
            "x": p["x"] * alpha + c["x"] * (1 - alpha),
            "y": p["y"] * alpha + c["y"] * (1 - alpha),
            "v": max(cv, pv),
        })
    return out


class MirrorDebounce:
    """
    Debounce the left/right mirror decision to avoid rapid toggling.

    A switch is only committed after the candidate state is observed for
    `stable_frames` consecutive frames.
    """

    def __init__(self, stable_frames: int = 6):
        self.stable_frames = max(1, int(stable_frames))
        self.state = False
        self._candidate = None
        self._count = 0

    def update(self, desired: bool) -> bool:
        if desired == self.state:
            self._candidate = None
            self._count = 0
            return self.state
        if self._candidate != desired:
            self._candidate = desired
            self._count = 1
            return self.state
        self._count += 1
        if self._count >= self.stable_frames:
            self.state = bool(desired)
            self._candidate = None
            self._count = 0
        return self.state


# ── CSV parser ────────────────────────────────────────────────────────────────
def load_frames_csv(path: str):
    frames = []
    modes = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            modes.append((row.get("mode") or "").strip())
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
    return frames, modes

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


def draw_reference_skeleton(img, ref, color=GHOST_COLOR):
    """
    Reference skeleton rendered in a single colour (no deviation colouring).
    No neck (head sits closer via silhouette/head settings).
    """
    # Bones
    for a, b in CONNECTIONS:
        la, lb = ref[a], ref[b]
        if la["v"] < MIN_VIS or lb["v"] < MIN_VIS:
            continue
        _draw_dashed(img, px(la), px(lb), color, 2)

    # Joints
    for i in (0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30):
        if ref[i]["v"] < MIN_VIS:
            continue
        cv2.circle(img, px(ref[i]), 4, color, -1, cv2.LINE_AA)


def _draw_capsule(img, p1, p2, color, thickness: int):
    cv2.line(img, p1, p2, color, thickness, cv2.LINE_AA)
    cv2.circle(img, p1, thickness // 2, color, -1, cv2.LINE_AA)
    cv2.circle(img, p2, thickness // 2, color, -1, cv2.LINE_AA)


def draw_body_silhouette(img, landmarks, color, alpha: float = 1.0):
    """
    Render a simple 'mannequin' silhouette from landmarks:
    - filled torso quad (shoulders + hips)
    - thick limb capsules
    - head circle
    This gives a more body-like look than a stick skeleton but still uses only landmarks.
    """
    overlay = img.copy()

    def ok(i: int) -> bool:
        return landmarks[i]["v"] >= MIN_VIS

    # Midpoints for shaping
    has_shoulders = ok(11) and ok(12)
    has_hips = ok(23) and ok(24)
    if has_shoulders:
        ls, rs = landmarks[11], landmarks[12]
        ms = {"x": (ls["x"] + rs["x"]) / 2, "y": (ls["y"] + rs["y"]) / 2, "v": 1.0}
    else:
        ms = None
    if has_hips:
        lh, rh = landmarks[23], landmarks[24]
        mh = {"x": (lh["x"] + rh["x"]) / 2, "y": (lh["y"] + rh["y"]) / 2, "v": 1.0}
    else:
        mh = None

    # Torso fill (rounded-ish hex): shoulders → waist → hips
    if has_shoulders and has_hips:
        ls_p = px(landmarks[11])
        rs_p = px(landmarks[12])
        lh_p = px(landmarks[23])
        rh_p = px(landmarks[24])
        # waist points slightly inset from hips (gives taper)
        waist_inset = 0.35
        wl = (
            int(lh_p[0] * (1 - waist_inset) + ls_p[0] * waist_inset),
            int(lh_p[1] * 0.65 + ls_p[1] * 0.35),
        )
        wr = (
            int(rh_p[0] * (1 - waist_inset) + rs_p[0] * waist_inset),
            int(rh_p[1] * 0.65 + rs_p[1] * 0.35),
        )
        torso_pts = np.array([ls_p, rs_p, wr, rh_p, lh_p, wl], dtype=np.int32)
        cv2.fillConvexPoly(overlay, torso_pts, color, cv2.LINE_AA)

    # Head
    if ok(0):
        # Bigger head, slightly shifted down to sit closer to torso.
        nose_p = px(landmarks[0])
        head_p = (nose_p[0], int(nose_p[1] + 22))
        cv2.circle(overlay, head_p, 34, color, -1, cv2.LINE_AA)

    # Limb capsules (thickness tuned for 720x1280). We taper by segment.
    limbs = [
        (11, 13, 22), (13, 15, 16),  # left arm
        (12, 14, 22), (14, 16, 16),  # right arm
        (23, 25, 30), (25, 27, 26), (27, 29, 22),  # left leg
        (24, 26, 30), (26, 28, 26), (28, 30, 22),  # right leg
    ]
    for a, b, t in limbs:
        if ok(a) and ok(b):
            _draw_capsule(overlay, px(landmarks[a]), px(landmarks[b]), color, t)

    # Feet / hands (small pads)
    for i, r in ((15, 10), (16, 10), (29, 12), (30, 12)):
        if ok(i):
            cv2.circle(overlay, px(landmarks[i]), r, color, -1, cv2.LINE_AA)

    if alpha >= 0.999:
        img[:, :] = overlay
    else:
        cv2.addWeighted(overlay, float(alpha), img, 1.0 - float(alpha), 0.0, dst=img)


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

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--frames", required=True, help="Path to frames.csv")
    parser.add_argument("--out",    default="overlay.mp4", help="Output MP4 path")
    parser.add_argument("--fps",    type=int, default=FPS)
    parser.add_argument(
        "--style",
        choices=("skeleton", "silhouette"),
        default="skeleton",
        help="Render style for the live user (and ghost): skeleton or filled silhouette",
    )
    parser.add_argument(
        "--reference",
        choices=("single_leg", "bilateral"),
        default="single_leg",
        help="Ghost reference: Physiopedia clinical SLS (default) or bilateral squat",
    )
    parser.add_argument(
        "--reps",
        default=None,
        help="Optional reps.csv (app export). If omitted, uses reps.csv beside --frames when present.",
    )
    parser.add_argument(
        "--reference_frames",
        default=None,
        help="Optional landmark CSV to use as the ghost cycle (overrides built-in keyframes).",
    )
    parser.add_argument(
        "--smooth_user",
        action="store_true",
        help="Apply simple temporal smoothing to user landmarks (reduces jitter).",
    )
    parser.add_argument(
        "--mirror_debounce",
        type=int,
        default=6,
        help="Frames required to switch left/right stance when inferring (default: 6).",
    )
    args = parser.parse_args()

    print(f"Loading user frames from {args.frames} ...")
    user_frames, _modes = load_frames_csv(args.frames)
    if not user_frames:
        sys.exit("No frames found in CSV.")
    print(f"  {len(user_frames)} user frames loaded.")

    rep_segments: list[dict] = []
    reps_path = args.reps
    if not reps_path:
        sibling = Path(args.frames).resolve().parent / "reps.csv"
        if sibling.is_file():
            reps_path = str(sibling)
    if reps_path:
        if not Path(reps_path).is_file():
            sys.exit(f"Reps file not found: {reps_path}")
        rep_segments = load_reps_segments(reps_path)
        print(f"  Loaded {len(rep_segments)} rep segment(s) from {reps_path} (stance from `side`).")
    elif args.reference == "single_leg":
        print("  No reps.csv — stance side inferred from ankle height each frame.")

    ref_frames_path = args.reference_frames
    if not ref_frames_path and args.reference == "single_leg":
        candidate = Path("references/single_leg_squat/frames.csv")
        if candidate.is_file():
            ref_frames_path = str(candidate)

    if ref_frames_path:
        if not Path(ref_frames_path).is_file():
            sys.exit(f"Reference frames file not found: {ref_frames_path}")
        ref_cycle = load_reference_frames_csv(ref_frames_path)
        if not ref_cycle:
            sys.exit(f"No frames found in reference file: {ref_frames_path}")
        print(f"  Loaded reference cycle from {ref_frames_path} ({len(ref_cycle)} frames).")
    else:
        ref_cycle = build_reference_cycle(60, args.reference)
    print(f"  {len(ref_cycle)}-frame reference cycle ({args.reference}).")

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(args.out, fourcc, args.fps, (WIDTH, HEIGHT))

    mirrored_count = 0
    mirror_filter = MirrorDebounce(args.mirror_debounce)
    prev_user = None
    for i, user_lms in enumerate(user_frames):
        if args.smooth_user:
            user_lms = smooth_pose(prev_user, user_lms, alpha=0.75)
            prev_user = user_lms

        ref_lms = ref_cycle[i % len(ref_cycle)]
        if args.reference == "single_leg":
            if rep_segments:
                mirror = stance_mirror_from_reps(i, rep_segments)
            else:
                mirror = mirror_filter.update(stance_mirror_from_ankles(user_lms))
            if mirror:
                ref_lms = mirror_pose_lr(ref_lms)
                mirrored_count += 1

        frame = np.full((HEIGHT, WIDTH, 3), BG, dtype=np.uint8)
        if args.style == "silhouette":
            # Ghost: green translucent silhouette; live: solid cyan.
            draw_body_silhouette(frame, ref_lms, GHOST_COLOR, alpha=0.35)
            draw_body_silhouette(frame, user_lms, LIVE_COLOR, alpha=1.0)
        else:
            # Green reference skeleton (no deviation colouring).
            draw_reference_skeleton(frame, ref_lms, color=GHOST_COLOR)
            draw_skeleton(frame, user_lms, LIVE_COLOR, solid=True, joint_r=5, bone_w=2)

        frame_num = f"frame {i+1}/{len(user_frames)}"
        cv2.putText(frame, frame_num, (20, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (120, 120, 120), 1, cv2.LINE_AA)

        writer.write(frame)

    writer.release()
    print(f"Done → {args.out}  ({len(user_frames)} frames @ {args.fps}fps)")
    if args.reference == "single_leg":
        print(f"  Right-stance (mirrored) ghost frames: {mirrored_count}/{len(user_frames)}")

if __name__ == "__main__":
    main()
