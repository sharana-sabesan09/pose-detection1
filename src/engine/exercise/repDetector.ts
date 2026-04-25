/**
 * src/engine/exercise/repDetector.ts — REP STATE MACHINE
 *
 * STATES:
 *   IDLE     — user is standing or hasn't started moving down yet
 *   DESCENT  — knee flexion is increasing (going down)
 *   ASCENT   — knee flexion is decreasing (coming up)
 *
 * EVENTS produced on transitions:
 *   repStart — IDLE   → DESCENT
 *   bottom   — DESCENT → ASCENT
 *   repEnd   — ASCENT → IDLE
 *
 * HYSTERESIS:
 *   - Velocity must exceed a deadband to switch direction (avoids flicker
 *     at the bottom of the rep where velocity oscillates near 0).
 *   - A descent only starts once knee flexion crosses DESCENT_TRIGGER_DEG.
 *   - A rep is rejected (no repStart event) if its peak knee flex doesn't
 *     reach MIN_REP_DEPTH_DEG by the time the user comes back up.
 *     (That logic lives in the aggregator / pipeline — the state machine
 *     itself is dumb on purpose.)
 */

import { FrameFeatures, RepState, RepStateEvents, REP_THRESHOLDS } from './types';

export interface UpdateRepStateOutput {
  state:  RepState;
  events: RepStateEvents;
}

/**
 * updateRepState — pure transition function. Given the current frame, the
 * previous frame, and the current state, returns the next state plus any
 * events that fired on this frame.
 *
 * Pass `prev = undefined` for the first frame ever (it stays IDLE, no events).
 */
export function updateRepState(
  current: FrameFeatures,
  prev: FrameFeatures | undefined,
  state: RepState,
): UpdateRepStateOutput {
  const events: RepStateEvents = {};
  if (!prev) return { state, events };

  const k  = current.kneeFlexion;
  const v  = current.velocityKneeFlex;
  const dead = REP_THRESHOLDS.VELOCITY_DEAD_DEG_S;

  switch (state) {
    case 'IDLE': {
      // Need clear downward motion AND enough flexion to qualify as a descent.
      if (v > dead && k > REP_THRESHOLDS.DESCENT_TRIGGER_DEG) {
        events.repStart = true;
        return { state: 'DESCENT', events };
      }
      return { state, events };
    }

    case 'DESCENT': {
      // Switch to ascent on velocity sign-flip past the deadband.
      if (v < -dead) {
        events.bottom = true;
        return { state: 'ASCENT', events };
      }
      return { state, events };
    }

    case 'ASCENT': {
      // Once the user is back near standing, the rep is over — we're already
      // in ASCENT so the bottom has been observed. Velocity is intentionally
      // NOT part of this check: a real squat usually has nonzero ascent
      // velocity at the moment the knees fully extend, and our synthetic
      // data does too.
      if (k < REP_THRESHOLDS.STAND_KNEE_DEG) {
        events.repEnd = true;
        return { state: 'IDLE', events };
      }
      return { state, events };
    }

    default:
      return { state: 'IDLE', events };
  }
}
