/**
 * src/types/index.ts — THE APP'S SHARED VOCABULARY
 *
 * TypeScript requires every piece of data to have a defined "shape" — a list
 * of what fields it contains and what type each field is.
 * This file is the single source of truth for those shapes across the whole app.
 *
 * Think of it like a glossary: if SessionScreen, the detectors, and the Claude
 * API call all need to talk about a "UserProfile", they all import the same
 * definition from here so they're guaranteed to agree on what a UserProfile looks like.
 *
 * If you ever need to add or change a field (e.g. add a "medications" field
 * to UserProfile), you change it once here and TypeScript tells you everywhere
 * else that needs to be updated.
 */

/**
 * UserProfile — WHAT WE KNOW ABOUT THE PERSON USING THE APP
 *
 * Collected once on the Intake Form screen. Saved to AsyncStorage.
 * Loaded at the start of every session so risk scores can be personalised.
 *
 * Fields:
 *   age                — The user's age in years.
 *   gender             — Biological sex. Matters clinically: females aged 65+
 *                        have elevated fall risk (Rivolta et al. 2019).
 *   heightCm           — Height in centimetres. Used to compute BMI.
 *   weightKg           — Weight in kilograms. Used to compute BMI.
 *   bmi                — Body Mass Index = weight(kg) / height(m)².
 *                        Extremes (underweight or obese) raise fall risk.
 *   demographicRiskScore — A single number (0–100) that summarises all the
 *                        above risk factors. Computed once on intake and baked
 *                        into every Overall Fall Risk score during the session.
 *                        0 = no demographic risk, 100 = maximum demographic risk.
 */
export type InjuredSide = 'left' | 'right' | 'bilateral' | 'unknown';

export type RehabPhase =
  | 'acute'
  | 'sub-acute'
  | 'functional'
  | 'return-to-sport'
  | 'unknown';

export interface PTRecordSummary {
  id: string;
  name: string;
  pages: number;
  added: string;
}

export interface UserProfile {
  patientId: string;
  name?: string;
  age: number;
  gender: 'male' | 'female' | 'other';
  heightCm: number;
  weightKg: number;
  bmi: number;
  demographicRiskScore: number;
  injured_joints: string[];
  injured_side: InjuredSide;
  rehab_phase: RehabPhase;
  diagnosis: string;
  contraindications: string[];
  restrictions: string[];
  doctorName?: string;
  doctorEmail?: string;
  ptRecords?: PTRecordSummary[];
  ptRecordsNote?: string;
  backendProfileSyncedAt?: string;
}

/**
 * SessionMode — WHICH MOVEMENT THE USER IS CURRENTLY PERFORMING
 *
 * The user picks one mode before they start moving.
 * Each mode activates different detectors and shows different scores:
 *
 *   'standing'    → activates Balance Stability detector.
 *                   The person stands still. We measure sway.
 *
 *   'transition'  → activates Transition Safety detector.
 *                   The person sits down or stands up. We measure
 *                   how long it takes and how much they wobble after.
 *
 *   'walking'     → activates Gait Regularity and Lateral Sway detectors.
 *                   The person walks. We measure step rhythm and hip sway.
 *
 * Scores from inactive modes are shown dimmed with their last known value
 * (they don't reset to zero — that would be misleading).
 */
export type SessionMode = 'standing' | 'transition' | 'walking';

/**
 * RiskScores — THE FIVE NUMBERS SHOWN ON THE LIVE DASHBOARD
 *
 * Each score runs from 0 (worst) to 100 (best / safest).
 * They update 30 times per second as the camera sees new poses.
 *
 * Colour coding on the dashboard:
 *   75–100 → Green  (low risk, safe to continue)
 *   50–74  → Yellow (moderate risk, proceed with caution)
 *   25–49  → Orange (high risk, consider stopping)
 *   0–24   → Red    (critical, stop immediately)
 *
 *   balanceStability  — How steadily the person stands still.
 *                       Derived from the Standing Stability detector.
 *
 *   transitionSafety  — How safely the person moves from sitting to standing.
 *                       Derived from Stand-Up Duration + Post-Stand Wobble.
 *
 *   gaitRegularity    — How even and rhythmic the walking pattern is.
 *                       Derived from Step Rhythm Consistency.
 *                       Highest weight (25%) — it's the single strongest
 *                       predictor of fall risk in the Rivolta 2019 study.
 *
 *   lateralSway       — How much the hips swing side-to-side while walking.
 *                       Derived from Lateral Trunk Sway.
 *                       Second strongest predictor.
 *
 *   overallFallRisk   — The headline score. Weighted combination of all four
 *                       scores above plus the user's demographic risk.
 *                       Weights: gaitRegularity 25%, others 20% each.
 */
export interface RiskScores {
  balanceStability: number;
  transitionSafety: number;
  gaitRegularity: number;
  lateralSway: number;
  overallFallRisk: number;
}

/**
 * Landmark — ONE BODY POINT DETECTED BY MEDIAPIPE POSE
 *
 * MediaPipe Pose identifies 33 points on the human body (joints, ears, etc.).
 * Each point is described by its position in 3D space relative to the camera frame.
 *
 *   x, y   — horizontal and vertical position as a fraction of the frame
 *             (0.0 = left/top edge, 1.0 = right/bottom edge).
 *   z      — depth. Negative = closer to camera, positive = further away.
 *             Less accurate than x/y but useful for some calculations.
 *   visibility — how confident MediaPipe is that this point is actually visible
 *                in the frame (0.0 = not visible, 1.0 = fully visible).
 *                Points with low visibility (e.g. a leg hidden behind furniture)
 *                should be excluded from calculations.
 */
export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

/**
 * PoseFrame — ALL 33 LANDMARKS FOR ONE CAMERA FRAME
 *
 * This is the raw output from ZETIC Melange / MediaPipe Pose for a single
 * moment in time. It arrives 30 times per second (once per camera frame).
 *
 * The landmark indices follow MediaPipe's fixed numbering:
 *   Index 0   = nose
 *   Index 11  = left shoulder
 *   Index 12  = right shoulder
 *   Index 23  = left hip       ← heavily used by our detectors
 *   Index 24  = right hip
 *   Index 25  = left knee
 *   Index 26  = right knee
 *   Index 27  = left ankle
 *   Index 28  = right ankle
 *   Index 29  = left heel
 *   Index 30  = right heel
 *   Index 7   = left ear
 *   Index 8   = right ear
 *
 * The detectors in src/engine/ consume PoseFrames one at a time
 * and accumulate measurements across multiple frames over time.
 */
export type PoseFrame = Landmark[];
