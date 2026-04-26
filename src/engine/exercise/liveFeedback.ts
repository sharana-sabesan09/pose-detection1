/**
 * src/engine/exercise/liveFeedback.ts
 *
 * Computes approximate errors from the last N frames WITHOUT needing a
 * full rep-detection pass. Used for the 10-second TTS feedback loop.
 *
 * We take the peak of each metric over the window (same logic as the rep
 * aggregator) and apply the same thresholds. This gives a "worst-case in
 * the last window" picture — useful for real-time coaching because it
 * surfaces problems even if a complete rep hasn't finished yet.
 */

import { FrameFeatures, ERROR_THRESHOLDS, RepErrors } from './types';
import { fetchTtsSpeak } from '../backendClient';

const WINDOW_FRAMES = 60;  // ~2–6 seconds depending on fps

/** Compute live errors from the last N frames. */
export function computeLiveErrors(buffer: FrameFeatures[]): RepErrors {
  const window = buffer.slice(-WINDOW_FRAMES);
  if (window.length === 0) {
    return {
      kneeValgus: false, trunkLean: false, trunkFlex: false,
      pelvicDrop: false, pelvicShift: false, hipAdduction: false,
      kneeOverFoot: false, balance: false,
    };
  }

  let fppaPeak         = 0;
  let trunkLeanPeak    = 0;
  let trunkFlexPeak    = 0;
  let pelvicDropPeak   = 0;
  let hipAdductionPeak = 0;
  let kneeOffsetPeak   = 0;

  const hipXs: number[] = [];

  for (const f of window) {
    if (f.fppa         > fppaPeak)         fppaPeak         = f.fppa;
    if (f.trunkLean    > trunkLeanPeak)    trunkLeanPeak    = f.trunkLean;
    if (f.trunkFlex    > trunkFlexPeak)    trunkFlexPeak    = f.trunkFlex;
    if (f.pelvicDrop   > pelvicDropPeak)   pelvicDropPeak   = f.pelvicDrop;
    if (f.hipAdduction > hipAdductionPeak) hipAdductionPeak = f.hipAdduction;
    if (f.kneeOffset   > kneeOffsetPeak)   kneeOffsetPeak   = f.kneeOffset;
    hipXs.push(f.midHipX);
  }

  const meanX  = hipXs.reduce((s, v) => s + v, 0) / hipXs.length;
  const swayNorm = Math.sqrt(hipXs.reduce((s, v) => s + (v - meanX) ** 2, 0) / hipXs.length);

  return {
    kneeValgus:   fppaPeak         > ERROR_THRESHOLDS.KNEE_VALGUS_FPPA_DEG,
    trunkLean:    trunkLeanPeak     > ERROR_THRESHOLDS.TRUNK_LEAN_DEG,
    trunkFlex:    trunkFlexPeak     > ERROR_THRESHOLDS.TRUNK_FLEX_DEG,
    pelvicDrop:   pelvicDropPeak    > ERROR_THRESHOLDS.PELVIC_DROP_DEG,
    pelvicShift:  false,
    hipAdduction: hipAdductionPeak  > ERROR_THRESHOLDS.HIP_ADDUCTION_DEG,
    kneeOverFoot: kneeOffsetPeak    > ERROR_THRESHOLDS.KNEE_OFFSET_NORM,
    balance:      swayNorm          > ERROR_THRESHOLDS.SWAY_NORM,
  };
}

/** Fetch TTS audio from the backend and return base64-encoded MP3. */
export async function fetchTTSAudio(text: string): Promise<string | null> {
  return fetchTtsSpeak(text);
}
