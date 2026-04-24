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
      // On web, Expo Router reads params from hash; also support window.location
      let p = { ...params };
      if (Platform.OS === "web" && (!p.access_token || !p.user_id)) {
        const qs = new URLSearchParams(
          (window as any).location.search?.replace(/^\?/, "") ||
            (window as any).location.hash?.replace(/^#\/?auth-success\??/, "") ||
            ""
        );
        p = {
          access_token: qs.get("access_token") || p.access_token,
          refresh_token: qs.get("refresh_token") || p.refresh_token,
          expires_in: qs.get("expires_in") || p.expires_in,
          user_id: qs.get("user_id") || p.user_id,
          display_name: qs.get("display_name") || p.display_name,
          profile_image: qs.get("profile_image") || p.profile_image,
          product: qs.get("product") || p.product,
          error: qs.get("error") || p.error,
        } as any;
      }

      if (p.error) {
        setMsg(`Error: ${p.error}`);
        setTimeout(() => router.replace("/"), 2500);
        return;
      }
      if (!p.access_token || !p.user_id) {
        setMsg("Missing token. Redirecting…");
        setTimeout(() => router.replace("/"), 1800);
        return;
      }

      await saveAuth({
        access_token: p.access_token!,
        refresh_token: p.refresh_token || "",
        expires_at: Date.now() + Number(p.expires_in || 3600) * 1000,
        user_id: p.user_id!,
        display_name: p.display_name || p.user_id!,
        profile_image: p.profile_image || "",
        product: p.product || "free",
      });
      setMsg("Welcome to SoundMap");
      setTimeout(() => router.replace("/map"), 500);
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
