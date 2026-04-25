/**
 * src/engine/exercise/exporter.ts — SHIP SESSION ARTIFACTS OFF THE PHONE
 *
 * Two complementary exit paths so the user can pick the artifacts up
 * on a laptop without ever attaching the phone to Xcode:
 *
 *   1. Backend POST  — fetch() to <BACKEND_URL>/exports/session.
 *                      The laptop writes session.json / reps.csv / reps.jsonl
 *                      / frames.csv into <repo>/exports/<stamp>_<id>/.
 *                      Preferred path. Requires phone + laptop on same LAN.
 *
 *   2. iOS share sheet — Share.share({ message }). AirDrop / Mail / Files /
 *                        Notes. No native deps, no pod install. Used as a
 *                        fallback or "share again" affordance.
 *
 * The functions are pure async; SessionScreen calls them in finishRecording.
 *
 * NOTE on schema:
 *   The "full session JSON" is just SessionSummary (already nests every
 *   RepFeatures in summary.reps[]) plus a few session-meta fields stitched
 *   in by buildSessionJson(). That's the single artifact the user asked
 *   for — one full schema for the video with nested per-rep schemas.
 */

import { Share } from 'react-native';
import { RepFeatures, SessionSummary } from './types';
import { buildRepsCsv } from './csvWriter';

// ─────────────────────────────────────────────────────────────────────────────
// Schema builders
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionExportPayload {
  sessionId:    string;
  startedAtMs:  number;
  endedAtMs:    number;
  durationMs:   number;
  exercise:     string;
  numReps:      number;
  summary:      SessionSummary;
  /** One JSON object per line — the rep schema the user pasted in their plan. */
  repsJsonl:    string;
  /** Same data, CSV form. */
  repsCsv:      string;
}

/**
 * Stitch the full session JSON: SessionSummary plus session-level metadata.
 * Pretty-printed because the user is going to read it on a laptop.
 */
export function buildSessionJson(
  sessionId: string,
  startedAtMs: number,
  endedAtMs: number,
  summary: SessionSummary,
): string {
  const doc = {
    sessionId,
    startedAtMs,
    endedAtMs,
    durationMs: Math.max(0, endedAtMs - startedAtMs),
    exercise:   summary.exercise,
    numReps:    summary.summary.numReps,
    summary,
  };
  return JSON.stringify(doc, null, 2);
}

/** One JSON object per line — easy to grep / tail / pipe into pandas. */
export function buildRepsJsonl(reps: RepFeatures[]): string {
  return reps.map(r => JSON.stringify(r)).join('\n') + (reps.length ? '\n' : '');
}

export function buildExportPayload(
  sessionId: string,
  startedAtMs: number,
  endedAtMs: number,
  summary: SessionSummary,
): SessionExportPayload {
  return {
    sessionId,
    startedAtMs,
    endedAtMs,
    durationMs: Math.max(0, endedAtMs - startedAtMs),
    exercise:   summary.exercise,
    numReps:    summary.summary.numReps,
    summary,
    repsJsonl:  buildRepsJsonl(summary.reps),
    repsCsv:    buildRepsCsv(summary.reps),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Backend POST
// ─────────────────────────────────────────────────────────────────────────────

export interface BackendExportResult {
  ok:        boolean;
  status?:   number;
  writtenTo?: string;
  files?:    string[];
  error?:    string;
}

/**
 * POST the session artifacts to the laptop running the FastAPI backend.
 * Returns ok=false (never throws) so the caller can fall back to the
 * share sheet without a try/catch dance.
 *
 * Pass null/empty baseUrl to disable. Trailing slashes on baseUrl are fine.
 */
export async function postSessionToBackend(
  baseUrl: string | null | undefined,
  payload: SessionExportPayload,
  framesCsv?: string,
  timeoutMs = 8000,
): Promise<BackendExportResult> {
  if (!baseUrl) return { ok: false, error: 'no backend URL configured' };

  const url = baseUrl.replace(/\/+$/, '') + '/exports/session';
  const summaryJson = buildSessionJson(
    payload.sessionId,
    payload.startedAtMs,
    payload.endedAtMs,
    payload.summary,
  );

  const body = {
    session_id:   payload.sessionId,
    summary_json: summaryJson,
    reps_csv:     payload.repsCsv,
    reps_jsonl:   payload.repsJsonl,
    frames_csv:   framesCsv,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    }
    const data = await res.json().catch(() => ({}));
    return {
      ok:        true,
      status:    res.status,
      writtenTo: data?.written_to,
      files:     data?.files,
    };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, error: (e as Error).message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// iOS share sheet
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Open the native share sheet with the full session JSON as the payload.
 * On iOS the user can AirDrop straight to their Mac, save to Files, or
 * mail it to themselves — no Xcode in the loop.
 *
 * The CSV/JSONL strings tend to be much smaller than the JSON because
 * frames aren't included; we expose a `body` arg so SessionScreen can
 * choose what to share if it ever wants to send the CSV instead.
 */
export async function shareSessionViaSheet(
  payload: SessionExportPayload,
  body?: string,
): Promise<{ ok: boolean; action?: string; error?: string }> {
  const message = body ?? buildSessionJson(
    payload.sessionId,
    payload.startedAtMs,
    payload.endedAtMs,
    payload.summary,
  );
  try {
    const result = await Share.share(
      { message, title: `sentinel-${payload.sessionId}.json` },
      { subject: `Sentinel session ${payload.sessionId}` },
    );
    return { ok: result.action !== Share.dismissedAction, action: result.action };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
