/**
 * src/engine/exercise/repDetector.ts — POST-HOC REP DETECTION FROM HIP Y TRAJECTORY
 *
 * Called once at the end of a recording on the full FrameFeatures buffer.
 *
 * HOW REPS ARE DEFINED:
 *   midHipY increases as the person descends (screen-y grows downward).
 *   A rep is the cycle: stand → squat → stand.
 *
 *   Instead of computing a global min/max range, we track a rolling baseline
 *   (where "standing" is right now) and trigger on amplitude relative to it:
 *
 *     Enter squat: y - baseline >= AMP_THRESH  AND  dy > 0  (descending)
 *     Exit squat:  baseline - y <= AMP_THRESH * 0.3  AND  dy < 0  (ascending back)
 *
 *   Baseline updates only while standing, so it adapts to camera drift or the
 *   person shifting height without being poisoned by squat frames.
 */

import { FrameFeatures } from './types';

export interface RepRange {
  startIdx:  number;   // first frame of descent
  bottomIdx: number;   // frame of peak hip descent
  endIdx:    number;   // frame person returned to standing
}

export const HIP_DETECT = {
  /** Exponential smoothing factor for the standing baseline. Small = slow adapt. */
  BASELINE_ALPHA: 0.02,

  /** Minimum hip descent relative to baseline to trigger a squat (screen-fraction). */
  AMP_THRESH: 0.01,

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

  const smoothed = rollingMean(frames.map(f => f.midHipY), HIP_DETECT.SMOOTH_WINDOW);

  let baseline = smoothed[0];
  const reps: RepRange[] = [];
  let inSquat   = false;
  let startIdx  = 0;
  let bottomIdx = 0;
  let bottomY   = -Infinity;

  for (let i = 0; i < smoothed.length; i++) {
    const y  = smoothed[i];
    const dy = i > 0 ? smoothed[i] - smoothed[i - 1] : 0;

    if (!inSquat) {
      // Baseline only updates while standing.
      baseline = baseline * (1 - HIP_DETECT.BASELINE_ALPHA) + y * HIP_DETECT.BASELINE_ALPHA;

      // Enter squat: hip has descended past the amplitude threshold.
      // dy > 0 guard is omitted — with a slow-tracking baseline, the amplitude
      // threshold is only reached near the squat depth, not on trivial movements.
      if (y - baseline >= HIP_DETECT.AMP_THRESH) {
        inSquat   = true;
        startIdx  = i;
        bottomIdx = i;
        bottomY   = y;
      }
    } else {
      // Track deepest frame.
      if (y > bottomY) { bottomY = y; bottomIdx = i; }

      // Exit squat: hip has returned to within 30% of AMP_THRESH above baseline.
      // Using (y - baseline) not (baseline - y): when squatting y > baseline, so
      // (baseline - y) is negative and would always satisfy <= threshold.
      if (y - baseline <= HIP_DETECT.AMP_THRESH * 0.3 && dy < 0) {
        if (i - startIdx >= HIP_DETECT.MIN_REP_FRAMES) {
          reps.push({ startIdx, bottomIdx, endIdx: i });
        }
        inSquat = false;
        bottomY = -Infinity;
      }
    }
  }

  return reps;
}
