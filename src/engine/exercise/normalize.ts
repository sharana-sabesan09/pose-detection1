/**
 * src/engine/exercise/normalize.ts — LANDMARK NORMALIZATION
 *
 * Raw MediaPipe landmarks live in screen-fraction space ([0,1] for x and y),
 * which means "1 pelvis-width" looks different at 6ft vs 5ft, when the user
 * is closer or farther from the camera, etc.
 *
 * To make every downstream feature scale-invariant, we re-express each
 * landmark in PELVIS-WIDTH UNITS relative to the HIP MIDPOINT:
 *
 *   1. Translate so the hip midpoint sits at (0, 0).
 *   2. Scale so the pelvis spans 1 unit on the x axis.
 *
 * After this transform:
 *   - x = horizontal offset from hip midline (positive = right side of hips)
 *   - y = vertical offset from hip midline (positive y = below the hips
 *         on screen — y is still inverted, see PoseFrame docs)
 *   - z = same scaling applied so depth remains comparable
 *
 * If the hip landmarks are missing or have very low visibility, we fall back
 * to the IDENTITY transform (x/y unchanged) and flag every landmark with
 * visibility 0 so downstream code can skip the frame.
 */

import { LM } from '../landmarks';
import { NormalizedLandmarks, RawLandmarks } from './types';

/** Minimum visibility for a landmark to be treated as "present". */
const MIN_HIP_VISIBILITY = 0.3;

/** Floor on pelvis width to avoid /0 explosion when hips momentarily collapse. */
const MIN_PELVIS_WIDTH = 1e-3;

/**
 * normalizeLandmarks — move + scale every landmark into pelvis-width units.
 *
 * Returns a fresh array; the input is not mutated.
 */
export function normalizeLandmarks(landmarks: RawLandmarks): NormalizedLandmarks {
  const lh = landmarks[LM.LEFT_HIP];
  const rh = landmarks[LM.RIGHT_HIP];

  const hipsVisible =
    lh && rh &&
    (lh.visibility ?? 1) >= MIN_HIP_VISIBILITY &&
    (rh.visibility ?? 1) >= MIN_HIP_VISIBILITY;

  if (!hipsVisible) {
    // Bail with a copy that flags everything invisible so downstream code skips.
    return landmarks.map(l => ({ x: l.x, y: l.y, z: l.z, visibility: 0 }));
  }

  const cx = (lh.x + rh.x) / 2;
  const cy = (lh.y + rh.y) / 2;
  const cz = (lh.z + rh.z) / 2;

  const dx = rh.x - lh.x;
  const dy = rh.y - lh.y;
  // Pelvis width = the 2D distance between the two hips.
  // Using x+y avoids degenerate widths if the user is rotated.
  const pelvisWidth = Math.max(Math.hypot(dx, dy), MIN_PELVIS_WIDTH);

  return landmarks.map(l => ({
    x:          (l.x - cx) / pelvisWidth,
    y:          (l.y - cy) / pelvisWidth,
    z:          (l.z - cz) / pelvisWidth,
    visibility: l.visibility ?? 1,
  }));
}

/** Convenience: returns the pelvis-width that would be used for a given frame. */
export function getPelvisWidth(landmarks: RawLandmarks): number {
  const lh = landmarks[LM.LEFT_HIP];
  const rh = landmarks[LM.RIGHT_HIP];
  if (!lh || !rh) return MIN_PELVIS_WIDTH;
  return Math.max(Math.hypot(rh.x - lh.x, rh.y - lh.y), MIN_PELVIS_WIDTH);
}
