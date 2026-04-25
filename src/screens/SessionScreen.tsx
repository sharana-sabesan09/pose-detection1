/**
 * src/screens/SessionScreen.tsx — LIVE SESSION (TAB 1)
 *
 * DATA PIPELINE:
 *   VisionCamera → usePose (TF.js MoveNet) → pose state
 *     → PoseDetectors → aggregateScores → ScoreDashboard (live scores)
 *     → recordingBuffer (when recording) → analyzeRecording → Dashboard
 *
 * RECORDING FLOW:
 *   User taps "Record" → pose frames buffered for up to 60s
 *   → timer reaches 0 OR user taps "Stop"
 *   → analyzeRecording() processes full dataset
 *   → result saved to AsyncStorage
 *   → navigates to Results tab automatically
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, Platform, Alert,
} from 'react-native';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { CompositeNavigationProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { MainTabParamList } from '../navigation/MainTabs';
import { SessionMode, UserProfile, RiskScores } from '../types';
import { PoseDetectors } from '../engine/detectors';
import { aggregateScores } from '../engine/scoreAggregator';
import {
  analyzeRecording,
  saveAnalysis,
  RecordedFrame,
} from '../engine/analyzeRecording';
import ScoreDashboard from '../components/ScoreDashboard';
import { usePose } from '../engine/usePose';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS + TYPES
// ─────────────────────────────────────────────────────────────────────────────
const MAX_RECORD_SEC = 60;

type NavProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Live'>,
  NativeStackNavigationProp<RootStackParamList>
>;

const DEFAULT_SCORES: RiskScores = {
  balanceStability: 50,
  transitionSafety: 50,
  gaitRegularity:   50,
  lateralSway:      50,
  overallFallRisk:  50,
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function SessionScreen() {
  const navigation = useNavigation<NavProp>();

  const [mode,        setMode]        = useState<SessionMode>('standing');
  const [scores,      setScores]      = useState<RiskScores>(DEFAULT_SCORES);
  const [initialized, setInitialized] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);

  // ── Recording state ───────────────────────────────────────────────────────
  const [recordState, setRecordState]   = useState<'idle' | 'recording' | 'analyzing'>('idle');
  const [timeLeft,    setTimeLeft]      = useState(MAX_RECORD_SEC);

  const recordingFrames = useRef<RecordedFrame[]>([]);
  const profileRef      = useRef<UserProfile | null>(null);
  const detectorsRef    = useRef(new PoseDetectors());
  const recordStateRef  = useRef(recordState);

  // keep ref in sync so the pose effect always sees the latest recordState
  useEffect(() => { recordStateRef.current = recordState; }, [recordState]);

  // ── VisionCamera setup ────────────────────────────────────────────────────
  const device = useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  // ── Pose detection hook ───────────────────────────────────────────────────
  const { cameraRef, onCameraStarted, pose, status } = usePose();

  // ── Load user profile once ────────────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem('sentinel_profile').then(raw => {
      if (raw) profileRef.current = JSON.parse(raw) as UserProfile;
    });
  }, []);

  // ── Camera on/off with screen focus ──────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      setCameraActive(true);
      return () => setCameraActive(false);
    }, [])
  );

  // ── Process each new pose frame ───────────────────────────────────────────
  useEffect(() => {
    if (!pose) return;

    if (recordStateRef.current === 'recording') {
      recordingFrames.current.push({ t: Date.now(), pose });
    }

    detectorsRef.current.update(pose, mode);
    const demographicRisk = profileRef.current?.demographicRiskScore ?? 0;
    setScores(aggregateScores(detectorsRef.current.measurements, demographicRisk));
    if (!initialized) setInitialized(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pose]);

  // ── Mode change: reset detector buffers ──────────────────────────────────
  const handleModeChange = useCallback((newMode: SessionMode) => {
    detectorsRef.current.reset();
    setMode(newMode);
  }, []);

  // ── Countdown timer while recording ──────────────────────────────────────
  useEffect(() => {
    if (recordState !== 'recording') return;

    setTimeLeft(MAX_RECORD_SEC);

    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          finishRecording();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordState]);

  // ── Start recording ───────────────────────────────────────────────────────
  const startRecording = useCallback(() => {
    recordingFrames.current = [];
    setRecordState('recording');
  }, []);

  // ── Finish recording: analyze + save + navigate ───────────────────────────
  const finishRecording = useCallback(async () => {
    setRecordState('analyzing');

    const frames = recordingFrames.current;
    const demographicRisk = profileRef.current?.demographicRiskScore ?? 0;

    const result = analyzeRecording(frames, demographicRisk);
    await saveAnalysis(result);

    setRecordState('idle');
    recordingFrames.current = [];
    navigation.navigate('Results');
  }, [navigation]);

  // ── Reset profile ─────────────────────────────────────────────────────────
  const handleReset = () => {
    Alert.alert('Reset profile?', 'Returns you to the intake form.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset', style: 'destructive',
        onPress: async () => {
          await AsyncStorage.removeItem('sentinel_profile');
          navigation.navigate('Intake');
        },
      },
    ]);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>

      {/* ── FULL-SCREEN CAMERA ────────────────────────────────────────── */}
      {device && hasPermission && cameraActive && (
        <Camera
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={cameraActive}
          photo={true}
          onStarted={onCameraStarted}
        />
      )}

      {/* ── RN OVERLAY ────────────────────────────────────────────────── */}
      <SafeAreaView style={styles.overlay} pointerEvents="box-none">

        {/* ── TOP BAR ──────────────────────────────────────────────────── */}
        <View style={styles.topBar}>
          <Text style={styles.title}>SENTINEL</Text>
          <StatusPill status={status} ready={initialized} />
          <TouchableOpacity style={styles.resetBtn} onPress={handleReset}>
            <Text style={styles.resetBtnText}>Reset</Text>
          </TouchableOpacity>
        </View>

        <View style={{ flex: 1 }} pointerEvents="none" />

        {/* ── BOTTOM PANEL ─────────────────────────────────────────────── */}
        <View pointerEvents="auto">
          <ScoreDashboard scores={scores} mode={mode} initialized={initialized} />
          <RecordButton
            state={recordState}
            timeLeft={timeLeft}
            onStart={startRecording}
            onStop={finishRecording}
          />
          <ModeSelector mode={mode} onChange={handleModeChange} />
        </View>

      </SafeAreaView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RECORD BUTTON
// ─────────────────────────────────────────────────────────────────────────────

function RecordButton({
  state, timeLeft, onStart, onStop,
}: {
  state:    'idle' | 'recording' | 'analyzing';
  timeLeft: number;
  onStart:  () => void;
  onStop:   () => void;
}) {
  if (state === 'analyzing') {
    return (
      <View style={styles.recordBar}>
        <Text style={styles.analyzingText}>Analyzing recording…</Text>
      </View>
    );
  }

  if (state === 'recording') {
    return (
      <View style={styles.recordBar}>
        <View style={styles.countdownBadge}>
          <Text style={styles.countdownText}>{timeLeft}s</Text>
        </View>
        <Text style={styles.recordingLabel}>Recording — stay in frame</Text>
        <TouchableOpacity style={styles.stopBtn} onPress={onStop}>
          <Text style={styles.stopBtnText}>■ Stop</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.recordBar}>
      <TouchableOpacity style={styles.recordBtn} onPress={onStart}>
        <Text style={styles.recordBtnText}>⬤  Record 60s Analysis</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS PILL + MODE SELECTOR
// ─────────────────────────────────────────────────────────────────────────────

function StatusPill({ status, ready }: { status: string; ready: boolean }) {
  const color = ready ? '#00c853' : status === 'error' ? '#f44336' : '#f0a500';
  const label = ready ? 'LIVE' : status === 'error' ? 'ERROR' : 'LOADING';
  return (
    <View style={[styles.pill, { backgroundColor: color + '33' }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

function ModeSelector({
  mode, onChange,
}: { mode: SessionMode; onChange: (m: SessionMode) => void }) {
  const modes: { key: SessionMode; label: string; sub: string }[] = [
    { key: 'standing',   label: 'Standing',   sub: 'Balance' },
    { key: 'transition', label: 'Transition', sub: 'Sit ↔ Stand' },
    { key: 'walking',    label: 'Walking',    sub: 'Gait' },
  ];
  return (
    <View style={styles.modeBar}>
      {modes.map(({ key, label, sub }) => {
        const active = mode === key;
        return (
          <TouchableOpacity
            key={key}
            style={[styles.modeBtn, active && styles.modeBtnActive]}
            onPress={() => onChange(key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.modeBtnLabel, active && styles.activeTxt]}>{label}</Text>
            <Text style={[styles.modeBtnSub,   active && styles.activeTxt]}>{sub}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  bg:     '#0d1b2a',
  border: '#1e3a50',
  accent: '#00d4ff',
  muted:  '#4a7090',
};

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#000' },
  overlay: { flex: 1 },

  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: 'rgba(13,27,42,0.80)', gap: 10,
  },
  title:        { flex: 1, fontSize: 18, fontWeight: '800', color: C.accent, letterSpacing: 4 },
  pill:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, gap: 5 },
  dot:          { width: 6, height: 6, borderRadius: 3 },
  pillText:     { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  resetBtn:     { paddingHorizontal: 10, paddingVertical: 4 },
  resetBtnText: { fontSize: 12, color: C.muted, fontWeight: '500' },

  recordBar: {
    backgroundColor: 'rgba(13,27,42,0.92)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  recordBtn: {
    flex: 1,
    backgroundColor: 'rgba(0,212,255,0.08)',
    borderWidth: 1,
    borderColor: C.accent,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  recordBtnText: { color: C.accent, fontSize: 14, fontWeight: '700' },
  countdownBadge: {
    backgroundColor: '#f44336',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 48,
    alignItems: 'center',
  },
  countdownText:  { color: '#fff', fontSize: 16, fontWeight: '800' },
  recordingLabel: { flex: 1, color: '#f44336', fontSize: 12, fontWeight: '600' },
  stopBtn: {
    backgroundColor: 'rgba(244,67,54,0.15)',
    borderWidth: 1,
    borderColor: '#f44336',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  stopBtnText:   { color: '#f44336', fontSize: 13, fontWeight: '700' },
  analyzingText: { flex: 1, color: C.accent, fontSize: 13, fontWeight: '600', textAlign: 'center' },

  modeBar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(13,27,42,0.95)',
    paddingHorizontal: 12, paddingVertical: 10, gap: 10,
    paddingBottom: Platform.OS === 'ios' ? 4 : 10,
  },
  modeBtn:       { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: 'rgba(18,32,51,0.6)', gap: 3 },
  modeBtnActive: { borderColor: C.accent, backgroundColor: 'rgba(0,212,255,0.12)' },
  modeBtnLabel:  { fontSize: 13, fontWeight: '600', color: C.muted },
  modeBtnSub:    { fontSize: 10, color: C.muted, opacity: 0.6 },
  activeTxt:     { color: C.accent, opacity: 1 },
});
