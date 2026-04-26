/**
 * App.tsx — THE FRONT DOOR OF THE APPLICATION
 *
 * First-time visitor  → Intake Form (collect age, gender, height, weight)
 * Returning visitor   → Main app (Live camera tab + Results tab)
 *
 * NAVIGATION STRUCTURE:
 *
 *   Stack.Navigator
 *     ├── Intake   ← shown once, never again after profile saved
 *     └── Main     ← the bottom-tab layout (Live | Results)
 *          ├── Live     (SessionScreen — camera + skeleton + scores + record)
 *          └── Results  (DashboardScreen — analysis history)
 */

import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SentinelOnboardingScreen from './src/screens/SentinelOnboardingScreen';
import HomeScreen from './src/screens/HomeScreen';
import SessionScreen from './src/screens/SessionScreen';
import MovementsScreen from './src/screens/MovementsScreen';
import DoctorReviewScreen from './src/screens/DoctorReviewScreen';
import ReturnScreen from './src/screens/ReturnScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import { loadStoredProfile } from './src/engine/profileStorage';

/**
 * RootStackParamList — THE TWO TOP-LEVEL ROUTES
 *
 * 'Intake' — the one-time profile form
 * 'Main'   — the bottom tab navigator (contains the live session + dashboard)
 */
export type RootStackParamList = {
  Onboarding: { mode?: 'edit' } | undefined;
  Home: undefined;
  Session: undefined;
  Movements: undefined;
  DoctorReview: undefined;
  Return: undefined;
  Profile: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [loading,    setLoading]    = useState(true);
  const [hasProfile, setHasProfile] = useState(false);

  useEffect(() => {
    loadStoredProfile()
      .then(profile => setHasProfile(!!profile))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#00d4ff" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName={hasProfile ? 'Home' : 'Onboarding'}
        screenOptions={{ headerShown: false, animation: 'fade' }}
      >
        <Stack.Screen name="Onboarding" component={SentinelOnboardingScreen} />
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Session" component={SessionScreen} />
        <Stack.Screen name="Movements" component={MovementsScreen} />
        <Stack.Screen name="DoctorReview" component={DoctorReviewScreen} />
        <Stack.Screen name="Return" component={ReturnScreen} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0d1b2a',
  },
});
