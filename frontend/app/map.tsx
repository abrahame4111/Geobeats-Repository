import { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
  TouchableOpacity,
  Animated,
  AppState,
} from "react-native";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import SoundMapView, { MapMarker, SoundMapHandle } from "../src/components/SoundMapView";
import ListenAlongCard from "../src/components/ListenAlongCard";
import PlayerBottomSheet from "../src/components/PlayerBottomSheet";
import SearchSheet from "../src/components/SearchSheet";
import FloatingReactions, { FloatingReaction } from "../src/components/FloatingReactions";
import ListenersSheet from "../src/components/ListenersSheet";
import {
  BACKEND_URL,
  StoredAuth,
  addToQueue,
  clearAuth,
  getActiveUsers,
  getCurrentlyPlaying,
  getDevices,
  loadAuth,
  playerAction,
  setRepeat,
} from "../src/api";

const GOOGLE_MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string;

type UsersMap = Record<string, any>;

export default function MapScreen() {
  const router = useRouter();
  const [auth, setAuth] = useState<StoredAuth | null>(null);
  const [loading, setLoading] = useState(true);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [usersMap, setUsersMap] = useState<UsersMap>({});
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [listenLoading, setListenLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "synced" | "hosting">("idle");
  const [hostId, setHostId] = useState<string | null>(null);
  const [myTrack, setMyTrack] = useState<any>(null);
  const [myIsPlaying, setMyIsPlaying] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const locIntervalRef = useRef<any>(null);
  const trackIntervalRef = useRef<any>(null);
  const pullRef = useRef<(() => Promise<void>) | null>(null);
  const syncIntervalRef = useRef<any>(null);
  const pendingSyncRef = useRef<any>(null);
  const [broadcastOn, setBroadcastOn] = useState(true);
  const [mapStyle, setMapStyleState] = useState<"geobeats" | "satellite">("geobeats");
  // Persist theme choice across sessions
  useEffect(() => {
    AsyncStorage.getItem("@geobeats/mapStyle").then((v) => {
      if (v === "geobeats" || v === "satellite") setMapStyleState(v);
    });
  }, []);
  const toggleMapStyle = () => {
    const next = mapStyle === "geobeats" ? "satellite" : "geobeats";
    setMapStyleState(next);
    AsyncStorage.setItem("@geobeats/mapStyle", next).catch(() => {});
    setToast({
      title: next === "geobeats" ? "GeoBeats Theme" : "Satellite Theme",
      subtitle: next === "geobeats" ? "Neon NFS-style map" : "Photorealistic Earth",
      tone: "live",
    });
    setTimeout(() => setToast(null), 1800);
  };
  const broadcastOnRef = useRef(true);
  const [toast, setToast] = useState<{ title: string; subtitle: string; tone: "live" | "ghost" } | null>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const toastTimerRef = useRef<any>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [listenersOpen, setListenersOpen] = useState(false);
  const mapRef = useRef<SoundMapHandle>(null);
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const [hasSpotify, setHasSpotify] = useState(true); // optimistic — assume open until proven otherwise

  // ---- Auto-pause when queue runs out (Spotify Autoplay workaround) ----
  // We track URIs the user explicitly queued via this app. When the currently
  // playing track changes from an "approved" URI to one that is NOT approved,
  // we know Spotify Autoplay just kicked in — pause playback automatically.
  const approvedUrisRef = useRef<Set<string>>(new Set());
  const autoStopArmedRef = useRef(false);
  const lastUriRef = useRef<string | null>(null);

  const approveUri = (uri?: string) => {
    if (!uri) return;
    approvedUrisRef.current.add(uri);
    autoStopArmedRef.current = true;
  };

  const sendReaction = (targetUserId: string, emoji: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "reaction:send", target_user_id: targetUserId, emoji }));
    // Also show locally so the sender sees their own reaction float up
    setFloatingReactions((p) => [
      ...p,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, emoji, fromName: "You" },
    ]);
  };

  const removeReaction = (id: string) =>
    setFloatingReactions((p) => p.filter((r) => r.id !== id));

  // ---- Init auth ----
  useEffect(() => {
    (async () => {
      const a = await loadAuth();
      if (!a) {
        router.replace("/");
        return;
      }
      setAuth(a);
      setLoading(false);
    })();
  }, []);

  // ---- WebSocket connection with auto-reconnect + keepalive ----
  const pingIntervalRef = useRef<any>(null);
  const reconnectTimerRef = useRef<any>(null);
  const reconnectAttemptsRef = useRef(0);
  const wsShouldRunRef = useRef(false);
  const [wsConnected, setWsConnected] = useState(false);

  useEffect(() => {
    if (!auth) return;
    wsShouldRunRef.current = true;

    const connect = () => {
      if (!wsShouldRunRef.current) return;
      const wsUrl = `${BACKEND_URL.replace(/^http/, "ws")}/api/ws?user_id=${encodeURIComponent(
        auth.user_id
      )}&display_name=${encodeURIComponent(auth.display_name)}&profile_image=${encodeURIComponent(
        auth.profile_image || ""
      )}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[ws] connected");
        reconnectAttemptsRef.current = 0;
        setWsConnected(true);
        // Immediately re-send our current location + track so peers see us
        if (myLocation) {
          ws.send(JSON.stringify({ type: "location:update", lat: myLocation.lat, lng: myLocation.lng }));
        }
        if (myTrack) {
          ws.send(JSON.stringify({ type: "user:active_track", track: myTrack, is_playing: myIsPlaying }));
        }
        // Keepalive ping every 25s
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try { ws.send(JSON.stringify({ type: "ping" })); } catch {}
          }
        }, 25000);
      };
      ws.onmessage = (e) => handleWsMessage(e.data);
      ws.onclose = () => {
        console.log("[ws] closed");
        setWsConnected(false);
        if (pingIntervalRef.current) { clearInterval(pingIntervalRef.current); pingIntervalRef.current = null; }
        if (!wsShouldRunRef.current) return;
        // Exponential backoff: 1s, 2s, 4s, … capped at 10s
        const attempt = reconnectAttemptsRef.current++;
        const delay = Math.min(10000, 1000 * 2 ** Math.min(attempt, 4));
        console.log(`[ws] reconnect in ${delay}ms (attempt ${attempt + 1})`);
        reconnectTimerRef.current = setTimeout(connect, delay);
      };
      ws.onerror = (err) => console.warn("[ws] error", err);
    };
    connect();

    return () => {
      wsShouldRunRef.current = false;
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      try { wsRef.current?.close(); } catch {}
      wsRef.current = null;
    };
  }, [auth?.user_id]);

  const handleWsMessage = (raw: any) => {
    try {
      const data = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (data.type === "users:snapshot") {
        const next: UsersMap = {};
        (data.users || []).forEach((u: any) => (next[u.user_id] = u));
        setUsersMap(next);
      } else if (data.type === "user:online") {
        setUsersMap((p) => ({ ...p, [data.user.user_id]: { ...p[data.user.user_id], ...data.user } }));
      } else if (data.type === "user:offline") {
        setUsersMap((p) => {
          const n = { ...p };
          delete n[data.user_id];
          return n;
        });
      } else if (data.type === "location:update") {
        setUsersMap((p) => ({
          ...p,
          [data.user_id]: {
            ...p[data.user_id],
            user_id: data.user_id,
            lat: data.lat,
            lng: data.lng,
            // Server now includes display_name/profile_image/current_track so
            // late-joining peers get a fully-rendered avatar immediately.
            display_name: data.display_name || p[data.user_id]?.display_name,
            profile_image: data.profile_image || p[data.user_id]?.profile_image,
            current_track: data.current_track || p[data.user_id]?.current_track,
            is_playing: typeof data.is_playing === "boolean" ? data.is_playing : p[data.user_id]?.is_playing,
          },
        }));
      } else if (data.type === "user:active_track") {
        setUsersMap((p) => ({
          ...p,
          [data.user_id]: {
            ...p[data.user_id],
            user_id: data.user_id,
            current_track: data.track,
            is_playing: data.is_playing,
          },
        }));
      } else if (data.type === "session:joined") {
        setHostId(data.host_id);
        setSyncStatus("syncing");
        pendingSyncRef.current = {
          track: data.track,
          is_playing: data.is_playing,
          position_ms: 0,
          timestamp: Date.now() / 1000,
        };
        applySync();
      } else if (data.type === "session:left") {
        setHostId(null);
        setSyncStatus("idle");
      } else if (data.type === "session:update" || data.type === "session:sync") {
        pendingSyncRef.current = data;
        setSyncStatus("synced");
        applySync();
      } else if (data.type === "session:guest_joined") {
        setSyncStatus("hosting");
      } else if (data.type === "session:queue_add") {
        // Host receives a track URI from a guest; queue it on host's Spotify
        if (auth && data.track_uri) {
          (async () => {
            try {
              // Disable repeat so playback doesn't loop the same track forever
              try { await setRepeat(auth, "off"); } catch {}
              await addToQueue(auth, data.track_uri);
              // Mark this URI as approved + arm autoplay-blocking auto-pause
              approveUri(data.track_uri);
              showToast("QUEUED", `${data.from_display_name || "Guest"} added "${data.track_name || "a track"}"`, "live");
            } catch (e) {
              console.warn("[queue] host add failed", e);
              showToast("QUEUE FAILED", "Open Spotify on your device", "ghost");
            }
          })();
        }
      } else if (data.type === "reaction:incoming") {
        setFloatingReactions((p) => [
          ...p,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            emoji: data.emoji,
            fromName: data.from_display_name || "Someone",
          },
        ]);
      }
    } catch (e) {
      console.warn("ws parse err", e);
    }
  };

  // ---- Location tracking ----
  useEffect(() => {
    if (!auth) return;
    (async () => {
      try {
        let lat = 40.758, lng = -73.9855; // fallback
        if (Platform.OS === "web") {
          if (typeof navigator !== "undefined" && (navigator as any).geolocation) {
            (navigator as any).geolocation.getCurrentPosition(
              (pos: any) => {
                const la = pos.coords.latitude, ln = pos.coords.longitude;
                setMyLocation({ lat: la, lng: ln });
                sendLocation(la, ln);
              },
              () => {
                // keep fallback + jitter for variety
                const la = lat + (Math.random() - 0.5) * 0.02;
                const ln = lng + (Math.random() - 0.5) * 0.02;
                setMyLocation({ lat: la, lng: ln });
                sendLocation(la, ln);
              },
              { enableHighAccuracy: false, timeout: 8000 }
            );
          } else {
            setMyLocation({ lat, lng });
            sendLocation(lat, lng);
          }
        } else {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status !== "granted") {
            setPermissionError("Location permission denied. Using default location.");
            setMyLocation({ lat, lng });
            sendLocation(lat, lng);
          } else {
            const pos = await Location.getCurrentPositionAsync({});
            const la = pos.coords.latitude, ln = pos.coords.longitude;
            setMyLocation({ lat: la, lng: ln });
            sendLocation(la, ln);
          }
        }

        // Re-send location every 5 seconds with slight jitter if same
        locIntervalRef.current = setInterval(async () => {
          if (Platform.OS !== "web") {
            try {
              const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
              const la = pos.coords.latitude, ln = pos.coords.longitude;
              setMyLocation({ lat: la, lng: ln });
              sendLocation(la, ln);
              return;
            } catch {}
          }
          setMyLocation((prev) => {
            if (!prev) return prev;
            sendLocation(prev.lat, prev.lng);
            return prev;
          });
        }, 5000);
      } catch (e) {
        console.warn("loc err", e);
      }
    })();
    return () => clearInterval(locIntervalRef.current);
  }, [auth?.user_id]);

  const sendLocation = (lat: number, lng: number) => {
    if (!broadcastOnRef.current) return;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "location:update", lat, lng }));
    }
  };

  const showToast = (title: string, subtitle: string, tone: "live" | "ghost") => {
    setToast({ title, subtitle, tone });
    Animated.timing(toastAnim, { toValue: 1, duration: 280, useNativeDriver: true }).start();
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      Animated.timing(toastAnim, { toValue: 0, duration: 240, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setToast(null);
      });
    }, 2400);
  };

  const toggleBroadcast = () => {
    const next = !broadcastOnRef.current;
    broadcastOnRef.current = next;
    setBroadcastOn(next);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "user:set_visibility", visible: next }));
      if (next && myLocation) {
        ws.send(JSON.stringify({ type: "location:update", lat: myLocation.lat, lng: myLocation.lng }));
      }
    }
    if (next) {
      showToast("YOU'RE LIVE", "Your vibe is on the map", "live");
    } else {
      showToast("GHOST MODE", "You've vanished from the map", "ghost");
    }
  };

  // ---- Poll my own currently-playing & broadcast ----
  useEffect(() => {
    if (!auth) return;
    const pull = async () => {
      try {
        const cp: any = await getCurrentlyPlaying(auth);
        const playing = !!cp?.is_playing;
        const item = cp?.item || null;
        const ws = wsRef.current;

        // ----- Autoplay-blocking: detect track URI change and pause if the
        // new track wasn't queued via this app (Spotify Autoplay kicked in).
        const newUri: string | null = item?.uri || null;
        if (newUri && newUri !== lastUriRef.current) {
          const prev = lastUriRef.current;
          if (
            autoStopArmedRef.current &&
            prev &&
            approvedUrisRef.current.has(prev) &&
            !approvedUrisRef.current.has(newUri)
          ) {
            // Queue-end → autoplay began. Pause to honour the user's intent.
            try {
              await playerAction("pause", auth, {});
              setMyIsPlaying(false);
              // Aggressively reset local state so the listen-along card and
              // marker pill update immediately, without waiting for the next
              // 5s poll cycle. The next pull() will reconcile from Spotify.
              setMyTrack(null);
              showToast("PLAYBACK ENDED", "Queue finished — autoplay blocked", "live");
            } catch (e) {
              console.warn("[autostop] pause failed", e);
            }
            autoStopArmedRef.current = false;
          }
          lastUriRef.current = newUri;
        }

        setMyTrack(item ? { item } : null);
        setMyIsPlaying(playing);

        // Update Spotify-active-device flag — Spotify being "open" means at least
        // one device is registered/available, even if not currently playing.
        try {
          const dev: any = await getDevices(auth);
          const list = dev?.devices || [];
          setHasSpotify(list.length > 0 || playing);
        } catch {}
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "user:active_track",
              track: item ? { item } : null,
              is_playing: playing,
              position_ms: cp?.progress_ms || 0,
            })
          );
        }
        // If hosting and have session, push sync
        if (syncStatus === "hosting" && item) {
          ws?.send(
            JSON.stringify({
              type: "session:sync",
              track: { item },
              is_playing: playing,
              position_ms: cp?.progress_ms || 0,
            })
          );
        }
      } catch (e) {
        // Token may be expired or no active device, ignore
      }
    };
    pull();
    trackIntervalRef.current = setInterval(pull, 5000);
    pullRef.current = pull;
    return () => clearInterval(trackIntervalRef.current);
  }, [auth?.user_id, syncStatus]);

  // ---- Re-poll on app foreground (so OPEN SPOTIFY state refreshes when user returns) ----
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        // Immediate re-poll so the player UI updates without waiting for next 5s tick
        pullRef.current?.();
      }
    });
    return () => sub.remove();
  }, []);

  // ---- Apply sync (guest side) ----
  const applySync = async () => {
    if (!auth) return;
    const sync = pendingSyncRef.current;
    if (!sync || !sync.track) return;
    try {
      const uri = sync.track.item?.uri || sync.track.uri;
      if (!uri) return;
      // Estimate current host position based on elapsed time since message timestamp
      const elapsed = Math.max(0, (Date.now() / 1000 - (sync.timestamp || Date.now() / 1000)) * 1000);
      const targetPos = Math.floor((sync.position_ms || 0) + (sync.is_playing ? elapsed : 0));
      if (sync.is_playing) {
        await playerAction("play", auth, { track_uri: uri, position_ms: targetPos });
      } else {
        await playerAction("pause", auth, {});
      }
    } catch (e) {
      // user may not have an active Spotify device; silent fail
    }
  };

  // Periodic resync for guests every 5s
  useEffect(() => {
    if (syncStatus !== "synced") {
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
      return;
    }
    syncIntervalRef.current = setInterval(() => applySync(), 5000);
    return () => clearInterval(syncIntervalRef.current);
  }, [syncStatus, auth?.user_id]);

  // ---- Map markers ----
  const markers: MapMarker[] = useMemo(() => {
    const list = Object.values(usersMap).filter((u: any) => u.user_id !== auth?.user_id);
    // Inject self marker only when broadcasting (not in ghost mode)
    if (auth && myLocation && broadcastOn) {
      list.push({
        user_id: auth.user_id,
        display_name: auth.display_name,
        profile_image: auth.profile_image,
        lat: myLocation.lat,
        lng: myLocation.lng,
        current_track: myTrack,
        is_playing: myIsPlaying,
      });
    }
    return list.filter((u: any) => u.lat && u.lng) as MapMarker[];
  }, [usersMap, myLocation, auth, myTrack, myIsPlaying, broadcastOn]);

  // Send self identity to map so self-marker renders in secondary color
  const mapSelfId = auth?.user_id;
  const mapMarkers = useMemo(() => {
    return markers.map((m) => ({ ...m, isSelf: m.user_id === mapSelfId }));
  }, [markers, mapSelfId]);

  // ---- Handlers ----
  // selectedUser:
  //  - For SELF: always trust local state (myTrack / myIsPlaying) so the card
  //    immediately reflects pause / autopause / app-close, without waiting for
  //    a server WS roundtrip that might leave stale data in usersMap.
  //  - For OTHERS: read from usersMap (server-broadcast positions/tracks).
  const selectedUser = selectedUserId
    ? (selectedUserId === auth?.user_id
        ? (auth ? { user_id: auth.user_id, display_name: auth.display_name, profile_image: auth.profile_image, current_track: myTrack, is_playing: myIsPlaying } : null)
        : (usersMap[selectedUserId] || null))
    : null;

  // Auto-close the card and leave any active listen-along session when the
  // user (self) stops playing music — covers Spotify pause, queue end with
  // autoplay-block kicking in, app being backgrounded, or device disconnect.
  // Without this the card would linger showing a stale track.
  useEffect(() => {
    if (!auth) return;
    const selfHasMusic = !!myTrack && !!myIsPlaying;
    if (!selfHasMusic) {
      // 1) Close the self-card if it's open
      if (selectedUserId === auth.user_id) {
        setSelectedUserId(null);
      }
      // 2) Stop hosting any session — others can no longer sync to silence
      if (syncStatus === "hosting") {
        try {
          wsRef.current?.send(JSON.stringify({ type: "session:stop" }));
        } catch {}
        setHostId(null);
        setSyncStatus("idle");
      }
      // 3) If joined as a guest and self isn't playing, leaving the session
      //    is too aggressive (guests by definition stop playing during sync);
      //    so we do NOT auto-leave guest sessions here.
    }
  }, [myTrack, myIsPlaying, selectedUserId, auth?.user_id, syncStatus]);

  const handleMarker = (uid: string) => setSelectedUserId(uid);

  const handleListenAlong = () => {
    if (!auth || !selectedUser) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn("[listen-along] ws not open", ws?.readyState);
      showToast("CAN'T JOIN", "Reconnecting — try again in a sec", "ghost");
      return;
    }
    if (hostId === selectedUser.user_id) {
      console.log("[listen-along] leave", selectedUser.user_id);
      ws.send(JSON.stringify({ type: "session:leave" }));
      setHostId(null);
      setSyncStatus("idle");
      setSelectedUserId(null);
    } else if (selectedUser.user_id !== auth.user_id) {
      console.log("[listen-along] join host", selectedUser.user_id);
      setListenLoading(true);
      ws.send(JSON.stringify({ type: "session:join", host_id: selectedUser.user_id }));
      setTimeout(() => setListenLoading(false), 1200);
    }
  };

  const handlePlayPause = async () => {
    if (!auth) return;
    try {
      if (myIsPlaying) await playerAction("pause", auth, {});
      else await playerAction("play", auth, {});
    } catch {}
  };
  const handleNext = async () => { if (!auth) return; try { await playerAction("next", auth, {}); } catch {} };
  const handlePrev = async () => { if (!auth) return; try { await playerAction("previous", auth, {}); } catch {} };

  const handleLogout = async () => {
    await clearAuth();
    router.replace("/");
  };

  if (loading || !auth) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color="#B026FF" size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SoundMapView
        ref={mapRef}
        apiKey={GOOGLE_MAPS_KEY}
        markers={mapMarkers}
        myLocation={myLocation}
        onMarkerPress={handleMarker}
        mapStyle={mapStyle}
      />

      {/* Top bar */}
      <View style={styles.topBar} pointerEvents="box-none">
        <View style={styles.topBarInner}>
          <View style={styles.sideSpacer}>
            <TouchableOpacity
              onPress={() => setSearchOpen(true)}
              style={styles.ghostBtn}
              testID="search-toggle"
              activeOpacity={0.8}
              hitSlop={8}
            >
              <Ionicons name="search" size={19} color="#B026FF" />
            </TouchableOpacity>
          </View>
          <View style={styles.liveCount} testID="live-count">
            <View style={[styles.liveDot, (!broadcastOn || !wsConnected) && styles.liveDotMuted]} />
            <Text style={styles.liveCountText}>
              {!wsConnected ? "RECONNECTING…" : `${markers.length} ${markers.length === 1 ? "LISTENER" : "LISTENERS"}`}
            </Text>
          </View>
          <View style={styles.sideSpacer}>
            <TouchableOpacity
              onPress={toggleBroadcast}
              style={[styles.ghostBtn, !broadcastOn && styles.ghostBtnOff]}
              testID="ghost-toggle"
              activeOpacity={0.8}
              hitSlop={8}
            >
              <Ionicons
                name={broadcastOn ? "radio" : "eye-off"}
                size={19}
                color={broadcastOn ? "#B026FF" : "rgba(255,255,255,0.55)"}
              />
            </TouchableOpacity>
          </View>
        </View>
        {permissionError && (
          <Text style={styles.permWarn} testID="perm-warn">
            {permissionError}
          </Text>
        )}
      </View>

      {toast && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.toast,
            toast.tone === "ghost" ? styles.toastGhost : styles.toastLive,
            {
              opacity: toastAnim,
              transform: [
                {
                  translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }),
                },
              ],
            },
          ]}
          testID="broadcast-toast"
        >
          <Ionicons
            name={toast.tone === "ghost" ? "eye-off" : "radio"}
            size={16}
            color={toast.tone === "ghost" ? "#fff" : "#B026FF"}
          />
          <View style={{ flex: 1 }}>
            <Text style={[styles.toastTitle, toast.tone === "ghost" && { color: "#fff" }]}>
              {toast.title}
            </Text>
            <Text style={styles.toastSubtitle}>{toast.subtitle}</Text>
          </View>
        </Animated.View>
      )}

      {selectedUser && (
        <ListenAlongCard
          user={selectedUser as any}
          onClose={() => setSelectedUserId(null)}
          onListenAlong={handleListenAlong}
          onReact={(emoji) => sendReaction(selectedUser.user_id, emoji)}
          busy={listenLoading}
          isActiveSession={hostId === selectedUser.user_id}
          isSelf={selectedUser.user_id === auth.user_id}
        />
      )}

      <PlayerBottomSheet
        profileImage={auth.profile_image}
        displayName={auth.display_name}
        track={myTrack}
        isPlaying={myIsPlaying}
        syncStatus={syncStatus}
        inSession={!!hostId && hostId !== auth.user_id}
        hasSpotify={hasSpotify}
        onPlayPause={handlePlayPause}
        onNext={handleNext}
        onPrev={handlePrev}
        onOpenListeners={() => setListenersOpen(true)}
      />

      {/* Theme toggle FAB — sits above the locate-me FAB, swaps map style */}
      <TouchableOpacity
        onPress={toggleMapStyle}
        style={styles.themeFab}
        activeOpacity={0.85}
        testID="theme-toggle"
        hitSlop={8}
      >
        <Ionicons
          name="earth"
          size={19}
          color="#B026FF"
        />
      </TouchableOpacity>

      {/* Locate-me FAB */}
      <TouchableOpacity
        onPress={() => {
          if (myLocation) mapRef.current?.centerOn(myLocation.lat, myLocation.lng, 15);
        }}
        disabled={!myLocation}
        style={[styles.locateFab, !myLocation && styles.locateFabDisabled]}
        activeOpacity={0.85}
        testID="locate-me"
        hitSlop={8}
      >
        <Ionicons name="locate" size={19} color={myLocation ? "#B026FF" : "rgba(176,38,255,0.35)"} />
      </TouchableOpacity>
      <SearchSheet
        visible={searchOpen}
        auth={auth}
        isInSession={!!hostId && hostId !== auth.user_id}
        hostName={hostId ? usersMap[hostId]?.display_name : null}
        onClose={() => setSearchOpen(false)}
        onQueued={(uri) => approveUri(uri)}
        onPlayedNow={(track) => {
          // Optimistic update so the bottom player sheet swaps to the new
          // track the moment the user taps a row, in sync with playback start.
          setMyTrack({ item: track });
          setMyIsPlaying(true);
          setHasSpotify(true);
          approveUri(track.uri);
          // Trigger a confirming poll ~700ms later so we replace optimistic
          // state with authoritative Spotify state (album art etc.).
          setTimeout(() => pullRef.current?.(), 700);
        }}
        onForwardToHost={(trackUri, trackName) => {
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({ type: "session:queue_add", track_uri: trackUri, track_name: trackName })
            );
          }
        }}
      />

      <FloatingReactions reactions={floatingReactions} onDone={removeReaction} />

      <ListenersSheet
        visible={listenersOpen}
        auth={auth}
        listeners={markers as any}
        hostId={hostId}
        selfId={auth.user_id}
        onClose={() => setListenersOpen(false)}
        onListenAlong={(uid) => {
          const ws = wsRef.current;
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          // Switch session: leave first if currently in one (different host), then join
          if (hostId && hostId !== uid) {
            ws.send(JSON.stringify({ type: "session:leave" }));
          }
          ws.send(JSON.stringify({ type: "session:join", host_id: uid }));
          setListenersOpen(false);
        }}
        onLeaveSession={() => {
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "session:leave" }));
          }
          setHostId(null);
          setSyncStatus("idle");
          setListenersOpen(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#05050A" },
  loadingWrap: { flex: 1, backgroundColor: "#05050A", alignItems: "center", justifyContent: "center" },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingTop: Platform.OS === "web" ? 16 : 52,
    paddingHorizontal: 16,
    zIndex: 30,
  },
  topBarInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  liveCount: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(10,10,18,0.85)",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(176,38,255,0.25)",
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#B026FF" },
  liveDotMuted: { backgroundColor: "rgba(255,255,255,0.4)" },
  liveCountText: { color: "#B026FF", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  ghostBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(10,10,18,0.85)",
    borderWidth: 1,
    borderColor: "rgba(176,38,255,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  sideSpacer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  locateFab: {
    position: "absolute",
    right: 16,
    bottom: 150,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(10,10,18,0.85)",
    borderWidth: 1,
    borderColor: "rgba(176,38,255,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  locateFabDisabled: {
    borderColor: "rgba(176,38,255,0.15)",
  },
  themeFab: {
    position: "absolute",
    right: 16,
    bottom: 204, // sits 54px above locateFab (44 + 10 spacing)
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(10,10,18,0.85)",
    borderWidth: 1,
    borderColor: "rgba(176,38,255,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  ghostBtnOff: {
    borderColor: "rgba(255,255,255,0.18)",
  },
  toast: {
    position: "absolute",
    top: Platform.OS === "web" ? 70 : 105,
    left: 24,
    right: 24,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    zIndex: 60,
  },
  toastLive: {
    backgroundColor: "rgba(20,28,5,0.95)",
    borderColor: "rgba(176,38,255,0.5)",
  },
  toastGhost: {
    backgroundColor: "rgba(15,15,22,0.95)",
    borderColor: "rgba(255,255,255,0.18)",
  },
  toastTitle: { color: "#B026FF", fontWeight: "900", fontSize: 12, letterSpacing: 1.5 },
  toastSubtitle: { color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 2 },
  permWarn: {
    marginTop: 8,
    color: "#FF8A00",
    fontSize: 12,
    backgroundColor: "rgba(0,0,0,0.4)",
    padding: 6,
    borderRadius: 8,
    textAlign: "center",
  },
});
