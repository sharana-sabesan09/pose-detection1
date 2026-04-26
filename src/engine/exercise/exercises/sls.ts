/**
 * SLS (Single Leg Squat) exercise plugin.
 * Thin wrapper around the existing threshold-based error/score logic.
 */

import { RepFeatureValues } from '../types';
import { computeErrors, computeScore } from '../errors';
import { ExercisePlugin } from './plugin';

export const evaluateSLS: ExercisePlugin = (features: RepFeatureValues) => {
  const errors = computeErrors(features);
  return { errors, score: computeScore(errors) };
};
