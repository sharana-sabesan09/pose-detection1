import { BACKEND_URL } from '../constants';
import { UserProfile } from '../types';

let cachedAccessToken: string | null = null;

type HttpMethod = 'GET' | 'POST' | 'PUT';

export interface PatientOverview {
  id: string;
  metadata: {
    age: number;
    gender: 'male' | 'female' | 'other';
    heightCm: number;
    weightKg: number;
    bmi: number;
    demographicRiskScore: number;
  } | null;
  created_at: string;
  updated_at: string;
  session_count: number;
  accumulated_scores: {
    fall_risk_avg: number | null;
    reinjury_risk_avg: number | null;
  } | null;
  recent_sessions: Array<{
    session_id: string;
    kind: 'exercise' | 'pt';
    started_at: string;
    ended_at: string | null;
    exercise: string | null;
    summary: string | null;
    fall_risk_score: number | null;
    reinjury_risk_score: number | null;
    rom_score: number | null;
  }>;
}

async function getBackendToken(baseUrl: string, timeoutMs = 8000): Promise<string> {
  if (cachedAccessToken) return cachedAccessToken;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(baseUrl.replace(/\/+$/, '') + '/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'mobile-app', role: 'mobile' }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.access_token) throw new Error('token response missing access_token');
    cachedAccessToken = data.access_token as string;
    return cachedAccessToken;
  } finally {
    clearTimeout(timer);
  }
}

export async function backendRequest<T>(
  path: string,
  method: HttpMethod,
  body?: unknown,
  timeoutMs = 8000,
): Promise<T> {
  if (!BACKEND_URL) throw new Error('no backend URL configured');

  const token = await getBackendToken(BACKEND_URL, timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(BACKEND_URL.replace(/\/+$/, '') + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        cachedAccessToken = null;
      }
      throw new Error(`HTTP ${res.status}`);
    }

    return await res.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function upsertPatientProfile(profile: UserProfile) {
  return backendRequest(
    `/patients/${profile.patientId}`,
    'PUT',
    {
      age: profile.age,
      gender: profile.gender,
      heightCm: profile.heightCm,
      weightKg: profile.weightKg,
      bmi: profile.bmi,
      demographicRiskScore: profile.demographicRiskScore,
    },
  );
}

export async function fetchPatientOverview(patientId: string) {
  return backendRequest<PatientOverview>(`/patients/${patientId}/overview`, 'GET');
}

export async function fetchLatestReport(patientId: string) {
  return backendRequest<{ summary: string; session_highlights: string[]; recommendations: string[] }>(
    `/reports/${patientId}/latest`,
    'GET',
  );
}

export async function fetchProgressReport(patientId: string) {
  return backendRequest<{
    longitudinal_report: string;
    overall_trend: string;
    milestones_reached: string[];
    next_goals: string[];
  }>(`/reports/${patientId}/progress`, 'GET');
}
