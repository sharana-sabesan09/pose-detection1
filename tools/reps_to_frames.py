"""
tools/reps_to_frames.py — convert reps.csv OR session.json to a synthetic frames.csv

Accepts either format:
  --reps session.json   (the full session JSON from the app / email)
  --reps reps.csv       (the per-rep CSV export)

Usage:
    python tools/reps_to_frames.py --reps session.json --out frames.csv
    python tools/render_overlay.py --frames frames.csv --out overlay.mp4
"""

import argparse
import csv
import json
import math

# ── Landmark indices (mirrors src/engine/landmarks.ts) ───────────────────────
NOSE           =  0
LEFT_EAR       =  7
RIGHT_EAR      =  8
LEFT_SHOULDER  = 11
RIGHT_SHOULDER = 12
LEFT_ELBOW     = 13
RIGHT_ELBOW    = 14
LEFT_WRIST     = 15
RIGHT_WRIST    = 16
LEFT_HIP       = 23
RIGHT_HIP      = 24
LEFT_KNEE      = 25
RIGHT_KNEE     = 26
LEFT_ANKLE     = 27
RIGHT_ANKLE    = 28
LEFT_HEEL      = 29
RIGHT_HEEL     = 30

# ── Geometry helpers ──────────────────────────────────────────────────────────
def lerp(a, b, t):
    return a + (b - a) * t

def lm(x, y, v=1.0):
    return {"x": x, "y": y, "v": v}

def build_frame(t, rep):
    """
    t     : 0.0 = standing, 1.0 = full depth
    rep   : dict parsed from one reps.csv row

    Feature mapping:
      depth_deg        → how deep the knee bends (hip drop + knee forward)
      trunk_flex_peak  → how far forward the torso leans
      trunk_lean_peak  → lateral lean (Trendelenburg-style)
      fppa_peak        → knee valgus on dominant side (knees cave inward)
      pelvic_drop_peak → one hip higher than other at depth
      side             → which side is dominant for asymmetric features
    """
    depth       = float(rep["depth_deg"])
    trunk_flex  = float(rep["trunk_flex_peak"])
    trunk_lean  = float(rep["trunk_lean_peak"])
    fppa        = float(rep["fppa_peak"])
    pelvic_drop = float(rep["pelvic_drop_peak"])
    side        = rep["side"]   # "left" | "right"

    # Normalise: reference squat is 120°. Scale depth visually against that.
    depth_vis = min(depth / 120.0, 1.0) * t

    # ── Hip: drops as squat deepens ───────────────────────────────────────────
    y_hip_stand = 0.55
    y_hip_squat = 0.70
    y_hip = lerp(y_hip_stand, y_hip_squat, depth_vis)

    # Pelvic drop: one hip higher than the other at depth
    drop_offset = (pelvic_drop / 25.0) * 0.04 * depth_vis
    y_left_hip  = y_hip + (drop_offset if side == "right" else -drop_offset)
    y_right_hip = y_hip - (drop_offset if side == "right" else -drop_offset)

    # Lateral pelvic shift
    pelvic_shift = float(rep.get("pelvic_shift_peak", 0))
    hip_shift_x = (pelvic_shift / 0.15) * 0.03 * depth_vis
    if side == "right":
        hip_shift_x = -hip_shift_x

    # ── Trunk ─────────────────────────────────────────────────────────────────
    # Forward lean: shoulders shift forward and down relative to hips
    fwd = (trunk_flex / 90.0) * 0.10 * depth_vis

    # Lateral lean: shoulders tilt over dominant side
    lat = (trunk_lean / 25.0) * 0.05 * depth_vis
    if side == "right":
        lat = -lat

    torso_h = 0.33
    y_shoulder = y_hip - torso_h + fwd * 0.3
    x_ls = lerp(0.41, 0.38, depth_vis) + fwd - lat + hip_shift_x
    x_rs = lerp(0.59, 0.62, depth_vis) + fwd - lat + hip_shift_x

    # ── Knees ─────────────────────────────────────────────────────────────────
    # Valgus: FPPA values in this data are ~30–175; values > 120 indicate
    # pronounced valgus on the dominant side (knee drifts toward midline).
    valgus = max(0.0, (fppa - 90.0) / 90.0) * 0.06 * depth_vis
    y_knee = lerp(0.72, 0.78, depth_vis)

    if side == "left":
        x_lk = lerp(0.44, 0.38, depth_vis) + valgus   # left knee caves right
        x_rk = lerp(0.56, 0.62, depth_vis)
    else:
        x_lk = lerp(0.44, 0.38, depth_vis)
        x_rk = lerp(0.56, 0.62, depth_vis) - valgus   # right knee caves left

    # ── Arms: extend forward for counterbalance ───────────────────────────────
    y_elbow = y_shoulder + 0.14
    y_wrist = y_shoulder + 0.28
    arm_fwd = fwd * 1.2

    # ── Assemble frame (33 landmarks) ─────────────────────────────────────────
    f = [lm(0.5, 0.5, 0.3)] * 33   # default (low visibility)
    f = list(f)

    y_head = y_shoulder - 0.14
    f[NOSE]           = lm(0.50 + fwd * 0.3 - lat, y_head)
    f[LEFT_EAR]       = lm(0.46 + fwd * 0.3 - lat, y_head + 0.01)
    f[RIGHT_EAR]      = lm(0.54 + fwd * 0.3 - lat, y_head + 0.01)
    f[LEFT_SHOULDER]  = lm(x_ls, y_shoulder)
    f[RIGHT_SHOULDER] = lm(x_rs, y_shoulder)
    f[LEFT_ELBOW]     = lm(x_ls - 0.05 + arm_fwd, y_elbow)
    f[RIGHT_ELBOW]    = lm(x_rs + 0.05 + arm_fwd, y_elbow)
    f[LEFT_WRIST]     = lm(x_ls - 0.07 + arm_fwd * 1.5, y_wrist)
    f[RIGHT_WRIST]    = lm(x_rs + 0.07 + arm_fwd * 1.5, y_wrist)
    f[LEFT_HIP]       = lm(0.44 + hip_shift_x, y_left_hip)
    f[RIGHT_HIP]      = lm(0.56 + hip_shift_x, y_right_hip)
    f[LEFT_KNEE]      = lm(x_lk, y_knee)
    f[RIGHT_KNEE]     = lm(x_rk, y_knee)
    f[LEFT_ANKLE]     = lm(0.44, 0.88)
    f[RIGHT_ANKLE]    = lm(0.56, 0.88)
    f[LEFT_HEEL]      = lm(0.43, 0.91)
    f[RIGHT_HEEL]     = lm(0.57, 0.91)

    return f

def standing_frame():
    """All joints in neutral standing position."""
    return build_frame(0.0, {
        "depth_deg": 0, "trunk_flex_peak": 0, "trunk_lean_peak": 0,
        "fppa_peak": 90, "pelvic_drop_peak": 0, "pelvic_shift_peak": 0,
        "side": "left",
    })

# ── Phase helpers ─────────────────────────────────────────────────────────────
def rep_phase(frame_idx, start, bottom, end):
    """Returns t in [0, 1]: 0=standing, 1=full depth."""
    if frame_idx <= start or frame_idx >= end:
        return 0.0
    if frame_idx <= bottom:
        span = max(1, bottom - start)
        return (frame_idx - start) / span
    else:
        span = max(1, end - bottom)
        return (end - frame_idx) / span

# ── CSV writer ────────────────────────────────────────────────────────────────
def write_frames_csv(path, all_frames):
    header = ["t", "mode"]
    for i in range(33):
        header += [f"lm{i}_x", f"lm{i}_y", f"lm{i}_z", f"lm{i}_v"]

    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        for frame_idx, (t_ms, lms) in enumerate(all_frames):
            row = [t_ms, "squat"]
            for lm_data in lms:
                row += [
                    round(lm_data["x"], 5),
                    round(lm_data["y"], 5),
                    0.0,
                    round(lm_data["v"], 3),
                ]
            writer.writerow(row)

# ── Main ──────────────────────────────────────────────────────────────────────
def load_reps(path: str) -> list[dict]:
    """Load reps from either a session JSON file or a reps CSV file."""
    with open(path, encoding="utf-8") as f:
        text = f.read().strip()

    # JSON path
    if text.startswith("{") or text.startswith("["):
        data = json.loads(text)
        raw_reps = data.get("summary", data).get("reps", [])
        reps = []
        for r in raw_reps:
            f = r.get("features", {})
            t = r.get("timing", {})
            reps.append({
                "depth_deg":        f.get("kneeFlexionDeg", 90),
                "trunk_flex_peak":  f.get("trunkFlexPeak",  60),
                "trunk_lean_peak":  f.get("trunkLeanPeak",  5),
                "fppa_peak":        f.get("fppaPeak",       90),
                "pelvic_drop_peak": f.get("pelvicDropPeak", 0),
                "pelvic_shift_peak":f.get("pelvicShiftPeak",0),
                "side":             r.get("side", "left"),
                "start_frame":      t.get("startFrame",  0),
                "bottom_frame":     t.get("bottomFrame", 0),
                "end_frame":        t.get("endFrame",    0),
            })
        return reps

    # CSV path
    import io
    return list(csv.DictReader(io.StringIO(text)))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--reps", required=True, help="Path to session.json or reps.csv")
    parser.add_argument("--out",  default="frames.csv", help="Output frames.csv")
    args = parser.parse_args()

    reps = load_reps(args.reps)

    # Find the total frame range across all reps
    all_frames_out = []
    prev_end = 0
    t_ms = 0
    MS_PER_FRAME = 33   # ~30fps

    for rep in reps:
        start  = int(rep["start_frame"])
        bottom = int(rep["bottom_frame"])
        end    = int(rep["end_frame"])

        # Fill standing frames between reps
        for fi in range(prev_end, start):
            all_frames_out.append((t_ms, standing_frame()))
            t_ms += MS_PER_FRAME

        # Generate frames for this rep
        for fi in range(start, end + 1):
            t_phase = rep_phase(fi, start, bottom, end)
            lms = build_frame(t_phase, rep)
            all_frames_out.append((t_ms, lms))
            t_ms += MS_PER_FRAME

        prev_end = end + 1

    write_frames_csv(args.out, all_frames_out)
    print(f"Written {len(all_frames_out)} frames → {args.out}")
    print(f"Now run:  python tools/render_overlay.py --frames {args.out} --out overlay.mp4")

if __name__ == "__main__":
    main()
