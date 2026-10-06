import React, { useMemo } from "react";
import { View, StyleSheet, Platform } from "react-native";
import { WebView } from "react-native-webview";
import { BACKEND_URL } from "../api";

type Props = {
  /** Image URL (album art) */
  imageSrc: string;
  /** Tooltip caption that follows the cursor (desktop) */
  captionText?: string;
  /** Bigger overlay text pinned to bottom-left of the card */
  overlayTitle?: string;
  /** Container size in px (figure outer box) */
  containerSize?: number;
  /** Image size in px (inner image) */
  imageSize?: number;
  /** Tilt amplitude in degrees (default 14) */
  rotateAmplitude?: number;
  /** Hover/touch scale (default 1.10) */
  scaleOnHover?: number;
  /** Show the cursor-following tooltip (default true) */
  showTooltip?: boolean;
};

/**
 * RN wrapper around the React Bits <TiltedCard /> component, hosted as a
 * WebView pointing at the backend `/api/tiltedcard.html` route. Touch events
 * inside the WebView drive the tilt on mobile; ambient idle wobble plays when
 * the user isn't interacting.
 */
export default function TiltedCard({
  imageSrc,
  captionText = "",
  overlayTitle = "",
  containerSize = 320,
  imageSize,
  rotateAmplitude = 14,
  scaleOnHover = 1.1,
  showTooltip = true,
}: Props) {
  const iSize = imageSize ?? containerSize;
  const uri = useMemo(() => {
    const params = new URLSearchParams({
      src: imageSrc || "",
      cap: captionText,
      title: overlayTitle,
      amp: String(rotateAmplitude),
      sc: String(scaleOnHover),
      w: String(containerSize),
      h: String(containerSize),
      iw: String(iSize),
      ih: String(iSize),
      showCap: showTooltip ? "1" : "0",
    });
    return `${BACKEND_URL}/api/tiltedcard.html?${params.toString()}`;
  }, [imageSrc, captionText, overlayTitle, rotateAmplitude, scaleOnHover, containerSize, iSize, showTooltip]);

  return (
    <View style={[styles.wrap, { width: containerSize, height: containerSize }]}>
      <WebView
        source={{ uri }}
        style={styles.webview}
        originWhitelist={["*"]}
        scrollEnabled={false}
        bounces={false}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState={false}
        androidLayerType="hardware"
        // Prevent the WebView from blocking the parent view's scroll/dismiss.
        nestedScrollEnabled={false}
        // Transparent so the parent gradient shows through edges.
        opaque={false}
        allowsInlineMediaPlayback
        backgroundColor={"transparent" as any}
        // Web target: render an iframe with the same URL.
        // (react-native-web auto-handles WebView -> iframe.)
        textZoom={Platform.OS === "android" ? 100 : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: "transparent",
    overflow: "visible",
  },
  webview: {
    flex: 1,
    backgroundColor: "transparent",
  },
});
