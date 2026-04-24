import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export type UserCardData = {
  user_id: string;
  display_name: string;
  profile_image?: string;
  current_track?: any;
  is_playing?: boolean;
  host_session?: boolean;
};

type Props = {
  user: UserCardData;
  onClose: () => void;
  onListenAlong: () => void;
  busy?: boolean;
  isActiveSession?: boolean;
};

function extractTrack(ct: any) {
  if (!ct) return null;
  const item = ct.item || ct;
  const name = item?.name || "";
  const artists = (item?.artists || []).map((a: any) => a.name).join(", ");
  const art = item?.album?.images?.[0]?.url || "";
  return { name, artists, art };
}

export default function ListenAlongCard({ user, onClose, onListenAlong, busy, isActiveSession }: Props) {
  const t = extractTrack(user.current_track);
  return (
    <View style={styles.card} testID="listen-along-card">
      <View style={styles.header}>
        <Image
          source={{ uri: user.profile_image || "https://placehold.co/100x100/121218/D4FF00?text=M" }}
          style={styles.avatar}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>
            {user.display_name}
          </Text>
          <View style={styles.liveRow}>
            <View style={[styles.dot, !user.is_playing && styles.dotMuted]} />
            <Text style={styles.liveLabel}>
              {user.is_playing ? "NOW PLAYING" : "PAUSED"}
            </Text>
          </View>
        </View>
        <TouchableOpacity onPress={onClose} testID="close-card-button" hitSlop={10}>
          <Ionicons name="close" size={22} color="rgba(255,255,255,0.6)" />
        </TouchableOpacity>
      </View>

      {t && t.name ? (
        <View style={styles.trackRow}>
          {t.art ? <Image source={{ uri: t.art }} style={styles.art} /> : <View style={[styles.art, styles.artPlaceholder]} />}
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.trackName} numberOfLines={2}>
              {t.name}
            </Text>
            <Text style={styles.trackArtist} numberOfLines={1}>
              {t.artists}
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.emptyRow}>
          <Ionicons name="musical-note-outline" size={20} color="rgba(255,255,255,0.4)" />
          <Text style={styles.emptyText}>Not playing anything right now</Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.cta, (!t?.name || busy) && styles.ctaDisabled, isActiveSession && styles.ctaActive]}
        onPress={onListenAlong}
        disabled={!t?.name || busy}
        testID="listen-along-cta"
        activeOpacity={0.85}
      >
        {busy ? (
          <ActivityIndicator color="#000" />
        ) : (
          <>
            <Ionicons name={isActiveSession ? "stop-circle" : "headset"} size={22} color="#000" />
            <Text style={styles.ctaText}>{isActiveSession ? "LEAVE SESSION" : "LISTEN ALONG"}</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    bottom: 110,
    left: 16,
    right: 16,
    backgroundColor: "rgba(10,10,18,0.92)",
    borderRadius: 28,
    padding: 20,
    gap: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 12 },
    zIndex: 40,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: "#D4FF00",
    backgroundColor: "#12121A",
  },
  name: { color: "#fff", fontSize: 18, fontWeight: "800" },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#D4FF00", shadowColor: "#D4FF00", shadowOpacity: 0.8, shadowRadius: 6 },
  dotMuted: { backgroundColor: "rgba(255,255,255,0.3)" },
  liveLabel: { color: "rgba(255,255,255,0.55)", fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  trackRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  art: { width: 64, height: 64, borderRadius: 10, backgroundColor: "#12121A" },
  artPlaceholder: { borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  trackName: { color: "#fff", fontSize: 15, fontWeight: "700" },
  trackArtist: { color: "rgba(255,255,255,0.6)", fontSize: 13 },
  emptyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },
  emptyText: { color: "rgba(255,255,255,0.5)", fontSize: 13 },
  cta: {
    backgroundColor: "#D4FF00",
    borderRadius: 999,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  ctaActive: { backgroundColor: "#FF4500" },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: "#000", fontWeight: "900", fontSize: 14, letterSpacing: 1 },
});
