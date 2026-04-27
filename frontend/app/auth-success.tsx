import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Platform } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { saveAuth } from "../src/api";

export default function AuthSuccess() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    access_token?: string;
    refresh_token?: string;
    expires_in?: string;
    user_id?: string;
    display_name?: string;
    profile_image?: string;
    product?: string;
    error?: string;
  }>();
  const [msg, setMsg] = useState("Connecting to Spotify…");

  useEffect(() => {
    (async () => {
      // On web, also read params from window.location (router can lose them across redirects)
      let p: any = { ...params };
      if (Platform.OS === "web") {
        const w = window as any;
        const search = (w.location?.search || "").replace(/^\?/, "");
        const hash = (w.location?.hash || "").replace(/^#/, "");
        const fromHashQs = hash.includes("?") ? hash.split("?").slice(1).join("?") : "";
        const qs = new URLSearchParams(search || fromHashQs);
        ["access_token","refresh_token","expires_in","user_id","display_name","profile_image","product","error"].forEach((k) => {
          if (!p[k] && qs.get(k)) p[k] = qs.get(k);
        });
      }

      // Detect popup mode (window.opener exists)
      const isPopup = Platform.OS === "web" && !!(window as any).opener && (window as any).opener !== window;

      if (p.error) {
        if (isPopup) {
          (window as any).opener.postMessage({ __soundmap_auth_error: true, error: p.error }, "*");
          (window as any).close();
          return;
        }
        setMsg(`Error: ${p.error}`);
        setTimeout(() => router.replace("/"), 2500);
        return;
      }
      if (!p.access_token || !p.user_id) {
        setMsg("Missing token. Redirecting…");
        setTimeout(() => router.replace("/"), 1800);
        return;
      }

      const payload = {
        access_token: p.access_token!,
        refresh_token: p.refresh_token || "",
        expires_at: Date.now() + Number(p.expires_in || 3600) * 1000,
        user_id: p.user_id!,
        display_name: p.display_name || p.user_id!,
        profile_image: p.profile_image || "",
        product: p.product || "free",
      };

      if (isPopup) {
        (window as any).opener.postMessage({ __soundmap_auth: true, payload }, "*");
        setMsg("Connected! You can close this window.");
        setTimeout(() => { try { (window as any).close(); } catch (_) {} }, 400);
        return;
      }

      await saveAuth(payload);
      setMsg("Welcome to SoundMap");
      setTimeout(() => router.replace("/map"), 400);
    })();
  }, []);

  return (
    <View style={styles.container}>
      <ActivityIndicator color="#D4FF00" size="large" />
      <Text style={styles.text} testID="auth-success-message">
        {msg}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#05050A",
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
  },
  text: { color: "#fff", fontSize: 15, fontWeight: "600", letterSpacing: 0.5 },
});
