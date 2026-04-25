/**
 * src/engine/exercise/errors.ts — REP-LEVEL ERROR CLASSIFICATION + SCORING
 *
 * Each error is a single boolean derived by comparing the rep's PEAK feature
 * value to a clinically-motivated threshold. Thresholds live in types.ts so
 * they can be tuned in one place.
 *
 * Scoring is a simple count-of-errors classification:
 *   0–1 errors → "good"
 *   2–3 errors → "fair"
 *   ≥4 errors  → "poor"
 *
 * Why count and not weighted average? Per-error weights were debated and
 * rejected — the project spec section 6.2 says "never average angles for
 * scoring" and the binary count is more interpretable for a clinician.
 */

import {
  RepFeatureValues,
  RepErrors,
  RepScore,
  RepClassification,
  ERROR_THRESHOLDS,
} from './types';

/** computeErrors — boolean per-error from a rep's peak feature values. */
export function computeErrors(features: RepFeatureValues): RepErrors {
  return {
    kneeValgus:    features.fppaPeak           > ERROR_THRESHOLDS.KNEE_VALGUS_FPPA_DEG,
    trunkLean:     features.trunkLeanPeak      > ERROR_THRESHOLDS.TRUNK_LEAN_DEG,
    trunkFlex:     features.trunkFlexPeak      > ERROR_THRESHOLDS.TRUNK_FLEX_DEG,
    pelvicDrop:    features.pelvicDropPeak     > ERROR_THRESHOLDS.PELVIC_DROP_DEG,
    pelvicShift:   features.pelvicShiftPeak    > ERROR_THRESHOLDS.PELVIC_SHIFT_NORM,
    hipAdduction:  features.hipAdductionPeak   > ERROR_THRESHOLDS.HIP_ADDUCTION_DEG,
    kneeOverFoot:  features.kneeOffsetPeak     > ERROR_THRESHOLDS.KNEE_OFFSET_NORM,
    balance:       features.swayNorm           > ERROR_THRESHOLDS.SWAY_NORM,
  };
}

/** computeScore — count true errors and bucket into a classification. */
export function computeScore(errors: RepErrors): RepScore {
  const totalErrors = Object.values(errors).reduce(
    (n, e) => (e ? n + 1 : n),
    0,
  );
  const classification: RepClassification =
    totalErrors <= 1 ? 'good' :
    totalErrors <= 3 ? 'fair' :
                       'poor';
  return { totalErrors, classification };
}
