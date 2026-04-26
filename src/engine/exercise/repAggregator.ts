/**
 * src/engine/exercise/repAggregator.ts — PER-REP FEATURE AGGREGATION (POST-HOC)
 *
 * Pure function. Receives a frame slice bounded by detectRepRanges and an
 * exercise plugin, and returns one finalised RepFeatures.
 *
 * The plugin decides errors + score — no exercise-specific logic lives here.
 */

import {
  EXPECTED_ROM_DEG,
  FrameFeatures,
  RepFeatureValues,
  RepFeatures,
  Side,
} from './types';
import { updateWindowStats }    from './windowStats';
import { RepRange }             from './repDetector';
import { ExercisePlugin }       from './exercises/plugin';

export function aggregateRepFromFrames(
  frames:  FrameFeatures[],
  repId:   number,
  range:   RepRange,
  plugin:  ExercisePlugin,
): RepFeatures | null {
  if (frames.length < 3) return null;

  const startFrame   = frames[0];
  const endFrame     = frames[frames.length - 1];
  const bottomRelIdx = Math.min(range.bottomIdx - range.startIdx, frames.length - 1);
  const bottomFrame  = frames[bottomRelIdx];

  // Side: majority vote across all frames in the rep.
  const leftCount = frames.filter(f => f.dominantSide === 'left').length;
  const side: Side = leftCount >= frames.length / 2 ? 'left' : 'right';

  let kneeFlexionDeg   = -Infinity;
  let fppaPeak         = -Infinity;
  let trunkLeanPeak    = -Infinity;
  let trunkFlexPeak    = -Infinity;
  let pelvicDropPeak   = -Infinity;
  let hipAdductionPeak = -Infinity;
  let kneeOffsetPeak   = -Infinity;
  let pelvicShiftPeak  = 0;
  let maxMidHipY       = -Infinity;
  let confSum          = 0;

  const startMidHipX  = startFrame.midHipX;
  const TAP_THRESHOLD = 0.05; // screen-fraction drop from start = heel near floor
  let swingHeelContactFrames = 0;

  for (const f of frames) {
    if (f.kneeFlexion  > kneeFlexionDeg)   kneeFlexionDeg   = f.kneeFlexion;
    if (f.fppa         > fppaPeak)         fppaPeak         = f.fppa;
    if (f.trunkLean    > trunkLeanPeak)    trunkLeanPeak    = f.trunkLean;
    if (f.trunkFlex    > trunkFlexPeak)    trunkFlexPeak    = f.trunkFlex;
    if (f.pelvicDrop   > pelvicDropPeak)   pelvicDropPeak   = f.pelvicDrop;
    if (f.hipAdduction > hipAdductionPeak) hipAdductionPeak = f.hipAdduction;
    if (f.kneeOffset   > kneeOffsetPeak)   kneeOffsetPeak   = f.kneeOffset;
    if (f.midHipY      > maxMidHipY)       maxMidHipY       = f.midHipY;
    const shift = Math.abs(f.midHipX - startMidHipX);
    if (shift          > pelvicShiftPeak)  pelvicShiftPeak  = shift;

    // Swing heel approaching the floor (high swingHeelY = lower on screen).
    // Compare against the starting swing heel Y — if it drops significantly, count it.
    if (f.swingHeelY > 0 && f.swingHeelY >= (startFrame.swingHeelY + TAP_THRESHOLD)) {
      swingHeelContactFrames++;
    }

    confSum += f.confidence;
  }

  const ws = updateWindowStats(frames, frames.length);

  const features: RepFeatureValues = {
    kneeFlexionDeg,
    romRatio:               kneeFlexionDeg / EXPECTED_ROM_DEG,
    fppaPeak,
    fppaAtDepth:            bottomFrame.fppa,
    trunkLeanPeak,
    trunkFlexPeak,
    pelvicDropPeak,
    pelvicShiftPeak,
    hipAdductionPeak,
    kneeOffsetPeak,
    swayNorm:               ws.swayNorm,
    smoothness:             ws.smoothness,
    pelvisVertDisplacement: Math.max(0, maxMidHipY - startFrame.midHipY),
    swingHeelContactFrames,
  };

  const { errors, score } = plugin(features);

  return {
    repId,
    side,
    timing: {
      startFrame:  range.startIdx,
      bottomFrame: range.bottomIdx,
      endFrame:    range.endIdx,
      durationMs:  endFrame.timestamp - startFrame.timestamp,
    },
    features,
    errors,
    score,
    confidence: confSum / frames.length,
  };
}
