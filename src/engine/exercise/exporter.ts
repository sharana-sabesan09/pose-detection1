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
import {
  ExerciseType,
  FrameFeatures,
  InjuredJointInfo,
  MultiExerciseSession,
  RepFeatures,
  SessionExerciseEntry,
  SessionSummary,
} from './types';
import { buildFrameDebugCsv, buildRepsCsv } from './csvWriter';

// ─────────────────────────────────────────────────────────────────────────────
// Schema builders
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionExportPayload {
  /** Synthetic per-exercise id — `<visitId>-<exercise>-<i>`. Sent to the
   *  backend as `sessionId` for backward compatibility with older clients. */
  exerciseId:   string;
  /** Top-level MultiExerciseSession.sessionId — shared across all exercises
   *  in this visit. Sent to the backend as `visitId`. */
  visitId:      string;
  /** Per-exercise injured-joint ROM carve-out (or null for walking / unknown). */
  injuredJointRom: { joint: string; rom: number | null } | null;
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
  /**
   * Optional calibration markers for the fixed 4-step filming protocol.
   * When set, both fields must be present together (backend validates).
   */
  calibrationBatchId?: string;
  calibrationStep?: 1 | 2 | 3 | 4;
}

/**
 * Stitch the full session JSON: SessionSummary plus session-level metadata.
 * Pretty-printed because the user is going to read it on a laptop.
 */
export function buildSessionJson(
  exerciseId: string,
  startedAtMs: number,
  endedAtMs: number,
  summary: SessionSummary,
): string {
  const doc = {
    sessionId:  exerciseId,
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
  exerciseId: string,
  visitId: string,
  injuredJointRom: { joint: string; rom: number | null } | null,
  startedAtMs: number,
  endedAtMs: number,
  summary: SessionSummary,
  frameFeatures: FrameFeatures[],
  patientId?: string | null,
  calibration?: { batchId: string; step: 1 | 2 | 3 | 4 },
): SessionExportPayload {
  return {
    exerciseId,
    visitId,
    injuredJointRom,
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
    calibrationBatchId: calibration?.batchId,
    calibrationStep: calibration?.step,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-exercise session
//
// One recording session may produce multiple exercise entries (e.g. left+right
// SLS, left+right step-down, walking). The wrapper preserves each entry's
// shape exactly so anything that previously consumed the single-exercise JSON
// can still read individual entries.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a SessionExerciseEntry from a finalised SessionSummary plus its
 * recording window. This is the per-exercise sub-document that gets
 * appended to MultiExerciseSession.exercises[].
 */
/**
 * Compute the per-exercise ROM number for one finished entry. Mirrors
 * computeRomByExercise but for a single SessionSummary so we can attach
 * it directly to the entry as it finishes (no second pass needed).
 *
 * Returns null for walking (which doesn't measure joint ROM). For
 * rep-based exercises that ran but produced no reps, returns
 * `{ joint, rom: null }` so the field still exists for longitudinal
 * tracking continuity.
 */
function computeInjuredJointRomForEntry(
  summary: SessionSummary,
  injuredJointName: string,
): { joint: string; rom: number | null } | null {
  if (summary.exercise === 'walking') return null;
  const reps = summary.reps;
  if (reps.length === 0) return { joint: injuredJointName, rom: null };
  const sum = reps.reduce((s, r) => s + r.features.romRatio, 0);
  return { joint: injuredJointName, rom: sum / reps.length };
}

export function buildSessionExerciseEntry(
  summary: SessionSummary,
  startedAtMs: number,
  endedAtMs: number,
  visitId: string,
  injuredJointName: string,
): SessionExerciseEntry {
  return {
    exercise:    summary.exercise,
    visitId,
    injuredJointRom: computeInjuredJointRomForEntry(summary, injuredJointName),
    startedAtMs,
    endedAtMs,
    durationMs:  Math.max(0, endedAtMs - startedAtMs),
    numReps:     summary.summary.numReps,
    summary,
  };
}

/**
 * Compute a ROM score per rep-based exercise: mean romRatio across that
 * exercise's reps. Walking is excluded — it doesn't measure joint ROM.
 * Rep-based exercises that ran but produced no reps map to null so the
 * field still exists for longitudinal tracking continuity.
 */
function computeRomByExercise(
  entries: SessionExerciseEntry[],
): Partial<Record<ExerciseType, number | null>> {
  const out: Partial<Record<ExerciseType, number | null>> = {};
  for (const e of entries) {
    if (e.exercise === 'walking') continue;
    const reps = e.summary.reps;
    if (reps.length === 0) {
      out[e.exercise as ExerciseType] = null;
      continue;
    }
    const sum = reps.reduce((s, r) => s + r.features.romRatio, 0);
    out[e.exercise as ExerciseType] = sum / reps.length;
  }
  return out;
}

export function buildMultiExerciseSession(
  sessionId: string,
  startedAtMs: number,
  endedAtMs: number,
  patientId: string,
  injuredJointName: string,
  entries: SessionExerciseEntry[],
): MultiExerciseSession {
  const injuredJoint: InjuredJointInfo = {
    name: injuredJointName,
    romByExercise: computeRomByExercise(entries),
  };
  return {
    sessionId,
    startedAtMs,
    endedAtMs,
    durationMs: Math.max(0, endedAtMs - startedAtMs),
    patient: { patientId, injuredJoint },
    exercises: entries,
  };
}

export function buildMultiExerciseJson(session: MultiExerciseSession): string {
  return JSON.stringify(session, null, 2);
}

export interface MultiSessionExportPayload {
  session:          MultiExerciseSession;
  /** All exercise reps concatenated, JSONL form. Convenience for analysis tools. */
  repsJsonl:        string;
  /** All exercise reps concatenated, CSV form. */
  repsCsv:          string;
  /** Per-frame features CSV, all exercises concatenated with an exercise column. */
  frameFeaturesCsv: string;
}

export function buildMultiSessionExportPayload(
  session: MultiExerciseSession,
  framesByExercise: { exercise: string; frames: FrameFeatures[] }[],
): MultiSessionExportPayload {
  const allReps: RepFeatures[] = session.exercises.flatMap(e => e.summary.reps);
  const repsJsonl = buildRepsJsonl(allReps);
  const repsCsv   = buildRepsCsv(allReps);

  // Frame features CSV: emit one block per exercise. Each block carries its
  // own header line so downstream tools can split by header.
  const frameBlocks = framesByExercise
    .map(({ exercise, frames }) =>
      `# exercise: ${exercise}\n` + buildFrameDebugCsv(frames),
    )
    .join('\n');

  return {
    session,
    repsJsonl,
    repsCsv,
    frameFeaturesCsv: frameBlocks,
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

function n(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function sanitizeSessionSummaryForBackend(summary: SessionSummary): SessionSummary {
  return {
    ...summary,
    summary: {
      ...summary.summary,
      // Backend schema expects numeric floats; walking/no-rep sessions may carry nulls.
      avgDepth: n(summary.summary.avgDepth),
      minDepth: n(summary.summary.minDepth),
      avgFppa: n(summary.summary.avgFppa),
      maxFppa: n(summary.summary.maxFppa),
      consistency: n(summary.summary.consistency),
    },
  };
}

function formatErrorDetail(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
export async function postExerciseToBackend(
  baseUrl: string | null | undefined,
  payload: SessionExportPayload,
  framesCsv?: string,
  timeoutMs = 15000,
): Promise<BackendExportResult> {
  if (!baseUrl) return { ok: false, error: 'no backend URL configured' };

  const url = baseUrl.replace(/\/+$/, '') + '/sessions/exercise-result';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const safeSummary = sanitizeSessionSummaryForBackend(payload.summary);
    const token = await getBackendToken(baseUrl, timeoutMs);
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body:    JSON.stringify({
        // `sessionId` is the legacy field name on the backend body — it
        // carries the synthetic per-exercise id. `visitId` is the new
        // shared-across-the-visit identifier.
        sessionId: payload.exerciseId,
        visitId: payload.visitId,
        injuredJointRom: payload.injuredJointRom,
        startedAtMs: payload.startedAtMs,
        endedAtMs: payload.endedAtMs,
        durationMs: payload.durationMs,
        exercise: payload.exercise,
        numReps: payload.numReps,
        summary: safeSummary,
        patientId: payload.patientId ?? null,
        repsCsv: payload.repsCsv,
        frameFeaturesCsv: payload.frameFeaturesCsv,
        framesCsv: framesCsv ?? null,
        ...(payload.calibrationBatchId && payload.calibrationStep
          ? {
              calibrationBatchId: payload.calibrationBatchId,
              calibrationStep: payload.calibrationStep,
            }
          : {}),
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
        if (parsed?.detail !== undefined) detail = formatErrorDetail(parsed.detail);
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
        session_id: payload.exerciseId,
        summary_json: buildSessionJson(
          payload.exerciseId,
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
    payload.exerciseId,
    payload.startedAtMs,
    payload.endedAtMs,
    payload.summary,
  );
  try {
    const result = await Share.share(
      { message, title: `sentinel-${payload.exerciseId}.json` },
      { subject: `onTrack exercise ${payload.exerciseId}` },
    );
    return { ok: result.action !== Share.dismissedAction, action: result.action };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-exercise session — archive POST + local export + share
//
// The whole MultiExerciseSession payload is archived once per visit via
// POST /sessions/multi-exercise-archive. The current backend ingest path
// does NOT read that table back — it exists for a future longitudinal
// agent. Per-exercise rows continue to be sent one at a time through
// postExerciseToBackend; this archive call is fire-and-forget on top.
// ─────────────────────────────────────────────────────────────────────────────

export async function postMultiExerciseArchiveToBackend(
  baseUrl: string | null | undefined,
  session: MultiExerciseSession,
  timeoutMs = 15000,
): Promise<BackendExportResult> {
  if (!baseUrl) return { ok: false, error: 'no backend URL configured' };

  const url = baseUrl.replace(/\/+$/, '') + '/sessions/multi-exercise-archive';
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
      body: JSON.stringify({
        visitId:     session.sessionId,
        startedAtMs: session.startedAtMs,
        endedAtMs:   session.endedAtMs,
        durationMs:  session.durationMs,
        patientId:   session.patient.patientId,
        payload:     session,
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
        if (parsed?.detail !== undefined) detail = formatErrorDetail(parsed.detail);
      } catch { /* keep raw */ }
      return {
        ok: false,
        status: res.status,
        detail: detail || undefined,
        error: detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`,
      };
    }
    await res.json().catch(() => ({}));
    return { ok: true, status: res.status };
  } catch (e) {
    clearTimeout(timer);
    cachedAccessToken = null;
    return { ok: false, error: (e as Error).message };
  }
}

export async function postMultiSessionToLocalExports(
  baseUrl: string | null | undefined,
  payload: MultiSessionExportPayload,
  framesCsv?: string,
  timeoutMs = 20000,
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
        session_id:   payload.session.sessionId,
        summary_json: buildMultiExerciseJson(payload.session),
        reps_csv:     payload.repsCsv,
        reps_jsonl:   payload.repsJsonl,
        frames_csv:   framesCsv ?? payload.frameFeaturesCsv,
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
    return { ok: true, status: res.status, writtenTo: data?.written_to, files: data?.files };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, error: (e as Error).message };
  }
}

export async function shareMultiSessionViaSheet(
  payload: MultiSessionExportPayload,
): Promise<{ ok: boolean; action?: string; error?: string }> {
  const message = buildMultiExerciseJson(payload.session);
  try {
    const result = await Share.share(
      { message, title: `sentinel-${payload.session.sessionId}.json` },
      { subject: `onTrack session ${payload.session.sessionId}` },
    );
    return { ok: result.action !== Share.dismissedAction, action: result.action };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
