import React from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts } from "expo-font";

export default function RootLayout() {
  // Preload the Ionicons font from a local asset (bypasses the
  // @expo/vector-icons → Expo Go asset-resolution bug that throws
  // "Font file for ionicons is empty" on Android Expo Go). Importing
  // Ionicons via @expo/vector-icons still works because expo-font
  // registers the font under the same family name we use here.
  const [fontsLoaded] = useFonts({
    Ionicons: require("../assets/fonts/Ionicons.ttf"),
  });

  if (!fontsLoaded) {
    // Render nothing while the icon font is loading. With
    // newArchEnabled: true the splash screen is shown by the OS
    // until the first React tree commits, so this is a brief no-op.
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#05050A" }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: "#05050A" },
            animation: "fade",
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="auth-success" />
          <Stack.Screen name="map" />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
