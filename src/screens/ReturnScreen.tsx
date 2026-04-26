import React, { useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import {
  FieldLabel,
  InkButton,
  PainSlider,
  PaperBackground,
  ScreenHeader,
  SketchBox,
  SketchCircle,
  SketchInput,
} from '../sentinel/primitives';
import { COLORS, FONTS } from '../sentinel/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Return'>;

type ReturnData = {
  session_type: 'treatment' | 'assessment' | 'home_exercise_check';
  overall_feel: 'great' | 'good' | 'okay' | 'rough' | 'bad' | null;
  pain: Record<string, number>;
  pt_plan: string;
  notes: string;
};

const FEEDBACK_STORAGE_KEY = 'sentinel_last_session_feedback';

export default function ReturnScreen({ navigation }: Props) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<ReturnData>({
    session_type: 'treatment',
    overall_feel: null,
    pain: { knee_flexion: 0, hip_flexion: 0 },
    pt_plan: '',
    notes: '',
  });

  const setPatch = (patch: Partial<ReturnData>) => {
    setData(current => ({ ...current, ...patch }));
  };

  const setPain = (joint: string, value: number) => {
    setData(current => ({
      ...current,
      pain: { ...current.pain, [joint]: value },
    }));
  };

  const finish = async () => {
    await AsyncStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify({
      ...data,
      savedAt: new Date().toISOString(),
    }));
    navigation.navigate('Home');
  };

  if (step === 0) {
    return (
      <View style={styles.root}>
        <PaperBackground />
        <ScreenHeader
          onBack={() => navigation.goBack()}
          title="How did it go?"
          subtitle="quick check-in"
        />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.sectionLabel}>WHAT KIND OF SESSION?</Text>
          <View style={styles.stack}>
            {[
              { id: 'treatment', label: 'Treatment', sub: 'Standard rehab session' },
              { id: 'assessment', label: 'Assessment', sub: 'Formal measurement / baseline' },
              { id: 'home_exercise_check', label: 'Home check-in', sub: 'Solo, limited camera data' },
            ].map(option => (
              <Pressable
                key={option.id}
                onPress={() => setPatch({ session_type: option.id as ReturnData['session_type'] })}
              >
                <SketchBox
                  seed={option.id.length + 33}
                  style={styles.optionCard}
                  fill={
                    data.session_type === option.id
                      ? 'rgba(28,38,50,0.06)'
                      : 'rgba(255,250,235,0.4)'
                  }
                >
                  <View style={styles.optionRow}>
                    <SketchCircle
                      size={22}
                      seed={option.id.length + 9}
                      stroke={COLORS.ink}
                      fill={data.session_type === option.id ? COLORS.ink : 'transparent'}
                      strokeWidth={1.6}
                    >
                      {data.session_type === option.id ? (
                        <Text style={styles.checkGlyph}>✓</Text>
                      ) : null}
                    </SketchCircle>
                    <View>
                      <Text style={styles.optionTitle}>{option.label}</Text>
                      <Text style={styles.optionSub}>{option.sub}</Text>
                    </View>
                  </View>
                </SketchBox>
              </Pressable>
            ))}
          </View>

          <Text style={styles.sectionLabel}>HOW DID IT FEEL OVERALL?</Text>
          <View style={styles.faceChoiceRow}>
            {[
              { id: 'great', face: '^_^', label: 'Great' },
              { id: 'good', face: '-_-', label: 'Good' },
              { id: 'okay', face: 'o_o', label: 'Okay' },
              { id: 'rough', face: '>_<', label: 'Rough' },
              { id: 'bad', face: 'x_x', label: 'Bad' },
            ].map(option => {
              const active = data.overall_feel === option.id;
              return (
                <Pressable
                  key={option.id}
                  style={styles.flex}
                  onPress={() => setPatch({ overall_feel: option.id as ReturnData['overall_feel'] })}
                >
                  <SketchBox
                    seed={option.id.length + 80}
                    style={styles.faceCard}
                    fill={active ? COLORS.ink : 'rgba(255,250,235,0.4)'}
                  >
                    <Text style={[styles.faceCardFace, active && styles.faceCardFaceActive]}>
                      {option.face}
                    </Text>
                    <Text style={[styles.faceCardLabel, active && styles.faceCardLabelActive]}>
                      {option.label}
                    </Text>
                  </SketchBox>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.nextWrap}>
            <InkButton
              label="Continue ->"
              onPress={() => setStep(1)}
              disabled={!data.overall_feel}
              style={styles.fullButton}
            />
          </View>
        </ScrollView>
      </View>
    );
  }

  if (step === 1) {
    return (
      <View style={styles.root}>
        <PaperBackground />
        <ScreenHeader
          onBack={() => setStep(0)}
          title="Where it hurt"
          subtitle="0 = none - 10 = worst"
        />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.bodyCopy}>
            Skip a joint if there was no pain there at all.
          </Text>
          {[
            { id: 'knee_flexion', label: 'Knee' },
            { id: 'hip_flexion', label: 'Hip' },
            { id: 'ankle_dorsiflexion', label: 'Ankle' },
            { id: 'lumbar_flexion', label: 'Lumbar' },
          ].map((joint, index) => (
            <PainSlider
              key={joint.id}
              label={joint.label}
              value={data.pain[joint.id] || 0}
              onChange={value => setPain(joint.id, value)}
              seed={400 + index * 7}
            />
          ))}
          <View style={styles.nextWrap}>
            <InkButton label="Continue ->" onPress={() => setStep(2)} style={styles.fullButton} />
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <PaperBackground />
      <ScreenHeader
        onBack={() => setStep(1)}
        title="Notes"
        subtitle="anything to flag for Dr. Adler?"
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.fieldBlock}>
          <FieldLabel>Today's plan (from clinician)</FieldLabel>
          <SketchInput
            multiline
            placeholder="e.g. 3x10 step-ups, 2x30s side plank, no impact"
            value={data.pt_plan}
            onChangeText={pt_plan => setPatch({ pt_plan })}
          />
        </View>

        <View style={styles.fieldBlock}>
          <FieldLabel>How you felt</FieldLabel>
          <SketchInput
            multiline
            placeholder="Knee gave a bit on the third set of step-ups. Otherwise fine."
            value={data.notes}
            onChangeText={notes => setPatch({ notes })}
          />
        </View>

        <SketchBox
          seed={500}
          style={styles.summaryCard}
          fill="rgba(255,250,235,0.5)"
        >
          <Text style={styles.summaryLabel}>SUMMARY</Text>
          <Text style={styles.summaryBody}>
            {data.session_type === 'treatment'
              ? 'Treatment'
              : data.session_type === 'assessment'
                ? 'Assessment'
                : 'Home check'}{' '}
            - feeling {data.overall_feel || '-'} - pain peak{' '}
            {Math.max(...Object.values(data.pain))}/10
          </Text>
        </SketchBox>

        <InkButton label="Save & sync ✓" onPress={finish} style={styles.fullButton} />
        <Text style={styles.footerText}>your therapist sees this within the hour</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.paper,
  },
  flex: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 22,
    paddingBottom: 28,
  },
  bodyCopy: {
    marginBottom: 16,
    fontFamily: FONTS.hand,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.ink2,
  },
  sectionLabel: {
    marginBottom: 8,
    fontFamily: FONTS.hand,
    fontSize: 13,
    color: COLORS.ink3,
    letterSpacing: 1,
  },
  stack: {
    gap: 8,
    marginBottom: 22,
  },
  optionCard: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  checkGlyph: {
    color: COLORS.paper,
    fontSize: 12,
    marginTop: -1,
  },
  optionTitle: {
    fontFamily: FONTS.display,
    fontSize: 20,
    color: COLORS.ink,
  },
  optionSub: {
    fontFamily: FONTS.hand,
    fontSize: 12,
    color: COLORS.ink3,
  },
  faceChoiceRow: {
    flexDirection: 'row',
    gap: 6,
  },
  faceCard: {
    paddingHorizontal: 4,
    paddingVertical: 10,
    alignItems: 'center',
  },
  faceCardFace: {
    fontFamily: FONTS.display,
    fontSize: 22,
    color: COLORS.ink,
  },
  faceCardFaceActive: {
    color: COLORS.paper,
  },
  faceCardLabel: {
    marginTop: 4,
    fontFamily: FONTS.hand,
    fontSize: 11,
    color: COLORS.ink,
  },
  faceCardLabelActive: {
    color: COLORS.paper,
  },
  nextWrap: {
    marginTop: 28,
    marginBottom: 12,
  },
  fullButton: {
    width: '100%',
  },
  fieldBlock: {
    marginBottom: 16,
  },
  summaryCard: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 22,
  },
  summaryLabel: {
    marginBottom: 8,
    fontFamily: FONTS.hand,
    fontSize: 13,
    color: COLORS.ink3,
    letterSpacing: 1,
  },
  summaryBody: {
    fontFamily: FONTS.hand,
    fontSize: 14,
    lineHeight: 21,
    color: COLORS.ink2,
  },
  footerText: {
    marginTop: 8,
    textAlign: 'center',
    fontFamily: FONTS.hand,
    fontSize: 12,
    color: COLORS.inkFaint,
  },
});
