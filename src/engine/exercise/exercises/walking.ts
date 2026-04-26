/**
 * src/engine/exercise/exercises/walking.ts — WALKING SESSION AGGREGATOR
 *
 * Walking is the only exercise type that does not produce reps. Instead it
 * runs three batch metrics over the full frame buffer:
 *
 *   gaitAsymmetry    — how uneven left-stance vs right-stance dwell times are
 *   lateralSwayRange — median 5s-window range of midHipX (frontal-plane sway)
 *   stabilityScore   — 0–100, derived from CoG variance during quiet windows
 *
 * Explicitly NOT included (these belong to the live sit-to-stand assessment,
 * not the prescribed walking exercise):
 *   - standupDuration / postStandWobble / nudgeRecovery
 *   - any sit-to-stand state machine
 *   - total step count (intentionally dropped per spec — the gait scores
 *     above carry the predictive signal)
 *
 * Rep-derived fields on SessionSummaryStats are returned as null because
 * walking has no reps; only the walking-only optional fields are populated.
 *
 * The math here is ported from src/engine/analyzeRecording.ts so the live
 * dashboard and the post-hoc schema agree on what these numbers mean.
 */

import {
  FrameFeatures,
  RepClassification,
  SessionSummary,
  SessionSummaryStats,
} from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Math helpers
// ─────────────────────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

function variance(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  let sq = 0;
  for (const v of arr) sq += (v - m) ** 2;
  return sq / arr.length;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ─────────────────────────────────────────────────────────────────────────────
// Step detection — zero-crossings of the (leftAnkle.y - rightAnkle.y) signal.
// Each crossing marks a stance transition; the time BETWEEN crossings is one
// stance dwell (alternating L-stance, R-stance, L-stance, …).
// ─────────────────────────────────────────────────────────────────────────────

interface StanceInterval {
  durationMs: number;
  /** +1 if this stance was on the left foot (left lower on screen), -1 if right. */
  side: 1 | -1;
}

function extractStanceIntervals(frames: FrameFeatures[]): StanceInterval[] {
  // FrameFeatures doesn't carry raw ankles, so we recover them from `landmarks`
  // (normalised). Y is monotonic with screen Y after normalisation, which is
  // all the zero-crossing detector needs.
  const out: StanceInterval[] = [];

  let prevSign = 0;
  let lastCrossingT = 0;
  let lastCrossingSign: 1 | -1 = 1;

  for (const f of frames) {
    const la = f.landmarks[27]; // LEFT_ANKLE
    const ra = f.landmarks[28]; // RIGHT_ANKLE
    if (!la || !ra) continue;
    if ((la.visibility ?? 1) < 0.3 || (ra.visibility ?? 1) < 0.3) continue;

    const diff = la.y - ra.y;
    // ±0.015 deadband — the same threshold analyzeRecording.ts uses.
    const sign = diff > 0.015 ? 1 : diff < -0.015 ? -1 : 0;

    if (sign !== 0 && sign !== prevSign) {
      if (prevSign !== 0 && lastCrossingT > 0) {
        const durationMs = f.timestamp - lastCrossingT;
        if (durationMs > 200 && durationMs < 2500) {
          out.push({ durationMs, side: lastCrossingSign });
        }
      }
      lastCrossingT    = f.timestamp;
      lastCrossingSign = sign as 1 | -1;
      prevSign         = sign;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Metric 1 — Gait asymmetry.
// Compare mean dwell on left stance vs right stance. Healthy gait is roughly
// symmetric; persistent asymmetry indicates pain/weakness on one side.
// 0 = symmetric, approaching 1 = max asymmetry.
// ─────────────────────────────────────────────────────────────────────────────

function computeGaitAsymmetry(intervals: StanceInterval[]): number | undefined {
  const left  = intervals.filter(i => i.side ===  1).map(i => i.durationMs);
  const right = intervals.filter(i => i.side === -1).map(i => i.durationMs);
  if (left.length < 2 || right.length < 2) return undefined;

  const mL = mean(left);
  const mR = mean(right);
  const denom = mL + mR;
  if (denom <= 0) return undefined;

  // |mL − mR| / (mL + mR): bounded in [0, 1]. ~0.05 is normal walking variation.
  return Math.abs(mL - mR) / denom;
}

// ─────────────────────────────────────────────────────────────────────────────
// Metric 2 — Lateral sway range.
// Median range of midHipX across non-overlapping ~5-second windows. Median
// (not max) so a single moment of stepping out of frame doesn't dominate.
// ─────────────────────────────────────────────────────────────────────────────

function computeLateralSwayRange(frames: FrameFeatures[]): number | undefined {
  const xs = frames.map(f => f.midHipX).filter(x => Number.isFinite(x) && x > 0);
  if (xs.length < 60) return undefined;

  const windowSize = 150; // ~5s at 30fps
  const ranges: number[] = [];
  for (let i = 0; i + windowSize <= xs.length; i += windowSize) {
    const w = xs.slice(i, i + windowSize);
    ranges.push(Math.max(...w) - Math.min(...w));
  }
  if (ranges.length === 0) {
    ranges.push(Math.max(...xs) - Math.min(...xs));
  }
  ranges.sort((a, b) => a - b);
  return ranges[Math.floor(ranges.length / 2)];
}

// ─────────────────────────────────────────────────────────────────────────────
// Metric 3 — Stability score (0–100, higher = steadier).
// Average over quiet 3s windows of CoG variance. Windows where the user is
// moving across the frame (range > 0.08) are excluded — those would inflate
// variance without representing instability.
// ─────────────────────────────────────────────────────────────────────────────

function computeStabilityScore(frames: FrameFeatures[]): number | undefined {
  const cogs = frames
    .map(f => ({ x: f.midHipX, y: f.midHipY }))
    .filter(p => p.x > 0 && p.y > 0);
  if (cogs.length < 30) return undefined;

  const windowSize = 90; // ~3s at 30fps
  const windowScores: number[] = [];
  for (let i = 0; i + windowSize <= cogs.length; i += windowSize) {
    const w  = cogs.slice(i, i + windowSize);
    const xs = w.map(p => p.x);
    const ys = w.map(p => p.y);
    const rangeX = Math.max(...xs) - Math.min(...xs);
    const rangeY = Math.max(...ys) - Math.min(...ys);
    if (rangeX < 0.08 && rangeY < 0.08) {
      const totalVar = variance(xs) + variance(ys);
      let s: number;
      if      (totalVar < 0.000005) s = 65;
      else if (totalVar <= 0.0003)  s = 75 + 25 * (1 - totalVar / 0.0003);
      else if (totalVar <= 0.001)   s = 75 - ((totalVar - 0.0003) / 0.0007) * 25;
      else                          s = Math.max(0, 50 - ((totalVar - 0.001) / 0.002) * 50);
      windowScores.push(clamp(s, 0, 100));
    }
  }
  if (windowScores.length === 0) return undefined;
  return clamp(mean(windowScores), 0, 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// Walking → SessionSummary.
//
// Rep-derived fields are null. overallRating is derived from the walking
// metrics so consumers have a single coarse pass/fail per exercise.
// ─────────────────────────────────────────────────────────────────────────────

function rateWalking(stability?: number, asymmetry?: number, sway?: number): RepClassification {
  // Map each available metric onto a [0, 100] safety score, take the mean.
  const scores: number[] = [];
  if (stability !== undefined) scores.push(stability);
  if (asymmetry !== undefined) scores.push(clamp(100 * (1 - asymmetry / 0.25), 0, 100));
  if (sway !== undefined) {
    let s: number;
    if      (sway <= 0.04) s = 72;
    else if (sway <= 0.10) s = 100 - Math.abs(sway - 0.07) / 0.07 * 20;
    else if (sway <= 0.18) s = 80 - ((sway - 0.10) / 0.08) * 40;
    else                   s = Math.max(0, 40 - ((sway - 0.18) / 0.10) * 40);
    scores.push(clamp(s, 0, 100));
  }
  if (scores.length === 0) return 'poor';
  const m = mean(scores);
  if (m >= 75) return 'good';
  if (m >= 50) return 'fair';
  return 'poor';
}

export function buildWalkingSummary(
  exercise: string,
  frames: FrameFeatures[],
): SessionSummary {
  const intervals       = extractStanceIntervals(frames);
  const gaitAsymmetry   = computeGaitAsymmetry(intervals);
  const lateralSwayRange = computeLateralSwayRange(frames);
  const stabilityScore   = computeStabilityScore(frames);

  const summary: SessionSummaryStats = {
    numReps:       0,
    avgDepth:      null,
    minDepth:      null,
    avgFppa:       null,
    maxFppa:       null,
    consistency:   null,
    overallRating: rateWalking(stabilityScore, gaitAsymmetry, lateralSwayRange),
    gaitAsymmetry,
    lateralSwayRange,
    stabilityScore,
  };

  return { exercise, reps: [], summary };
}
