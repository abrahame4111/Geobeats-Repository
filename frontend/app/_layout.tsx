import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { View } from "react-native";

// Keep splash visible until the icon font is registered.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  // Pre-register vector-icons' EXACT font name ("ionicons", lowercase)
  // but pointed at our LOCAL bundled TTF instead of the broken node_modules
  // asset path. Once Font.isLoaded("ionicons") is true, <Ionicons /> skips
  // its own internal Font.loadAsync (which is broken in Expo Go SDK 55:
  // "Font file for ionicons is empty").
  const [fontsLoaded, fontsError] = useFonts({
    ionicons: require("../assets/fonts/Ionicons.ttf"),
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });

  useEffect(() => {
    if (fontsLoaded || fontsError) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontsError]);

  if (!fontsLoaded && !fontsError) {
    // Render nothing until fonts are ready — splash stays up.
    return <View style={{ flex: 1, backgroundColor: "#05050A" }} />;
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
