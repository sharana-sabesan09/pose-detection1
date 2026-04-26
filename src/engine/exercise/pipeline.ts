/**
 * src/engine/exercise/pipeline.ts — EXERCISE PIPELINE
 *
 *   const pipe = new ExercisePipeline('rightSls');
 *   pipe.onFrame(timestamp, rawLandmarks);   // call per camera frame
 *   ...
 *   const session = pipe.finalize();         // SessionSummary
 *
 * REP DETECTION IS POST-HOC:
 *   onFrame() only extracts per-frame features and buffers them.
 *   finalize() runs the right detector for the current ExerciseType, then
 *   aggregates per-rep features.
 *
 * ROUTING BY ExerciseType:
 *   leftSls  / rightSls  → knee-flexion detector + SLS plugin
 *   leftLsd  / rightLsd  → floating-foot detector + LSDT plugin
 *   walking              → no rep detection; runs the walking aggregator
 *
 * The working leg's side is intrinsic to the ExerciseType, so we pass it
 * to computeFrameFeatures via forceSide instead of letting the per-frame
 * heuristic guess.
 */

import {
  ExerciseType,
  FrameFeatures,
  RawLandmarks,
  REP_THRESHOLDS,
  SessionSummary,
  Side,
  WindowStats,
} from './types';
import { normalizeLandmarks }     from './normalize';
import { computeFrameFeatures }   from './frameFeatures';
import { updateWindowStats }      from './windowStats';
import {
  detectRepRanges,
  detectStepDownRepRanges,
  RepRange,
}                                 from './repDetector';
import { aggregateRepFromFrames } from './repAggregator';
import { buildSessionSummary }    from './session';
import { ExercisePlugin }         from './exercises/plugin';
import { evaluateSLS }            from './exercises/sls';
import { evaluateLSDT }           from './exercises/lsdt';
import { buildWalkingSummary }    from './exercises/walking';

export interface ExercisePipelineOptions {
  bufferMaxFrames?: number;
  windowSize?:      number;
}

interface RouteConfig {
  side:     Side | null;                                    // null only for walking
  detect:   ((frames: FrameFeatures[]) => RepRange[]) | null; // null for walking
  plugin:   ExercisePlugin | null;                          // null for walking
}

function routeFor(exercise: ExerciseType): RouteConfig {
  switch (exercise) {
    case 'leftSls':  return { side: 'left',  detect: detectRepRanges,         plugin: evaluateSLS  };
    case 'rightSls': return { side: 'right', detect: detectRepRanges,         plugin: evaluateSLS  };
    case 'leftLsd':  return { side: 'left',  detect: detectStepDownRepRanges, plugin: evaluateLSDT };
    case 'rightLsd': return { side: 'right', detect: detectStepDownRepRanges, plugin: evaluateLSDT };
    case 'walking':  return { side: null,    detect: null,                    plugin: null         };
  }
}

export class ExercisePipeline {
  private allFrames:       FrameFeatures[] = [];
  private window:          FrameFeatures[] = [];
  private prevFrame:       FrameFeatures | undefined;
  private lastWindowStats: WindowStats = { swayNorm: 0, smoothness: 0, windowSize: 0 };
  private absFrameIdx = 0;

  private readonly bufferMaxFrames: number;
  private readonly windowSize:      number;
  private readonly route:           RouteConfig;

  constructor(
    private exerciseType: ExerciseType,
    options: ExercisePipelineOptions = {},
  ) {
    this.bufferMaxFrames = options.bufferMaxFrames ?? 90;
    this.windowSize      = options.windowSize      ?? 30;
    this.route           = routeFor(exerciseType);
  }

  /**
   * onFrame — extract per-frame features and buffer them.
   * Always returns null; reps are only available after finalize().
   */
  onFrame(timestamp: number, raw: RawLandmarks): null {
    const norm  = normalizeLandmarks(raw);
    // For rep-based exercises, lock the dominant side to the ExerciseType's
    // working leg. Walking has no working leg, so we let the heuristic decide.
    const forceSide = this.route.side ?? undefined;
    const frame = computeFrameFeatures(timestamp, raw, norm, this.prevFrame, forceSide);

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
   * finalize — run the appropriate detector + aggregator and return the
   * session summary. For walking, skip rep detection and run the
   * walking-specific aggregator instead.
   */
  finalize(): SessionSummary {
    if (this.exerciseType === 'walking') {
      return buildWalkingSummary(this.exerciseType, this.allFrames);
    }

    const { detect, plugin, side } = this.route;
    if (!detect || !plugin || !side) {
      // Defensive — every non-walking ExerciseType resolves all three.
      return buildSessionSummary(this.exerciseType, []);
    }

    const ranges = detect(this.allFrames);

    const reps = ranges
      .map((range, i) => {
        const slice = this.allFrames.slice(range.startIdx, range.endIdx + 1);
        return aggregateRepFromFrames(slice, i + 1, range, plugin, side);
      })
      .filter((r): r is NonNullable<typeof r> =>
        r !== null && r.features.kneeFlexionDeg >= REP_THRESHOLDS.MIN_REP_DEPTH_DEG,
      )
      .map((r, i) => ({ ...r, repId: i + 1 }));

    return buildSessionSummary(this.exerciseType, reps);
  }

  getLastWindowStats(): WindowStats    { return this.lastWindowStats; }
  getFrameBuffer():    FrameFeatures[] { return this.allFrames.slice(); }
  getExerciseType():   ExerciseType    { return this.exerciseType; }
}
