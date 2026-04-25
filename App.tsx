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
import AsyncStorage from '@react-native-async-storage/async-storage';
import IntakeScreen from './src/screens/IntakeScreen';
import MainTabs from './src/navigation/MainTabs';

/**
 * RootStackParamList — THE TWO TOP-LEVEL ROUTES
 *
 * 'Intake' — the one-time profile form
 * 'Main'   — the bottom tab navigator (contains the live session + dashboard)
 */
export type RootStackParamList = {
  Intake: undefined;
  Main:   undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [loading,    setLoading]    = useState(true);
  const [hasProfile, setHasProfile] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('sentinel_profile')
      .then(raw => setHasProfile(!!raw))
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
        initialRouteName={hasProfile ? 'Main' : 'Intake'}
        screenOptions={{ headerShown: false, animation: 'fade' }}
      >
        <Stack.Screen name="Intake" component={IntakeScreen} />
        <Stack.Screen name="Main"   component={MainTabs}     />
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
