// constants.example.ts — SAFE TO COMMIT. No real keys here.
//
// HOW TO USE:
//   1. Copy this file and rename the copy to constants.ts
//   2. Replace the placeholder strings with your real keys
//   3. constants.ts is gitignored — it will never be pushed to GitHub
//
// WHERE TO GET YOUR KEYS:
//   PERSONAL_ACCESS_KEY → zetic.ai → Account Settings → API Keys
//   POSE_MODEL_KEY      → zetic.ai → Model Hub → MediaPipe Pose → copy key

export const PERSONAL_ACCESS_KEY = 'YOUR_ZETIC_PERSONAL_ACCESS_KEY';
export const POSE_MODEL_KEY      = 'YOUR_ZETIC_MEDIAPIPE_POSE_MODEL_KEY';

// Your laptop's LAN IP + Metro port (8081 by default). End-of-recording
// session artifacts POST here and land in <repo>/exports/. Use
// 'ipconfig getifaddr en0' on macOS to find the IP. Use port 8000 instead
// if you're running the FastAPI backend. Set to '' to disable.
export const BACKEND_URL         = 'http://YOUR_LAPTOP_IP:8081';
