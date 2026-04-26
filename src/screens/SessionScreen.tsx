/**
 * src/screens/SessionScreen.tsx — LIVE SESSION (TAB 1)
 *
 * NEW MULTI-EXERCISE FLOW (replaces single 60s recording):
 *
 *   On mount → load patient.curr_program (prescribed exercises; calibration
 *   block normalized to leftSls → rightSls → leftLsd → rightLsd in patientInfo).
 *   User taps "Start Session" → run each exercise back-to-back:
 *
 *     For each exercise in curr_program:
 *       1. AWAITING — show "Next: <label>. Start when ready" + Start button
 *       2. RECORDING — fixed 30s, fresh ExercisePipeline per exercise
 *       3. On timer end (or stop) → finalize, buffer the entry, advance
 *
 *     After last exercise:
 *       4. ANALYZING — build MultiExerciseSession, POST to backend, share
 *       5. Navigate to Results
 *
 *   Live ScoreDashboard updates throughout from PoseDetectors. Mode is mapped
 *   from the current exercise (walking → 'walking', else → 'standing') so the
 *   dimming logic in ScoreDashboard still works.
 *
 * PATIENT DATA SOURCE: dummy JSON via loadPatientInfo() — see
 * src/engine/patientInfo.ts (TODO marker there for the SQL swap).
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, Platform, Alert,
} from 'react-native';
import WebView, { WebViewMessageEvent } from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { SessionMode, PoseFrame, UserProfile, RiskScores } from '../types';
import { PoseDetectors } from '../engine/detectors';
import { aggregateScores } from '../engine/scoreAggregator';
import {
  analyzeRecording,
  saveAnalysis,
  RecordedFrame,
} from '../engine/analyzeRecording';
import { ExercisePipeline } from '../engine/exercise/pipeline';
import {
  ExerciseType,
  RepErrors,
  SessionExerciseEntry,
} from '../engine/exercise/types';
import { computeLiveErrors, fetchTTSAudio } from '../engine/exercise/liveFeedback';
import { getSummaryMessage } from '../engine/exercise/feedback';
import {
  buildExportPayload,
  buildSessionExerciseEntry,
  buildMultiExerciseSession,
  buildMultiSessionExportPayload,
  postExerciseToBackend,
  postMultiExerciseArchiveToBackend,
  postMultiSessionToLocalExports,
  shareMultiSessionViaSheet,
} from '../engine/exercise/exporter';
import { buildLandmarkCsv } from '../engine/csvLogger';
import { BACKEND_URL, LOCAL_EXPORTS_URL } from '../constants';
import { POSE_HTML } from '../engine/poseHtml';
import { loadStoredProfile, saveStoredProfile } from '../engine/profileStorage';
import { upsertPatientProfile } from '../engine/backendClient';
import { loadPatientInfo, PatientInfo } from '../engine/patientInfo';
import { SketchBox } from '../sentinel/primitives';
import { COLORS, FONTS } from '../sentinel/theme';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS + TYPES
// ─────────────────────────────────────────────────────────────────────────────
const EXERCISE_DURATION_SEC = 30;

type SessionState = 'idle' | 'awaiting' | 'recording' | 'analyzing' | 'done';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

const DEFAULT_SCORES: RiskScores = {
  balanceStability: 50,
  transitionSafety: 50,
  gaitRegularity:   50,
  lateralSway:      50,
  overallFallRisk:  50,
};

function displayErrorDetail(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return 'Unknown backend error';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const EXERCISE_LABELS: Record<ExerciseType, string> = {
  leftSls:  'Left Single-Leg Squat',
  rightSls: 'Right Single-Leg Squat',
  leftLsd:  'Left Lateral Step-Down',
  rightLsd: 'Right Lateral Step-Down',
  walking:  'Walking',
};

function modeForExercise(e: ExerciseType): SessionMode {
  return e === 'walking' ? 'walking' : 'standing';
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function SessionScreen() {
  const navigation = useNavigation<NavProp>();

  const [scores,      setScores]      = useState<RiskScores>(DEFAULT_SCORES);
  const [initialized, setInitialized] = useState(false);
  const [webViewActive, setWebViewActive] = useState(false);

  // ── Session state ─────────────────────────────────────────────────────────
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [patient,      setPatient]      = useState<PatientInfo | null>(null);
  const [exerciseIdx,  setExerciseIdx]  = useState(0);
  const [timeLeft,     setTimeLeft]     = useState(EXERCISE_DURATION_SEC);

  // Mutable per-recording state lives in refs to avoid the message handler
  // re-binding on every render.
  const sessionStartedAtRef  = useRef<number>(0);
  const sessionIdRef         = useRef<string>('');
  const exerciseStartedAtRef = useRef<number>(0);
  const completedEntriesRef  = useRef<SessionExerciseEntry[]>([]);
  const framesByExerciseRef  = useRef<{ exercise: string; frames: ReturnType<ExercisePipeline['getFrameBuffer']> }[]>([]);
  const walkingRecordedFramesRef = useRef<RecordedFrame[]>([]);  // for analyzeRecording dashboard data
  const calibrationBatchIdRef = useRef<string | null>(null);

  const pipelineRef     = useRef<ExercisePipeline | null>(null);
  const profileRef      = useRef<UserProfile | null>(null);
  const detectorsRef    = useRef(new PoseDetectors());
  const sessionStateRef = useRef(sessionState);
  const webViewRef      = useRef<WebView>(null);
  const ttsRecordingEpochRef = useRef(0);

  useEffect(() => { sessionStateRef.current = sessionState; }, [sessionState]);

  const currentExercise: ExerciseType | null =
    patient && exerciseIdx < patient.curr_program.length
      ? patient.curr_program[exerciseIdx]
      : null;

  // ── Load profile + patient info on mount ─────────────────────────────────
  useEffect(() => {
    loadStoredProfile().then(async profile => {
      if (profile) {
        profileRef.current = profile;
        if (!profile.backendProfileSyncedAt) {
          try {
            await upsertPatientProfile(profile);
            const synced: UserProfile = { ...profile, backendProfileSyncedAt: new Date().toISOString() };
            profileRef.current = synced;
            await saveStoredProfile(synced);
          } catch (e) {
            console.warn('[SessionScreen] patient sync failed:', (e as Error).message);
          }
        }
      }
    });

    loadPatientInfo()
      .then(setPatient)
      .catch(e => console.warn('[SessionScreen] patient info load failed:', e));
  }, []);

  // ── WebView on/off with screen focus ──────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      setWebViewActive(true);
      return () => setWebViewActive(false);
    }, []),
  );

  // ── Countdown timer while recording ───────────────────────────────────────
  useEffect(() => {
    if (sessionState !== 'recording') return;
    setTimeLeft(EXERCISE_DURATION_SEC);

    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          finishCurrentExercise();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionState, exerciseIdx]);

  // ── Live coaching TTS: every 10s while recording (SLS / LSDT only) ─────────
  useEffect(() => {
    if (sessionState !== 'recording') return;
    if (!currentExercise || currentExercise === 'walking') return;

    ttsRecordingEpochRef.current += 1;
    const epoch = ttsRecordingEpochRef.current;
    const exType = feedbackExerciseType(currentExercise);

    const runTick = async () => {
      if (sessionStateRef.current !== 'recording') return;
      if (ttsRecordingEpochRef.current !== epoch) return;
      const pipe = pipelineRef.current;
      if (!pipe) return;
      const buf = pipe.getFrameBuffer();
      if (buf.length === 0) return;

      const errors = computeLiveErrors(buf);
      const classification = liveErrorsToClassification(errors);
      const text = getSummaryMessage(errors, classification, exType);
      const b64 = await fetchTTSAudio(text);
      if (sessionStateRef.current !== 'recording') return;
      if (ttsRecordingEpochRef.current !== epoch) return;
      if (!b64) return;
      const wv = webViewRef.current;
      if (!wv) return;
      wv.injectJavaScript(
        `(function(){try{if(typeof window.playAudio==='function')window.playAudio(${JSON.stringify(b64)});}catch(e){}})();true;`,
      );
    };

    const id = setInterval(runTick, 10000);
    return () => {
      clearInterval(id);
      ttsRecordingEpochRef.current += 1;
    };
  }, [sessionState, currentExercise]);

  // ── Receive landmarks from MediaPipe WebView ──────────────────────────────
  const onMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type !== 'pose' || !Array.isArray(msg.landmarks)) return;

      const pose = msg.landmarks as PoseFrame;
      const ex   = currentExercise;

      if (sessionStateRef.current === 'recording' && pipelineRef.current) {
        const t = Date.now();
        pipelineRef.current.onFrame(t, pose);
        if (ex === 'walking') walkingRecordedFramesRef.current.push({ t, pose });
      }

      const liveMode: SessionMode = ex ? modeForExercise(ex) : 'standing';
      detectorsRef.current.update(pose, liveMode);
      const demographicRisk = profileRef.current?.demographicRiskScore ?? 0;
      setScores(aggregateScores(detectorsRef.current.measurements, demographicRisk));
      if (!initialized) setInitialized(true);

    } catch { /* ignore malformed messages */ }
  }, [currentExercise, initialized]);

  // ── Session lifecycle ─────────────────────────────────────────────────────
  const startSession = useCallback(() => {
    if (!patient || patient.curr_program.length === 0) {
      Alert.alert('No exercises prescribed', 'This patient has no curr_program entries.');
      return;
    }
    calibrationBatchIdRef.current = programStartsWithCalibration(patient.curr_program)
      ? newCalibrationBatchId()
      : null;
    sessionIdRef.current = new Date().toISOString();
    sessionStartedAtRef.current = Date.now();
    completedEntriesRef.current = [];
    framesByExerciseRef.current = [];
    walkingRecordedFramesRef.current = [];
    setExerciseIdx(0);
    setSessionState('awaiting');
  }, [patient]);

  const startCurrentExercise = useCallback(() => {
    if (!currentExercise) return;
    exerciseStartedAtRef.current = Date.now();
    pipelineRef.current = new ExercisePipeline(currentExercise);
    detectorsRef.current.reset(); // fresh per-exercise live windows
    // Tell the WebView which reference "ghost trainer" loop to show for this exercise.
    try {
      const js = `try { window.__setGhostExercise && window.__setGhostExercise(${JSON.stringify(
        currentExercise,
      )}); } catch (e) {} true;`;
      webViewRef.current?.injectJavaScript(js);
    } catch {
      /* non-fatal */
    }
    setSessionState('recording');
  }, [currentExercise]);

  const finishCurrentExercise = useCallback(() => {
    const ex = currentExercise;
    const pipe = pipelineRef.current;
    if (!ex || !pipe) return;

    const startedAt = exerciseStartedAtRef.current;
    const endedAt   = Date.now();
    try {
      const summary = pipe.finalize();
      const visitId = sessionIdRef.current;
      const injuredJointName = patient?.injuredjoint ?? 'unknown';
      completedEntriesRef.current.push(
        buildSessionExerciseEntry(summary, startedAt, endedAt, visitId, injuredJointName),
      );
      framesByExerciseRef.current.push({ exercise: ex, frames: pipe.getFrameBuffer() });
      console.log(`[session] ${ex}: ${summary.reps.length} reps,`, JSON.stringify(summary.summary));
    } catch (e) {
      console.error('[session] finalize crash:', e);
    }
    pipelineRef.current = null;

    const nextIdx = exerciseIdx + 1;
    if (patient && nextIdx < patient.curr_program.length) {
      setExerciseIdx(nextIdx);
      setSessionState('awaiting');
    } else {
      finalizeSession();
    }
  }, [currentExercise, exerciseIdx, patient]);

  const finalizeSession = useCallback(async () => {
    setSessionState('analyzing');

    const sessionId   = sessionIdRef.current;
    const startedAtMs = sessionStartedAtRef.current;
    const endedAtMs   = Date.now();
    const entries     = completedEntriesRef.current;
    const patientId   = profileRef.current?.patientId ?? patient?.patientId ?? 'unknown';
    const injuredJointName = patient?.injuredjoint ?? 'unknown';

    const multiSession = buildMultiExerciseSession(
      sessionId, startedAtMs, endedAtMs,
      patientId, injuredJointName,
      entries,
    );

    const payload = buildMultiSessionExportPayload(multiSession, framesByExerciseRef.current);

    // Live dashboard (Results tab) — only meaningful for walking. Skip if absent.
    if (walkingRecordedFramesRef.current.length > 0) {
      const demographicRisk = profileRef.current?.demographicRiskScore ?? 0;
      const result = analyzeRecording(walkingRecordedFramesRef.current, demographicRisk);
      await saveAnalysis({ ...result, id: sessionId });
    }

    try {
      // 1. AsyncStorage backup — never lose the schema
      await AsyncStorage.setItem(`sentinel_schema_${sessionId}`, JSON.stringify(multiSession));

      // 2. Local /exports dev artifact
      const framesCsv = buildLandmarkCsv(
        // analyzeRecording-style flat frames CSV across the whole session
        // (best-effort: union of every recorded walking frame; non-walking uses
        // pipeline frame features CSV that's already in the payload).
        walkingRecordedFramesRef.current,
        'walking',
      );
      const localRes = await postMultiSessionToLocalExports(LOCAL_EXPORTS_URL, payload, framesCsv);
      if (localRes.ok) {
        console.log('[export] local artifacts saved:', localRes.writtenTo, localRes.files);
      } else {
        console.warn('[export] local artifact write failed:', localRes.error);
      }

      // 3. Backend POST — fan out one request per exercise entry, all
      // tagged with the same visitId so the backend can group them.
      let uploadedCount = 0;
      const backendErrors: string[] = [];
      for (const [i, entry] of entries.entries()) {
        const frames = framesByExerciseRef.current[i]?.frames ?? [];
        const mode = modeForExercise(entry.exercise as ExerciseType);
        const recorded: RecordedFrame[] = frames.map(f => ({
          t: f.timestamp,
          pose: f.landmarks as unknown as PoseFrame,
        }));
        const perExerciseFramesCsv = buildLandmarkCsv(recorded, mode);

        const step = calibrationStepForExercise(entry.exercise);
        const calibration =
          calibrationBatchIdRef.current && step
            ? { batchId: calibrationBatchIdRef.current, step }
            : undefined;

        const exercisePayload = buildExportPayload(
          `${sessionId}-${entry.exercise}-${i + 1}`,
          sessionId,
          entry.injuredJointRom,
          entry.startedAtMs,
          entry.endedAtMs,
          entry.summary,
          frames,
          patientId,
          calibration,
        );
        const backendRes = await postExerciseToBackend(BACKEND_URL, exercisePayload);
        if (backendRes.ok) uploadedCount += 1;
        else {
          backendErrors.push(displayErrorDetail(backendRes.detail ?? backendRes.error));
        }
      }

      // 4. Whole-visit archive — fire-and-forget. Failure here is non-fatal:
      // the per-exercise uploads above are the source of truth for current
      // agents, the archive only feeds future longitudinal work.
      const archiveRes = await postMultiExerciseArchiveToBackend(BACKEND_URL, multiSession);
      if (!archiveRes.ok) {
        console.warn('[export] visit archive failed:', archiveRes.error);
      }

      if (backendErrors.length === 0) {
        Alert.alert(
          'Visit exported',
          `${entries.length} exercises uploaded for this visit.${
            localRes.ok && localRes.writtenTo ? `\n\nLocal files: ${localRes.writtenTo}` : ''
          }`,
        );
      } else {
        const detail = backendErrors.join('\n');
        console.error('[export] backend POST failed:', detail);
        if (localRes.ok && localRes.writtenTo) {
          Alert.alert(
            'Backend upload partially failed (non-fatal)',
            `${uploadedCount}/${entries.length} exercise uploads succeeded.\n\n${detail}\n\nLocal: ${localRes.writtenTo}`,
          );
        } else {
          Alert.alert(
            'Backend upload partially failed',
            `${uploadedCount}/${entries.length} exercise uploads succeeded.\n\n${detail}`,
          );
        }
        await shareMultiSessionViaSheet(payload);
      }
    } catch (e) {
      console.error('[export] crash:', e);
      Alert.alert('Export error', String((e as Error).message));
    }

    setSessionState('done');
    navigation.replace('Return');
  }, [navigation, patient]);

  const stopSessionEarly = useCallback(() => {
    Alert.alert('Stop session?', 'Discards remaining exercises and exports what you have.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Stop', style: 'destructive',
        onPress: () => {
          if (pipelineRef.current) finishCurrentExercise();
          else finalizeSession();
        },
      },
    ]);
  }, [finishCurrentExercise, finalizeSession]);

  // ── Reset profile ─────────────────────────────────────────────────────────
  const handleHeaderBack = () => {
    if (sessionState === 'recording' || sessionState === 'analyzing') {
      stopSessionEarly();
      return;
    }
    navigation.goBack();
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  const liveMode: SessionMode = currentExercise ? modeForExercise(currentExercise) : 'standing';
  const currentExerciseLabel = currentExercise ? EXERCISE_LABELS[currentExercise] : 'Session';

  return (
    <View style={styles.root}>
      {webViewActive && (
        <WebView
          ref={webViewRef}
          style={StyleSheet.absoluteFill}
          source={{ html: POSE_HTML, baseUrl: 'https://localhost' }}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grant"
          originWhitelist={['*']}
          mixedContentMode="always"
          javaScriptEnabled
          onMessage={onMessage}
        />
      )}

      <View pointerEvents="none" style={styles.cameraTint} />

      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.topButton} onPress={handleHeaderBack}>
            <Text style={styles.topButtonText}>{'<'}</Text>
          </TouchableOpacity>
          <Text style={styles.sessionTitle}>Session</Text>
          <StatusPill
            initialized={initialized}
            sessionState={sessionState}
            timeLeft={timeLeft}
          />
        </View>

        <View style={styles.exercisePillWrap}>
          <SketchBox
            seed={41}
            style={styles.exercisePill}
            fill="rgba(28,38,50,0.45)"
            stroke="rgba(243,236,219,0.28)"
            strokeWidth={1.4}
          >
            <Text style={styles.exercisePillText}>
              {currentExerciseLabel}
              {patient
                ? ` - ${Math.min(
                    exerciseIdx + (sessionState === 'idle' ? 0 : 1),
                    patient.curr_program.length,
                  )} / ${patient.curr_program.length}`
                : ''}
            </Text>
          </SketchBox>
        </View>

        <View style={styles.bottomStack} pointerEvents="box-none">
          <LiveScoresCard scores={scores} initialized={initialized} />
          <SessionControls
            state={sessionState}
            patient={patient}
            currentExercise={currentExercise}
            exerciseIdx={exerciseIdx}
            timeLeft={timeLeft}
            onStartSession={startSession}
            onStartExercise={startCurrentExercise}
            onFinishExercise={finishCurrentExercise}
            onEndSession={stopSessionEarly}
            onStartAnotherSession={startSession}
            onGoHome={() => navigation.navigate('Home')}
          />
          <View style={styles.modeRow}>
            {[
              { id: 'standing', label: 'Standing', sub: 'Balance' },
              { id: 'transition', label: 'Sit -> Stand', sub: 'Transition' },
              { id: 'walking', label: 'Walking', sub: 'Gait' },
            ].map(mode => {
              const active = liveMode === mode.id;
              return (
                <View key={mode.id} style={styles.modeCard}>
                  <View
                    style={[
                      styles.modePill,
                      active ? styles.modePillActive : styles.modePillInactive,
                    ]}
                  >
                    <Text style={[styles.modeLabel, active && styles.modeLabelActive]}>
                      {mode.label}
                    </Text>
                    <Text style={[styles.modeSub, active && styles.modeSubActive]}>
                      {mode.sub}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION CONTROLS
// ─────────────────────────────────────────────────────────────────────────────

function SessionControls({
  state,
  patient,
  currentExercise,
  exerciseIdx,
  timeLeft,
  onStartSession,
  onStartExercise,
  onFinishExercise,
  onEndSession,
  onStartAnotherSession,
  onGoHome,
}: {
  state: SessionState;
  patient: PatientInfo | null;
  currentExercise: ExerciseType | null;
  exerciseIdx: number;
  timeLeft: number;
  onStartSession: () => void;
  onStartExercise: () => void;
  onFinishExercise: () => void;
  onEndSession: () => void;
  onStartAnotherSession: () => void;
  onGoHome: () => void;
}) {
  const total = patient?.curr_program.length ?? 0;
  const currentPosition =
    total > 0
      ? Math.min(exerciseIdx + (state === 'idle' ? 0 : 1), total)
      : 0;

  if (state === 'analyzing') {
    return (
      <SketchBox
        seed={201}
        style={styles.controlBox}
        fill="rgba(243,236,219,0.92)"
        stroke="rgba(243,236,219,0.92)"
      >
        <Text style={styles.controlTitle}>Analyzing session</Text>
        <Text style={styles.controlHint}>
          Uploading your exercises and preparing the doctor review.
        </Text>
      </SketchBox>
    );
  }

  if (state === 'done') {
    return (
      <SketchBox
        seed={202}
        style={styles.controlBox}
        fill="rgba(243,236,219,0.92)"
        stroke="rgba(243,236,219,0.92)"
      >
        <Text style={styles.controlTitle}>Session complete</Text>
        <Text style={styles.controlHint}>
          Your notes and recordings are ready to review.
        </Text>
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.primaryButton} onPress={onStartAnotherSession}>
            <Text style={styles.primaryButtonText}>Start another</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={onGoHome}>
            <Text style={styles.secondaryButtonText}>Home</Text>
          </TouchableOpacity>
        </View>
      </SketchBox>
    );
  }

  if (state === 'recording' && currentExercise && patient) {
    return (
      <SketchBox
        seed={203}
        style={styles.controlBox}
        fill="rgba(243,236,219,0.92)"
        stroke="rgba(243,236,219,0.92)"
      >
        <Text style={styles.controlTitle}>Recording now</Text>
        <Text style={styles.controlHint}>
          {EXERCISE_LABELS[currentExercise]} • {currentPosition}/{total}
        </Text>
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.primaryButton, styles.primaryButtonDanger]}
            onPress={onFinishExercise}
          >
            <Text style={styles.primaryButtonText}>Stop • {timeLeft}s left</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={onEndSession}>
            <Text style={styles.secondaryButtonText}>End</Text>
          </TouchableOpacity>
        </View>
      </SketchBox>
    );
  }

  if (state === 'awaiting' && currentExercise && patient) {
    return (
      <SketchBox
        seed={204}
        style={styles.controlBox}
        fill="rgba(243,236,219,0.92)"
        stroke="rgba(243,236,219,0.92)"
      >
        <Text style={styles.controlTitle}>Next move</Text>
        <Text style={styles.controlHint}>
          {EXERCISE_LABELS[currentExercise]} • {currentPosition}/{total} • 30s capture
        </Text>
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.primaryButton} onPress={onStartExercise}>
            <Text style={styles.primaryButtonText}>Record 30s</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={onEndSession}>
            <Text style={styles.secondaryButtonText}>End</Text>
          </TouchableOpacity>
        </View>
      </SketchBox>
    );
  }

  if (!patient) {
    return (
      <SketchBox
        seed={205}
        style={styles.controlBox}
        fill="rgba(243,236,219,0.92)"
        stroke="rgba(243,236,219,0.92)"
      >
        <Text style={styles.controlTitle}>Loading session</Text>
        <Text style={styles.controlHint}>Pulling your prescribed exercises now.</Text>
      </SketchBox>
    );
  }

  return (
    <SketchBox
      seed={206}
      style={styles.controlBox}
      fill="rgba(243,236,219,0.92)"
      stroke="rgba(243,236,219,0.92)"
    >
      <Text style={styles.controlTitle}>Ready to start</Text>
      <Text style={styles.controlHint}>
        {patient.patientId} • {patient.curr_program.length} prescribed moves
      </Text>
      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.primaryButton} onPress={onStartSession}>
          <Text style={styles.primaryButtonText}>Start session</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={onGoHome}>
          <Text style={styles.secondaryButtonText}>Home</Text>
        </TouchableOpacity>
      </View>
    </SketchBox>
  );
}

function LiveScoresCard({
  scores,
  initialized,
}: {
  scores: RiskScores;
  initialized: boolean;
}) {
  const items = [
    { label: 'Balance', value: Math.round(scores.balanceStability) },
    { label: 'Gait', value: Math.round(scores.gaitRegularity) },
    { label: 'Sway', value: Math.round(scores.lateralSway) },
    { label: 'Fall risk', value: Math.round(100 - scores.overallFallRisk), inverse: true },
  ];

  return (
    <SketchBox
      seed={111}
      style={styles.scoreCard}
      fill="rgba(243,236,219,0.92)"
      stroke="rgba(243,236,219,0.92)"
    >
      <View style={styles.scoreCardHeader}>
        <Text style={styles.scoreCardTitle}>Live scores</Text>
        <Text style={styles.scoreCardHint}>
          {initialized ? 'updates 30x/sec' : 'warming up camera'}
        </Text>
      </View>
      <View style={styles.scoreGrid}>
        {items.map(item => (
          <LiveScoreRow
            key={item.label}
            label={item.label}
            value={item.value}
            inverse={item.inverse}
          />
        ))}
      </View>
    </SketchBox>
  );
}

function LiveScoreRow({
  label,
  value,
  inverse,
}: {
  label: string;
  value: number;
  inverse?: boolean;
}) {
  const good = inverse ? value < 30 : value >= 70;
  const warn = inverse ? value < 50 : value >= 50;
  const color = good ? COLORS.greenDeep : warn ? COLORS.warmDeep : COLORS.bad;
  const clampedValue = Math.max(0, Math.min(100, value));

  return (
    <View style={styles.scoreRow}>
      <View style={styles.scoreTopLine}>
        <Text style={styles.scoreLabel}>{label}</Text>
        <Text style={[styles.scoreValue, { color }]}>{clampedValue}</Text>
      </View>
      <View style={styles.scoreTrack}>
        <View
          style={[
            styles.scoreFill,
            { backgroundColor: color, width: `${Math.max(6, clampedValue)}%` },
          ]}
        />
      </View>
    </View>
  );
}

function StatusPill({
  initialized,
  sessionState,
  timeLeft,
}: {
  initialized: boolean;
  sessionState: SessionState;
  timeLeft: number;
}) {
  let color = COLORS.green;
  let border = COLORS.greenDeep;
  let label = 'LIVE';

  if (!initialized) {
    color = COLORS.warm;
    border = COLORS.warmDeep;
    label = 'LOADING';
  }

  if (sessionState === 'recording') {
    color = COLORS.bad;
    border = COLORS.bad;
    label = `REC ${Math.max(0, EXERCISE_DURATION_SEC - timeLeft)}s`;
  } else if (sessionState === 'analyzing') {
    color = COLORS.warm;
    border = COLORS.warmDeep;
    label = 'SYNCING';
  } else if (sessionState === 'done') {
    color = COLORS.accent;
    border = COLORS.accentDeep;
    label = 'DONE';
  }

  return (
    <View style={[styles.statusPill, { borderColor: border, backgroundColor: `${color}33` }]}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text style={[styles.statusText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  overlay: {
    flex: 1,
  },
  cameraTint: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(26,31,37,0.16)',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  topButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(243,236,219,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(243,236,219,0.12)',
  },
  topButtonText: {
    fontFamily: FONTS.handBold,
    fontSize: 18,
    color: COLORS.paper,
  },
  sessionTitle: {
    flex: 1,
    fontFamily: FONTS.display,
    fontSize: 24,
    color: COLORS.paper,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusText: {
    fontFamily: FONTS.hand,
    fontSize: 12,
  },
  exercisePillWrap: {
    alignItems: 'center',
    marginTop: 12,
    paddingHorizontal: 16,
  },
  exercisePill: {
    minWidth: 180,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  exercisePillText: {
    textAlign: 'center',
    fontFamily: FONTS.handBold,
    fontSize: 14,
    color: COLORS.paper,
  },
  bottomStack: {
    marginTop: 'auto',
    paddingHorizontal: 14,
    paddingBottom: Platform.OS === 'ios' ? 18 : 16,
    gap: 12,
  },
  scoreCard: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  scoreCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  scoreCardTitle: {
    fontFamily: FONTS.display,
    fontSize: 22,
    color: COLORS.ink,
  },
  scoreCardHint: {
    fontFamily: FONTS.hand,
    fontSize: 12,
    color: COLORS.ink3,
  },
  scoreGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
  },
  scoreRow: {
    width: '48%',
  },
  scoreTopLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  scoreLabel: {
    fontFamily: FONTS.hand,
    fontSize: 13,
    color: COLORS.ink3,
  },
  scoreValue: {
    fontFamily: FONTS.display,
    fontSize: 20,
    color: COLORS.ink,
  },
  scoreTrack: {
    height: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(28,38,50,0.16)',
    overflow: 'hidden',
  },
  scoreFill: {
    height: '100%',
    borderRadius: 8,
  },
  controlBox: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  controlTitle: {
    fontFamily: FONTS.display,
    fontSize: 22,
    color: COLORS.ink,
  },
  controlHint: {
    marginTop: 4,
    fontFamily: FONTS.hand,
    fontSize: 13,
    color: COLORS.ink3,
    lineHeight: 18,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  primaryButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: COLORS.ink,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  primaryButtonDanger: {
    backgroundColor: COLORS.bad,
  },
  primaryButtonText: {
    fontFamily: FONTS.handBold,
    fontSize: 16,
    color: COLORS.paper,
  },
  secondaryButton: {
    minHeight: 50,
    minWidth: 78,
    borderRadius: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(243,236,219,0.92)',
    borderWidth: 1.5,
    borderColor: COLORS.ink,
  },
  secondaryButtonText: {
    fontFamily: FONTS.handBold,
    fontSize: 16,
    color: COLORS.ink,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  modeCard: {
    flex: 1,
  },
  modePill: {
    borderRadius: 12,
    borderWidth: 1.5,
    paddingVertical: 8,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  modePillActive: {
    backgroundColor: 'rgba(243,236,219,0.92)',
    borderColor: 'rgba(243,236,219,0.92)',
  },
  modePillInactive: {
    backgroundColor: 'rgba(243,236,219,0.12)',
    borderColor: 'rgba(243,236,219,0.35)',
  },
  modeLabel: {
    fontFamily: FONTS.display,
    fontSize: 16,
    color: COLORS.paper,
  },
  modeLabelActive: {
    color: COLORS.ink,
  },
  modeSub: {
    marginTop: 1,
    fontFamily: FONTS.hand,
    fontSize: 10,
    color: 'rgba(243,236,219,0.55)',
    letterSpacing: 1,
  },
  modeSubActive: {
    color: COLORS.ink3,
  },
});
