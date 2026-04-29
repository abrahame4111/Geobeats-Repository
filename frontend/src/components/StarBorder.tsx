import React, { useEffect } from "react";
import { Platform, StyleSheet, View, ViewStyle } from "react-native";
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
 */
export default function StarBorder({
  label,
  color = "#D4FF00",
  speed = "5s",
  busy = false,
  onPress,
  style,
  height = 64,
  testID,
}: Props) {
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
      <View style={[{ height, width: "100%" }, style]} testID={testID}>
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

  return (
    <View style={[{ height, width: "100%" }, style]} testID={testID}>
      <WebView
        // Re-key on busy/label so the WebView reflects the new state cleanly.
        key={`${busy ? 1 : 0}-${label}`}
        source={{ uri: url }}
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
  webview: {
    flex: 1,
    width: "100%",
    height: "100%",
    backgroundColor: "transparent",
  },
});
