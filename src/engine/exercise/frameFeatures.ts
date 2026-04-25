/**
 * src/engine/exercise/frameFeatures.ts — PER-FRAME GEOMETRY ENGINE
 *
 * Given normalised landmarks for ONE frame, produce a FrameFeatures object
 * with every angle / distance the rest of the pipeline cares about.
 *
 * IMPORTANT COORDINATE NOTES:
 *   - In MediaPipe's normalised image space, y INCREASES going DOWN the
 *     screen. After our normalize.ts pass, the same convention holds:
 *     a landmark below the hips has positive y.
 *   - We treat "vertical (up)" as the −y direction. Trunk lean / hip
 *     adduction / knee-flex are all measured relative to that.
 *   - Angles are returned in DEGREES throughout.
 *
 * SIDE SELECTION:
 *   For features that are inherently per-side (knee flexion, FPPA, hip
 *   adduction, knee offset) we compute both sides and pick the one with
 *   higher visibility. That choice is recorded in `dominantSide` so the
 *   rep aggregator can lock in the side for the whole rep.
 */

import { Landmark } from '../../types';
import { LM } from '../landmarks';
import {
  FrameFeatures,
  NormalizedLandmarks,
  RawLandmarks,
  Side,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Geometry helpers
// ─────────────────────────────────────────────────────────────────────────────

const RAD2DEG = 180 / Math.PI;
const FOOT_INDEX_LEFT = 31;
const FOOT_INDEX_RIGHT = 32;

function vec2Sub(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: a.x - b.x, y: a.y - b.y };
}

function dot2(a: { x: number; y: number }, b: { x: number; y: number }) {
  return a.x * b.x + a.y * b.y;
}

function len2(a: { x: number; y: number }) {
  return Math.hypot(a.x, a.y);
}

/**
 * Angle ABC, in 2D, in degrees. Returns the inner angle at vertex B —
 * always in [0, 180]. Returns NaN if either edge has zero length.
 */
function angleAt2D(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  const ba = vec2Sub(a, b);
  const bc = vec2Sub(c, b);
  const denom = len2(ba) * len2(bc);
  if (denom < 1e-9) return NaN;
  const cos = Math.min(1, Math.max(-1, dot2(ba, bc) / denom));
  return Math.acos(cos) * RAD2DEG;
}

/**
 * Angle of vector v from straight-up (the −y direction). Returns degrees,
 * always non-negative, in [0, 180]. Useful for "how far is this segment
 * from vertical?"
 */
function angleFromVertical2D(v: { x: number; y: number }): number {
  // Up vector = (0, -1). Magnitude check to avoid /0.
  const m = len2(v);
  if (m < 1e-9) return 0;
  // dot(v, up) = -v.y; cos(angle) = -v.y / m
  const cos = Math.min(1, Math.max(-1, -v.y / m));
  return Math.acos(cos) * RAD2DEG;
}

// ─────────────────────────────────────────────────────────────────────────────
// Side-specific computations
// ─────────────────────────────────────────────────────────────────────────────

interface LegLandmarks {
  hip:   Landmark;
  knee:  Landmark;
  ankle: Landmark;
  foot:  Landmark;
}

function legFor(side: Side, lms: NormalizedLandmarks): LegLandmarks {
  if (side === 'left') {
    return {
      hip:   lms[LM.LEFT_HIP],
      knee:  lms[LM.LEFT_KNEE],
      ankle: lms[LM.LEFT_ANKLE],
      foot:  lms[FOOT_INDEX_LEFT] ?? lms[LM.LEFT_HEEL] ?? lms[LM.LEFT_ANKLE],
    };
  }
  return {
    hip:   lms[LM.RIGHT_HIP],
    knee:  lms[LM.RIGHT_KNEE],
    ankle: lms[LM.RIGHT_ANKLE],
    foot:  lms[FOOT_INDEX_RIGHT] ?? lms[LM.RIGHT_HEEL] ?? lms[LM.RIGHT_ANKLE],
  };
}

function legVisibility(leg: LegLandmarks): number {
  const v = (l: Landmark) => l.visibility ?? 0;
  return (v(leg.hip) + v(leg.knee) + v(leg.ankle)) / 3;
}

/** Knee flexion (deg). 0 = straight leg. ~120 = deep squat. */
function kneeFlexion(leg: LegLandmarks): number {
  const inner = angleAt2D(leg.hip, leg.knee, leg.ankle);
  if (Number.isNaN(inner)) return 0;
  return Math.max(0, 180 - inner);
}

/**
 * FPPA — Frontal Plane Projection Angle (deg).
 * Same hip-knee-ankle inner angle but in the frontal x-y plane only.
 * Reported as deviation from a straight (180°) line: 0 = neutral,
 * positive = bent. Sign of valgus vs varus is not distinguished here —
 * the threshold check treats any large bend as a valgus risk.
 */
function fppa(leg: LegLandmarks): number {
  const inner = angleAt2D(
    { x: leg.hip.x,   y: leg.hip.y },
    { x: leg.knee.x,  y: leg.knee.y },
    { x: leg.ankle.x, y: leg.ankle.y },
  );
  if (Number.isNaN(inner)) return 0;
  return Math.max(0, 180 - inner);
}

/**
 * Hip adduction (deg). Angle of the thigh (hip→knee) from vertical, ONLY
 * counted when the knee is moving toward the body midline relative to the
 * hip on that side.
 *
 *   left side: adduction when knee.x > hip.x (knee right of left hip → toward midline)
 *   right side: adduction when knee.x < hip.x (knee left of right hip → toward midline)
 */
function hipAdduction(side: Side, leg: LegLandmarks): number {
  const v = vec2Sub(leg.knee, leg.hip);
  const angle = angleFromVertical2D(v); // 0 = perfectly vertical thigh
  const inward =
    (side === 'left' && v.x > 0) ||
    (side === 'right' && v.x < 0);
  return inward ? angle : 0;
}

/**
 * Knee offset (pelvis-widths). Horizontal distance between the knee and
 * the foot index. If the camera is sagittal (side-on), this captures the
 * "knee over toes" cue. If the camera is frontal, it captures medial
 * knee drift.
 */
function kneeOffset(leg: LegLandmarks): number {
  return Math.abs(leg.knee.x - leg.foot.x);
}

/**
 * Foot height (y-coordinate). Lower value = foot is higher on screen = lifted.
 * Used to detect unilateral / single-leg exercises where one foot is grounded
 * and the other is lifted.
 */
function footHeight(leg: LegLandmarks): number {
  return leg.foot.y;
}

// ─────────────────────────────────────────────────────────────────────────────
// Trunk + pelvis (frame-shared)
// ─────────────────────────────────────────────────────────────────────────────

function trunkLean(lms: NormalizedLandmarks): number {
  const ls = lms[LM.LEFT_SHOULDER];
  const rs = lms[LM.RIGHT_SHOULDER];
  if (!ls || !rs) return 0;
  const midShoulder = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  // After normalisation hip mid is at (0,0), so trunk vector = midShoulder.
  // Project onto x-y (frontal plane only): we already are there.
  return angleFromVertical2D({ x: midShoulder.x, y: midShoulder.y });
}

function trunkFlex(lms: NormalizedLandmarks): number {
  const ls = lms[LM.LEFT_SHOULDER];
  const rs = lms[LM.RIGHT_SHOULDER];
  if (!ls || !rs) return 0;
  // Sagittal plane uses (z, y). After normalisation hip-mid is at (0,0,0).
  const midShoulder = { x: (ls.z + rs.z) / 2, y: (ls.y + rs.y) / 2 };
  // Skip if z is essentially absent (some pose models give z=0 always).
  if (Math.abs(midShoulder.x) < 1e-4) return 0;
  return angleFromVertical2D(midShoulder);
}

function pelvicDrop(lms: NormalizedLandmarks): number {
  const lh = lms[LM.LEFT_HIP];
  const rh = lms[LM.RIGHT_HIP];
  if (!lh || !rh) return 0;
  // pelvis width is 1 after normalisation, so atan(|dy|/1) = atan(|dy|).
  return Math.atan(Math.abs(rh.y - lh.y)) * RAD2DEG;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * computeFrameFeatures — turn one frame's worth of NORMALIZED landmarks +
 * the original raw landmarks (for the unnormalized hip-mid coordinates we
 * need to track sway in screen space) into a FrameFeatures object.
 *
 * @param timestamp  Wall-clock ms (Date.now()) when this frame arrived.
 * @param raw        Original landmarks (for the screen-space hip midpoint).
 * @param normalized Output of normalizeLandmarks(raw).
 * @param prev       The previous frame's features (used for velocity).
 *                   Pass undefined for the first frame.
 */
export function computeFrameFeatures(
  timestamp: number,
  raw: RawLandmarks,
  normalized: NormalizedLandmarks,
  prev?: FrameFeatures,
): FrameFeatures {
  // ── Side selection ────────────────────────────────────────────────────────
  const leftLeg  = legFor('left',  normalized);
  const rightLeg = legFor('right', normalized);
  const leftVis  = legVisibility(leftLeg);
  const rightVis = legVisibility(rightLeg);

  // Foot height in normalised space (larger y = lower on screen = closer to floor).
  // For a single-leg squat the lifted foot has SMALLER y; the standing foot has LARGER y.
  // We want the STANDING leg — the one whose foot is lower on screen (larger y).
  const leftFootY  = footHeight(leftLeg);
  const rightFootY = footHeight(rightLeg);
  // footHeightDiff > 0 → right foot is lower on screen (standing) → dominant = right
  // footHeightDiff < 0 → left foot is lower on screen (standing)  → dominant = left
  const footHeightDiff = rightFootY - leftFootY;

  let dominantSide: Side;
  if (Math.abs(footHeightDiff) > 0.1) {
    // Unilateral: pick the leg whose foot is on the floor (larger y = lower on screen).
    dominantSide = footHeightDiff > 0 ? 'right' : 'left';
  } else {
    // Bilateral or neutral: use visibility
    dominantSide = leftVis >= rightVis ? 'left' : 'right';
  }

  const dominantLeg = dominantSide === 'left' ? leftLeg : rightLeg;
  const dominantVis = dominantSide === 'left' ? leftVis : rightVis;

  // ── Per-side geometry on the dominant leg ─────────────────────────────────
  const knee = kneeFlexion(dominantLeg);
  const fp   = fppa(dominantLeg);
  const ha   = hipAdduction(dominantSide, dominantLeg);
  const ko   = kneeOffset(dominantLeg);

  // ── Trunk + pelvis (using normalized landmarks) ───────────────────────────
  const tLean = trunkLean(normalized);
  const tFlex = trunkFlex(normalized);
  const pDrop = pelvicDrop(normalized);

  // ── Hip midpoint in SCREEN space (raw) — sway and shift live here ─────────
  const lhRaw = raw[LM.LEFT_HIP];
  const rhRaw = raw[LM.RIGHT_HIP];
  const midHipX = lhRaw && rhRaw ? (lhRaw.x + rhRaw.x) / 2 : 0;
  const midHipY = lhRaw && rhRaw ? (lhRaw.y + rhRaw.y) / 2 : 0;

  // ── Velocity (first-order back-difference) ────────────────────────────────
  let velocityKneeFlex = 0;
  if (prev) {
    const dtMs = timestamp - prev.timestamp;
    if (dtMs > 0) {
      velocityKneeFlex = ((knee - prev.kneeFlexion) * 1000) / dtMs;
    }
  }

  return {
    timestamp,
    landmarks: normalized,
    kneeFlexion:  knee,
    fppa:         fp,
    trunkLean:    tLean,
    trunkFlex:    tFlex,
    pelvicDrop:   pDrop,
    hipAdduction: ha,
    kneeOffset:   ko,
    midHipX,
    midHipY,
    velocityKneeFlex,
    dominantSide,
    confidence:   dominantVis,
  };
}
