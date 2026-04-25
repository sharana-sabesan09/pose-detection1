import AsyncStorage from '@react-native-async-storage/async-storage';
import { UserProfile } from '../types';

const STORAGE_KEY = 'sentinel_profile';

export function generatePatientId(): string {
  return `pt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function saveStoredProfile(profile: UserProfile): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

export async function loadStoredProfile(): Promise<UserProfile | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  const parsed = JSON.parse(raw) as Partial<UserProfile>;
  if (parsed.patientId) {
    return parsed as UserProfile;
  }

  const upgraded: UserProfile = {
    patientId: generatePatientId(),
    age: parsed.age ?? 0,
    gender: parsed.gender ?? 'other',
    heightCm: parsed.heightCm ?? 0,
    weightKg: parsed.weightKg ?? 0,
    bmi: parsed.bmi ?? 0,
    demographicRiskScore: parsed.demographicRiskScore ?? 0,
    backendProfileSyncedAt: parsed.backendProfileSyncedAt,
  };
  await saveStoredProfile(upgraded);
  return upgraded;
}
