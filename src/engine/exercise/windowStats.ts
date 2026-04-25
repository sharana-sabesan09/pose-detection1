/**
 * src/engine/exercise/windowStats.ts — ROLLING WINDOW STATS
 *
 * Computes stats over the last N frames in the per-frame buffer:
 *
 *   swayNorm   — std-dev of midHipX (in screen-fraction units, since
 *                that's the coordinate system the existing fall-risk
 *                code uses too — a sway of 0.05 means ~5% of frame width)
 *   smoothness — std-dev of velocityKneeFlex (deg/s)
 *
 * Always O(N) per call and N is small (≈30 frames at 30fps = 1 second).
 */

import { FrameFeatures, WindowStats } from './types';

const DEFAULT_WINDOW_SIZE = 30;

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  let sum = 0;
  for (const x of arr) sum += x;
  const mean = sum / arr.length;
  let sq = 0;
  for (const x of arr) sq += (x - mean) ** 2;
  return Math.sqrt(sq / arr.length);
}

/**
 * updateWindowStats — recompute over the last `windowSize` frames of `buffer`.
 * Returns a fresh WindowStats. Cheap to call per-frame.
 */
export function updateWindowStats(
  buffer: FrameFeatures[],
  windowSize: number = DEFAULT_WINDOW_SIZE,
): WindowStats {
  if (buffer.length === 0) {
    return { swayNorm: 0, smoothness: 0, windowSize: 0 };
  }

  const start = Math.max(0, buffer.length - windowSize);
  const window = buffer.slice(start);

  const swayNorm   = stddev(window.map(f => f.midHipX));
  const smoothness = stddev(window.map(f => f.velocityKneeFlex));

  return { swayNorm, smoothness, windowSize: window.length };
}
