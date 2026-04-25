/**
 * src/engine/exercise/pipeline.ts — REAL-TIME EXERCISE PIPELINE
 *
 * One class to wire everything together. You instantiate it once per
 * recording session, feed it raw landmarks for each frame, and pull off
 * the finalised RepFeatures whenever a rep ends.
 *
 *   const pipe = new ExercisePipeline('squat');
 *   pipe.onFrame(timestamp, rawLandmarks);
 *   ...
 *   const session = pipe.finalize();   // SessionSummary
 *
 * STATELESSNESS NOTE:
 *   Every helper in this folder is pure or carries its own state. The
 *   pipeline only stitches them together — that's deliberate so each
 *   layer remains independently testable.
 */

import {
  FrameFeatures,
  RawLandmarks,
  RepFeatures,
  REP_THRESHOLDS,
  RepState,
  SessionSummary,
  WindowStats,
} from './types';
import { normalizeLandmarks } from './normalize';
import { computeFrameFeatures } from './frameFeatures';
import { updateWindowStats } from './windowStats';
import { updateRepState } from './repDetector';
import { RepAggregator } from './repAggregator';
import { buildSessionSummary } from './session';

const DEFAULT_BUFFER_MAX = 90;     // frames kept for window stats (~3s @ 30fps)
const DEFAULT_WINDOW_SIZE = 30;    // frames used by updateWindowStats (~1s)

export interface ExercisePipelineOptions {
  /** Max frames retained in the per-frame buffer for window stats. */
  bufferMaxFrames?: number;
  /** Size of the rolling stats window (must be ≤ bufferMaxFrames). */
  windowSize?: number;
}

export class ExercisePipeline {
  private buffer: FrameFeatures[] = [];
  private allFrames: FrameFeatures[] = [];
  private prevFrame: FrameFeatures | undefined;
  private state: RepState = 'IDLE';
  private aggregator = new RepAggregator();
  private reps: RepFeatures[] = [];
  private absFrameIdx = 0;
  private lastWindowStats: WindowStats = { swayNorm: 0, smoothness: 0, windowSize: 0 };

  private bufferMaxFrames: number;
  private windowSize: number;

  constructor(
    private exerciseName: string = 'squat',
    options: ExercisePipelineOptions = {},
  ) {
    this.bufferMaxFrames = options.bufferMaxFrames ?? DEFAULT_BUFFER_MAX;
    this.windowSize      = options.windowSize      ?? DEFAULT_WINDOW_SIZE;
  }

  /**
   * onFrame — feed one camera frame through the full pipeline.
   * Returns the rep that just finished, if any (so callers can write to CSV
   * immediately on rep end). Returns null on every other frame.
   */
  onFrame(timestamp: number, raw: RawLandmarks): RepFeatures | null {
    // 1. Normalise landmarks
    const norm = normalizeLandmarks(raw);

    // 2. Per-frame features (uses prev for velocity)
    const frame = computeFrameFeatures(timestamp, raw, norm, this.prevFrame);

    // 3. Buffer + window stats
    this.allFrames.push(frame);
    this.buffer.push(frame);
    if (this.buffer.length > this.bufferMaxFrames) {
      this.buffer.splice(0, this.buffer.length - this.bufferMaxFrames);
    }
    this.lastWindowStats = updateWindowStats(this.buffer, this.windowSize);

    // 4. State machine
    const { state: nextState, events } = updateRepState(frame, this.prevFrame, this.state);

    // 5. Aggregator lifecycle
    if (events.repStart) {
      this.aggregator.startRep(frame, this.absFrameIdx);
    }
    if (this.state !== 'IDLE' || nextState !== 'IDLE') {
      this.aggregator.update(frame, this.absFrameIdx);
    }
    if (events.bottom) {
      this.aggregator.markBottom(this.absFrameIdx);
    }

    let finishedRep: RepFeatures | null = null;
    if (events.repEnd) {
      const rep = this.aggregator.finalizeRep(this.lastWindowStats, this.absFrameIdx);
      // Reject reps that never reached real depth.
      // ID is assigned HERE (not inside the aggregator) so only reps that
      // pass this gate get an ID — no gaps from rejected shallow reps.
      if (rep && rep.features.kneeFlexionDeg >= REP_THRESHOLDS.MIN_REP_DEPTH_DEG) {
        rep.repId = this.reps.length + 1;
        this.reps.push(rep);
        finishedRep = rep;
      }
    }

    // 6. Advance state
    this.state = nextState;
    this.prevFrame = frame;
    this.absFrameIdx++;

    return finishedRep;
  }

  /** Complete the session, returning everything detected so far. */
  finalize(): SessionSummary {
    return buildSessionSummary(this.exerciseName, this.reps);
  }

  /** Inspectors (mostly for tests / debug overlays). */
  getState(): RepState { return this.state; }
  getReps():  RepFeatures[] { return this.reps.slice(); }
  getLastWindowStats(): WindowStats { return this.lastWindowStats; }
  getFrameBuffer(): FrameFeatures[] { return this.buffer.slice(); }
  getAllFrames(): FrameFeatures[] { return this.allFrames.slice(); }
}
