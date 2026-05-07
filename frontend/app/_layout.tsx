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
  // Pre-register the "Ionicons" font NAME using our locally bundled TTF.
  // @expo/vector-icons looks up this exact name internally; once it's
  // already loaded, it skips its own (broken in Expo Go SDK 55) loader.
  const [fontsLoaded, fontsError] = useFonts({
    Ionicons: require("../assets/fonts/Ionicons.ttf"),
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
