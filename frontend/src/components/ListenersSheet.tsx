import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Image,
  ActivityIndicator,
  Animated,
  Easing,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getQueue, StoredAuth } from "../api";

type Listener = {
  user_id: string;
  display_name: string;
  profile_image?: string;
  current_track?: any;
  is_playing?: boolean;
};

type Props = {
  visible: boolean;
  auth: StoredAuth | null;
  listeners: Listener[];
  hostId?: string | null;
  selfId?: string | null;
  onClose: () => void;
  onListenAlong?: (userId: string) => void;
  onLeaveSession?: () => void;
};

function trackInfo(ct: any) {
  if (!ct) return null;
  const item = ct.item || ct;
  const name = item?.name;
  if (!name) return null;
  const artists = (item?.artists || []).map((a: any) => a.name).join(", ");
  const art = item?.album?.images?.[item?.album?.images?.length - 1]?.url || item?.album?.images?.[0]?.url || "";
  return { name, artists, art };
}

export default function ListenersSheet({
  visible,
  auth,
  listeners,
  hostId,
  selfId,
  onClose,
  onListenAlong,
  onLeaveSession,
}: Props) {
  const [tab, setTab] = useState<"listeners" | "queue">("listeners");
  const [queue, setQueue] = useState<any[]>([]);
  const [currentlyPlaying, setCurrentlyPlaying] = useState<any>(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: visible ? 1 : 0,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible]);

  // Load queue when tab switches or sheet opens
  useEffect(() => {
    if (!visible || tab !== "queue" || !auth) return;
    let cancelled = false;
    (async () => {
      setQueueLoading(true);
      setQueueError(null);
      try {
        const data: any = await getQueue(auth);
        if (cancelled) return;
        setCurrentlyPlaying(data?.currently_playing || null);
        // Spotify's queue endpoint repeats the currently-playing track many
        // times when repeat=track or autoplay is on. Dedupe consecutive
        // duplicates so the UI doesn't show 10× of the same song.
        const raw: any[] = data?.queue || [];
        const deduped: any[] = [];
        let prevId: string | null = null;
        for (const t of raw) {
          const id = t?.id || t?.uri;
          if (id && id === prevId) continue;
          deduped.push(t);
          prevId = id;
        }
        setQueue(deduped);
      } catch (e) {
        if (!cancelled) setQueueError("Couldn't load queue");
      } finally {
        if (!cancelled) setQueueLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, tab, auth]);

  if (!visible && (slideAnim as any)._value === 0) return null;
  const translateY = slideAnim.interpolate({ inputRange: [0, 1], outputRange: [800, 0] });

  return (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      style={[styles.overlay, { opacity: slideAnim }]}
    >
      <TouchableOpacity activeOpacity={1} style={styles.backdrop} onPress={onClose} />
      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        <View style={styles.handle} />

        {/* Header with tabs */}
        <View style={styles.header}>
          <View style={styles.tabs}>
            <TouchableOpacity
              style={[styles.tab, tab === "listeners" && styles.tabActive]}
              onPress={() => setTab("listeners")}
            >
              <Ionicons name="people" size={14} color={tab === "listeners" ? "#05050A" : "rgba(255,255,255,0.6)"} />
              <Text style={[styles.tabText, tab === "listeners" && styles.tabTextActive]}>
                LISTENERS · {listeners.length}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, tab === "queue" && styles.tabActive]}
              onPress={() => setTab("queue")}
            >
              <Ionicons name="list" size={14} color={tab === "queue" ? "#05050A" : "rgba(255,255,255,0.6)"} />
              <Text style={[styles.tabText, tab === "queue" && styles.tabTextActive]}>
                QUEUE
              </Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={10} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>
        </View>

        {tab === "listeners" ? (
          <FlatList
            data={listeners}
            keyExtractor={(u) => u.user_id}
            contentContainerStyle={{ paddingBottom: 40 }}
            ListEmptyComponent={<Text style={styles.empty}>No one online yet.</Text>}
            renderItem={({ item }) => {
              const t = trackInfo(item.current_track);
              const isMe = item.user_id === selfId;
              const isHost = item.user_id === hostId;
              return (
                <View style={styles.listenerRow}>
                  <Image
                    source={{ uri: item.profile_image || "https://placehold.co/100x100/121218/D4FF00?text=M" }}
                    style={styles.avatar}
                  />
                  <View style={{ flex: 1 }}>
                    <View style={styles.nameRow}>
                      <Text style={styles.name} numberOfLines={1}>
                        {item.display_name}
                        {isMe ? " (you)" : ""}
                      </Text>
                      {isHost && !isMe ? (
                        <View style={styles.hostPill}>
                          <Ionicons name="radio" size={9} color="#D4FF00" />
                          <Text style={styles.hostPillText}>HOST</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.track} numberOfLines={1}>
                      {t ? `${t.name} — ${t.artists}` : "Not playing"}
                    </Text>
                  </View>
                  {!isMe ? (
                    isHost ? (
                      <TouchableOpacity style={[styles.actionBtn, styles.leaveBtn]} onPress={onLeaveSession}>
                        <Ionicons name="stop-circle" size={14} color="#fff" />
                        <Text style={styles.actionBtnText}>LEAVE</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={[styles.actionBtn, !t && styles.actionBtnDisabled]}
                        disabled={!t}
                        onPress={() => onListenAlong?.(item.user_id)}
                      >
                        <Ionicons name="headset" size={14} color="#05050A" />
                        <Text style={[styles.actionBtnText, { color: "#05050A" }]}>JOIN</Text>
                      </TouchableOpacity>
                    )
                  ) : null}
                </View>
              );
            }}
          />
        ) : (
          <FlatList
            data={queue}
            keyExtractor={(item, i) => `${item?.id || i}-${i}`}
            contentContainerStyle={{ paddingBottom: 40 }}
            ListHeaderComponent={
              <View>
                {currentlyPlaying ? (
                  <View style={styles.nowPlaying}>
                    <Text style={styles.sectionLabel}>NOW PLAYING</Text>
                    <View style={styles.queueRow}>
                      {currentlyPlaying.album?.images?.[0]?.url ? (
                        <Image source={{ uri: currentlyPlaying.album.images[currentlyPlaying.album.images.length - 1]?.url || currentlyPlaying.album.images[0].url }} style={styles.qArt} />
                      ) : <View style={[styles.qArt, { backgroundColor: "#1a1a26" }]} />}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.qName} numberOfLines={1}>{currentlyPlaying.name}</Text>
                        <Text style={styles.qArtist} numberOfLines={1}>{(currentlyPlaying.artists || []).map((a: any) => a.name).join(", ")}</Text>
                      </View>
                    </View>
                  </View>
                ) : null}
                {queue.length > 0 ? <Text style={[styles.sectionLabel, { marginTop: 8 }]}>UP NEXT</Text> : null}
                {queueLoading ? <ActivityIndicator color="#D4FF00" style={{ marginTop: 16 }} /> : null}
                {queueError ? <Text style={styles.empty}>{queueError}</Text> : null}
              </View>
            }
            ListEmptyComponent={!queueLoading && !queueError ? <Text style={styles.empty}>Queue is empty.</Text> : null}
            renderItem={({ item }) => (
              <View style={styles.queueRow}>
                {item?.album?.images?.length ? (
                  <Image source={{ uri: item.album.images[item.album.images.length - 1]?.url || item.album.images[0].url }} style={styles.qArt} />
                ) : <View style={[styles.qArt, { backgroundColor: "#1a1a26" }]} />}
                <View style={{ flex: 1 }}>
                  <Text style={styles.qName} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.qArtist} numberOfLines={1}>{(item.artists || []).map((a: any) => a.name).join(", ")}</Text>
                </View>
              </View>
            )}
          />
        )}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 100, justifyContent: "flex-end" },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    height: "70%",
    backgroundColor: "#0b0b14",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderColor: "rgba(212,255,0,0.15)",
  },
  handle: { alignSelf: "center", width: 44, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.18)", marginBottom: 10 },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 12, gap: 10 },
  tabs: { flex: 1, flexDirection: "row", backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 999, padding: 4, gap: 4 },
  tab: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", paddingVertical: 8, borderRadius: 999 },
  tabActive: { backgroundColor: "#D4FF00" },
  tabText: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "900", letterSpacing: 0.8 },
  tabTextActive: { color: "#05050A" },
  closeBtn: { padding: 4 },
  empty: { color: "rgba(255,255,255,0.4)", fontSize: 13, textAlign: "center", marginTop: 32 },
  listenerRow: {
    flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.05)",
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#12121A" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
  name: { color: "#fff", fontSize: 14, fontWeight: "700", flexShrink: 1 },
  hostPill: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: "rgba(212,255,0,0.12)", borderWidth: 1, borderColor: "rgba(212,255,0,0.3)" },
  hostPillText: { color: "#D4FF00", fontSize: 9, fontWeight: "900", letterSpacing: 0.5 },
  track: { color: "rgba(255,255,255,0.5)", fontSize: 12 },
  actionBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, backgroundColor: "#D4FF00",
  },
  actionBtnDisabled: { backgroundColor: "rgba(212,255,0,0.3)" },
  actionBtnText: { fontSize: 11, fontWeight: "900", letterSpacing: 0.8 },
  leaveBtn: { backgroundColor: "rgba(255,69,0,0.16)", borderWidth: 1, borderColor: "rgba(255,69,0,0.55)" },
  sectionLabel: { color: "rgba(255,255,255,0.45)", fontSize: 10, fontWeight: "900", letterSpacing: 1, marginVertical: 6 },
  nowPlaying: {},
  queueRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  qArt: { width: 44, height: 44, borderRadius: 6 },
  qName: { color: "#fff", fontSize: 14, fontWeight: "700" },
  qArtist: { color: "rgba(255,255,255,0.55)", fontSize: 12, marginTop: 2 },
});
