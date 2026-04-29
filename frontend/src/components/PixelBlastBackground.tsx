import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { BACKEND_URL } from "../api";

type Props = {
  // PixelBlast tunable params (all optional)
  variant?: "square" | "circle" | "triangle" | "diamond";
  pixelSize?: number;
  color?: string;
  patternScale?: number;
  patternDensity?: number;
  pixelSizeJitter?: number;
  enableRipples?: boolean;
  rippleSpeed?: number;
  rippleThickness?: number;
  rippleIntensityScale?: number;
  liquid?: boolean;
  liquidStrength?: number;
  liquidRadius?: number;
  liquidWobbleSpeed?: number;
  speed?: number;
  edgeFade?: number;
  noiseAmount?: number;
  transparent?: boolean;
};

/**
 * Animated PixelBlast WebGL background that works on both web (iframe) and
 * native (react-native-webview). The shader runs inside a backend-served
 * HTML page so we get a single source of truth and no Metro/three.js bundling
 * surprises. Touch events flow through naturally on native; on web the iframe
 * lets the WebGL canvas receive ripple clicks while the parent overlays UI.
 */
export default function PixelBlastBackground(props: Props) {
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    params[k] = typeof v === "boolean" ? (v ? "1" : "0") : String(v);
  }
  const qs = new URLSearchParams(params).toString();
  const url = `${BACKEND_URL}/api/pixelblast.html${qs ? "?" + qs : ""}`;

  if (Platform.OS === "web") {
    return (
      <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
        {/* @ts-ignore: iframe is fine on web */}
        <iframe
          src={url}
          style={{
            border: 0,
            width: "100%",
            height: "100%",
            display: "block",
            background: "#05050A",
          }}
          title="PixelBlast background"
          // @ts-ignore — DOM-only attribute
          scrolling="no"
        />
      </View>
    );
  }
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      <WebView
        source={{ uri: url }}
        style={styles.webview}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={["*"]}
        androidLayerType="hardware"
        // Clear background so app's own dark color shows through if WebGL fails
        // (iOS specific to avoid the default white flash):
        // @ts-ignore
        backgroundColor="transparent"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  webview: {
    flex: 1,
    backgroundColor: "transparent",
  },
});
