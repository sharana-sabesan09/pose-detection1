/**
 * src/engine/exercise/repAggregator.ts — PER-REP FEATURE AGGREGATION (POST-HOC)
 *
 * Pure function — no class, no lifecycle methods.
 * Receives a slice of FrameFeatures already bounded by detectRepRanges
 * and returns one finalised RepFeatures.
 */

import {
  EXPECTED_ROM_DEG,
  FrameFeatures,
  RepFeatureValues,
  RepFeatures,
  Side,
} from './types';
import { computeErrors, computeScore } from './errors';
import { updateWindowStats }           from './windowStats';
import { RepRange }                    from './repDetector';

export function aggregateRepFromFrames(
  frames: FrameFeatures[],
  repId:  number,
  range:  RepRange,
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
  let confSum          = 0;

  const startMidHipX = startFrame.midHipX;

  for (const f of frames) {
    if (f.kneeFlexion  > kneeFlexionDeg)   kneeFlexionDeg   = f.kneeFlexion;
    if (f.fppa         > fppaPeak)         fppaPeak         = f.fppa;
    if (f.trunkLean    > trunkLeanPeak)    trunkLeanPeak    = f.trunkLean;
    if (f.trunkFlex    > trunkFlexPeak)    trunkFlexPeak    = f.trunkFlex;
    if (f.pelvicDrop   > pelvicDropPeak)   pelvicDropPeak   = f.pelvicDrop;
    if (f.hipAdduction > hipAdductionPeak) hipAdductionPeak = f.hipAdduction;
    if (f.kneeOffset   > kneeOffsetPeak)   kneeOffsetPeak   = f.kneeOffset;
    const shift = Math.abs(f.midHipX - startMidHipX);
    if (shift          > pelvicShiftPeak)  pelvicShiftPeak  = shift;
    confSum += f.confidence;
  }

  const ws = updateWindowStats(frames, frames.length);

  const features: RepFeatureValues = {
    kneeFlexionDeg,
    romRatio:         kneeFlexionDeg / EXPECTED_ROM_DEG,
    fppaPeak,
    fppaAtDepth:      bottomFrame.fppa,
    trunkLeanPeak,
    trunkFlexPeak,
    pelvicDropPeak,
    pelvicShiftPeak,
    hipAdductionPeak,
    kneeOffsetPeak,
    swayNorm:         ws.swayNorm,
    smoothness:       ws.smoothness,
  };

  const errors = computeErrors(features);

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
    score:      computeScore(errors),
    confidence: confSum / frames.length,
  };
}
