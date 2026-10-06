import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  useAudioRecorder,
  RecordingPresets,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
} from "expo-audio";
import { BACKEND_URL } from "../api";

export type RadarMatch = {
  matched: true;
  title: string;
  subtitle?: string;
  art?: string;
  isrc?: string;
  shazam_id?: string;
  spotify_uri?: string;
  spotify_url?: string;
};

export type RadarResult = RadarMatch | { matched: false; error?: string };

type Props = {
  /** Called when recognition completes (success or failure). */
  onResult?: (result: RadarResult) => void;
  /** Called whenever the radar UI changes phase — useful for toasts. */
  onPhaseChange?: (phase: Phase) => void;
};

export type Phase = "idle" | "recording" | "uploading" | "success" | "error";

const RECORD_MS = 10_000;

/**
 * Pulsing mic FAB that records ~10 seconds of ambient audio (via the new
 * SDK 55 `expo-audio` recorder) and uploads it to `/api/recognize` (Shazam).
 */
export default function SongRadarFab({ onResult, onPhaseChange }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [remaining, setRemaining] = useState(0);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pulse rings (two staggered) — only animate while recording.
  const pulse1 = useRef(new Animated.Value(0)).current;
  const pulse2 = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    onPhaseChange?.(phase);
    if (phase === "recording") {
      const loop = (val: Animated.Value, delay: number) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(val, {
              toValue: 1,
              duration: 1400,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(val, {
              toValue: 0,
              duration: 0,
              useNativeDriver: true,
            }),
          ])
        );
      const a1 = loop(pulse1, 0);
      const a2 = loop(pulse2, 700);
      const breathe = Animated.loop(
        Animated.sequence([
          Animated.timing(scale, {
            toValue: 1.08,
            duration: 700,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 1,
            duration: 700,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      );
      a1.start();
      a2.start();
      breathe.start();
      return () => {
        a1.stop();
        a2.stop();
        breathe.stop();
        pulse1.setValue(0);
        pulse2.setValue(0);
        scale.setValue(1);
      };
    }
  }, [phase, onPhaseChange, pulse1, pulse2, scale]);

  const cleanupTimers = () => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    if (tickTimerRef.current) clearInterval(tickTimerRef.current);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    stopTimerRef.current = null;
    tickTimerRef.current = null;
    flashTimerRef.current = null;
  };

  const flashThen = (next: Phase, ms = 1600) => {
    setPhase(next);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => {
      setPhase("idle");
    }, ms);
  };

  const stopAndUpload = async () => {
    cleanupTimers();
    setRemaining(0);
    setPhase("uploading");
    let uri: string | null = null;
    try {
      await recorder.stop();
      uri = recorder.uri;
    } catch (e) {
      console.warn("[radar] stop failed", e);
    }
    try {
      await setAudioModeAsync({ allowsRecording: false });
    } catch {}

    if (!uri) {
      flashThen("error");
      onResult?.({ matched: false, error: "No audio captured" });
      return;
    }

    try {
      const fd = new FormData();
      // RN FormData accepts the {uri,name,type} shape directly.
      fd.append("audio", {
        // @ts-ignore — RN's FormData
        uri,
        name: "radar.m4a",
        type: "audio/m4a",
      } as any);

      const res = await fetch(`${BACKEND_URL}/api/recognize`, {
        method: "POST",
        body: fd,
      });
      const json = (await res.json()) as RadarResult;
      if (json.matched) {
        flashThen("success", 1800);
      } else {
        flashThen("error");
      }
      onResult?.(json);
    } catch (e: any) {
      console.warn("[radar] upload failed", e);
      flashThen("error");
      onResult?.({ matched: false, error: String(e?.message || e) });
    }
  };

  const start = async () => {
    if (phase === "recording") {
      // Tap again → finish early.
      stopAndUpload();
      return;
    }
    if (phase !== "idle") return;
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "Microphone needed",
          "Enable microphone access in Settings to identify songs around you."
        );
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase("recording");
      setRemaining(Math.ceil(RECORD_MS / 1000));

      // Auto-stop after RECORD_MS.
      stopTimerRef.current = setTimeout(() => stopAndUpload(), RECORD_MS);
      // Tick the countdown each second for the small label.
      const startedAt = Date.now();
      tickTimerRef.current = setInterval(() => {
        const left = Math.max(0, RECORD_MS - (Date.now() - startedAt));
        setRemaining(Math.ceil(left / 1000));
      }, 250);
    } catch (e) {
      console.warn("[radar] start failed", e);
      cleanupTimers();
      setRemaining(0);
      flashThen("error");
      try { await setAudioModeAsync({ allowsRecording: false }); } catch {}
    }
  };

  const onPress = () => {
    if (phase === "uploading") return;
    if (phase === "recording") {
      stopAndUpload();
      return;
    }
    start();
  };

  // Color depending on phase.
  const ring = phase === "error"
    ? "#FF4D7A"
    : phase === "success"
    ? "#26FFB0"
    : "#B026FF";

  // The icon shown.
  const iconName: keyof typeof Ionicons.glyphMap =
    phase === "uploading" ? "sync"
    : phase === "success" ? "checkmark"
    : phase === "error" ? "alert"
    : phase === "recording" ? "stop"
    : "mic";

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {/* Pulse rings, only visible while recording */}
      {phase === "recording" && (
        <>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.pulseRing,
              {
                borderColor: ring,
                opacity: pulse1.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
                transform: [{ scale: pulse1.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }) }],
              },
            ]}
          />
          <Animated.View
            pointerEvents="none"
            style={[
              styles.pulseRing,
              {
                borderColor: ring,
                opacity: pulse2.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
                transform: [{ scale: pulse2.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
              },
            ]}
          />
        </>
      )}
      <Animated.View style={{ transform: [{ scale }] }}>
        <TouchableOpacity
          onPress={onPress}
          activeOpacity={0.85}
          testID="song-radar-fab"
          hitSlop={8}
          style={[
            styles.btn,
            { borderColor: ring },
            phase === "recording" && styles.btnRecording,
          ]}
        >
          <Ionicons name={iconName} size={19} color={ring} />
        </TouchableOpacity>
      </Animated.View>
      {phase === "recording" && remaining > 0 ? (
        <View style={styles.countdownBadge} pointerEvents="none">
          <Text style={styles.countdownText}>{remaining}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  btn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(10,10,18,0.85)",
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  btnRecording: {
    backgroundColor: "rgba(176,38,255,0.18)",
  },
  pulseRing: {
    position: "absolute",
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
  },
  countdownBadge: {
    position: "absolute",
    bottom: -6,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: "#0A0A12",
    borderWidth: 1,
    borderColor: "rgba(176,38,255,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  countdownText: {
    color: "#B026FF",
    fontSize: 10,
    fontWeight: "900",
  },
});
