import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Font from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { View } from "react-native";

// Keep splash visible until the icon font is registered.
SplashScreen.preventAutoHideAsync().catch(() => {});

const BACKEND =
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  "https://globe-tune.preview.emergentagent.com";

export default function RootLayout() {
  // FALLBACK FONT LOADING (Expo SDK 54 + Expo Go bug):
  // Metro's bundler returns an empty buffer for `require(".ttf")` font
  // assets when Expo Go fetches them over the tunnel ("Font file for
  // ionicons is empty" error). To bypass this entirely we fetch the TTF
  // directly from the FastAPI backend via HTTPS — Font.loadAsync accepts
  // a remote { uri } source and registers the font under the same name
  // ("ionicons" lowercase) that @expo/vector-icons looks up internally.
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [fontsError, setFontsError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await Font.loadAsync({
          ionicons: { uri: `${BACKEND}/api/assets/fonts/Ionicons.ttf` },
          SpaceMono: { uri: `${BACKEND}/api/assets/fonts/SpaceMono-Regular.ttf` },
        });
        if (!cancelled) setFontsLoaded(true);
      } catch (e: any) {
        if (!cancelled) setFontsError(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontsError) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontsError]);

  if (!fontsLoaded && !fontsError) {
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
