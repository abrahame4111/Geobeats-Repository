import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  Image,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  Animated,
  Easing,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { addToQueue, playNow, searchTracks, setRepeat, StoredAuth } from "../api";

type Track = {
  uri: string;
  id: string;
  name: string;
  artists: { name: string }[];
  album: { images: { url: string }[]; name?: string };
  duration_ms: number;
};

type Props = {
  visible: boolean;
  auth: StoredAuth | null;
  isInSession: boolean;
  hostName?: string | null;
  onClose: () => void;
  // Forwards a track URI to the host's session queue (host's frontend handles it)
  onForwardToHost?: (trackUri: string, trackName: string) => void;
  // Notify parent that a URI was successfully queued (for autoplay-blocking)
  onQueued?: (trackUri: string) => void;
  // Called immediately after a "play now" succeeds so parent can sync the player UI
  onPlayedNow?: (track: Track) => void;
};

export default function SearchSheet({ visible, auth, isInSession, hostName, onClose, onForwardToHost, onQueued, onPlayedNow }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queuedIds, setQueuedIds] = useState<Record<string, "loading" | "ok" | "err">>({});
  const slideAnim = useRef(new Animated.Value(0)).current;
  const debounceRef = useRef<any>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: visible ? 1 : 0,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    if (visible) {
      // Auto-focus the input shortly after opening
      setTimeout(() => inputRef.current?.focus(), 320);
    } else {
      // Reset state on close
      setTimeout(() => {
        setQuery("");
        setResults([]);
        setError(null);
        setQueuedIds({});
      }, 280);
    }
  }, [visible]);

  // Debounced search with "latest wins" guard so faster requests can't be
  // overwritten by slower in-flight ones (e.g. when user deletes letters
  // quickly and an older longer-query response arrives last).
  const reqIdRef = useRef(0);
  useEffect(() => {
    if (!visible) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed) {
      reqIdRef.current += 1; // invalidate any in-flight requests
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      if (!auth) return;
      const myReq = ++reqIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const data: any = await searchTracks(auth, trimmed);
        // Drop response if a newer request has been issued since
        if (myReq !== reqIdRef.current) return;
        const items = data?.tracks?.items || [];
        setResults(items);
      } catch (e: any) {
        if (myReq !== reqIdRef.current) return;
        setError("Search failed. Try again.");
        setResults([]);
      } finally {
        if (myReq === reqIdRef.current) setLoading(false);
      }
    }, 150);
    return () => clearTimeout(debounceRef.current);
  }, [query, auth, visible]);

  const handleQueue = async (track: Track) => {
    if (!auth) return;
    setQueuedIds((p) => ({ ...p, [track.id]: "loading" }));
    try {
      // Disable repeat first so playback doesn't loop the same track forever.
      // Best-effort — may fail for non-Premium or no-active-device, ignore.
      try { await setRepeat(auth, "off"); } catch {}
      // Always queue on user's own Spotify (so guest hears it on their device too)
      await addToQueue(auth, track.uri);
      // Notify parent so it can mark this URI as "approved" for autoplay-blocking
      onQueued?.(track.uri);
      // If user is a guest in a session, also forward to host so the host queues it on their Spotify
      if (isInSession && onForwardToHost) {
        onForwardToHost(track.uri, track.name);
      }
      setQueuedIds((p) => ({ ...p, [track.id]: "ok" }));
      // Keep "ok" state permanently — once a track is added, it stays added
    } catch (e) {
      setQueuedIds((p) => ({ ...p, [track.id]: "err" }));
      setTimeout(() => {
        setQueuedIds((p) => {
          const n = { ...p };
          delete n[track.id];
          return n;
        });
      }, 2400);
    }
  };

  if (!visible && (slideAnim as any)._value === 0) {
    // Fully hidden — don't render to avoid intercepting touches
    return null;
  }

  const translateY = slideAnim.interpolate({ inputRange: [0, 1], outputRange: [800, 0] });

  return (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      style={[styles.overlay, { opacity: slideAnim }]}
    >
      <TouchableOpacity activeOpacity={1} style={styles.backdrop} onPress={onClose} />
      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerSide}>
              <Text style={styles.title}>SEARCH</Text>
            </View>
            {isInSession ? (
              <View pointerEvents="none" style={styles.hostBadgeWrap}>
                <View style={styles.hostBadge}>
                  <Ionicons name="headset" size={11} color="#D4FF00" />
                  <Text style={styles.hostBadgeText} numberOfLines={1}>
                    Queues to {hostName || "host"}
                  </Text>
                </View>
              </View>
            ) : null}
            <View style={[styles.headerSide, { alignItems: "flex-end" }]}>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={8}>
                <Ionicons name="close" size={22} color="rgba(255,255,255,0.7)" />
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.searchRow}>
            <Ionicons name="search" size={16} color="rgba(255,255,255,0.55)" />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={setQuery}
              placeholder="Songs, artists, albums…"
              placeholderTextColor="rgba(255,255,255,0.4)"
              style={styles.input}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
            {loading && <ActivityIndicator size="small" color="#D4FF00" />}
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <FlatList
            data={results}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 32 }}
            ListEmptyComponent={
              !loading && query.trim().length > 0 ? (
                <Text style={styles.emptyHint}>No results.</Text>
              ) : !query.trim() ? (
                <Text style={styles.emptyHint}>Type to search Spotify…</Text>
              ) : null
            }
            renderItem={({ item }) => {
              const status = queuedIds[item.id];
              const art = item.album?.images?.[item.album.images.length - 1]?.url || item.album?.images?.[0]?.url;
              const handlePlayNow = async () => {
                if (!auth) return;
                setQueuedIds((p) => ({ ...p, [`play-${item.id}`]: "loading" }));
                // Fire optimistic UI update immediately so the player bottom
                // sheet reflects the song instantly without waiting for the poll.
                onPlayedNow?.(item);
                try {
                  try { await setRepeat(auth, "off"); } catch {}
                  await playNow(auth, item.uri);
                  onQueued?.(item.uri);
                } catch (e) {
                  console.warn("[play-now] failed", e);
                } finally {
                  setQueuedIds((p) => {
                    const n = { ...p };
                    delete n[`play-${item.id}`];
                    return n;
                  });
                }
              };
              return (
                <TouchableOpacity
                  style={styles.row}
                  onPress={handlePlayNow}
                  activeOpacity={0.6}
                  testID={`play-now-${item.id}`}
                >
                  {art ? <Image source={{ uri: art }} style={styles.art} /> : <View style={[styles.art, { backgroundColor: "#1a1a26" }]} />}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.trackName} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.artistName} numberOfLines={1}>
                      {item.artists?.map((a) => a.name).join(", ")}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.queueBtn,
                      status === "ok" && styles.queueBtnOk,
                      status === "err" && styles.queueBtnErr,
                    ]}
                    onPress={(e) => { e.stopPropagation(); handleQueue(item); }}
                    disabled={status === "loading" || status === "ok"}
                    activeOpacity={0.85}
                  >
                    {status === "loading" ? (
                      <ActivityIndicator size="small" color="#05050A" />
                    ) : status === "ok" ? (
                      <Ionicons name="checkmark" size={18} color="#05050A" />
                    ) : status === "err" ? (
                      <Ionicons name="alert" size={16} color="#fff" />
                    ) : (
                      <Ionicons name="add" size={20} color="#05050A" />
                    )}
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            }}
          />
        </KeyboardAvoidingView>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 100,
    justifyContent: "flex-end",
  },
  backdrop: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheet: {
    height: "82%",
    backgroundColor: "#0b0b14",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderColor: "rgba(212,255,0,0.15)",
  },
  handle: {
    alignSelf: "center",
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.18)",
    marginBottom: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    position: "relative",
  },
  headerSide: {
    flex: 1,
    justifyContent: "center",
  },
  title: { color: "#fff", fontSize: 16, fontWeight: "900", letterSpacing: 1.2 },
  hostBadgeWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  hostBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "rgba(212,255,0,0.08)",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(212,255,0,0.35)",
    maxWidth: "60%",
  },
  hostBadgeText: { color: "#D4FF00", fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  closeBtn: { padding: 4 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  input: { flex: 1, color: "#fff", fontSize: 14, paddingVertical: 0 },
  error: { color: "#FF8A00", fontSize: 12, marginBottom: 8 },
  emptyHint: { color: "rgba(255,255,255,0.4)", fontSize: 13, textAlign: "center", marginTop: 32 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
  },
  art: { width: 44, height: 44, borderRadius: 6 },
  trackName: { color: "#fff", fontSize: 14, fontWeight: "700" },
  artistName: { color: "rgba(255,255,255,0.55)", fontSize: 12, marginTop: 2 },
  queueBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#D4FF00",
  },
  queueBtnOk: { backgroundColor: "#7CFF55" },
  queueBtnErr: { backgroundColor: "#FF4500" },
});
