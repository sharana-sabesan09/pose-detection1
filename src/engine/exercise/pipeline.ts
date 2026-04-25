/**
 * src/engine/exercise/pipeline.ts — EXERCISE PIPELINE
 *
 *   const pipe = new ExercisePipeline('squat');
 *   pipe.onFrame(timestamp, rawLandmarks);   // call per camera frame
 *   ...
 *   const session = pipe.finalize();         // SessionSummary with all reps
 *
 * REP DETECTION IS POST-HOC:
 *   onFrame() only extracts per-frame features and buffers them.
 *   finalize() scans the full hip-Y trajectory to find rep boundaries,
 *   then aggregates features for each detected rep.
 */

import {
  FrameFeatures,
  RawLandmarks,
  REP_THRESHOLDS,
  SessionSummary,
  WindowStats,
} from './types';
import { normalizeLandmarks }     from './normalize';
import { computeFrameFeatures }   from './frameFeatures';
import { updateWindowStats }      from './windowStats';
import { detectRepRanges }        from './repDetector';
import { aggregateRepFromFrames } from './repAggregator';
import { buildSessionSummary }    from './session';

export interface ExercisePipelineOptions {
  bufferMaxFrames?: number;
  windowSize?:      number;
}

export class ExercisePipeline {
  private allFrames:       FrameFeatures[] = [];
  private window:          FrameFeatures[] = [];
  private prevFrame:       FrameFeatures | undefined;
  private lastWindowStats: WindowStats = { swayNorm: 0, smoothness: 0, windowSize: 0 };
  private absFrameIdx = 0;

  private readonly bufferMaxFrames: number;
  private readonly windowSize:      number;

  constructor(
    private exerciseName: string = 'squat',
    options: ExercisePipelineOptions = {},
  ) {
    this.bufferMaxFrames = options.bufferMaxFrames ?? 90;
    this.windowSize      = options.windowSize      ?? 30;
  }

  /**
   * onFrame — extract per-frame features and buffer them.
   * Always returns null; reps are only available after finalize().
   */
  onFrame(timestamp: number, raw: RawLandmarks): null {
    const norm  = normalizeLandmarks(raw);
    const frame = computeFrameFeatures(timestamp, raw, norm, this.prevFrame);

    this.allFrames.push(frame);

    this.window.push(frame);
    if (this.window.length > this.bufferMaxFrames) {
      this.window.splice(0, this.window.length - this.bufferMaxFrames);
    }
    this.lastWindowStats = updateWindowStats(this.window, this.windowSize);

    this.prevFrame = frame;
    this.absFrameIdx++;
    return null;
  }

  /**
   * finalize — detect reps from the full hip-Y trajectory, aggregate
   * features per rep, and return the session summary.
   */
  finalize(): SessionSummary {
    const ranges = detectRepRanges(this.allFrames);

    const reps = ranges
      .map((range, i) => {
        const slice = this.allFrames.slice(range.startIdx, range.endIdx + 1);
        return aggregateRepFromFrames(slice, i + 1, range);
      })
      .filter((r): r is NonNullable<typeof r> =>
        r !== null && r.features.kneeFlexionDeg >= REP_THRESHOLDS.MIN_REP_DEPTH_DEG,
      )
      .map((r, i) => ({ ...r, repId: i + 1 }));

    return buildSessionSummary(this.exerciseName, reps);
  }

  getLastWindowStats(): WindowStats    { return this.lastWindowStats; }
  getFrameBuffer():    FrameFeatures[] { return this.allFrames.slice(); }
}
