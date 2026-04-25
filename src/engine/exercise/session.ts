/**
 * src/engine/exercise/session.ts — SESSION-LEVEL AGGREGATION
 *
 * Given a finalised list of RepFeatures, summarise across the session.
 *
 *   numReps       — how many reps were detected
 *   avgDepth      — mean peak knee flexion across reps
 *   minDepth      — worst-case (shallowest) rep
 *   avgFppa       — mean fppaPeak
 *   maxFppa       — single worst fppaPeak across the session
 *   consistency   — 1 - (stddev(depth) / mean(depth)), clamped to [0,1].
 *                   Higher = more consistent rep depth.
 *   overallRating — based on per-rep classifications.
 */

import {
  RepClassification,
  RepFeatures,
  SessionSummary,
  SessionSummaryStats,
} from './types';

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  let sq = 0;
  for (const v of arr) sq += (v - m) ** 2;
  return Math.sqrt(sq / arr.length);
}

function rateSession(reps: RepFeatures[]): RepClassification {
  if (reps.length === 0) return 'poor';
  const counts = { good: 0, fair: 0, poor: 0 };
  for (const r of reps) counts[r.score.classification]++;
  // Worst-of-majority: if ≥40% of reps are poor → poor; else if ≥40% fair → fair; else good.
  const t = reps.length * 0.4;
  if (counts.poor >= t) return 'poor';
  if (counts.fair + counts.poor >= t) return 'fair';
  return 'good';
}

export function computeSessionSummary(reps: RepFeatures[]): SessionSummaryStats {
  const depths = reps.map(r => r.features.kneeFlexionDeg);
  const fppas  = reps.map(r => r.features.fppaPeak);

  const avgDepth = mean(depths);
  const cv = avgDepth > 0 ? stddev(depths) / avgDepth : 1;
  const consistency = Math.max(0, Math.min(1, 1 - cv));

  return {
    numReps:       reps.length,
    avgDepth,
    minDepth:      depths.length ? Math.min(...depths) : 0,
    avgFppa:       mean(fppas),
    maxFppa:       fppas.length ? Math.max(...fppas) : 0,
    consistency,
    overallRating: rateSession(reps),
  };
}

export function buildSessionSummary(
  exercise: string,
  reps: RepFeatures[],
): SessionSummary {
  return {
    exercise,
    reps,
    summary: computeSessionSummary(reps),
  };
}
