import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Platform,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getLoginUrl, loadAuth } from "../src/api";

export default function Login() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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

  const handleLogin = async () => {
    setBusy(true);
    setErr(null);
    try {
      const url = await getLoginUrl();
      if (Platform.OS === "web") {
        // Full page redirect
        (window as any).location.href = url;
      } else {
        await Linking.openURL(url);
      }
    } catch (e: any) {
      setErr(e?.message || "Login failed");
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color="#D4FF00" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.glow1} />
      <View style={styles.glow2} />

      <View style={styles.top} testID="login-hero">
        <View style={styles.logoWrap}>
          <Ionicons name="musical-notes" size={42} color="#D4FF00" />
        </View>
        <Text style={styles.brand} testID="app-title">
          SOUNDMAP
        </Text>
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
        <TouchableOpacity
          style={[styles.cta, busy && styles.ctaDisabled]}
          onPress={handleLogin}
          disabled={busy}
          testID="login-spotify-button"
          activeOpacity={0.85}
        >
          {busy ? (
            <ActivityIndicator color="#000" />
          ) : (
            <>
              <Ionicons name="logo-bitbucket" size={22} color="#000" />
              <Text style={styles.ctaText}>CONNECT WITH SPOTIFY</Text>
            </>
          )}
        </TouchableOpacity>
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
  );
}

function Feature({ icon, text }: { icon: any; text: string }) {
  return (
    <View style={styles.featureRow}>
      <View style={styles.featureIcon}>
        <Ionicons name={icon} size={18} color="#D4FF00" />
      </View>
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#05050A",
    paddingHorizontal: 28,
    justifyContent: "space-between",
    paddingVertical: 32,
    overflow: "hidden",
  },
  glow1: {
    position: "absolute",
    width: 400,
    height: 400,
    borderRadius: 200,
    backgroundColor: "#D4FF00",
    opacity: 0.08,
    top: -120,
    right: -120,
  },
  glow2: {
    position: "absolute",
    width: 380,
    height: 380,
    borderRadius: 190,
    backgroundColor: "#FF4500",
    opacity: 0.06,
    bottom: -140,
    left: -100,
  },
  top: { marginTop: 40 },
  logoWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(212,255,0,0.12)",
    borderWidth: 1,
    borderColor: "rgba(212,255,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
  },
  brand: {
    color: "#fff",
    fontSize: 44,
    fontWeight: "900",
    letterSpacing: 2,
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
    backgroundColor: "rgba(212,255,0,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: { color: "#fff", fontSize: 15, fontWeight: "500", flex: 1 },
  ctaWrap: { gap: 14 },
  cta: {
    backgroundColor: "#D4FF00",
    borderRadius: 999,
    paddingVertical: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    shadowColor: "#D4FF00",
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
  },
  ctaDisabled: { opacity: 0.6 },
  ctaText: {
    color: "#000",
    fontWeight: "900",
    fontSize: 16,
    letterSpacing: 1,
  },
  err: { color: "#FF4500", textAlign: "center", fontSize: 13 },
  fineprint: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 11,
    textAlign: "center",
    lineHeight: 16,
  },
});
