/**
 * Exercise plugin interface.
 * Every exercise is a pure function: RepFeatureValues → { errors, score }.
 * No raw landmarks, no geometry — just clinical rule application.
 */

import { RepErrors, RepFeatureValues, RepScore } from '../types';

export interface ExerciseResult {
  errors: RepErrors;
  score:  RepScore;
}

export type ExercisePlugin = (features: RepFeatureValues) => ExerciseResult;

export type ExerciseType = 'sls' | 'lsdt';
