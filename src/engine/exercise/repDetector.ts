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

// ─────────────────────────────────────────────────────────────────────────────
// Step-down detector — uses the floating-foot trajectory.
//
// In a step-down, the working leg stands on the platform; the floating foot
// (the OPPOSITE side) reaches down toward the floor and back up. The hip
// barely moves and the working knee flexes only modestly, so neither of the
// other detectors fire reliably. Instead we watch swingHeelY directly.
//
// Larger swingHeelY = lower on screen = floor-bound. So a rep is:
//   foot up (baseline) → foot down (peak swingHeelY) → foot back up (baseline)
//
// We use a slow-EMA standing baseline + a small fixed amplitude trigger,
// because the foot's vertical travel is small relative to a deep squat.
// ─────────────────────────────────────────────────────────────────────────────

export const STEPDOWN_DETECT = {
  /** Slow EMA on the "foot up" reference. Only updates when not in descent. */
  BASELINE_ALPHA: 0.02,
  /** Trigger when the foot has dropped this far below baseline (screen-fraction). */
  AMP_THRESH: 0.025,
  /** Rolling-mean window applied to swingHeelY before thresholding. */
  SMOOTH_WINDOW: 7,
  /** Rep-end gate: must return to within this fraction of AMP_THRESH of baseline. */
  RETURN_FRACTION: 0.4,
  /** Minimum frames between rep start and end. */
  MIN_REP_FRAMES: 8,
} as const;

export function detectStepDownRepRanges(frames: FrameFeatures[]): RepRange[] {
  if (frames.length < 20) return [];

  const smoothed = rollingMean(
    frames.map(f => f.swingHeelY),
    STEPDOWN_DETECT.SMOOTH_WINDOW,
  );
  // Skip leading zeros (frames before the swing heel was visible).
  let firstValidIdx = 0;
  while (firstValidIdx < smoothed.length && smoothed[firstValidIdx] <= 0) firstValidIdx++;
  if (firstValidIdx >= smoothed.length - 10) return [];

  let baseline = smoothed[firstValidIdx];

  const reps: RepRange[] = [];
  let inDescent = false;
  let startIdx  = 0;
  let bottomIdx = 0;
  let bottomY   = -Infinity;

  const returnGate = STEPDOWN_DETECT.AMP_THRESH * STEPDOWN_DETECT.RETURN_FRACTION;

  for (let i = firstValidIdx; i < smoothed.length; i++) {
    const y  = smoothed[i];
    if (y <= 0) continue;
    const dy = i > 0 ? smoothed[i] - smoothed[i - 1] : 0;

    if (!inDescent) {
      // Baseline tracks the foot's standing height (only while NOT descending).
      baseline = baseline * (1 - STEPDOWN_DETECT.BASELINE_ALPHA) + y * STEPDOWN_DETECT.BASELINE_ALPHA;

      // Enter descent: foot has dropped past the amplitude threshold.
      if (y - baseline >= STEPDOWN_DETECT.AMP_THRESH && dy > 0) {
        inDescent = true;
        startIdx  = i;
        bottomIdx = i;
        bottomY   = y;
      }
    } else {
      if (y > bottomY) { bottomY = y; bottomIdx = i; }

      // Rep ends when the foot has lifted back close to baseline.
      // Use (y - baseline): while descended y > baseline, so this difference
      // shrinks as the foot rises. dy < 0 confirms we're rising, not stalled.
      if (y - baseline <= returnGate && dy < 0) {
        if (i - startIdx >= STEPDOWN_DETECT.MIN_REP_FRAMES) {
          reps.push({ startIdx, bottomIdx, endIdx: i });
        }
        inDescent = false;
        bottomY   = -Infinity;
      }
    }
  }

  return reps;
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy hip-Y detector (kept as fallback). Identical to the original
// detectRepRanges before we switched to knee flexion. Useful when the
// floating-foot signal is unreliable but hip drop is still meaningful.
// ─────────────────────────────────────────────────────────────────────────────

export const HIP_DETECT_LEGACY = {
  BASELINE_ALPHA: 0.02,
  AMP_THRESH:     0.06,
  SMOOTH_WINDOW:  7,
  MIN_REP_FRAMES: 8,
} as const;

export function detectRepRangesByHip(frames: FrameFeatures[]): RepRange[] {
  if (frames.length < 20) return [];

  const smoothed = rollingMean(frames.map(f => f.midHipY), HIP_DETECT_LEGACY.SMOOTH_WINDOW);
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
      baseline = baseline * (1 - HIP_DETECT_LEGACY.BASELINE_ALPHA) + y * HIP_DETECT_LEGACY.BASELINE_ALPHA;
      if (y - baseline >= HIP_DETECT_LEGACY.AMP_THRESH) {
        inSquat = true; startIdx = i; bottomIdx = i; bottomY = y;
      }
    } else {
      if (y > bottomY) { bottomY = y; bottomIdx = i; }
      if (y - baseline <= HIP_DETECT_LEGACY.AMP_THRESH * 0.3 && dy < 0) {
        if (i - startIdx >= HIP_DETECT_LEGACY.MIN_REP_FRAMES) {
          reps.push({ startIdx, bottomIdx, endIdx: i });
        }
        inSquat = false; bottomY = -Infinity;
      }
    }
  }
  return reps;
}

// ─────────────────────────────────────────────────────────────────────────────
// Knee-flexion rep detector (default for SLS).
// ─────────────────────────────────────────────────────────────────────────────

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
