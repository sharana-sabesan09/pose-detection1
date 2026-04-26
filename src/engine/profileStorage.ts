import AsyncStorage from '@react-native-async-storage/async-storage';
import { UserProfile } from '../types';

const STORAGE_KEY = 'sentinel_profile';

export function generatePatientId(): string {
  return `pt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeStoredProfile(parsed: Partial<UserProfile>): UserProfile {
  return {
    patientId: parsed.patientId ?? generatePatientId(),
    name: parsed.name,
    age: parsed.age ?? 0,
    gender: parsed.gender ?? 'other',
    heightCm: parsed.heightCm ?? 0,
    weightKg: parsed.weightKg ?? 0,
    bmi: parsed.bmi ?? 0,
    demographicRiskScore: parsed.demographicRiskScore ?? 0,
    injured_joints: Array.isArray(parsed.injured_joints) ? parsed.injured_joints : [],
    injured_side: parsed.injured_side ?? 'unknown',
    rehab_phase: parsed.rehab_phase ?? 'unknown',
    diagnosis: parsed.diagnosis ?? '',
    contraindications: Array.isArray(parsed.contraindications)
      ? parsed.contraindications
      : [],
    restrictions: Array.isArray(parsed.restrictions) ? parsed.restrictions : [],
    doctorName: parsed.doctorName,
    doctorEmail: parsed.doctorEmail,
    ptRecords: Array.isArray(parsed.ptRecords) ? parsed.ptRecords : [],
    ptRecordsNote: parsed.ptRecordsNote ?? '',
    backendProfileSyncedAt: parsed.backendProfileSyncedAt,
  };
}

export async function saveStoredProfile(profile: UserProfile): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

export async function loadStoredProfile(): Promise<UserProfile | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  const parsed = JSON.parse(raw) as Partial<UserProfile>;
  const normalized = normalizeStoredProfile(parsed);
  const needsMigration =
    !parsed.patientId ||
    parsed.injured_joints === undefined ||
    parsed.injured_side === undefined ||
    parsed.rehab_phase === undefined ||
    parsed.diagnosis === undefined ||
    parsed.contraindications === undefined ||
    parsed.restrictions === undefined ||
    parsed.ptRecords === undefined ||
    parsed.ptRecordsNote === undefined;

  if (needsMigration) {
    await saveStoredProfile(normalized);
  }
  return normalized;
}
