import React, { useEffect, useMemo, useRef, useState } from "react";
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
  onReact?: (emoji: string) => void;
  busy?: boolean;
  isActiveSession?: boolean;
  isSelf?: boolean;
};

const REACTIONS = ["🔥", "❤️", "💀"] as const;

function extractTrack(ct: any) {
  if (!ct) return null;
  const item = ct.item || ct;
  const name = item?.name || "";
  const artists = (item?.artists || []).map((a: any) => a.name).join(", ");
  const art = item?.album?.images?.[0]?.url || "";
  const isRadar = !!ct.is_radar;
  if (!name) return null;
  return { name, artists, art, isRadar };
}

/**
 * Atomic track swaps: when a track changes, name/artist update synchronously
 * via React batching, but the album art is fetched async by <Image>. To avoid
 * the brief "new title + old art" desync, we treat the *displayed* track as a
 * derived snapshot that only commits once the new artwork has been prefetched
 * (or after a 1.2s timeout fallback). All visible parts swap together.
 */
export default function ListenAlongCard({ user, onClose, onListenAlong, onReact, busy, isActiveSession, isSelf }: Props) {
  const incoming = useMemo(() => extractTrack(user.current_track), [user.current_track]);
  const [displayed, setDisplayed] = useState(incoming);
  const [artLoading, setArtLoading] = useState(false);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const sameName = (displayed?.name || "") === (incoming?.name || "");
    const sameArt = (displayed?.art || "") === (incoming?.art || "");
    if (sameName && sameArt) return;

    if (!incoming) {
      setDisplayed(null);
      setArtLoading(false);
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      return;
    }

    if (!incoming.art) {
      setDisplayed(incoming);
      setArtLoading(false);
      return;
    }

    setArtLoading(true);
    let cancelled = false;
    Image.prefetch(incoming.art)
      .catch(() => {})
      .finally(() => {
        if (cancelled) return;
        setDisplayed(incoming);
        setArtLoading(false);
        if (fallbackTimerRef.current) {
          clearTimeout(fallbackTimerRef.current);
          fallbackTimerRef.current = null;
        }
      });

    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = setTimeout(() => {
      if (cancelled) return;
      setDisplayed(incoming);
      setArtLoading(false);
    }, 1200);

    return () => {
      cancelled = true;
    };
  }, [incoming, displayed]);

  const t = displayed;
  const isPlaying = !!user.is_playing && !!t;
  const isRadar = !!t?.isRadar;
  // Show the track row whenever we have a track — even when PAUSED — so the
  // card reflects both states. It only disappears once the now-playing is
  // fully cleared (t === null after the 15s playback-stop grace).
  const showTrack = !!t;
  // Radar broadcasts have no synced playback — suppress the Listen Along CTA.
  const showButton = isPlaying && !isActiveSession && !isSelf && !isRadar;
  const showReactions = isPlaying && !isSelf && !!onReact;

  return (
    <View style={styles.card} testID="listen-along-card">
      <View style={styles.header}>
        <Image
          source={{ uri: user.profile_image || "https://placehold.co/100x100/121218/B026FF?text=M" }}
          style={styles.avatar}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>
            {user.display_name}
          </Text>
          <View style={styles.liveRow}>
            <View style={[styles.dot, !isPlaying && styles.dotMuted]} />
            <Text style={styles.liveLabel}>
              {isPlaying ? (isActiveSession ? "LISTENING ALONG" : isRadar ? "RADAR" : "NOW PLAYING") : "PAUSED"}
            </Text>
          </View>
        </View>
        <TouchableOpacity onPress={onClose} testID="close-card-button" hitSlop={10}>
          <Ionicons
            name={isActiveSession ? "exit-outline" : "close"}
            size={22}
            color={isActiveSession ? "#FF66E0" : "rgba(255,255,255,0.6)"}
          />
        </TouchableOpacity>
      </View>

      {showTrack ? (
        <View style={styles.trackRow} key={t!.art || t!.name}>
          {t!.art ? (
            <Image source={{ uri: t!.art }} style={styles.art} />
          ) : (
            <View style={[styles.art, styles.artPlaceholder]} />
          )}
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.trackName} numberOfLines={2}>
              {t!.name}
            </Text>
            {t!.artists ? (
              <Text style={styles.trackArtist} numberOfLines={1}>
                {t!.artists}
              </Text>
            ) : null}
          </View>
          {artLoading ? (
            <ActivityIndicator size="small" color="rgba(176,38,255,0.6)" />
          ) : null}
        </View>
      ) : null}

      {showReactions ? (
        <View style={styles.reactionRow} testID="reaction-row">
          {REACTIONS.map((e) => (
            <TouchableOpacity
              key={e}
              style={styles.reactionBtn}
              onPress={() => onReact!(e)}
              activeOpacity={0.65}
              testID={`react-${e}`}
              hitSlop={6}
            >
              <Text style={styles.reactionEmoji}>{e}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {showButton ? (
        <TouchableOpacity
          style={[styles.cta, busy && styles.ctaDisabled]}
          onPress={onListenAlong}
          disabled={busy}
          testID="listen-along-cta"
          activeOpacity={0.85}
        >
          {busy ? (
            <ActivityIndicator color="#000" />
          ) : (
            <>
              <Ionicons name="headset" size={22} color="#000" />
              <Text style={styles.ctaText}>LISTEN ALONG</Text>
            </>
          )}
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    bottom: 140,
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
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
  },
  header: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: "#B026FF",
    backgroundColor: "#1a0a24",
  },
  name: { color: "#fff", fontSize: 17, fontWeight: "700" },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  dot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: "#B026FF",
    shadowColor: "#B026FF", shadowOpacity: 1, shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  dotMuted: { backgroundColor: "rgba(255,255,255,0.35)", shadowOpacity: 0 },
  liveLabel: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  trackRow: { flexDirection: "row", gap: 14, alignItems: "center" },
  art: { width: 56, height: 56, borderRadius: 8, backgroundColor: "#1a0a24" },
  artPlaceholder: { borderWidth: 1, borderColor: "rgba(176,38,255,0.2)" },
  trackName: { color: "#fff", fontSize: 15, fontWeight: "700" },
  trackArtist: { color: "rgba(255,255,255,0.55)", fontSize: 13 },
  reactionRow: { flexDirection: "row", justifyContent: "center", gap: 14 },
  reactionBtn: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: "rgba(176,38,255,0.12)",
    borderWidth: 1, borderColor: "rgba(176,38,255,0.3)",
    alignItems: "center", justifyContent: "center",
  },
  reactionEmoji: { fontSize: 22 },
  cta: {
    backgroundColor: "#B026FF", borderRadius: 999, paddingVertical: 16,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: "#000", fontWeight: "900", fontSize: 15, letterSpacing: 1 },
});
