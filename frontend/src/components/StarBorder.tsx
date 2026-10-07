import React, { useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View, ViewStyle } from "react-native";
import { WebView } from "react-native-webview";
import { BACKEND_URL } from "../api";

type Props = {
  label: string;
  color?: string;
  speed?: string;
  busy?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
  height?: number;
  width?: number;
  testID?: string;
};

/**
 * StarBorder button — animated radial-gradient comet sweeping the perimeter
 * of a pill-shaped CTA. Rendered inside a WebView (native) / iframe (web)
 * because the effect uses CSS keyframe animations + radial-gradients which
 * have no clean native React Native equivalent.
 *
 * Tap is bridged via window.ReactNativeWebView.postMessage('star_press') on
 * native, and `window.parent.postMessage({ __starborder_press: true })` on web.
 *
 * Sizing: the WebView has no intrinsic size, so we estimate width from the
 * label length. Pass an explicit `width` to override.
 */
export default function StarBorder({
  label,
  color = "#B026FF",
  speed = "5s",
  busy = false,
  onPress,
  style,
  height = 50,
  width,
  testID,
}: Props) {
  const [failed, setFailed] = useState(false);
  // Estimate width based on label length when not provided. Tuned for the
  // 14px / 900-weight / 1.5px letter-spacing label.
  const estimatedWidth = Math.max(
    180,
    Math.min(360, label.length * 11 + 56),
  );
  const pillWidth = width ?? estimatedWidth;

  const params = new URLSearchParams({
    label,
    color,
    speed,
    busy: busy ? "1" : "0",
  }).toString();
  const url = `${BACKEND_URL}/api/starborder.html?${params}`;

  // Web: listen for postMessage from iframe
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const handler = (e: MessageEvent) => {
      if (e.data && (e.data as any).__starborder_press) onPress?.();
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onPress]);

  if (Platform.OS === "web") {
    return (
      <View
        style={[{ height, width: pillWidth, alignSelf: "center" }, style]}
        testID={testID}
      >
        {/* @ts-ignore: iframe is web-only */}
        <iframe
          src={url}
          title="StarBorder button"
          style={{
            border: 0,
            width: "100%",
            height: "100%",
            background: "transparent",
            display: "block",
          }}
          // @ts-ignore
          allowtransparency="true"
          // @ts-ignore
          scrolling="no"
        />
      </View>
    );
  }

  if (failed) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={busy}
        onPress={onPress}
        testID={testID}
        style={[styles.fallback, { height, width: pillWidth, borderColor: color }, style]}
      >
        {busy ? <ActivityIndicator color={color} /> : <Text style={styles.label}>{label}</Text>}
      </Pressable>
    );
  }

  return (
    <View
      style={[{ height, width: pillWidth, alignSelf: "center" }, style]}
      testID={testID}
    >
      <WebView
        // Re-key on busy/label so the WebView reflects the new state cleanly.
        key={`${busy ? 1 : 0}-${label}`}
        source={{ uri: url }}
        onError={() => setFailed(true)}
        onHttpError={() => setFailed(true)}
        renderError={() => <View />}
        style={styles.webview}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={["*"]}
        androidLayerType="hardware"
        onMessage={(e) => {
          if (e.nativeEvent.data === "star_press") onPress?.();
        }}
        // @ts-ignore — RN WebView prop
        backgroundColor="transparent"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignSelf: "center", alignItems: "center", justifyContent: "center",
    borderRadius: 25, borderWidth: 1, backgroundColor: "#181022",
  },
  label: { color: "#fdf9f3", fontSize: 13, fontWeight: "900", letterSpacing: 1.5 },
  webview: {
    flex: 1,
    width: "100%",
    height: "100%",
    backgroundColor: "transparent",
  },
});
