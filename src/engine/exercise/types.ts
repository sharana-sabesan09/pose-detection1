/**
 * src/engine/exercise/types.ts — SHARED TYPES FOR THE EXERCISE PIPELINE
 *
 * Three layers of features run in parallel:
 *   1. Frame-level (per camera frame)
 *   2. Window-level (rolling stats over the last N frames)
 *   3. Rep-level (event-driven, finalised when a rep ends)
 *
 * Plus a Session-level summary that aggregates across all reps.
 *
 * NOTE: keep this file pure — no React, no React Native, no IO.
 *       The whole exercise pipeline must stay runnable in plain Node so the
 *       smoke tests can execute without a phone.
 */

import { Landmark, PoseFrame } from '../../types';

// ─────────────────────────────────────────────────────────────────────────────
// Sides + landmarks
// ─────────────────────────────────────────────────────────────────────────────

export type Side = 'left' | 'right';

/** Raw landmarks straight from MediaPipe (PoseFrame is `Landmark[]` of length 33). */
export type RawLandmarks = PoseFrame;

/**
 * NormalizedLandmarks — the same 33 landmarks after centering on hip midpoint
 * and scaling by pelvis width. All x/y are now in "pelvis-widths" relative
 * to the hip midpoint, which makes every downstream feature scale-invariant.
 */
export type NormalizedLandmark = Landmark;
export type NormalizedLandmarks = NormalizedLandmark[];

// ─────────────────────────────────────────────────────────────────────────────
// Frame-level
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FrameFeatures — everything we extract from a single frame.
 *
 * Angles are in DEGREES. Distances are in PELVIS-WIDTH UNITS (already
 * normalised — see normalizeLandmarks).
 *
 * `dominantSide` is the side (left/right) chosen for any single-sided
 * features in this frame, picked by visibility. The rep aggregator can
 * use this to vote on which side a given rep "belongs to".
 */
export interface FrameFeatures {
  timestamp: number;

  /** Raw landmarks (kept for downstream debugging; not persisted to per-rep CSV). */
  landmarks: NormalizedLandmarks;

  // ── core geometry (degrees) ───────────────────────────────────────────────
  kneeFlexion:    number;   // 0 = straight leg, ~120 = deep squat
  fppa:           number;   // 0 = neutral, higher = more knee valgus
  trunkLean:      number;   // lateral (frontal plane) trunk angle from vertical
  trunkFlex:      number;   // forward (sagittal plane) trunk angle from vertical
  pelvicDrop:     number;   // Trendelenburg — frontal-plane hip-line tilt
  hipAdduction:   number;   // thigh angle toward midline (degrees from vertical)
  kneeOffset:     number;   // horizontal knee-over-toe distance (pelvis-widths)

  // ── positions for temporal/sway analysis (pelvis-widths from hip-mid) ─────
  midHipX:        number;
  midHipY:        number;

  // ── derived ───────────────────────────────────────────────────────────────
  velocityKneeFlex: number; // deg / second; 0 if no previous frame

  // ── unilateral ────────────────────────────────────────────────────────────
  swingHeelY: number; // raw screen-fraction y of the non-dominant heel (larger = lower on screen)

  // ── meta ──────────────────────────────────────────────────────────────────
  dominantSide:   Side;
  confidence:     number;   // mean visibility of the joints used (0–1)
}

// ─────────────────────────────────────────────────────────────────────────────
// Window-level
// ─────────────────────────────────────────────────────────────────────────────

export interface WindowStats {
  swayNorm:   number; // std dev of midHipX over window (pelvis-widths)
  smoothness: number; // std dev of velocityKneeFlex over window (deg/s)
  windowSize: number; // how many frames were actually used
}

// ─────────────────────────────────────────────────────────────────────────────
// Rep state machine
// ─────────────────────────────────────────────────────────────────────────────

export type RepState = 'IDLE' | 'DESCENT' | 'ASCENT';

export interface RepStateEvents {
  repStart?: boolean;
  bottom?:   boolean;
  repEnd?:   boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rep-level (PRIMARY OUTPUT)
// ─────────────────────────────────────────────────────────────────────────────

export interface RepTiming {
  startFrame:  number;
  bottomFrame: number;
  endFrame:    number;
  durationMs:  number;
}

export interface RepFeatureValues {
  kneeFlexionDeg: number;  // peak knee flexion = squat depth
  romRatio:       number;  // (peak - start) / expected (~120°). 0–1+.

  fppaPeak:       number;
  fppaAtDepth:    number;

  trunkLeanPeak:  number;
  trunkFlexPeak:  number;

  pelvicDropPeak:  number;
  pelvicShiftPeak: number;

  hipAdductionPeak: number;
  kneeOffsetPeak:   number;

  swayNorm:    number;
  smoothness:  number;

  // ── step-down additions ───────────────────────────────────────────────────
  pelvisVertDisplacement: number; // screen-fraction drop of hip midpoint (larger = deeper)
  swingHeelContactFrames: number; // frames where swing heel is near floor (heel tap proxy)
}

export interface RepErrors {
  kneeValgus:    boolean;
  trunkLean:     boolean;
  trunkFlex:     boolean;
  pelvicDrop:    boolean;
  pelvicShift:   boolean;
  hipAdduction:  boolean;
  kneeOverFoot:  boolean;
  balance:       boolean;
}

export type RepClassification = 'good' | 'fair' | 'poor';

export interface RepScore {
  totalErrors:    number;
  classification: RepClassification;
}

export interface RepFeatures {
  repId:      number;
  side:       Side;
  timing:     RepTiming;
  features:   RepFeatureValues;
  errors:     RepErrors;
  score:      RepScore;
  confidence: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session-level (FINAL OUTPUT)
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionSummaryStats {
  numReps:        number;
  avgDepth:       number;
  minDepth:       number;
  avgFppa:        number;
  maxFppa:        number;
  consistency:    number;            // 0–1, higher = more consistent depth
  overallRating:  RepClassification;
}

export interface SessionSummary {
  exercise: string;
  reps:     RepFeatures[];
  summary:  SessionSummaryStats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Thresholds (tunable in one place)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error thresholds — chosen to roughly match clinical squat-screening cues.
 * All values in degrees except where noted. Tweak in tests if needed.
 */
export const ERROR_THRESHOLDS = {
  KNEE_VALGUS_FPPA_DEG:     7,    // FPPA peak > this → valgus collapse (AAOS-aligned)
  TRUNK_LEAN_DEG:           10,   // peak frontal lean > this → fail
  TRUNK_FLEX_DEG:           45,   // peak forward lean > this → fail
  PELVIC_DROP_DEG:          5,    // peak Trendelenburg > this → fail
  PELVIC_SHIFT_NORM:        0.10, // hip lateral shift / pelvis-width > this
  HIP_ADDUCTION_DEG:        10,   // peak adduction > this
  KNEE_OFFSET_NORM:         0.20, // |knee - foot| / pelvis-width > this
  SWAY_NORM:                0.05, // window sway std > this → balance issue
} as const;

/**
 * Rep state machine thresholds.
 * kneeFlexion in degrees, velocity in deg/s.
 */
export const REP_THRESHOLDS = {
  /** Below this knee-flex level we consider the user "standing". */
  STAND_KNEE_DEG:        15,
  /** A descent can't be triggered until knee-flex exceeds this much. */
  DESCENT_TRIGGER_DEG:   25,
  /** Minimum peak knee flexion to count as a real rep (avoids twitches). */
  MIN_REP_DEPTH_DEG:     45,
  /** Velocity deadband — ignored as "still" between -DEAD and +DEAD. */
  VELOCITY_DEAD_DEG_S:   8,
  /** Minimum frames between rep events (debounces flicker at ~30fps). */
  MIN_EVENT_FRAMES:      3,
} as const;

/** Expected full ROM for romRatio normalisation. AAOS norm for step-down = 135°. */
export const EXPECTED_ROM_DEG = 135;
