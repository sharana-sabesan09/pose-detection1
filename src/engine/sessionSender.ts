/**
 * src/engine/sessionSender.ts — POST SESSION DATA TO LOCAL LAPTOP RECEIVER
 *
 * The iOS simulator shares localhost with the Mac, so we can POST directly
 * to a tiny Node server running on the same machine (tools/session-receiver.js).
 *
 * USAGE:
 *   1. Start the receiver on your laptop:
 *        node tools/session-receiver.js
 *   2. Run the app in the simulator (npm run ios)
 *   3. Record a session — data appears in tools/data/ automatically
 *
 * PHYSICAL DEVICE:
 *   Change RECEIVER_URL below to your Mac's LAN IP, e.g.:
 *     http://192.168.1.42:3001/session
 *   (find it with: ifconfig | grep "inet 192")
 *
 * This module never throws — all errors are caught and logged.
 * If the receiver isn't running, the app continues normally.
 */

import { SessionMode } from '../types';
import { RecordedFrame } from './analyzeRecording';
import { SessionSummary } from './exercise/types';

// ─── Change to your Mac's LAN IP when using a physical device ───────────────
const RECEIVER_URL = 'http://localhost:3001/session';

// Set to false to skip sending raw frames (they're large — ~2MB for 60s).
const SEND_RAW_FRAMES = true;

/**
 * sendSessionToLaptop — fire-and-forget POST to the local receiver.
 *
 * @param sessionId  ISO timestamp string (matches the AsyncStorage analysis id)
 * @param session    Full SessionSummary from ExercisePipeline.finalize()
 * @param frames     Raw recorded frames (optional — omit to save bandwidth)
 * @param mode       Session mode used during recording
 */
export async function sendSessionToLaptop(
  sessionId: string,
  session: SessionSummary,
  frames: RecordedFrame[],
  mode: SessionMode,
): Promise<void> {
  try {
    const payload = {
      sessionId,
      session,
      frames: SEND_RAW_FRAMES ? frames : [],
      mode,
    };

    const res = await fetch(RECEIVER_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    if (res.ok) {
      console.log(
        `[sessionSender] ✅ sent ${session.reps.length} rep(s) to laptop` +
        (SEND_RAW_FRAMES ? ` + ${frames.length} raw frames` : ''),
      );
    } else {
      console.warn('[sessionSender] receiver returned', res.status);
    }
  } catch (e) {
    // Receiver not running, or network issue — non-fatal.
    console.warn('[sessionSender] could not reach laptop receiver:', (e as Error).message);
    console.warn('[sessionSender] is `node tools/session-receiver.js` running?');
  }
}
