import React from "react";
import { Platform, StyleSheet, View, ViewStyle } from "react-native";
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
 * runs inside a backend-served HTML page so we sidestep the three.js bundling
 * and DOM-API requirements that prevent native React Native from running it.
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
      <View style={[styles.wrap, style]} pointerEvents="none">
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
  return (
    <View style={[styles.wrap, style]} pointerEvents="none">
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
        // @ts-ignore — RN WebView prop
        backgroundColor="transparent"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%", height: 140, backgroundColor: "transparent" },
  webview: { flex: 1, backgroundColor: "transparent" },
});
