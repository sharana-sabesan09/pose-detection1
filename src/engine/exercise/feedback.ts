/**
 * src/engine/exercise/feedback.ts — PATIENT-FACING FEEDBACK CUES
 *
 * Each error maps to three things:
 *   short  — a one-line cue spoken or shown immediately after a rep
 *   detail — a sentence explaining what went wrong and why it matters
 *   drill  — a suggested correction or exercise to address the fault
 *
 * These are written at a patient level, not a clinical level.
 * The intent is that they can be fed directly into a TTS engine
 * (ElevenLabs or otherwise) to give real-time verbal feedback.
 */

export interface ErrorFeedback {
  short:  string;
  detail: string;
  drill:  string;
}

// ─────────────────────────────────────────────────────────────────────────────
// SLS / LSDT shared error cues
// ─────────────────────────────────────────────────────────────────────────────

export const SLS_FEEDBACK: Record<string, ErrorFeedback> = {

  kneeValgus: {
    short:  'Push your knee out over your second toe.',
    detail: 'Your knee collapsed inward during the squat. This puts strain on the knee joint and is a sign the hip muscles need strengthening.',
    drill:  'Try a clamshell or glute bridge before your next set to activate your hip before loading it.',
  },

  trunkLean: {
    short:  'Stand taller — keep your chest up.',
    detail: 'Your upper body tilted to the side during the movement. This usually means the hip stabilisers on one side are not doing their job.',
    drill:  'Side-lying hip abduction on the weaker side can help. Focus on keeping both shoulders level as you lower.',
  },

  trunkFlex: {
    short:  'Keep your chest up and your back straight.',
    detail: 'You leaned forward too much. This shifts effort away from the glutes and onto the lower back, which can cause pain over time.',
    drill:  'Try the movement with your hands on your hips and eyes on a point on the wall in front of you. This cues you to stay upright.',
  },

  pelvicDrop: {
    short:  'Keep both hips level — do not let the free hip drop.',
    detail: 'Your hip on the unsupported side dropped during the movement. This is called a Trendelenburg sign and means the glute on your standing side needs work.',
    drill:  'Single-leg standing practice at a kitchen counter can help. Hold lightly and focus on keeping both hip bones at the same height.',
  },

  pelvicShift: {
    short:  'Keep your hips centred — do not shift sideways.',
    detail: 'Your hips drifted to one side instead of moving straight down. This can place uneven load on the joints over time.',
    drill:  'Stand in front of a mirror and watch your belt line as you lower. It should stay level and centred.',
  },

  hipAdduction: {
    short:  'Drive your knee outward — your thigh is crossing the midline.',
    detail: 'Your thigh moved toward the centre of your body. Combined with a knee collapse, this is one of the main injury risk patterns the test screens for.',
    drill:  'Place a resistance band just above your knees and practise pushing out against it as you squat.',
  },

  kneeOverFoot: {
    short:  'Aim your knee over your second toe — not toward your big toe.',
    detail: 'Your knee was not tracking over your foot. This puts uneven pressure on the kneecap and the inner structures of the knee.',
    drill:  'Put a piece of tape on the floor pointing from your heel toward your second toe. Try to keep your knee tracking along that line.',
  },

  balance: {
    short:  'Try to keep your body steady — reduce side-to-side rocking.',
    detail: 'There was noticeable sway during your movement. This suggests the ankle stabilisers or the small postural muscles are not fully engaged.',
    drill:  'Practice standing on one leg for 30 seconds at a time on a firm surface, then progress to a folded towel to challenge your balance further.',
  },

};

// ─────────────────────────────────────────────────────────────────────────────
// LSDT-specific overrides
// (the same error key may carry different clinical meaning in a step-down)
// ─────────────────────────────────────────────────────────────────────────────

export const LSDT_FEEDBACK: Record<string, ErrorFeedback> = {
  ...SLS_FEEDBACK,

  kneeValgus: {
    short:  'Push your knee out — keep it in line with your second toe as you step down.',
    detail: 'Your knee caved inward as you lowered. In the step-down this is especially significant because your full body weight is on one leg.',
    drill:  'Practise slow eccentric step-downs with a resistance band above the knee to build the habit of pushing out.',
  },

  hipAdduction: {
    short:  'Keep your free foot relaxed — do not press it into the floor.',
    detail: 'Your free leg appeared to make significant contact with the floor, which means weight may have transferred to it. The test scores the standing leg only.',
    drill:  'Focus on lowering the free foot until it just barely touches, then immediately drive back up using only the standing leg.',
  },

  pelvicShift: {
    short:  'Try to go deeper — you are not reaching your full range.',
    detail: 'The movement was quite shallow. The step-down should ideally bring your knee to at least a 60-degree bend for the assessment to be meaningful.',
    drill:  'Use a lower step or a visual target on the floor to guide your free foot to the right depth.',
  },

};

// ─────────────────────────────────────────────────────────────────────────────
// Helper — get all triggered cues for a rep
// ─────────────────────────────────────────────────────────────────────────────

export function getRepFeedback(
  errors:       { [key: string]: boolean | undefined },
  exerciseType: 'sls' | 'lsdt' = 'sls',
): ErrorFeedback[] {
  const map = exerciseType === 'lsdt' ? LSDT_FEEDBACK : SLS_FEEDBACK;
  return Object.entries(errors)
    .filter(([, fired]) => fired)
    .map(([key]) => map[key])
    .filter((c): c is ErrorFeedback => Boolean(c));
}

/**
 * getSummaryMessage — one sentence summarising the rep for TTS playback.
 * Prioritises the most clinically significant fault.
 */
export function getSummaryMessage(
  errors:         { [key: string]: boolean | undefined },
  classification: string,
  exerciseType:   'sls' | 'lsdt' = 'sls',
): string {
  const cues = getRepFeedback(errors, exerciseType);
  if (cues.length === 0) return 'Good rep. Keep that up.';
  if (classification === 'good') return `Good rep. One thing to watch: ${cues[0].short}`;
  return cues[0].short;
}
