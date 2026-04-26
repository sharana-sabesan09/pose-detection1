# SLS Raw Features and Error Flags (`session.json`)

This document explains, in practical clinical terms, what each SLS (Single Leg Squat) rep feature means and how error flags are computed in `session.json`.

## Where this data comes from

For each detected rep, the pipeline:

1. Computes per-frame geometry from pose landmarks (angles/distances).
2. Aggregates those frame values into rep-level features (mostly peaks).
3. Applies fixed thresholds to create boolean error flags.

In the final rep object:
- `features` = measured numbers for that rep
- `errors` = rule checks (`true` / `false`) derived from `features`
- `score.totalErrors` = count of `true` error flags
- `score.classification` = `good` (0-1), `fair` (2-3), `poor` (4+)

---

## Raw rep features (what they mean clinically)

These are the values under `summary.reps[i].features` in `session.json`.

- `kneeFlexionDeg`
  - Peak knee bend angle during the rep.
  - Higher means deeper squat.

- `romRatio`
  - Depth normalized to expected ROM (`kneeFlexionDeg / 135`).
  - `1.0` means roughly expected full depth, `< 1.0` is shallower.

- `fppaPeak`
  - Peak frontal-plane knee bend/deviation proxy.
  - Higher values indicate more knee collapse pattern risk.

- `fppaAtDepth`
  - FPPA value at the bottom of the rep.
  - Useful to inspect alignment specifically at deepest position.

- `trunkLeanPeak`
  - Largest side-to-side trunk lean from vertical.
  - Higher means more lateral trunk compensation.

- `trunkFlexPeak`
  - Largest forward trunk flex from vertical.
  - Higher means more forward torso pitch.

- `pelvicDropPeak`
  - Largest left-right pelvis tilt (Trendelenburg-like drop).
  - Higher means more pelvic asymmetry.

- `pelvicShiftPeak`
  - Maximum lateral translation of pelvis from rep start.
  - Higher means more side drift during the rep.

- `hipAdductionPeak`
  - Peak inward thigh angle toward midline.
  - Higher means more dynamic valgus-chain tendency.

- `kneeOffsetPeak`
  - Largest horizontal distance between knee and foot marker.
  - Captures knee-over-toe or medial/lateral knee drift depending on view.

- `swayNorm`
  - Within-rep side-to-side hip sway metric (standard deviation).
  - Higher means poorer balance stability.

- `smoothness`
  - Variability of knee angular velocity.
  - Higher usually means jerkier/less smooth movement.

- `pelvisVertDisplacement`
  - Vertical drop of pelvis midpoint from start to deepest part.
  - Larger value means more descent depth in screen space.

- `swingHeelContactFrames`
  - Count of frames where the non-stance heel appears near floor.
  - Higher can indicate tapping/assistance by swing leg.

Note: not every feature currently maps to an `errors` flag. Error logic uses a selected subset (below).

---

## How each error flag is calculated

Error flags are computed by comparing rep features against fixed thresholds.  
Rule: value `>` threshold => error is `true`; otherwise `false`.

### Error rules used today

- `kneeValgus`
  - `true` if `fppaPeak > 7` deg
  - `false` if `fppaPeak <= 7` deg

- `trunkLean`
  - `true` if `trunkLeanPeak > 10` deg
  - `false` if `trunkLeanPeak <= 10` deg

- `trunkFlex`
  - `true` if `trunkFlexPeak > 45` deg
  - `false` if `trunkFlexPeak <= 45` deg

- `pelvicDrop`
  - `true` if `pelvicDropPeak > 5` deg
  - `false` if `pelvicDropPeak <= 5` deg

- `pelvicShift`
  - `true` if `pelvicShiftPeak > 0.10` (normalized units)
  - `false` if `pelvicShiftPeak <= 0.10`

- `hipAdduction`
  - `true` if `hipAdductionPeak > 10` deg
  - `false` if `hipAdductionPeak <= 10` deg

- `kneeOverFoot`
  - `true` if `kneeOffsetPeak > 0.20` (normalized units)
  - `false` if `kneeOffsetPeak <= 0.20`

- `balance`
  - `true` if `swayNorm > 0.05` (normalized sway)
  - `false` if `swayNorm <= 0.05`

---

## What `TRUE` vs `FALSE` means for a patient

For any individual error key:

- `TRUE`
  - The patient crossed the preset threshold at least once during that rep.
  - Interpret as: "this movement pattern likely needs attention/coaching."
  - It does **not** mean diagnosis by itself; it is a screening flag.

- `FALSE`
  - The patient stayed within the preset threshold for that metric in that rep.
  - Interpret as: "no threshold breach detected for this specific pattern."
  - It does **not** mean perfect movement overall, only no breach on that rule.

Clinical interpretation is strongest across multiple reps and combined with context (injury side, symptoms, camera quality, and therapist judgment).

---

## Confidence and quality caveat

- `confidence` (per rep) is separate from `errors`.
- It reflects visibility quality of tracked landmarks (0-1).
- Low confidence means error flags may be less reliable and should be interpreted cautiously.

