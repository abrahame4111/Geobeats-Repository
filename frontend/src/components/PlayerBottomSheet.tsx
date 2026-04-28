import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";

type Props = {
  profileImage?: string;
  displayName: string;
  track?: any;
  isPlaying?: boolean;
  syncStatus?: "idle" | "syncing" | "synced" | "hosting";
  inSession?: boolean;
  onPlayPause?: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  onLogout?: () => void;
  onOpenListeners?: () => void;
};

function extractTrack(ct: any) {
  if (!ct) return null;
  const item = ct.item || ct;
  const name = item?.name;
  if (!name) return null;
  const artists = (item?.artists || []).map((a: any) => a.name).join(", ");
  const art = item?.album?.images?.[0]?.url || "";
  return { name, artists, art };
}

export default function PlayerBottomSheet({
  profileImage,
  displayName,
  track,
  isPlaying,
  syncStatus = "idle",
  inSession,
  onPlayPause,
  onNext,
  onPrev,
  onLogout,
  onOpenListeners,
}: Props) {
  const t = extractTrack(track);

  const syncBadge = (() => {
    if (syncStatus === "hosting")
      return { color: "#D4FF00", text: "YOU'RE HOSTING", icon: "radio" as const };
    if (syncStatus === "syncing")
      return { color: "#FF8A00", text: "SYNCING…", icon: "sync" as const };
    if (syncStatus === "synced")
      return { color: "#00FFE0", text: "LISTENING ALONG", icon: "headset" as const };
    return null;
  })();

  return (
    <View style={styles.sheet} testID="player-bottom-sheet">
      {syncBadge && (
        <View style={[styles.badge, { backgroundColor: `${syncBadge.color}22`, borderColor: `${syncBadge.color}66` }]}>
          <Ionicons name={syncBadge.icon} size={12} color={syncBadge.color} />
          <Text style={[styles.badgeText, { color: syncBadge.color }]}>{syncBadge.text}</Text>
        </View>
      )}

      <View style={styles.row}>
        <Image
          source={{ uri: t?.art || profileImage || "https://placehold.co/100x100/121218/D4FF00?text=M" }}
          style={[styles.art, !isPlaying && styles.artDim]}
        />
        <View style={styles.meta}>
          {t && isPlaying ? (
            <>
              <Text style={styles.title} numberOfLines={1}>
                {t.name}
              </Text>
              <Text style={styles.artist} numberOfLines={1}>
                {t.artists}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.title} numberOfLines={1}>
                Not playing currently
              </Text>
              <Text style={styles.artist} numberOfLines={1}>
                Open Spotify & play a track to go live
              </Text>
            </>
          )}
        </View>

        <View style={styles.controls}>
          {inSession ? (
            <TouchableOpacity
              onPress={onOpenListeners}
              testID="player-listeners"
              style={[styles.ctrlBtn, styles.ctrlPrimary, styles.ctrlGroup]}
              hitSlop={8}
              activeOpacity={0.85}
            >
              <Ionicons name="people" size={22} color="#000" />
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity onPress={onPrev} testID="player-prev" style={styles.ctrlBtn} hitSlop={8}>
                <Ionicons name="play-skip-back" size={20} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onPlayPause}
                testID="player-play-pause"
                style={[styles.ctrlBtn, styles.ctrlPrimary]}
                hitSlop={8}
              >
                <Ionicons name={isPlaying ? "pause" : "play"} size={20} color="#000" />
              </TouchableOpacity>
              <TouchableOpacity onPress={onNext} testID="player-next" style={styles.ctrlBtn} hitSlop={8}>
                <Ionicons name="play-skip-forward" size={20} color="#fff" />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#0a0a12",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 28,
    gap: 12,
    zIndex: 50,
  },
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  badgeText: { fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  art: {
    width: 54,
    height: 54,
    borderRadius: 10,
    backgroundColor: "#12121A",
  },
  artDim: { opacity: 0.45 },
  meta: { flex: 1, gap: 2 },
  title: { color: "#fff", fontSize: 15, fontWeight: "700" },
  artist: { color: "rgba(255,255,255,0.55)", fontSize: 12 },
  controls: { flexDirection: "row", alignItems: "center", gap: 6 },
  ctrlBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  ctrlPrimary: { backgroundColor: "#D4FF00" },
  ctrlGroup: { width: 48, height: 48, borderRadius: 24 },
  logoutBtn: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 2,
  },
  logoutText: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: "600" },
});
