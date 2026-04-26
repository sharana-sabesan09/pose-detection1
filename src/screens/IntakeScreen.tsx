/**
 * src/screens/IntakeScreen.tsx — THE ONE-TIME PATIENT INTAKE FORM
 *
 * This screen appears exactly once — the very first time the app is opened.
 * It collects four basic data points: age, biological sex, height, and weight.
 *
 * WHY DO WE NEED THIS?
 *   The Rivolta et al. 2019 study (which SENTINEL's scoring is based on)
 *   found that three demographic factors independently predict fall risk,
 *   even before the camera watches how someone moves:
 *     1. Age over 70         — physical decline increases fall probability
 *     2. Female sex at 65+   — post-menopausal bone/muscle changes
 *     3. BMI extremes        — underweight (low muscle mass) or obese
 *                              (joint strain, balance difficulty)
 *
 *   We combine these into a single "demographicRiskScore" (0–100) that gets
 *   permanently baked into every Overall Fall Risk calculation for this user.
 *
 * WHAT HAPPENS AFTER SUBMISSION?
 *   The profile is saved to AsyncStorage (the phone's local key-value store).
 *   The next time the app opens, App.tsx finds the saved profile and jumps
 *   straight to the Session screen — this form never appears again unless
 *   the user manually resets their profile.
 *
 * UI DECISIONS:
 *   - Large text and generous tap targets because the target users are
 *     elderly adults or people in physical recovery.
 *   - Dark blue medical aesthetic to feel trustworthy and clinical.
 *   - BMI preview appears instantly once height + weight are entered,
 *     giving users immediate feedback without needing to submit.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  PermissionsAndroid,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { UserProfile } from '../types';
import { upsertPatientProfile } from '../engine/backendClient';
import { generatePatientId, saveStoredProfile } from '../engine/profileStorage';

type VoiceModule = {
  start: (locale: string) => Promise<void>;
  stop: () => Promise<void>;
  destroy: () => Promise<void>;
  removeAllListeners: () => void;
  onSpeechResults?: (e: { value?: string[] }) => void;
  onSpeechError?: (e?: unknown) => void;
  onSpeechEnd?: () => void;
};

let cachedVoiceModule: VoiceModule | null | undefined;

function getVoiceModule(): VoiceModule | null {
  if (cachedVoiceModule !== undefined) return cachedVoiceModule;
  try {
    // Lazy require prevents startup crash if the native module isn't linked yet.
    const voice = require('@react-native-voice/voice').default as VoiceModule;
    cachedVoiceModule = voice;
    return voice;
  } catch {
    cachedVoiceModule = null;
    return null;
  }
}

// The navigation prop gives this screen the ability to switch to another screen.
// Specifically, after saving the profile we call navigation.replace('Home')
// which swaps to the main home screen without letting the user go back.
type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList>;
};

// We only allow three gender options to match the Rivolta 2019 study categories.
type Gender = 'male' | 'female' | 'other';

/**
 * calcBMI — BODY MASS INDEX FORMULA
 *
 * BMI = weight in kilograms ÷ (height in metres)²
 *
 * Example: 72 kg, 165 cm tall
 *   height in metres = 165 / 100 = 1.65
 *   BMI = 72 / (1.65 × 1.65) = 72 / 2.7225 ≈ 26.4
 *
 * BMI categories:
 *   < 18.5  = Underweight
 *   18.5–24.9 = Normal
 *   25–29.9 = Overweight
 *   ≥ 30    = Obese
 */
function calcBMI(heightCm: number, weightKg: number): number {
  const h = heightCm / 100; // convert cm → metres
  return weightKg / (h * h);
}

/**
 * calcDemographicRisk — TRANSLATES DEMOGRAPHICS INTO A 0–100 RISK SCORE
 *
 * This implements the three Rivolta 2019 LASSO-selected demographic factors.
 * LASSO regression is a statistical technique that identifies which variables
 * matter most — these three emerged as the strongest demographic predictors
 * from a study of 90 rehabilitation patients.
 *
 * HOW THE POINTS WORK:
 *
 *   Age contribution (max 40 points):
 *     < 65  →  0 pts  (baseline, no age-related penalty)
 *     65–69 → 15 pts  (mild elevated risk)
 *     70–74 → 25 pts  (moderate — crosses the clinical "over 70" threshold)
 *     75–79 → 30 pts  (high)
 *     80+   → 40 pts  (maximum age penalty)
 *
 *   Gender contribution (max 20 points):
 *     Female AND age ≥ 65 → +20 pts
 *     Everyone else       →  +0 pts
 *     (The risk is specific to post-65 females, not females in general)
 *
 *   BMI contribution (max 40 points):
 *     < 18.5 or ≥ 35 → +35 pts  (extremes are equally dangerous)
 *     30–34.9        → +20 pts  (obese)
 *     25–29.9        → +10 pts  (overweight)
 *     18.5–24.9      →  +0 pts  (healthy range)
 *
 *   Maximum possible total = 40 + 20 + 40 = 100.
 *   Math.min(100, score) clamps it in case we ever adjust the weights.
 *
 * @param age    - user's age in years
 * @param gender - 'male' | 'female' | 'other'
 * @param bmi    - pre-calculated Body Mass Index
 * @returns      - integer from 0 to 100
 */
function calcDemographicRisk(age: number, gender: Gender, bmi: number): number {
  let score = 0;

  // --- Age contribution ---
  if (age >= 80)      score += 40;
  else if (age >= 75) score += 30;
  else if (age >= 70) score += 25;
  else if (age >= 65) score += 15;

  // --- Gender contribution (only applies to females aged 65+) ---
  if (gender === 'female' && age >= 65) score += 20;

  // --- BMI contribution ---
  if (bmi < 18.5 || bmi >= 35)  score += 35; // underweight OR severely obese
  else if (bmi >= 30)             score += 20; // obese
  else if (bmi >= 25)             score += 10; // overweight

  // Cap at 100 so the score never overflows the 0–100 scale
  return Math.min(100, score);
}

export default function IntakeScreen({ navigation }: Props) {
  // ---------- LOCAL STATE ----------
  // Each input field gets its own state variable as a string
  // (TextInput always works with strings; we parse to numbers on submit).
  const [age, setAge] = useState('');
  const [gender, setGender] = useState<Gender>('male');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [symptoms, setSymptoms] = useState('');
  const [isListening, setIsListening] = useState(false);

  useEffect(() => {
    return () => {
      const voice = getVoiceModule();
      if (!voice) return;
      voice.destroy().then(voice.removeAllListeners).catch(() => {});
    };
  }, []);

  /**
   * handleStart — VALIDATES THE FORM, BUILDS THE PROFILE, AND SAVES IT
   *
   * Called when the user taps "Start Session →".
   *
   * Step 1: Parse all four string inputs into numbers and check they're sane.
   *         If anything is wrong, show an Alert and return early.
   * Step 2: Calculate BMI and demographicRiskScore.
   * Step 3: Bundle everything into a UserProfile object.
   * Step 4: Save the UserProfile to AsyncStorage under 'sentinel_profile'.
   * Step 5: Navigate to the Session screen (replace, not push, so user can't go back).
   */
  const handleStart = async () => {
    // Parse strings to numbers
    const ageNum = parseInt(age, 10);
    const heightNum = parseFloat(height);
    const weightNum = parseFloat(weight);

    // Validate age (must be a real adult, not a typo like 680)
    if (!age || isNaN(ageNum) || ageNum < 18 || ageNum > 110) {
      Alert.alert('Invalid age', 'Please enter an age between 18 and 110.');
      return;
    }
    // Validate height in centimetres (shortest adult ~100 cm, tallest ~250 cm)
    if (!height || isNaN(heightNum) || heightNum < 100 || heightNum > 250) {
      Alert.alert('Invalid height', 'Please enter height in cm (100–250).');
      return;
    }
    // Validate weight in kilograms
    if (!weight || isNaN(weightNum) || weightNum < 20 || weightNum > 300) {
      Alert.alert('Invalid weight', 'Please enter weight in kg (20–300).');
      return;
    }

    // Calculate the two derived values
    const bmi = calcBMI(heightNum, weightNum);
    const demographicRiskScore = calcDemographicRisk(ageNum, gender, bmi);

    // Build the complete profile object (matches the UserProfile interface in types/index.ts)
    const profile: UserProfile = {
      patientId: generatePatientId(),
      age: ageNum,
      gender,
      heightCm: heightNum,
      weightKg: weightNum,
      bmi: Math.round(bmi * 10) / 10, // round to 1 decimal place, e.g. 26.4
      demographicRiskScore,
      injured_joints: [],
      injured_side: 'unknown',
      rehab_phase: 'unknown',
      diagnosis: '',
      contraindications: [],
      restrictions: [],
      ptRecords: [],
      ptRecordsNote: '',
    };

    // Save to the phone's local storage. This persists across app restarts.
    // Key: 'sentinel_profile' — the same key App.tsx checks on boot.
    try {
      await upsertPatientProfile(profile);
      profile.backendProfileSyncedAt = new Date().toISOString();
    } catch (e) {
      console.warn('[IntakeScreen] backend patient upsert failed:', (e as Error).message);
    }
    await saveStoredProfile(profile);

    // Navigate to Home. `replace` removes the Intake screen from the stack
    // so the back button doesn't bring the user back to the form.
    navigation.replace('Home');
  };

  const ensureMicPermission = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  };

  const handleMicPress = async () => {
    try {
      const voice = getVoiceModule();
      if (!voice) {
        Alert.alert(
          'Voice module not ready',
          'Native voice support is not linked yet. Rebuild iOS after pod install.',
        );
        return;
      }

      if (isListening) {
        await voice.stop();
        setIsListening(false);
        return;
      }

      const permissionGranted = await ensureMicPermission();
      if (!permissionGranted) {
        Alert.alert('Microphone required', 'Please allow microphone access to dictate symptoms.');
        return;
      }

      voice.onSpeechResults = e => {
        const nextText = e.value?.[0]?.trim();
        if (!nextText) return;
        setSymptoms(nextText);
      };

      voice.onSpeechError = () => {
        setIsListening(false);
        Alert.alert('Voice input failed', 'Please try again or type your symptoms manually.');
      };

      voice.onSpeechEnd = () => setIsListening(false);

      await voice.start('en-US');
      setIsListening(true);
    } catch (e) {
      setIsListening(false);
      Alert.alert('Voice input failed', (e as Error).message);
    }
  };

  // ---------- RENDER ----------
  return (
    <SafeAreaView style={styles.safe}>
      {/*
        KeyboardAvoidingView: On iOS, when the keyboard appears, it would normally
        cover the bottom input fields. This component automatically shifts the
        layout up to keep inputs visible above the keyboard.
      */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/*
          ScrollView: Allows the user to scroll if the content is taller than
          the screen (important on small phones or when the keyboard is open).
          keyboardShouldPersistTaps="handled" means tapping a button while the
          keyboard is open won't accidentally dismiss the keyboard before the
          button's onPress fires.
        */}
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          {/* ---- HEADER ---- */}
          <View style={styles.header}>
            <Text style={styles.logo}>SENTINEL</Text>
            <Text style={styles.tagline}>Fall Prevention · On-Device AI</Text>
          </View>

          {/* ---- EXPLANATION CARD ---- */}
          {/* Tells the user why we need this information, building trust */}
          <View style={styles.introCard}>
            <Text style={styles.introTitle}>Before we begin</Text>
            <Text style={styles.introBody}>
              We need four data points to calibrate your risk scores. This is a one-time
              setup. Your profile is stored on this device and synced to your patient
              record so sessions and progress stay linked over time.
            </Text>
          </View>

          {/* ---- FORM FIELDS ---- */}
          <View style={styles.form}>

            {/* AGE FIELD */}
            <View style={styles.field}>
              <Text style={styles.label}>Age</Text>
              <TextInput
                style={styles.input}
                value={age}
                onChangeText={setAge}
                keyboardType="number-pad"   // shows numeric keyboard, no decimal point
                placeholder="e.g. 68"
                placeholderTextColor="#3a5068"
                maxLength={3}               // max 3 digits (age won't exceed 110)
                returnKeyType="done"
              />
            </View>

            {/* GENDER SELECTOR — three tap buttons instead of a dropdown */}
            <View style={styles.field}>
              <Text style={styles.label}>Biological sex</Text>
              <View style={styles.genderRow}>
                {(['male', 'female', 'other'] as Gender[]).map(g => (
                  <TouchableOpacity
                    key={g}
                    style={[
                      styles.genderBtn,
                      gender === g && styles.genderBtnActive, // highlight selected option
                    ]}
                    onPress={() => setGender(g)}
                    activeOpacity={0.8}
                  >
                    <Text style={[
                      styles.genderText,
                      gender === g && styles.genderTextActive,
                    ]}>
                      {/* Capitalise first letter: "male" → "Male" */}
                      {g.charAt(0).toUpperCase() + g.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {/* Explain WHY we ask this — important for patient trust */}
              <Text style={styles.fieldNote}>
                Used for Rivolta 2019 fall-risk factor (females ≥65 have elevated baseline risk).
              </Text>
            </View>

            {/* HEIGHT FIELD */}
            <View style={styles.field}>
              <Text style={styles.label}>Height</Text>
              {/* inputWithUnit wraps the TextInput and "cm" label side-by-side */}
              <View style={styles.inputWithUnit}>
                <TextInput
                  style={[styles.input, styles.inputFlex]}
                  value={height}
                  onChangeText={setHeight}
                  keyboardType="decimal-pad"  // allows decimal point for e.g. 165.5
                  placeholder="e.g. 165"
                  placeholderTextColor="#3a5068"
                  maxLength={5}
                  returnKeyType="done"
                />
                <Text style={styles.unit}>cm</Text>
              </View>
            </View>

            {/* WEIGHT FIELD */}
            <View style={styles.field}>
              <Text style={styles.label}>Weight</Text>
              <View style={styles.inputWithUnit}>
                <TextInput
                  style={[styles.input, styles.inputFlex]}
                  value={weight}
                  onChangeText={setWeight}
                  keyboardType="decimal-pad"
                  placeholder="e.g. 72"
                  placeholderTextColor="#3a5068"
                  maxLength={5}
                  returnKeyType="done"
                />
                <Text style={styles.unit}>kg</Text>
              </View>
            </View>

            {/* SYMPTOMS FIELD + MIC */}
            <View style={styles.field}>
              <Text style={styles.label}>Symptoms (optional)</Text>
              <View style={styles.voicePromptCard}>
                <Text style={styles.voicePromptTitle}>Please tell us about:</Text>
                <Text style={styles.voicePromptItem}>- Your current pain level (0-10)</Text>
                <Text style={styles.voicePromptItem}>- Your rehab goals for this cycle</Text>
                <Text style={styles.voicePromptItem}>- Any recent history of falls</Text>
                <Text style={styles.voicePromptItem}>- Any range of motion restrictions</Text>
              </View>
              <View style={styles.symptomsHeaderRow}>
                <Text style={styles.fieldNote}>
                  Tap the microphone and speak. You can also type below.
                </Text>
                <TouchableOpacity
                  style={[styles.micBtn, isListening && styles.micBtnActive]}
                  onPress={handleMicPress}
                  activeOpacity={0.85}
                >
                  <Text style={styles.micIcon}>{isListening ? '◼' : '🎤'}</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={[styles.input, styles.symptomsInput]}
                value={symptoms}
                onChangeText={setSymptoms}
                placeholder="e.g. right knee pain, unstable when stepping down"
                placeholderTextColor="#3a5068"
                multiline
                textAlignVertical="top"
              />
            </View>

            {/*
              BMI LIVE PREVIEW
              Only renders once both height and weight are filled in with valid numbers.
              Updates in real-time as the user types — no submit needed.
              This gives immediate feedback so users can verify their numbers look right.
            */}
            {height && weight && !isNaN(parseFloat(height)) && !isNaN(parseFloat(weight)) && (
              <View style={styles.bmiPreview}>
                <Text style={styles.bmiLabel}>BMI</Text>
                <Text style={styles.bmiValue}>
                  {calcBMI(parseFloat(height), parseFloat(weight)).toFixed(1)}
                </Text>
              </View>
            )}
          </View>

          {/* ---- SUBMIT BUTTON ---- */}
          <TouchableOpacity style={styles.startBtn} onPress={handleStart} activeOpacity={0.85}>
            <Text style={styles.startBtnText}>Start Session →</Text>
          </TouchableOpacity>

          {/* Privacy reassurance — important for medical apps */}
          <Text style={styles.privacy}>
            Your profile and session summaries sync to your patient record.
          </Text>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------- DESIGN TOKENS ----------
// All colours defined in one place so they're easy to update consistently.
const C = {
  bg: '#0d1b2a',       // page background — deep navy
  card: '#122033',     // slightly lighter navy for cards and inputs
  border: '#1e3a50',   // subtle border colour
  accent: '#00d4ff',   // cyan — primary highlight, button text, labels
  accentDim: '#0a3a4a',// darkened cyan for active button backgrounds
  text: '#e8f4f8',     // near-white for primary text
  muted: '#4a7090',    // muted blue-grey for secondary text
  note: '#3a6080',     // even more muted for small notes
};

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: C.bg,
  },
  scroll: {
    padding: 24,
    paddingBottom: 48, // extra space at the bottom so the button clears the home indicator
  },

  // ---- HEADER ----
  header: {
    alignItems: 'center',
    marginBottom: 32,
    marginTop: 12,
  },
  logo: {
    fontSize: 36,
    fontWeight: '800',
    color: C.accent,
    letterSpacing: 8,  // wide letter spacing gives a strong, brand-like feel
  },
  tagline: {
    fontSize: 12,
    color: C.muted,
    marginTop: 6,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },

  // ---- INTRO CARD ----
  introCard: {
    backgroundColor: C.card,
    borderRadius: 12,
    padding: 18,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 28,
  },
  introTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
    marginBottom: 8,
  },
  introBody: {
    fontSize: 14,
    color: C.muted,
    lineHeight: 20,
  },

  // ---- FORM ----
  form: {
    gap: 20,          // vertical space between each field
    marginBottom: 32,
  },
  field: {
    gap: 8,           // space between the label and the input
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: C.accent,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  input: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,     // large font size for accessibility
    color: C.text,
    fontWeight: '500',
  },
  inputFlex: {
    flex: 1, // makes the input fill the remaining horizontal space beside the unit label
  },
  inputWithUnit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  unit: {
    fontSize: 16,
    color: C.muted,
    fontWeight: '500',
    width: 30, // fixed width so inputs align even if one unit label is longer
  },
  fieldNote: {
    fontSize: 11,
    color: C.note,
    lineHeight: 16,
  },
  voicePromptCard: {
    backgroundColor: 'rgba(0, 212, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 255, 0.2)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  voicePromptTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: C.accent,
    marginBottom: 2,
  },
  voicePromptItem: {
    fontSize: 12,
    lineHeight: 18,
    color: C.text,
    opacity: 0.9,
  },
  symptomsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  symptomsInput: {
    minHeight: 96,
  },
  micBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.card,
  },
  micBtnActive: {
    borderColor: C.accent,
    backgroundColor: C.accentDim,
  },
  micIcon: {
    fontSize: 18,
    color: C.accent,
    fontWeight: '700',
  },

  // ---- GENDER SELECTOR ----
  genderRow: {
    flexDirection: 'row',
    gap: 10,
  },
  genderBtn: {
    flex: 1,           // each button takes equal width
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    alignItems: 'center',
  },
  genderBtnActive: {
    borderColor: C.accent,      // cyan border when selected
    backgroundColor: C.accentDim, // darkened cyan fill when selected
  },
  genderText: {
    fontSize: 14,
    fontWeight: '500',
    color: C.muted,
  },
  genderTextActive: {
    color: C.accent,   // cyan text when selected
    fontWeight: '600',
  },

  // ---- BMI PREVIEW ----
  bmiPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.card,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  bmiLabel: {
    fontSize: 13,
    color: C.muted,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  bmiValue: {
    fontSize: 22,
    fontWeight: '700',
    color: C.text,
  },

  // ---- SUBMIT BUTTON ----
  startBtn: {
    backgroundColor: C.accent, // solid cyan background
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: 'center',
    marginBottom: 16,
  },
  startBtnText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0d1b2a', // dark text on cyan background for contrast
    letterSpacing: 0.5,
  },

  // ---- PRIVACY NOTE ----
  privacy: {
    textAlign: 'center',
    fontSize: 12,
    color: C.note,
  },
});
