/**
 * LSDT (Lateral Step-Down Test) exercise plugin.
 *
 * The person stands on one leg on a raised surface and lowers their
 * free foot toward the ground in a controlled single-leg squat, then
 * returns to standing. The standing leg is scored.
 *
 * FIELD MAPPING (reuses RepErrors schema for export compatibility):
 *   kneeValgus   ← FPPA > 7°          medial knee collapse
 *   trunkLean    ← trunkLeanPeak > 10° lateral trunk lean
 *   pelvicDrop   ← pelvicDropPeak > 5° Trendelenburg / hip instability
 *   balance      ← swayNorm > 0.04    excessive stance-leg sway
 *   hipAdduction ← swingHeelContactFrames > 3  swing heel loaded (cheating)
 *   kneeOverFoot ← kneeOffsetPeak > 0.15  knee medial to toe
 *   pelvicShift  ← pelvisVertDisplacement < 0.02  insufficient depth / effort
 *   trunkFlex    ← false  (forward flex not scored in LSDT)
 *
 * SCORING:
 *   0–1 errors → good
 *   2–3 errors → fair
 *   ≥4  errors → poor
 */

import { RepFeatureValues, RepErrors } from '../types';
import { computeScore }                from '../errors';
import { ExercisePlugin }              from './plugin';

const LSDT = {
  FPPA_DEG:           7,     // knee valgus
  TRUNK_LEAN_DEG:    10,     // lateral lean
  PELVIC_DROP_DEG:    5,     // Trendelenburg
  SWAY_NORM:          0.04,  // stance stability
  HEEL_TAP_FRAMES:    3,     // frames swing heel near floor = weight transfer
  KNEE_OFFSET_NORM:   0.15,  // knee medial to toe
  MIN_DEPTH_DISP:     0.02,  // min pelvis drop — below this = insufficient effort
} as const;

export const evaluateLSDT: ExercisePlugin = (f: RepFeatureValues) => {
  const errors: RepErrors = {
    kneeValgus:   f.fppaPeak                  > LSDT.FPPA_DEG,
    trunkLean:    f.trunkLeanPeak              > LSDT.TRUNK_LEAN_DEG,
    pelvicDrop:   f.pelvicDropPeak             > LSDT.PELVIC_DROP_DEG,
    balance:      f.swayNorm                  > LSDT.SWAY_NORM,
    hipAdduction: f.swingHeelContactFrames     > LSDT.HEEL_TAP_FRAMES,
    kneeOverFoot: f.kneeOffsetPeak             > LSDT.KNEE_OFFSET_NORM,
    pelvicShift:  f.pelvisVertDisplacement     < LSDT.MIN_DEPTH_DISP,
    trunkFlex:    false,
  };

  return { errors, score: computeScore(errors) };
};
