/**
 * src/engine/landmarks.ts — MEDIAPIPE POSE LANDMARK UTILITIES
 *
 * This file is the bridge between raw numbers from the AI model and
 * meaningful body positions that the rest of the app can work with.
 *
 * THREE THINGS LIVE HERE:
 *   1. LM  — a lookup table: "which index in the array is the left hip?"
 *   2. parseLandmarks()   — converts the model's raw output into PoseFrames
 *   3. SKELETON_CONNECTIONS — which joints to connect with lines on screen
 *   4. mockPoseFrame()    — generates a fake but realistic pose for testing
 *                           when no ZETIC model key is configured yet
 */

import { Landmark, PoseFrame } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — LANDMARK INDEX MAP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * LM — NAMED SHORTCUTS FOR MEDIAPIPE'S 33 LANDMARK INDICES
 *
 * MediaPipe Pose returns an array of 33 landmarks. Each landmark is identified
 * by its position in the array (index 0 = nose, index 23 = left hip, etc.).
 *
 * Instead of writing magic numbers like `pose[23]` throughout the codebase,
 * we use `pose[LM.LEFT_HIP]` — much clearer, and if MediaPipe ever changes
 * their numbering, we only need to update this one file.
 *
 * SENTINEL's detectors primarily use:
 *   Hips (23/24)      — centre of gravity, lateral sway
 *   Knees (25/26)     — step detection, leg symmetry
 *   Ankles (27/28)    — step timing, step rhythm
 *   Heels (29/30)     — heel strike detection
 *   Shoulders (11/12) — upper body posture, trunk sway
 *   Ears (7/8)        — head position relative to hips
 */
export const LM = {
  NOSE:            0,
  LEFT_EAR:        7,
  RIGHT_EAR:       8,
  LEFT_SHOULDER:  11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW:     13,
  RIGHT_ELBOW:    14,
  LEFT_WRIST:     15,
  RIGHT_WRIST:    16,
  LEFT_HIP:       23,
  RIGHT_HIP:      24,
  LEFT_KNEE:      25,
  RIGHT_KNEE:     26,
  LEFT_ANKLE:     27,
  RIGHT_ANKLE:    28,
  LEFT_HEEL:      29,
  RIGHT_HEEL:     30,
} as const;


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — OUTPUT PARSER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * parseLandmarks — CONVERTS THE MODEL'S RAW FLOAT ARRAY INTO LANDMARK OBJECTS
 *
 * The ZETIC model outputs a flat list of numbers — 132 floats total:
 *   33 landmarks × 4 values each (x, y, z, visibility)
 *
 * Example raw output (first 8 numbers = landmark 0 + landmark 1):
 *   [0.512, 0.094, -0.02, 0.99,   0.489, 0.088, -0.01, 0.97, ...]
 *    ↑x     ↑y     ↑z     ↑vis    ↑x     ↑y     ↑z     ↑vis
 *    └──── landmark 0 (nose) ────┘ └─── landmark 1 ────────────┘
 *
 * This function groups those numbers into 33 neat Landmark objects
 * that the rest of the app can work with using names like `.x` and `.visibility`.
 *
 * @param rawFloats  — flat array of 132 float32 numbers from the model
 * @returns          — array of 33 Landmark objects (a PoseFrame)
 */
export function parseLandmarks(rawFloats: number[]): PoseFrame {
  const frame: PoseFrame = [];

  for (let i = 0; i < 33; i++) {
    const base = i * 4; // each landmark occupies 4 consecutive slots
    frame.push({
      x:          rawFloats[base],     // horizontal (0 = left, 1 = right)
      y:          rawFloats[base + 1], // vertical   (0 = top,  1 = bottom)
      z:          rawFloats[base + 2], // depth estimate (negative = closer)
      visibility: rawFloats[base + 3], // confidence (0 = hidden, 1 = clearly visible)
    });
  }

  return frame;
}


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — SKELETON CONNECTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SKELETON_CONNECTIONS — WHICH JOINTS TO CONNECT WITH LINES ON THE OVERLAY
 *
 * Each entry is a pair [A, B], meaning "draw a line from landmark A to landmark B".
 * The SkeletonOverlay component iterates this list to draw the bones of the skeleton.
 *
 * We only draw the joints SENTINEL actually uses clinically:
 *   - Full torso (shoulder → shoulder, shoulder → hip, hip → hip)
 *   - Both legs fully (hip → knee → ankle → heel)
 *   - Both arms partially (shoulder → elbow → wrist)
 *
 * We skip face landmarks (eyes, mouth) — irrelevant for fall risk.
 */
export const SKELETON_CONNECTIONS: [number, number][] = [
  // Torso — the structural core
  [LM.LEFT_SHOULDER,  LM.RIGHT_SHOULDER], // shoulder bar
  [LM.LEFT_SHOULDER,  LM.LEFT_HIP],       // left side of torso
  [LM.RIGHT_SHOULDER, LM.RIGHT_HIP],      // right side of torso
  [LM.LEFT_HIP,       LM.RIGHT_HIP],      // hip bar (key for lateral sway)

  // Left leg — critical for step rhythm and transition safety
  [LM.LEFT_HIP,   LM.LEFT_KNEE],
  [LM.LEFT_KNEE,  LM.LEFT_ANKLE],
  [LM.LEFT_ANKLE, LM.LEFT_HEEL],

  // Right leg
  [LM.RIGHT_HIP,   LM.RIGHT_KNEE],
  [LM.RIGHT_KNEE,  LM.RIGHT_ANKLE],
  [LM.RIGHT_ANKLE, LM.RIGHT_HEEL],

  // Arms — helps visualise upper body posture
  [LM.LEFT_SHOULDER,  LM.LEFT_ELBOW],
  [LM.LEFT_ELBOW,     LM.LEFT_WRIST],
  [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW],
  [LM.RIGHT_ELBOW,    LM.RIGHT_WRIST],
];


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — SIMULATION / MOCK POSE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * mockPoseFrame — GENERATES A REALISTIC FAKE POSE FOR TESTING
 *
 * WHY THIS EXISTS:
 *   When the ZETIC model key hasn't been configured yet (POSE_MODEL_KEY is
 *   still a placeholder), the app runs in "simulation mode". This function
 *   generates landmark positions that look like a real person standing in
 *   the centre of the frame, with a small random wobble applied.
 *
 * This means:
 *   - The camera still shows the real world
 *   - The skeleton overlay draws a plausible human figure
 *   - The detectors and score aggregator receive believable data
 *   - The whole pipeline can be tested end-to-end without a model key
 *
 * HOW THE POSITIONS WORK:
 *   All x/y values are fractions of the frame (0–1). A person standing in the
 *   centre of a portrait frame roughly looks like:
 *   - Nose at y=0.10 (near the top tenth of the frame)
 *   - Hips at y=0.55 (a little above halfway)
 *   - Heels at y=0.91 (near the bottom)
 *
 * @param wobble  — how much random sway to add, 0 = perfectly still,
 *                  0.01 = subtle micro-movement, 0.05 = very unsteady
 * @returns       — a PoseFrame with 33 landmarks
 */
export function mockPoseFrame(wobble: number = 0): PoseFrame {
  // Create 33 generic landmarks first (all at centre, fully visible).
  // We'll overwrite the specific ones we care about below.
  const frame: Landmark[] = Array(33).fill(null).map(() => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0.9,
  }));

  // Small helper that returns a random offset scaled by the wobble amount.
  // Called fresh for each value so every joint moves independently.
  const w = () => (Math.random() - 0.5) * wobble;

  // ── Head ──────────────────────────────────────────────────────────────────
  frame[LM.NOSE]           = { x: 0.50 + w(), y: 0.10 + w(), z: 0, visibility: 0.99 };
  frame[LM.LEFT_EAR]       = { x: 0.46 + w(), y: 0.09 + w(), z: 0, visibility: 0.95 };
  frame[LM.RIGHT_EAR]      = { x: 0.54 + w(), y: 0.09 + w(), z: 0, visibility: 0.95 };

  // ── Shoulders ─────────────────────────────────────────────────────────────
  frame[LM.LEFT_SHOULDER]  = { x: 0.41 + w(), y: 0.22 + w(), z: 0, visibility: 0.99 };
  frame[LM.RIGHT_SHOULDER] = { x: 0.59 + w(), y: 0.22 + w(), z: 0, visibility: 0.99 };

  // ── Arms ──────────────────────────────────────────────────────────────────
  frame[LM.LEFT_ELBOW]     = { x: 0.37 + w(), y: 0.37 + w(), z: 0, visibility: 0.95 };
  frame[LM.RIGHT_ELBOW]    = { x: 0.63 + w(), y: 0.37 + w(), z: 0, visibility: 0.95 };
  frame[LM.LEFT_WRIST]     = { x: 0.35 + w(), y: 0.51 + w(), z: 0, visibility: 0.90 };
  frame[LM.RIGHT_WRIST]    = { x: 0.65 + w(), y: 0.51 + w(), z: 0, visibility: 0.90 };

  // ── Hips — the centre of gravity landmark ─────────────────────────────────
  frame[LM.LEFT_HIP]       = { x: 0.44 + w(), y: 0.55 + w(), z: 0, visibility: 0.99 };
  frame[LM.RIGHT_HIP]      = { x: 0.56 + w(), y: 0.55 + w(), z: 0, visibility: 0.99 };

  // ── Legs ──────────────────────────────────────────────────────────────────
  frame[LM.LEFT_KNEE]      = { x: 0.43 + w(), y: 0.72 + w(), z: 0, visibility: 0.98 };
  frame[LM.RIGHT_KNEE]     = { x: 0.57 + w(), y: 0.72 + w(), z: 0, visibility: 0.98 };
  frame[LM.LEFT_ANKLE]     = { x: 0.44 + w(), y: 0.88 + w(), z: 0, visibility: 0.97 };
  frame[LM.RIGHT_ANKLE]    = { x: 0.56 + w(), y: 0.88 + w(), z: 0, visibility: 0.97 };
  frame[LM.LEFT_HEEL]      = { x: 0.43 + w(), y: 0.91 + w(), z: 0, visibility: 0.95 };
  frame[LM.RIGHT_HEEL]     = { x: 0.57 + w(), y: 0.91 + w(), z: 0, visibility: 0.95 };

  return frame;
}
