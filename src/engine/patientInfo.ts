/**
 * src/engine/patientInfo.ts — PATIENT INFO LOADER
 *
 * The pipeline reads two things from the patient record:
 *   1. curr_program — list of (side+exercise) entries to run this session.
 *      The four calibration moves are normalized to product order on load:
 *      leftSls → rightSls → leftLsd → rightLsd; then any tail (e.g. walking).
 *   2. injuredjoint — joint name (mediapipe-style) flagged for ROM tracking
 *
 * The other demographic fields stay aligned with backend/schemas/patient.py.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TODO: REPLACE WITH BACKEND/SQL FETCH
 * ─────────────────────────────────────────────────────────────────────────────
 * For now this just imports a static JSON file from src/data/patientInfo.json.
 * When the patient DB is wired up, swap loadPatientInfo() to call the backend
 * (see backend/schemas/patient.py for the matching schema). The PatientInfo
 * shape below is intentionally identical to the JSON shape so the swap is
 * mechanical.
 */

import { ExerciseType, normalizeExerciseProgram } from './exercise/types';
import patientData from '../data/patientInfo.json';

export interface PatientInfo {
  patientId:            string;
  age:                  number;
  gender:               'male' | 'female' | 'other';
  heightCm:             number;
  weightKg:             number;
  bmi:                  number;
  demographicRiskScore: number;
  curr_program:         ExerciseType[];
  injuredjoint:         string;
}

/**
 * Load the active patient's info. Synchronous because the dummy source is
 * a bundled JSON; the backend version will return a Promise — call sites
 * already use `await loadPatientInfo()` to make that swap painless.
 */
export async function loadPatientInfo(): Promise<PatientInfo> {
  // TODO: replace with `await fetch(BACKEND_URL + '/patients/' + id)` once the
  // backend route exists. The JSON shape already matches the response model.
  const raw = patientData as PatientInfo;
  return {
    ...raw,
    curr_program: normalizeExerciseProgram(raw.curr_program),
  };
}
