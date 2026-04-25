/**
 * src/constants.ts — API KEYS AND CREDENTIALS
 *
 * !! THIS FILE IS GITIGNORED — it will never be pushed to GitHub !!
 *
 * PERSONAL_ACCESS_KEY  — your ZETIC account key (already set).
 * MODEL_KEY            — the original LLM model key from the template (kept for reference).
 * POSE_MODEL_KEY       — the MediaPipe Pose model key from zetic.ai → Model Hub.
 *                        Replace the placeholder below once you have it.
 */

// Your personal ZETIC account key — proves you are an authorised user.
export const PERSONAL_ACCESS_KEY = 'ztp_ab9472b438a449a797289691bb023f29';

// Original LLM model key from the ZETIC template (not used by SENTINEL).
export const MODEL_KEY = 'a2ee025f302841a2b178883c361b4285';

// MediaPipe Pose model key — the model that detects 33 body landmarks per frame.
// Get it from: zetic.ai → Model Hub → MediaPipe Pose → copy the model key.
// Until this is set, the app runs in simulation mode (fake landmarks, real UI).
export const POSE_MODEL_KEY = 'a2ee025f302841a2b178883c361b4285';

// Where the phone POSTs completed exercise sessions at end-of-recording.
// The app now uses the production ingest route:
//   POST <BACKEND_URL>/auth/token
//   POST <BACKEND_URL>/sessions/exercise-result
//
// Use your laptop's LAN IP + FastAPI port for local dev, or Railway in prod.
// Set to '' to disable backend upload and use only the iOS share sheet.
export const BACKEND_URL = 'https://sentinel-backend-production-e75a.up.railway.app';
