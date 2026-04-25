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

export const HIP_DETECT = {
  /** Rolling-mean window (frames) applied before thresholding. */
  SMOOTH_WINDOW: 7,

  /** Minimum frames a squat phase must span to count as a rep. */
  MIN_REP_FRAMES: 8,
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

  const smoothed = rollingMean(frames.map(f => f.kneeFlexion), HIP_DETECT.SMOOTH_WINDOW);

  const reps: RepRange[] = [];
  let inSquat   = false;
  let startIdx  = 0;
  let bottomIdx = 0;
  let peakFlex  = 0;

  for (let i = 0; i < smoothed.length; i++) {
    const angle  = smoothed[i];
    const dAngle = i > 0 ? smoothed[i] - smoothed[i - 1] : 0;

    if (!inSquat) {
      if (angle >= REP_THRESHOLDS.DESCENT_TRIGGER_DEG && dAngle > 0) {
        inSquat   = true;
        startIdx  = i;
        bottomIdx = i;
        peakFlex  = angle;
      }
    } else {
      if (angle > peakFlex) { peakFlex = angle; bottomIdx = i; }

      if (angle <= REP_THRESHOLDS.STAND_KNEE_DEG) {
        if (i - startIdx >= HIP_DETECT.MIN_REP_FRAMES) {
          reps.push({ startIdx, bottomIdx, endIdx: i });
        }
        inSquat  = false;
        peakFlex = 0;
      }
    }
  }

  return reps;
}
