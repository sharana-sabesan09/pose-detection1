/**
 * src/engine/exercise/exporter.ts — SHIP SESSION ARTIFACTS OFF THE PHONE
 *
 * Two complementary exit paths:
 *
 *   1. Backend POST  — fetch() to <BACKEND_URL>/sessions/exercise-result.
 *                      Preferred path. Persists the uploaded schema into
 *                      PostgreSQL (`exercise_sessions`, `rep_analyses`) and
 *                      stores frame-feature rows into `pose_frames`.
 *
 *   2. iOS share sheet — Share.share({ message }). AirDrop / Mail / Files /
 *                        Notes. Used as a fallback if the backend upload fails.
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
import { FrameFeatures, RepFeatures, SessionSummary } from './types';
import { buildFrameDebugCsv, buildRepsCsv } from './csvWriter';

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
  /** Per-frame exercise features, CSV form. */
  frameFeaturesCsv: string;
  /** Optional backend patient linkage. */
  patientId?: string | null;
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
  frameFeatures: FrameFeatures[],
  patientId?: string | null,
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
    frameFeaturesCsv: buildFrameDebugCsv(frameFeatures),
    patientId: patientId ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Backend POST
// ─────────────────────────────────────────────────────────────────────────────

export interface BackendExportResult {
  ok:        boolean;
  status?:   number;
  id?: string;
  linkedSessionId?: string;
  writtenTo?: string;
  files?: string[];
  detail?:   string;
  error?:    string;
}

let cachedAccessToken: string | null = null;

async function getBackendToken(baseUrl: string, timeoutMs: number): Promise<string> {
  if (cachedAccessToken) return cachedAccessToken;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const tokenUrl = baseUrl.replace(/\/+$/, '') + '/auth/token';
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'mobile-app', role: 'mobile' }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`token request failed with HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data?.access_token) {
      throw new Error('token response missing access_token');
    }
    cachedAccessToken = data.access_token;
    return data.access_token as string;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST the completed exercise session to the FastAPI backend.
 * Returns ok=false (never throws) so the caller can fall back to the
 * share sheet without a try/catch dance.
 *
 * Pass null/empty baseUrl to disable. Trailing slashes on baseUrl are fine.
 */
export async function postSessionToBackend(
  baseUrl: string | null | undefined,
  payload: SessionExportPayload,
  timeoutMs = 15000,
): Promise<BackendExportResult> {
  if (!baseUrl) return { ok: false, error: 'no backend URL configured' };

  const url = baseUrl.replace(/\/+$/, '') + '/sessions/exercise-result';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const token = await getBackendToken(baseUrl, timeoutMs);
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body:    JSON.stringify({
        sessionId: payload.sessionId,
        startedAtMs: payload.startedAtMs,
        endedAtMs: payload.endedAtMs,
        durationMs: payload.durationMs,
        exercise: payload.exercise,
        numReps: payload.numReps,
        summary: payload.summary,
        patientId: payload.patientId ?? null,
        repsCsv: payload.repsCsv,
        frameFeaturesCsv: payload.frameFeaturesCsv,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      const trimmed = raw.trim();
      let detail = trimmed;
      try {
        const parsed = trimmed ? JSON.parse(trimmed) : null;
        if (parsed?.detail) detail = String(parsed.detail);
      } catch {
        // keep raw text fallback
      }
      return {
        ok: false,
        status: res.status,
        detail: detail || undefined,
        error: detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`,
      };
    }
    const data = await res.json().catch(() => ({}));
    return {
      ok: true,
      status: res.status,
      id: data?.id,
      linkedSessionId: data?.linkedSessionId,
    };
  } catch (e) {
    clearTimeout(timer);
    cachedAccessToken = null;
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Local dev export path — writes artifacts to backend repo's /exports folder.
 * This is intentionally independent from Railway/Postgres ingest.
 */
export async function postSessionToLocalExports(
  baseUrl: string | null | undefined,
  payload: SessionExportPayload,
  framesCsv?: string,
  timeoutMs = 15000,
): Promise<BackendExportResult> {
  if (!baseUrl) return { ok: false, error: 'no local exports URL configured' };

  const url = baseUrl.replace(/\/+$/, '') + '/exports/session';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: payload.sessionId,
        summary_json: buildSessionJson(
          payload.sessionId,
          payload.startedAtMs,
          payload.endedAtMs,
          payload.summary,
        ),
        reps_csv: payload.repsCsv,
        reps_jsonl: payload.repsJsonl,
        frames_csv: framesCsv ?? payload.frameFeaturesCsv,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      return {
        ok: false,
        status: res.status,
        detail: raw || undefined,
        error: raw ? `HTTP ${res.status}: ${raw}` : `HTTP ${res.status}`,
      };
    }
    const data = await res.json().catch(() => ({}));
    return {
      ok: true,
      status: res.status,
      writtenTo: data?.written_to,
      files: data?.files,
    };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Optional dev helper for sending frames.csv to the exports router separately.
 * The main production upload already includes frameFeaturesCsv in
 * POST /sessions/exercise-result.
 */
export async function postFramesToBackend(
  baseUrl: string | null | undefined,
  sessionId: string,
  outDir: string,
  framesCsv: string,
  timeoutMs = 60000,
): Promise<BackendExportResult> {
  if (!baseUrl) return { ok: false, error: 'no backend URL configured' };

  const url = baseUrl.replace(/\/+$/, '') + '/exports/frames';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ session_id: sessionId, out_dir: outDir, frames_csv: framesCsv }),
      signal:  controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    await res.json().catch(() => ({}));
    return { ok: true, status: res.status };
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
