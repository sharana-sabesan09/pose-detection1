import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { loadStoredProfile } from '../engine/profileStorage';
import type { UserProfile } from '../types';
import {
  PaperBackground,
  ScreenHeader,
  SectionLabel,
  SketchBox,
  SketchCircle,
  Stat,
  TagPill,
} from '../sentinel/primitives';
import { COLORS, FONTS, prettyJoint } from '../sentinel/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Profile'>;

export default function ProfileScreen({ navigation }: Props) {
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadStoredProfile().then(setProfile);
    }, []),
  );

  const displayName = profile?.name || 'Maya';

  return (
    <View style={styles.root}>
      <PaperBackground />
      <ScreenHeader
        onBack={() => navigation.goBack()}
        title="Your record"
        subtitle="patient profile"
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <SketchBox
          seed={600}
          style={styles.heroCard}
          fill="rgba(255,250,235,0.5)"
          double
        >
          <View style={styles.heroRow}>
            <SketchCircle size={64} seed={601} fill="rgba(28,38,50,0.06)">
              <Text style={styles.avatarText}>{displayName.slice(0, 1).toUpperCase()}</Text>
            </SketchCircle>
            <View style={styles.flex}>
              <Text style={styles.name}>{displayName}</Text>
              <Text style={styles.idText}>id - {profile?.patientId || 'p_8a4f'}</Text>
              <View style={styles.phasePillWrap}>
                <TagPill
                  label={(profile?.rehab_phase || 'sub-acute').replace('-', ' ')}
                  accent
                />
              </View>
            </View>
          </View>

          <View style={styles.statsRow}>
            <Stat label="age" value={profile?.age ?? 28} />
            <Stat label="bmi" value={profile?.bmi?.toFixed(1) ?? '22.4'} />
            <Stat
              label="ht/wt"
              value={`${profile?.heightCm ?? 168}-${profile?.weightKg ?? 63}`}
              small
            />
          </View>
        </SketchBox>

        <SectionLabel>DIAGNOSIS</SectionLabel>
        <SketchBox seed={610} style={styles.textCard} fill="rgba(255,250,235,0.4)">
          <Text style={styles.body}>{profile?.diagnosis || 'ACL reconstruction (left)'}</Text>
          <Text style={styles.meta}>
            injured side - <Text style={styles.metaStrong}>{profile?.injured_side || 'left'}</Text>
          </Text>
        </SketchBox>

        <SectionLabel>JOINTS TRACKED</SectionLabel>
        <View style={styles.tagWrap}>
          {(profile?.injured_joints?.length
            ? profile.injured_joints
            : ['knee_flexion', 'hip_flexion']
          ).map(joint => (
            <TagPill key={joint} label={prettyJoint(joint)} />
          ))}
        </View>

        <SectionLabel>CONTRAINDICATIONS</SectionLabel>
        <View style={styles.tagWrap}>
          {(profile?.contraindications?.length
            ? profile.contraindications
            : ['Deep squat below 90°', 'Single-leg hop']
          ).map(item => (
            <TagPill key={item} label={`! ${item}`} style={styles.warningPill} />
          ))}
        </View>

        <SectionLabel>RESTRICTIONS</SectionLabel>
        <View style={styles.tagWrap}>
          {(profile?.restrictions?.length
            ? profile.restrictions
            : ['Knee flexion < 90°', 'Pain <= 3/10']
          ).map(item => (
            <TagPill key={item} label={item} />
          ))}
        </View>

        <SectionLabel>CLINICIAN</SectionLabel>
        <SketchBox seed={620} style={styles.textCard} fill="rgba(255,250,235,0.4)">
          <View style={styles.clinicianRow}>
            <SketchCircle size={36} seed={621} fill="rgba(28,38,50,0.06)">
              <Text style={styles.clinicianAvatar}>A</Text>
            </SketchCircle>
            <View style={styles.flex}>
              <Text style={styles.clinicianName}>{profile?.doctorName || 'Dr. M. Adler'}</Text>
              <Text style={styles.clinicianEmail}>
                {profile?.doctorEmail || 'm.adler@bch.org'}
              </Text>
            </View>
          </View>
        </SketchBox>

        <SketchBox
          seed={700}
          style={styles.buttonCard}
          fill="transparent"
          stroke={COLORS.ink}
          strokeWidth={1.6}
        >
          <Text
            style={styles.buttonText}
            onPress={() => navigation.navigate('Onboarding', { mode: 'edit' })}
          >
            Update record
          </Text>
        </SketchBox>
        <Text style={styles.footer}>last synced 2 min ago</Text>
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
  heroRow: {
    flexDirection: 'row',
    gap: 14,
  },
  avatarText: {
    fontFamily: FONTS.display,
    fontSize: 30,
    color: COLORS.ink,
  },
  name: {
    fontFamily: FONTS.display,
    fontSize: 28,
    color: COLORS.ink,
  },
  idText: {
    fontFamily: FONTS.hand,
    fontSize: 13,
    color: COLORS.ink3,
  },
  phasePillWrap: {
    marginTop: 6,
  },
  statsRow: {
    marginTop: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  textCard: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  body: {
    fontFamily: FONTS.hand,
    fontSize: 16,
    color: COLORS.ink,
  },
  meta: {
    marginTop: 4,
    fontFamily: FONTS.hand,
    fontSize: 12,
    color: COLORS.ink3,
  },
  metaStrong: {
    fontFamily: FONTS.handBold,
    color: COLORS.ink,
  },
  tagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  warningPill: {
    borderColor: COLORS.bad,
  },
  clinicianRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  clinicianAvatar: {
    fontFamily: FONTS.display,
    fontSize: 16,
    color: COLORS.ink,
  },
  clinicianName: {
    fontFamily: FONTS.handBold,
    fontSize: 15,
    color: COLORS.ink,
  },
  clinicianEmail: {
    fontFamily: FONTS.hand,
    fontSize: 12,
    color: COLORS.ink3,
  },
  buttonCard: {
    marginTop: 22,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: {
    fontFamily: FONTS.handBold,
    fontSize: 16,
    color: COLORS.ink,
  },
  footer: {
    marginTop: 14,
    paddingBottom: 8,
    textAlign: 'center',
    fontFamily: FONTS.hand,
    fontSize: 12,
    color: COLORS.inkFaint,
  },
});
