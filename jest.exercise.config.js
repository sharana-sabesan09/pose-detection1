/**
 * Standalone Jest config for the exercise pipeline tests.
 *
 * The pipeline is pure TypeScript with no React Native imports, so we
 * use ts-jest directly and skip the RN preset entirely. Run with:
 *
 *   npx jest --config jest.exercise.config.js
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/engine/exercise/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'preserve', esModuleInterop: true, target: 'ES2020', moduleResolution: 'node', strict: false, skipLibCheck: true } }],
  },
};
