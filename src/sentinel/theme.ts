import { Platform } from 'react-native';
import type { ExerciseType } from '../engine/exercise/types';
import type { RehabPhase } from '../types';

export const COLORS = {
  paper: '#F3ECDB',
  paper2: '#EDE4CF',
  paper3: '#E6DCC1',
  paperBright: '#FFF9F0',
  ink: '#1C2632',
  ink2: '#354352',
  ink3: '#5B6878',
  inkFaint: '#8A93A0',
  accent: '#C7775A',
  accentSoft: '#ECD5C9',
  accentDeep: '#965239',
  green: '#5E956C',
  greenSoft: '#DCE9DC',
  greenDeep: '#416F4D',
  warm: '#E4C66A',
  warmSoft: '#F4E7B4',
  warmDeep: '#7F6532',
  blue: '#879DCB',
  blueSoft: '#D7E0F1',
  blueDeep: '#546E9C',
  bad: '#B65849',
  warn: '#D0A24F',
  cameraTop: '#2A323B',
  cameraBottom: '#1A1F25',
  white: '#FFF9F0',
};

export const FONTS = {
  display: Platform.select({
    ios: 'Caveat',
    android: 'Caveat',
    default: 'Caveat',
  }),
  hand: Platform.select({
    ios: 'Kalam-Regular',
    android: 'Kalam-Regular',
    default: 'Kalam-Regular',
  }),
  handBold: Platform.select({
    ios: 'Kalam-Bold',
    android: 'Kalam-Bold',
    default: 'Kalam-Bold',
  }),
  mono: Platform.select({
    ios: 'JetBrainsMono',
    android: 'JetBrainsMono',
    default: 'JetBrainsMono',
  }),
};

export const REHAB_PHASES: Array<{
  id: Exclude<RehabPhase, 'unknown'>;
  label: string;
  sub: string;
}> = [
  { id: 'acute', label: 'Acute', sub: '0-2 weeks · pain & swelling' },
  { id: 'sub-acute', label: 'Sub-acute', sub: '2-6 weeks · range of motion' },
  { id: 'functional', label: 'Functional', sub: '6-12 weeks · strength' },
  {
    id: 'return-to-sport',
    label: 'Return to sport',
    sub: '12 weeks+ · sport-specific',
  },
];

export const JOINT_OPTIONS = [
  'hip_flexion',
  'hip_extension',
  'hip_abduction',
  'knee_flexion',
  'ankle_dorsiflexion',
  'ankle_plantarflexion',
  'shoulder_flexion',
  'shoulder_abduction',
  'lumbar_flexion',
] as const;

export const COMMON_CONTRAS = [
  'Deep squat below 90°',
  'Full weight-bearing',
  'End-range hip IR',
  'Overhead loading',
  'Knee valgus',
  'Spinal flexion w/ load',
  'Single-leg hop',
];

export const COMMON_RESTRICTS = [
  'Max 50% body weight',
  'Knee flexion < 90°',
  'No running',
  'Pain ≤ 3/10',
  'Avoid impact',
  'Tempo 3-1-3',
  'Brace on for ADLs',
];

export const DIAGNOSIS_SUGGEST = [
  'ACL reconstruction',
  'Patellofemoral pain',
  'Grade II ankle sprain',
  'Rotator cuff repair',
  'Achilles tendinopathy',
  'Meniscus tear',
  'Hip labral repair',
];

export function prettyJoint(id: string): string {
  return id
    .replace(/_r$/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

export function calcBMI(heightCm: number, weightKg: number): number {
  const heightM = heightCm / 100;
  if (!heightM) return 0;
  return weightKg / (heightM * heightM);
}

export function calcDemographicRisk(
  age: number,
  gender: 'male' | 'female' | 'other',
  bmi: number,
): number {
  let score = 0;

  if (age >= 80) score += 40;
  else if (age >= 75) score += 30;
  else if (age >= 70) score += 25;
  else if (age >= 65) score += 15;

  if (gender === 'female' && age >= 65) score += 20;

  if (bmi < 18.5 || bmi >= 35) score += 35;
  else if (bmi >= 30) score += 20;
  else if (bmi >= 25) score += 10;

  return Math.min(100, score);
}

export function greetingForNow(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function labelForExercise(exercise: ExerciseType): string {
  const map: Record<ExerciseType, string> = {
    leftSls: 'Left single-leg squat',
    rightSls: 'Right single-leg squat',
    leftLsd: 'Left lateral step-down',
    rightLsd: 'Right lateral step-down',
    walking: 'Walking',
  };
  return map[exercise];
}

export function movementMetaForExercise(exercise: ExerciseType): {
  title: string;
  joint: string;
  sets: string;
  difficulty: 'easy' | 'med' | 'hard';
  today?: boolean;
} {
  switch (exercise) {
    case 'leftSls':
      return {
        title: 'Left single-leg squat',
        joint: 'knee',
        sets: '3 × 8',
        difficulty: 'hard',
        today: true,
      };
    case 'rightSls':
      return {
        title: 'Right single-leg squat',
        joint: 'knee',
        sets: '3 × 8',
        difficulty: 'hard',
        today: true,
      };
    case 'leftLsd':
      return {
        title: 'Left lateral step-down',
        joint: 'hip',
        sets: '3 × 10',
        difficulty: 'med',
        today: true,
      };
    case 'rightLsd':
      return {
        title: 'Right lateral step-down',
        joint: 'hip',
        sets: '3 × 10',
        difficulty: 'med',
        today: true,
      };
    case 'walking':
      return {
        title: 'Walking cadence check',
        joint: 'gait',
        sets: '30 sec',
        difficulty: 'easy',
        today: true,
      };
  }
}

export function formatMonthDay(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
