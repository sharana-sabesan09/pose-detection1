import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import {
  fetchLatestReport,
  fetchPatientOverview,
} from '../engine/backendClient';
import { loadStoredProfile } from '../engine/profileStorage';
import { PaperBackground, ScreenHeader, SketchBox, SketchCircle, Squiggle, TagPill } from '../sentinel/primitives';
import { COLORS, FONTS, formatMonthDay } from '../sentinel/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'DoctorReview'>;

type LatestReport = {
  summary: string;
  session_highlights: string[];
  recommendations: string[];
} | null;

type TimelineNote = {
  date: string;
  body: string;
};

export default function DoctorReviewScreen({ navigation }: Props) {
  const [latestReport, setLatestReport] = useState<LatestReport>(null);
  const [timelineNotes, setTimelineNotes] = useState<TimelineNote[]>([
    {
      date: 'Apr 15',
      body: 'Knee flexion ROM looking good. Cleared for full body-weight squat to 90°.',
    },
    {
      date: 'Apr 08',
      body: 'Reduce single-leg balance time to 20s. Form > duration.',
    },
    {
      date: 'Mar 31',
      body: 'Welcome aboard. Phase: sub-acute. Hold compressive sleeve during ADLs.',
    },
  ]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      const load = async () => {
        const profile = await loadStoredProfile();
        if (!profile?.patientId) return;

        try {
          const [report, overview] = await Promise.all([
            fetchLatestReport(profile.patientId).catch(() => null),
            fetchPatientOverview(profile.patientId).catch(() => null),
          ]);

          if (cancelled) return;
          setLatestReport(report);

          if (overview?.recent_sessions?.length) {
            const notes = overview.recent_sessions
              .filter(session => session.summary)
              .slice(0, 3)
              .map(session => ({
                date: formatMonthDay(session.started_at),
                body: session.summary ?? '',
              }));
            if (notes.length) {
              setTimelineNotes(notes);
            }
          }
        } catch {
          if (!cancelled) {
            setLatestReport(null);
          }
        }
      };

      load();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const summary =
    latestReport?.summary ??
    "Strong week - gait regularity is up to 82 from 71. The lateral sway during your walking sets is the next thing to chip at. I'd like you to add the hip airplane drill before squats. Reduce step-up height to 12 cm until pain settles below 3/10.";
  const chips = latestReport?.recommendations?.length
    ? latestReport.recommendations.slice(0, 3)
    : ['+ Hip airplane', 'Reduce step-up height', 'Pain target <= 3'];

  return (
    <View style={styles.root}>
      <PaperBackground />
      <ScreenHeader
        onBack={() => navigation.goBack()}
        title="From Dr. Adler"
        subtitle="reviewed Apr 22"
      />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <SketchBox
          seed={222}
          style={styles.heroCard}
          fill="rgba(255,250,235,0.5)"
        >
          <View style={styles.heroHeader}>
            <SketchCircle size={48} seed={223} fill="rgba(28,38,50,0.06)">
              <Text style={styles.avatarText}>A</Text>
            </SketchCircle>
            <View>
              <Text style={styles.heroTitle}>Dr. M. Adler</Text>
              <Text style={styles.heroSub}>orthopaedic PT - Boston</Text>
            </View>
            <View style={styles.flex} />
            <TagPill label={latestReport ? 'latest' : '2 new'} accent />
          </View>
          <Squiggle width={120} />
          <Text style={styles.summary}>{summary}</Text>
          <View style={styles.chips}>
            {chips.map(chip => (
              <TagPill key={chip} label={chip} />
            ))}
          </View>
        </SketchBox>

        <Text style={styles.sectionLabel}>EARLIER NOTES</Text>
        {timelineNotes.map((note, index) => (
          <View key={`${note.date}-${index}`} style={styles.noteWrap}>
            <SketchBox
              seed={300 + index * 7}
              style={styles.noteCard}
              fill="rgba(255,250,235,0.4)"
            >
              <View style={styles.noteHeader}>
                <Text style={styles.noteDate}>{note.date}</Text>
                <Text style={styles.noteBadge}>NOTE</Text>
              </View>
              <Text style={styles.noteBody}>{note.body}</Text>
            </SketchBox>
          </View>
        ))}

        <SketchBox
          seed={499}
          style={styles.messageButton}
          fill="transparent"
          stroke={COLORS.ink}
          strokeWidth={1.6}
        >
          <Text style={styles.messageText}>Send a message to Dr. Adler {'->'}</Text>
        </SketchBox>
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
  heroCard: {
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  heroHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  avatarText: {
    fontFamily: FONTS.display,
    fontSize: 22,
    color: COLORS.ink,
  },
  heroTitle: {
    fontFamily: FONTS.display,
    fontSize: 22,
    color: COLORS.ink,
  },
  heroSub: {
    fontFamily: FONTS.hand,
    fontSize: 12,
    color: COLORS.ink3,
  },
  summary: {
    marginTop: 12,
    fontFamily: FONTS.hand,
    fontSize: 16,
    lineHeight: 24,
    color: COLORS.ink2,
  },
  chips: {
    marginTop: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  sectionLabel: {
    marginTop: 22,
    marginBottom: 10,
    fontFamily: FONTS.hand,
    fontSize: 12,
    color: COLORS.ink3,
    letterSpacing: 1.5,
  },
  noteWrap: {
    marginBottom: 10,
  },
  noteCard: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  noteHeader: {
    marginBottom: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  noteDate: {
    fontFamily: FONTS.display,
    fontSize: 18,
    color: COLORS.ink,
  },
  noteBadge: {
    fontFamily: FONTS.hand,
    fontSize: 11,
    color: COLORS.inkFaint,
    letterSpacing: 1,
  },
  noteBody: {
    fontFamily: FONTS.hand,
    fontSize: 14,
    lineHeight: 21,
    color: COLORS.ink2,
  },
  messageButton: {
    marginTop: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  messageText: {
    fontFamily: FONTS.handBold,
    fontSize: 16,
    color: COLORS.ink,
  },
});
