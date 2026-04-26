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
import {
  PaperBackground,
  ScreenHeader,
  SketchBox,
  SketchCircle,
  Squiggle,
  TagPill,
} from '../sentinel/primitives';
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
  const [timelineNotes, setTimelineNotes] = useState<TimelineNote[]>([]);

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
            setTimelineNotes(notes);
          } else {
            setTimelineNotes([]);
          }
        } catch {
          if (!cancelled) {
            setLatestReport(null);
            setTimelineNotes([]);
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
    'No reviewed clinical note is available yet. This screen updates after a grounded session report is stored.';
  const chips = latestReport?.recommendations?.slice(0, 3) ?? [];

  return (
    <View style={styles.root}>
      <PaperBackground />
      <ScreenHeader
        onBack={() => navigation.goBack()}
        title="Clinical review"
        subtitle={latestReport ? 'latest recorded note' : 'no reviewed note yet'}
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
              <Text style={styles.avatarText}>R</Text>
            </SketchCircle>
            <View>
              <Text style={styles.heroTitle}>Latest report</Text>
              <Text style={styles.heroSub}>grounded session output</Text>
            </View>
            <View style={styles.flex} />
            <TagPill label={latestReport ? 'latest' : 'awaiting data'} accent />
          </View>
          <Squiggle width={120} />
          <Text style={styles.summary}>{summary}</Text>
          {chips.length > 0 ? (
            <View style={styles.chips}>
              {chips.map(chip => (
                <TagPill key={chip} label={chip} />
              ))}
            </View>
          ) : null}
        </SketchBox>

        <Text style={styles.sectionLabel}>EARLIER NOTES</Text>
        {timelineNotes.length > 0 ? (
          timelineNotes.map((note, index) => (
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
          ))
        ) : (
          <SketchBox
            seed={499}
            style={styles.emptyNote}
            fill="rgba(255,250,235,0.35)"
          >
            <Text style={styles.emptyNoteText}>
              Earlier reviewed notes appear here after recorded sessions generate summaries.
            </Text>
          </SketchBox>
        )}

        <Text style={styles.infoText}>
          In-app clinician messaging is not available in this build.
        </Text>
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
  emptyNote: {
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  emptyNoteText: {
    fontFamily: FONTS.hand,
    fontSize: 14,
    lineHeight: 21,
    color: COLORS.inkFaint,
  },
  infoText: {
    marginTop: 14,
    textAlign: 'center',
    fontFamily: FONTS.hand,
    fontSize: 12,
    color: COLORS.inkFaint,
  },
});
