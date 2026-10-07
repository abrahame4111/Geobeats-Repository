import React, { useState, useCallback } from "react";
import {
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
  LayoutChangeEvent,
} from "react-native";
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
 * surprises.
 *
 * Mobile WebView quirks: window.innerWidth/innerHeight and 100vw/100vh are
 * unreliable inside react-native-webview before layout settles (and on iOS the
 * URL bar can shrink the layout viewport mid-animation). We therefore measure
 * the actual screen size on the RN side and inject those exact pixel
 * dimensions into the page via `injectedJavaScriptBeforeContentLoaded` BEFORE
 * the shader script runs. The HTML reads `window.__RN_VIEWPORT` first.
 */
export default function PixelBlastBackground(props: Props) {
  const { width: winW, height: winH } = useWindowDimensions();
  const [size, setSize] = useState<{ w: number; h: number }>({ w: winW, h: winH });
  const [failed, setFailed] = useState(false);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setSize((prev) =>
        prev.w === width && prev.h === height ? prev : { w: width, h: height },
      );
    }
  }, []);

  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    params[k] = typeof v === "boolean" ? (v ? "1" : "0") : String(v);
  }
  const qs = new URLSearchParams(params).toString();
  const url = `${BACKEND_URL}/api/pixelblast.html${qs ? "?" + qs : ""}`;

  if (Platform.OS === "web") {
    return (
      <View
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
        onLayout={onLayout}
      >
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

  // Inject the measured viewport BEFORE any HTML script runs.
  const injectedBefore = `
    (function(){
      try {
        window.__RN_VIEWPORT = { w: ${size.w}, h: ${size.h} };
      } catch(e) {}
      true;
    })();
  `;

  // After load, also push updates if the size changes (e.g. rotation).
  const injectedAfter = `
    (function(){
      try {
        window.__RN_VIEWPORT = { w: ${size.w}, h: ${size.h} };
        window.dispatchEvent(new Event('resize'));
      } catch(e) {}
      true;
    })();
  `;

  if (failed) {
    return <View style={[StyleSheet.absoluteFillObject, { backgroundColor: "#05050A" }]} pointerEvents="none" />;
  }

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none" onLayout={onLayout}>
      <WebView
        // Re-mount when viewport changes drastically (rotation) so the canvas
        // can rebuild buffers cleanly.
        key={`${Math.round(size.w)}x${Math.round(size.h)}`}
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
        injectedJavaScriptBeforeContentLoaded={injectedBefore}
        injectedJavaScript={injectedAfter}
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
