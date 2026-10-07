import React, { useState, useCallback } from "react";
import {
  Platform,
  StyleSheet,
  View,
  Text,
  ViewStyle,
  LayoutChangeEvent,
} from "react-native";
import { WebView } from "react-native-webview";
import { BACKEND_URL } from "../api";

type Props = {
  text?: string;
  asciiFontSize?: number;
  textFontSize?: number;
  textColor?: string;
  planeBaseHeight?: number;
  enableWaves?: boolean;
  style?: ViewStyle;
};

/**
 * ASCII text effect rendered via WebView/iframe (web + native). The shader
 * runs inside a backend-served HTML page so we sidestep three.js bundling
 * and DOM-API requirements that prevent native React Native from running it.
 *
 * Mobile WebView quirks: window.innerWidth/innerHeight inside react-native-
 * webview can report stale or zero values during initial paint, causing the
 * rendered ASCII to clip into a tiny box. We measure the actual host View's
 * dimensions on the RN side and inject those into the page via
 * `injectedJavaScriptBeforeContentLoaded`. The HTML reads `window.__RN_VIEWPORT`
 * and uses those exact dimensions for setSize().
 */
export default function ASCIIText({
  text = "GeoBeats",
  asciiFontSize = 8,
  textFontSize = 200,
  textColor = "#fdf9f3",
  planeBaseHeight = 8,
  enableWaves = true,
  style,
}: Props) {
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [failed, setFailed] = useState(false);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setSize((prev) =>
        prev.w === width && prev.h === height ? prev : { w: width, h: height },
      );
    }
  }, []);

  const params: Record<string, string> = {
    text,
    asciiFontSize: String(asciiFontSize),
    textFontSize: String(textFontSize),
    textColor,
    planeBaseHeight: String(planeBaseHeight),
    enableWaves: enableWaves ? "1" : "0",
  };
  const qs = new URLSearchParams(params).toString();
  const url = `${BACKEND_URL}/api/asciitext.html?${qs}`;

  if (Platform.OS === "web") {
    return (
      <View style={[styles.wrap, style]} pointerEvents="none" onLayout={onLayout}>
        {/* @ts-ignore: iframe is web-only */}
        <iframe
          src={url}
          title="ASCII Text"
          style={{ border: 0, width: "100%", height: "100%", background: "transparent" }}
          // @ts-ignore
          allowtransparency="true"
          // @ts-ignore
          scrolling="no"
        />
      </View>
    );
  }

  const injectedBefore = `
    (function(){
      try { window.__RN_VIEWPORT = { w: ${size.w}, h: ${size.h} }; } catch(e) {}
      true;
    })();
  `;
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
    return (
      <View style={[styles.wrap, styles.fallback, style]} pointerEvents="none">
        <Text style={[styles.fallbackText, { color: textColor }]}>{text}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, style]} pointerEvents="none" onLayout={onLayout}>
      {size.w > 0 && size.h > 0 ? (
        <WebView
          // Re-mount when measured size changes drastically so canvas rebuilds.
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
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%", height: 140, backgroundColor: "transparent" },
  webview: { flex: 1, width: "100%", height: "100%", backgroundColor: "transparent" },
  fallback: { justifyContent: "center" },
  fallbackText: { fontSize: 52, fontWeight: "900", letterSpacing: -2 },
});
