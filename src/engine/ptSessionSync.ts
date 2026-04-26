import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  endBackendSession,
  replaceBackendSessionFrameFeatures,
  startBackendSession,
} from './backendClient';

export type PtSessionType = 'treatment' | 'assessment' | 'home_exercise_check';

export interface PtSessionSyncDraft {
  draftId: string;
  backendSessionId: string;
  visitId: string;
  patientId: string;
  startedAtMs: number;
  endedAtMs: number;
  exerciseCount: number;
  frameFeaturesCsv: string;
  createdAt: string;
}

export interface PtSessionSyncIntake {
  sessionType: PtSessionType;
  painScores: Record<string, number>;
  ptPlan: string;
  userInput: string;
}

export interface PendingPtSessionSync extends PtSessionSyncDraft {
  intake: PtSessionSyncIntake;
  queuedAt: string;
  attempts: number;
  lastError?: string;
}

const DRAFT_KEY_PREFIX = 'sentinel_pt_session_draft_';
const QUEUE_KEY = 'sentinel_pt_session_sync_queue';

function draftKey(draftId: string): string {
  return `${DRAFT_KEY_PREFIX}${draftId}`;
}

function newRandomId(): string {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export function createPtSessionSyncIds(): {
  draftId: string;
  backendSessionId: string;
} {
  return {
    draftId: `draft-${newRandomId()}`,
    backendSessionId: newRandomId(),
  };
}

async function readQueue(): Promise<PendingPtSessionSync[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed as PendingPtSessionSync[] : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: PendingPtSessionSync[]): Promise<void> {
  if (queue.length === 0) {
    await AsyncStorage.removeItem(QUEUE_KEY);
    return;
  }
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

async function syncPendingPtSession(item: PendingPtSessionSync): Promise<void> {
  await startBackendSession(
    item.backendSessionId,
    item.patientId,
    item.intake.ptPlan,
    item.startedAtMs,
  );
  await replaceBackendSessionFrameFeatures(
    item.backendSessionId,
    item.frameFeaturesCsv,
  );
  await endBackendSession(item.backendSessionId, {
    patientId: item.patientId,
    ptPlan: item.intake.ptPlan,
    painScores: item.intake.painScores,
    userInput: item.intake.userInput,
    sessionType: item.intake.sessionType,
    endedAtMs: item.endedAtMs,
  });
}

export async function savePtSessionSyncDraft(draft: PtSessionSyncDraft): Promise<void> {
  await AsyncStorage.setItem(draftKey(draft.draftId), JSON.stringify(draft));
}

export async function loadPtSessionSyncDraft(
  draftId: string,
): Promise<PtSessionSyncDraft | null> {
  const raw = await AsyncStorage.getItem(draftKey(draftId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PtSessionSyncDraft;
  } catch {
    return null;
  }
}

export async function deletePtSessionSyncDraft(draftId: string): Promise<void> {
  await AsyncStorage.removeItem(draftKey(draftId));
}

export async function queuePtSessionSync(
  draft: PtSessionSyncDraft,
  intake: PtSessionSyncIntake,
): Promise<PendingPtSessionSync> {
  const queued: PendingPtSessionSync = {
    ...draft,
    intake,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  };
  const queue = await readQueue();
  const nextQueue = [
    ...queue.filter(item => item.draftId !== draft.draftId),
    queued,
  ];
  await writeQueue(nextQueue);
  await deletePtSessionSyncDraft(draft.draftId);
  return queued;
}

export async function flushPendingPtSessionQueue(): Promise<{
  synced: number;
  failed: number;
  errors: string[];
}> {
  const queue = await readQueue();
  if (queue.length === 0) {
    return { synced: 0, failed: 0, errors: [] };
  }

  let synced = 0;
  let failed = 0;
  const errors: string[] = [];
  const remaining: PendingPtSessionSync[] = [];

  for (const item of queue) {
    try {
      await syncPendingPtSession(item);
      synced += 1;
    } catch (e) {
      failed += 1;
      const message = (e as Error).message;
      errors.push(message);
      remaining.push({
        ...item,
        attempts: item.attempts + 1,
        lastError: message,
      });
    }
  }

  await writeQueue(remaining);
  return { synced, failed, errors };
}
