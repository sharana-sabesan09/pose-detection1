/**
 * Standard reference squat — ideal form in MediaPipe normalized screen space.
 * Portrait orientation, person centred. Used as the ghost skeleton the live
 * user pose is compared against.
 *
 * 60 frames: standing (t=0) → deep squat (t=1) → standing (t=0)
 * Smooth cosine envelope so the animation loops cleanly.
 */

import { Landmark, PoseFrame } from '../../../types/index';
import { LM } from '../../landmarks';

function lm(x: number, y: number): Landmark {
  return { x, y, z: 0, visibility: 1 };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lmLerp(a: Landmark, b: Landmark, t: number): Landmark {
  return lm(lerp(a.x, b.x, t), lerp(a.y, b.y, t));
}

// ── Standing ──────────────────────────────────────────────────────────────────
const STAND: Partial<Record<number, Landmark>> = {
  [LM.NOSE]:            lm(0.50, 0.08),
  [LM.LEFT_EAR]:        lm(0.46, 0.09),
  [LM.RIGHT_EAR]:       lm(0.54, 0.09),
  [LM.LEFT_SHOULDER]:   lm(0.41, 0.22),
  [LM.RIGHT_SHOULDER]:  lm(0.59, 0.22),
  [LM.LEFT_ELBOW]:      lm(0.37, 0.37),
  [LM.RIGHT_ELBOW]:     lm(0.63, 0.37),
  [LM.LEFT_WRIST]:      lm(0.35, 0.52),
  [LM.RIGHT_WRIST]:     lm(0.65, 0.52),
  [LM.LEFT_HIP]:        lm(0.44, 0.55),
  [LM.RIGHT_HIP]:       lm(0.56, 0.55),
  [LM.LEFT_KNEE]:       lm(0.44, 0.72),
  [LM.RIGHT_KNEE]:      lm(0.56, 0.72),
  [LM.LEFT_ANKLE]:      lm(0.44, 0.88),
  [LM.RIGHT_ANKLE]:     lm(0.56, 0.88),
  [LM.LEFT_HEEL]:       lm(0.43, 0.91),
  [LM.RIGHT_HEEL]:      lm(0.57, 0.91),
};

// ── Deep squat (~90° knee flexion) ────────────────────────────────────────────
const SQUAT: Partial<Record<number, Landmark>> = {
  [LM.NOSE]:            lm(0.50, 0.40),
  [LM.LEFT_EAR]:        lm(0.46, 0.41),
  [LM.RIGHT_EAR]:       lm(0.54, 0.41),
  [LM.LEFT_SHOULDER]:   lm(0.38, 0.52),
  [LM.RIGHT_SHOULDER]:  lm(0.62, 0.52),
  [LM.LEFT_ELBOW]:      lm(0.32, 0.66),
  [LM.RIGHT_ELBOW]:     lm(0.68, 0.66),
  [LM.LEFT_WRIST]:      lm(0.30, 0.78),
  [LM.RIGHT_WRIST]:     lm(0.70, 0.78),
  [LM.LEFT_HIP]:        lm(0.42, 0.68),
  [LM.RIGHT_HIP]:       lm(0.58, 0.68),
  [LM.LEFT_KNEE]:       lm(0.38, 0.78),
  [LM.RIGHT_KNEE]:      lm(0.62, 0.78),
  [LM.LEFT_ANKLE]:      lm(0.44, 0.88),
  [LM.RIGHT_ANKLE]:     lm(0.56, 0.88),
  [LM.LEFT_HEEL]:       lm(0.43, 0.91),
  [LM.RIGHT_HEEL]:      lm(0.57, 0.91),
};

const CENTRE = lm(0.5, 0.5);

function buildFrame(t: number): PoseFrame {
  const frame: Landmark[] = Array(33)
    .fill(null)
    .map(() => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
  for (let i = 0; i < 33; i++) {
    const s = STAND[i] ?? CENTRE;
    const q = SQUAT[i] ?? CENTRE;
    frame[i] = lmLerp(s, q, t);
  }
  return frame;
}

export const SQUAT_REFERENCE: PoseFrame[] = Array.from({ length: 60 }, (_, i) => {
  const t = (1 - Math.cos((i / 59) * Math.PI)) / 2;
  return buildFrame(t);
});
