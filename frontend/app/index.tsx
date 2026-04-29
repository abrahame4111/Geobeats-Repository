import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { Ionicons } from "@expo/vector-icons";
import { getLoginUrl, loadAuth, saveAuth, StoredAuth } from "../src/api";
import PixelBlastBackground from "../src/components/PixelBlastBackground";
import ASCIIText from "../src/components/ASCIIText";
import StarBorder from "../src/components/StarBorder";

WebBrowser.maybeCompleteAuthSession();

export default function Login() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const popupTimerRef = useRef<any>(null);

  useEffect(() => {
    (async () => {
      const a = await loadAuth();
      if (a?.access_token && a.expires_at > Date.now()) {
        router.replace("/map");
      } else {
        setLoading(false);
      }
    })();
  }, []);

  // Listen for postMessage from popup (web)
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const handler = async (e: MessageEvent) => {
      if (!e.data || typeof e.data !== "object") return;
      if ((e.data as any).__soundmap_auth) {
        const payload = (e.data as any).payload as StoredAuth;
        await saveAuth(payload);
        if (popupTimerRef.current) clearInterval(popupTimerRef.current);
        router.replace("/map");
      }
      if ((e.data as any).__soundmap_auth_error) {
        setErr((e.data as any).error || "Login failed");
        setBusy(false);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const parseTokenUrl = (url: string): StoredAuth | null => {
    try {
      const u = new URL(url);
      const qs = u.searchParams.toString().length > 0 ? u.searchParams : new URLSearchParams(u.hash.replace(/^#/, "").replace(/^[^?]*\??/, ""));
      const access_token = qs.get("access_token");
      const user_id = qs.get("user_id");
      if (!access_token || !user_id) return null;
      return {
        access_token,
        refresh_token: qs.get("refresh_token") || "",
        expires_at: Date.now() + Number(qs.get("expires_in") || 3600) * 1000,
        user_id,
        display_name: qs.get("display_name") || user_id,
        profile_image: qs.get("profile_image") || "",
        product: qs.get("product") || "free",
      };
    } catch {
      return null;
    }
  };

  const handleLogin = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (Platform.OS === "web") {
        // Open OAuth in a popup window. The /auth-success page postMessages tokens back.
        const url = await getLoginUrl({ popup: true });
        const w = 520, h = 720;
        const winW = (window as any).innerWidth || (window as any).screen.width;
        const winH = (window as any).innerHeight || (window as any).screen.height;
        const top = Math.max(0, (winH - h) / 2);
        const left = Math.max(0, (winW - w) / 2);
        const popup = (window as any).open(
          url,
          "soundmap_spotify_oauth",
          `width=${w},height=${h},top=${top},left=${left}`
        );
        if (!popup) {
          // Popup blocked – fall back to top-level redirect
          (window as any).open(url, "_top");
          return;
        }
        // Watch for popup closed without auth
        popupTimerRef.current = setInterval(() => {
          if (popup.closed) {
            clearInterval(popupTimerRef.current);
            setBusy(false);
          }
        }, 800);
      } else {
        // Mobile / Expo Go – open in-app browser and capture redirect
        const redirectUri = Linking.createURL("auth-success");
        const url = await getLoginUrl({ mobile_redirect: redirectUri });
        const result = await WebBrowser.openAuthSessionAsync(url, redirectUri, {
          showInRecents: true,
        });
        if (result.type === "success" && (result as any).url) {
          const parsed = parseTokenUrl((result as any).url);
          if (parsed) {
            await saveAuth(parsed);
            router.replace("/map");
            return;
          }
          setErr("Auth response missing tokens");
        } else if (result.type === "cancel" || result.type === "dismiss") {
          setErr(null);
        } else {
          setErr("Login was cancelled");
        }
        setBusy(false);
      }
    } catch (e: any) {
      setErr(e?.message || "Login failed");
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color="#B026FF" />
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
      <PixelBlastBackground
        variant="circle"
        pixelSize={5}
        color="#B026FF"
        patternScale={2.5}
        patternDensity={1.6}
        pixelSizeJitter={0.6}
        enableRipples
        rippleSpeed={0.5}
        rippleThickness={0.14}
        rippleIntensityScale={2}
        liquid
        liquidStrength={0.15}
        liquidRadius={1.4}
        liquidWobbleSpeed={5.5}
        speed={0.55}
        edgeFade={0}
      />
      {/* Subtle vertical scrim so text stays legible over the pixel pattern */}
      <View style={styles.scrim} pointerEvents="none" />
      <SafeAreaView style={styles.container}>

      <View style={styles.top} testID="login-hero">
        <ASCIIText
          text="GeoBeats"
          asciiFontSize={8}
          textFontSize={200}
          textColor="#fdf9f3"
          planeBaseHeight={8}
          enableWaves
          style={styles.brandAscii}
        />
        <Text style={styles.tagline}>
          see the world through{"\n"}the music it&apos;s playing.
        </Text>
      </View>

      <View style={styles.featureList}>
        <Feature icon="map" text="Live map of listeners near you" />
        <Feature icon="headset" text="Join sessions, listen in sync" />
        <Feature icon="flash" text="Powered by Spotify Premium" />
      </View>

      <View style={styles.ctaWrap}>
        <StarBorder
          label="CONNECT WITH SPOTIFY"
          color="#B026FF"
          speed="5s"
          busy={busy}
          onPress={handleLogin}
          height={50}
          testID="login-spotify-button"
        />
        {err && (
          <Text style={styles.err} testID="login-error">
            {err}
          </Text>
        )}
        <Text style={styles.fineprint}>
          By continuing, you agree to share your public profile and currently-playing track with other users on the map.
        </Text>
      </View>
      </SafeAreaView>
    </View>
  );
}

function Feature({ icon, text }: { icon: any; text: string }) {
  return (
    <View style={styles.featureRow}>
      <View style={styles.featureIcon}>
        <Ionicons name={icon} size={18} color="#B026FF" />
      </View>
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#05050A",
  },
  container: {
    flex: 1,
    backgroundColor: "transparent",
    paddingHorizontal: 28,
    justifyContent: "space-between",
    paddingVertical: 32,
    overflow: "hidden",
  },
  scrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(5,5,10,0.55)",
  },
  top: { marginTop: 40 },
  brandAscii: {
    width: "100%",
    height: 140,
    marginBottom: 4,
    marginLeft: -8, // ASCII pre adds left padding; visually re-center
  },
  tagline: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 17,
    marginTop: 14,
    lineHeight: 24,
  },
  featureList: { gap: 18 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(176,38,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: { color: "#fff", fontSize: 15, fontWeight: "500", flex: 1 },
  ctaWrap: { gap: 14 },
  err: { color: "#FF4500", textAlign: "center", fontSize: 13 },
  fineprint: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 11,
    textAlign: "center",
    lineHeight: 16,
  },
});
