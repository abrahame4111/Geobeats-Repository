import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import TiltedCard from "./TiltedCard";

export type SongFoundData = {
  title: string;
  artist?: string;
  art?: string;
  spotifyUrl?: string | null;
  spotifyUri?: string | null;
};

type Props = {
  visible: boolean;
  data: SongFoundData | null;
  onDismiss: () => void;
};

/**
 * Full-screen radar match modal. Renders a tilting album-art card (React Bits
 * TiltedCard via WebView) centered on screen with a DISMISS button below.
 * Animates in with a fade + scale on the card; backdrop fades.
 */
export default function SongFoundCard({ visible, data, onDismiss }: Props) {
  const { width, height } = useWindowDimensions();
  const fade = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.6)).current;
  const cardY = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fade, {
          toValue: 1,
          duration: 260,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.spring(cardScale, {
          toValue: 1,
          friction: 7,
          tension: 80,
          useNativeDriver: true,
        }),
        Animated.spring(cardY, {
          toValue: 0,
          friction: 7,
          tension: 80,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      fade.setValue(0);
      cardScale.setValue(0.6);
      cardY.setValue(40);
    }
  }, [visible, fade, cardScale, cardY]);

  if (!visible || !data) return null;

  // Card sized to ~70% of screen width, capped at 340.
  const cardSize = Math.min(340, Math.round(width * 0.72));

  return (
    <Animated.View
      pointerEvents="auto"
      style={[styles.root, { width, height, opacity: fade }]}
      testID="song-found-card"
    >
      {/* Dim backdrop */}
      <TouchableOpacity
        activeOpacity={1}
        onPress={onDismiss}
        style={StyleSheet.absoluteFill as any}
      >
        <Animated.View style={[styles.backdrop, { opacity: fade }]} />
      </TouchableOpacity>

      {/* Centered content */}
      <View style={styles.center} pointerEvents="box-none">
        <Animated.View
          style={{
            transform: [{ translateY: cardY }, { scale: cardScale }],
            alignItems: "center",
          }}
        >
          {/* Tagline */}
          <View style={styles.tagWrap}>
            <Ionicons name="radio" size={14} color="#FF66E0" />
            <Text style={styles.tagText}>SONG FOUND</Text>
          </View>

          {/* Tilted album art */}
          <View style={{ width: cardSize, height: cardSize }}>
            <TiltedCard
              imageSrc={data.art || "https://placehold.co/600x600/121218/B026FF?text=%E2%99%AB"}
              overlayTitle={data.title}
              captionText={data.artist || data.title}
              containerSize={cardSize}
              imageSize={cardSize}
              rotateAmplitude={14}
              scaleOnHover={1.1}
            />
          </View>

          {/* Title + artist */}
          <View style={styles.metaWrap}>
            <Text style={styles.title} numberOfLines={2}>
              {data.title}
            </Text>
            {data.artist ? (
              <Text style={styles.artist} numberOfLines={1}>
                {data.artist}
              </Text>
            ) : null}
          </View>

          {/* Dismiss */}
          <TouchableOpacity
            onPress={onDismiss}
            style={styles.dismissBtn}
            activeOpacity={0.85}
            testID="song-found-dismiss"
          >
            <Text style={styles.dismissText}>DISMISS</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    top: 0,
    left: 0,
    zIndex: 200,
    elevation: 200,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(5,5,12,0.85)",
    backdropFilter: "blur(12px)" as any,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  tagWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(176,38,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,102,224,0.5)",
    marginBottom: 18,
  },
  tagText: {
    color: "#FF66E0",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2,
  },
  metaWrap: {
    marginTop: 22,
    alignItems: "center",
    maxWidth: 320,
  },
  title: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 0.2,
    textAlign: "center",
  },
  artist: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    marginTop: 4,
    textAlign: "center",
  },
  spotifyBtn: {
    // unused — kept for future re-enable
    display: "none",
  },
  spotifyBtnText: {
    display: "none",
  },
  dismissBtn: {
    marginTop: 14,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(15,15,22,0.6)",
  },
  dismissText: {
    color: "rgba(255,255,255,0.85)",
    fontWeight: "900",
    letterSpacing: 2,
    fontSize: 12,
  },
});
