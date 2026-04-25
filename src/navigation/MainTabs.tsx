/**
 * src/navigation/MainTabs.tsx — BOTTOM TAB NAVIGATOR
 *
 * Defines the two-tab layout shown after the user completes the Intake form.
 * The tab bar sits at the bottom of the screen and stays visible
 * on both tabs.
 *
 *   Tab 1 — Live    📷   The camera + skeleton + live scores + record button
 *   Tab 2 — Results 📊   Analysis history and fall risk reports
 *
 * STYLING:
 *   The tab bar uses the app's dark blue colour scheme with a cyan accent
 *   for the active tab. It sits above the iPhone home indicator (handled
 *   automatically by React Navigation's safe area integration).
 */

import React from 'react';
import { Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import SessionScreen from '../screens/SessionScreen';
import DashboardScreen from '../screens/DashboardScreen';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * MainTabParamList — THE TWO TABS
 * Both tabs receive no parameters when navigated to (hence `undefined`).
 */
export type MainTabParamList = {
  Live:    undefined;
  Results: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function MainTabs() {
  return (
    <Tab.Navigator
      initialRouteName="Live"
      screenOptions={({ route }) => ({
        headerShown: false,   // Each screen builds its own header

        // ── Tab icon ───────────────────────────────────────────────────────
        // Using emoji in a Text component as icons — lightweight, no icon font needed.
        tabBarIcon: ({ focused }) => {
          const icon = route.name === 'Live' ? '📷' : '📊';
          return (
            <Text style={{ fontSize: focused ? 22 : 18, opacity: focused ? 1 : 0.5 }}>
              {icon}
            </Text>
          );
        },

        // ── Tab bar visual style ───────────────────────────────────────────
        tabBarStyle: {
          backgroundColor: '#0a1929',
          borderTopColor: '#1e3a50',
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 8,
        },
        tabBarActiveTintColor:   '#00d4ff',   // cyan for the active tab
        tabBarInactiveTintColor: '#4a7090',   // muted blue for inactive

        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          letterSpacing: 0.5,
          marginTop: 2,
        },
      })}
    >
      <Tab.Screen
        name="Live"
        component={SessionScreen}
        options={{ tabBarLabel: 'Live' }}
      />
      <Tab.Screen
        name="Results"
        component={DashboardScreen}
        options={{ tabBarLabel: 'Results' }}
      />
    </Tab.Navigator>
  );
}
