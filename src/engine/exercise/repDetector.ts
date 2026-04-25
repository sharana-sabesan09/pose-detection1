/**
 * src/engine/exercise/repDetector.ts — POST-HOC REP DETECTION FROM KNEE FLEXION
 *
 * Called once at the end of a recording on the full FrameFeatures buffer.
 *
 * HOW REPS ARE DEFINED:
 *   kneeFlexion is 0° standing, ~60–80° chair squat, ~90–120° deep squat.
 *   A rep is the cycle: stand → squat → stand.
 *
 *   We use knee angle rather than hip Y so that low-amplitude exercises
 *   (e.g. chair-supported single-leg squats) are detected reliably — the hip
 *   barely moves vertically but the knee still flexes meaningfully.
 *
 *     Enter squat: smoothed angle >= DESCENT_TRIGGER_DEG  AND  dAngle > 0
 *     Exit squat:  smoothed angle <= STAND_KNEE_DEG
 *
 *   Minimum peak flexion (MIN_REP_DEPTH_DEG) is enforced in pipeline.ts after
 *   aggregation, not here, so borderline reps still get their features scored.
 */

import { FrameFeatures, REP_THRESHOLDS } from './types';

export interface RepRange {
  startIdx:  number;   // first frame of descent
  bottomIdx: number;   // frame of peak knee flexion
  endIdx:    number;   // frame person returned to standing
}

export const KNEE_DETECT = {
  /** Rolling-mean window (frames) applied before thresholding. */
  SMOOTH_WINDOW: 7,

  /** Minimum frames a squat phase must span to count as a rep. */
  MIN_REP_FRAMES: 8,

  /** Small hysteresis band above stand threshold to avoid flicker near top. */
  STAND_HYSTERESIS_DEG: 3,
} as const;

function rollingMean(arr: number[], window: number): number[] {
  const half = Math.floor(window / 2);
  return arr.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(arr.length, lo + window);
    let s = 0;
    for (let j = lo; j < hi; j++) s += arr[j];
    return s / (hi - lo);
  });
}

export function detectRepRanges(frames: FrameFeatures[]): RepRange[] {
  if (frames.length < 20) return [];

  const smoothed = rollingMean(frames.map(f => f.kneeFlexion), KNEE_DETECT.SMOOTH_WINDOW);
  const standGate = REP_THRESHOLDS.STAND_KNEE_DEG + KNEE_DETECT.STAND_HYSTERESIS_DEG;

  const reps: RepRange[] = [];
  let inSquat   = false;
  let startIdx  = 0;
  let bottomIdx = 0;
  let peakFlex  = 0;

  for (let i = 0; i < smoothed.length; i++) {
    const angle  = smoothed[i];
    const dAngle = i > 0 ? smoothed[i] - smoothed[i - 1] : 0;

    if (!inSquat) {
      // Enter squat: knee must be bending AND already past the trigger threshold.
      if (angle >= REP_THRESHOLDS.DESCENT_TRIGGER_DEG && dAngle > 0) {
        inSquat   = true;
        startIdx  = i;
        bottomIdx = i;
        peakFlex  = angle;
      }
    } else {
      // Track the true peak throughout the whole squat — jitter during descent
      // or a momentary direction reversal no longer ends the rep early.
      if (angle > peakFlex) {
        peakFlex  = angle;
        bottomIdx = i;
      }
      // Rep ends only when the knee has genuinely returned to near-standing.
      if (angle <= standGate) {
        if (i - startIdx >= KNEE_DETECT.MIN_REP_FRAMES) {
          reps.push({ startIdx, bottomIdx, endIdx: i });
        }
        inSquat  = false;
        peakFlex = 0;
      }
    }
  }

  return reps;
}
