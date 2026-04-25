/**
 * src/engine/exercise/repAggregator.ts — PER-REP FEATURE AGGREGATION
 *
 * A small state-machine companion that owns the per-rep buffer of frames
 * and turns it into a finalised RepFeatures at rep end.
 *
 * Lifecycle:
 *   startRep(frame)       — called on the repStart event; resets state
 *   update(frame)         — called on every frame while the rep is in flight
 *   markBottom(frameIdx)  — called on the bottom event; snapshots "at depth"
 *   finalizeRep(window)   — called on repEnd; produces RepFeatures
 *
 * KEY DESIGN POINTS (from the spec):
 *   - Track BOTH peak values AND at-depth values for FPPA. Peaks tell you
 *     "how bad did it ever get during the rep"; at-depth tells you the
 *     specific moment of greatest demand.
 *   - Side is locked at rep start (majority dominantSide of the rep so far,
 *     which on the first frame just means "the start frame's side").
 *   - The aggregator does NOT do detection — that's the state machine's job.
 */

import {
  EXPECTED_ROM_DEG,
  FrameFeatures,
  RepFeatureValues,
  RepFeatures,
  Side,
  WindowStats,
} from './types';
import { computeErrors, computeScore } from './errors';

export class RepAggregator {
  private currentRepFrames: FrameFeatures[] = [];
  private startFrameAbsIdx = 0;
  private bottomFrameAbsIdx = 0;
  private endFrameAbsIdx = 0;
  private startedAtMs = 0;
  private side: Side = 'left';
  private startFrame: FrameFeatures | null = null;
  private bottomFrame: FrameFeatures | null = null;

  /** Called on every absolute frame index regardless of state, for bookkeeping. */
  private absIdx = 0;

  /** Mark the start of a new rep. Resets all per-rep buffers. */
  startRep(frame: FrameFeatures, absoluteFrameIndex: number): void {
    this.currentRepFrames = [frame];
    this.startFrame = frame;
    this.bottomFrame = null;
    this.startFrameAbsIdx = absoluteFrameIndex;
    this.bottomFrameAbsIdx = absoluteFrameIndex;
    this.startedAtMs = frame.timestamp;
    this.side = frame.dominantSide;
    this.absIdx = absoluteFrameIndex;
  }

  /** Append a frame to the current rep. No-op if no rep is in progress. */
  update(frame: FrameFeatures, absoluteFrameIndex: number): void {
    if (this.currentRepFrames.length === 0) return;
    this.currentRepFrames.push(frame);
    this.absIdx = absoluteFrameIndex;
  }

  /** Snapshot the bottom-of-rep frame. */
  markBottom(absoluteFrameIndex: number): void {
    if (this.currentRepFrames.length === 0) return;
    this.bottomFrameAbsIdx = absoluteFrameIndex;
    this.bottomFrame = this.currentRepFrames[this.currentRepFrames.length - 1];
  }

  /**
   * Finalise the rep using the latest window stats (sway / smoothness).
   * Returns null if the rep didn't actually have a bottom (e.g. user
   * stood back up before reaching real depth — caller should discard).
   */
  finalizeRep(windowStats: WindowStats, absoluteFrameIndex: number): RepFeatures | null {
    if (this.currentRepFrames.length === 0 || !this.bottomFrame || !this.startFrame) {
      this.reset();
      return null;
    }

    this.endFrameAbsIdx = absoluteFrameIndex;
    const endFrame = this.currentRepFrames[this.currentRepFrames.length - 1];
    const frames = this.currentRepFrames;

    // ── Peak / extreme values across ALL frames in the rep ──────────────────
    let kneeFlexionDeg   = -Infinity;
    let fppaPeak         = -Infinity;
    let trunkLeanPeak    = -Infinity;
    let trunkFlexPeak    = -Infinity;
    let pelvicDropPeak   = -Infinity;
    let hipAdductionPeak = -Infinity;
    let kneeOffsetPeak   = -Infinity;
    let pelvicShiftPeak  = 0;
    let confSum          = 0;

    const startMidHipX = this.startFrame.midHipX;

    for (const f of frames) {
      if (f.kneeFlexion       > kneeFlexionDeg)   kneeFlexionDeg   = f.kneeFlexion;
      if (f.fppa              > fppaPeak)         fppaPeak         = f.fppa;
      if (f.trunkLean         > trunkLeanPeak)    trunkLeanPeak    = f.trunkLean;
      if (f.trunkFlex         > trunkFlexPeak)    trunkFlexPeak    = f.trunkFlex;
      if (f.pelvicDrop        > pelvicDropPeak)   pelvicDropPeak   = f.pelvicDrop;
      if (f.hipAdduction      > hipAdductionPeak) hipAdductionPeak = f.hipAdduction;
      if (f.kneeOffset        > kneeOffsetPeak)   kneeOffsetPeak   = f.kneeOffset;
      const shift = Math.abs(f.midHipX - startMidHipX);
      if (shift               > pelvicShiftPeak)  pelvicShiftPeak  = shift;
      confSum += f.confidence;
    }

    const features: RepFeatureValues = {
      kneeFlexionDeg,
      romRatio:        kneeFlexionDeg / EXPECTED_ROM_DEG,
      fppaPeak,
      fppaAtDepth:     this.bottomFrame.fppa,
      trunkLeanPeak,
      trunkFlexPeak,
      pelvicDropPeak,
      pelvicShiftPeak,
      hipAdductionPeak,
      kneeOffsetPeak,
      swayNorm:        windowStats.swayNorm,
      smoothness:      windowStats.smoothness,
    };

    const errors = computeErrors(features);
    const score  = computeScore(errors);

    const rep: RepFeatures = {
      repId: 0, // assigned by pipeline after the depth filter passes
      side:  this.side,
      timing: {
        startFrame:  this.startFrameAbsIdx,
        bottomFrame: this.bottomFrameAbsIdx,
        endFrame:    this.endFrameAbsIdx,
        durationMs:  endFrame.timestamp - this.startedAtMs,
      },
      features,
      errors,
      score,
      confidence: frames.length > 0 ? confSum / frames.length : 0,
    };

    this.reset();
    return rep;
  }

  /** Drop the current in-progress rep without producing output. */
  abort(): void {
    this.reset();
  }

  private reset(): void {
    this.currentRepFrames = [];
    this.startFrame = null;
    this.bottomFrame = null;
  }
}
