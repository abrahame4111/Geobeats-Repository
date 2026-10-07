import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  Friend,
  FriendPerson,
  FriendsData,
  PersonLookup,
  StoredAuth,
  lookupPerson,
  removeFriend,
  respondFriendRequest,
  sendFriendRequest,
} from "../api";
import { timeAgo } from "../timeAgo";

type Props = {
  auth: StoredAuth | null;
  query: string;
  friends: FriendsData;
  onFriendsChanged: () => void;
  onFlyToFriend: (friend: Friend) => void;
};

const PLACEHOLDER = "https://placehold.co/100x100/1a0a24/B026FF?text=";

function Avatar({ uri, name, dim }: { uri?: string; name: string; dim?: boolean }) {
  return (
    <Image
      source={{ uri: uri || `${PLACEHOLDER}${encodeURIComponent((name || "?").slice(0, 1))}` }}
      style={[styles.avatar, dim && styles.avatarDim]}
    />
  );
}

export default function PeopleSearch({ auth, query, friends, onFriendsChanged, onFlyToFriend }: Props) {
  const [result, setResult] = useState<PersonLookup | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const reqIdRef = useRef(0);
  const debounceRef = useRef<any>(null);

  const trimmed = query.trim();

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!trimmed) {
      reqIdRef.current += 1;
      setResult(null);
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
        const p = await lookupPerson(auth, trimmed);
        if (myReq !== reqIdRef.current) return;
        setResult(p.exact);
      } catch (e: any) {
        if (myReq !== reqIdRef.current) return;
        setResult(null);
        setError(String(e?.message || "").includes("404") ? "No Spotify profile found for that username." : "Lookup failed. Try again.");
      } finally {
        if (myReq === reqIdRef.current) setLoading(false);
      }
    }, 450);
    return () => clearTimeout(debounceRef.current);
  }, [trimmed, auth]);

  const run = async (id: string, fn: () => Promise<any>, after?: (relation: PersonLookup["relation"]) => void) => {
    if (!auth) return;
    setBusyId(id);
    try {
      const res = await fn();
      after?.(res?.relation);
      onFriendsChanged();
    } catch (e) {
      console.warn("[friends] action failed", e);
    } finally {
      setBusyId(null);
    }
  };

  const setRelation = (relation?: PersonLookup["relation"]) =>
    setResult((r) => (r && relation ? { ...r, relation } : r));

  const renderAction = (p: PersonLookup) => {
    const busy = busyId === p.user_id;
    if (p.relation === "self") return <Text style={styles.youTag}>YOU</Text>;
    if (busy) return <ActivityIndicator size="small" color="#B026FF" />;
    if (p.relation === "friends") {
      return (
        <View style={styles.friendsTag}>
          <Ionicons name="checkmark-circle" size={14} color="#7CFF55" />
          <Text style={styles.friendsTagText}>FRIENDS</Text>
        </View>
      );
    }
    if (p.relation === "pending_out") {
      return (
        <TouchableOpacity
          style={styles.ghostBtn}
          onPress={() => run(p.user_id, () => removeFriend(auth!, p.user_id), setRelation)}
          testID={`cancel-request-${p.user_id}`}
        >
          <Text style={styles.ghostBtnText}>REQUESTED</Text>
        </TouchableOpacity>
      );
    }
    if (p.relation === "pending_in") {
      return (
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => run(p.user_id, () => respondFriendRequest(auth!, p.user_id, true), setRelation)}
          testID={`accept-${p.user_id}`}
        >
          <Text style={styles.addBtnText}>ACCEPT</Text>
        </TouchableOpacity>
      );
    }
    return (
      <TouchableOpacity
        style={styles.addBtn}
        onPress={() => run(p.user_id, () => sendFriendRequest(auth!, p), setRelation)}
        testID={`add-friend-${p.user_id}`}
      >
        <Ionicons name="person-add" size={14} color="#05050A" />
        <Text style={styles.addBtnText}>ADD</Text>
      </TouchableOpacity>
    );
  };

  // ---- Searching state ----
  if (trimmed) {
    return (
      <View style={{ flex: 1 }}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {result ? (
          <View style={styles.resultCard} testID="person-result">
            <Avatar uri={result.profile_image} name={result.display_name} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{result.display_name}</Text>
              <Text style={styles.sub} numberOfLines={1}>
                @{result.user_id}
                {result.on_geobeats ? "  ·  On GeoBeats" : "  ·  Not on GeoBeats yet"}
              </Text>
            </View>
            {renderAction(result)}
          </View>
        ) : !loading && !error ? (
          <Text style={styles.hint}>Looking up “{trimmed}”…</Text>
        ) : null}
        {result && !result.on_geobeats && result.relation === "none" ? (
          <Text style={styles.note}>They&apos;ll see your request once they sign in to GeoBeats with Spotify.</Text>
        ) : null}
      </View>
    );
  }

  // ---- Idle state: hint + requests + friends ----
  const hasAnything = friends.incoming.length + friends.outgoing.length + friends.friends.length > 0;
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
      <View style={styles.hintWrap}>
        <Ionicons name="person-circle-outline" size={28} color="rgba(176,38,255,0.7)" />
        <Text style={styles.hintTitle}>Search for any Spotify profile</Text>
        <Text style={styles.hintSub}>Paste a Spotify username or profile link to send a friend request.</Text>
      </View>

      {friends.incoming.length > 0 ? (
        <>
          <Text style={styles.section}>REQUESTS</Text>
          {friends.incoming.map((p: FriendPerson) => (
            <View key={`in-${p.user_id}`} style={styles.row} testID={`incoming-${p.user_id}`}>
              <Avatar uri={p.profile_image} name={p.display_name} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{p.display_name}</Text>
                <Text style={styles.sub}>wants to be friends</Text>
              </View>
              {busyId === p.user_id ? (
                <ActivityIndicator size="small" color="#B026FF" />
              ) : (
                <View style={{ flexDirection: "row", gap: 6 }}>
                  <TouchableOpacity
                    style={styles.iconBtnDecline}
                    onPress={() => run(p.user_id, () => respondFriendRequest(auth!, p.user_id, false))}
                    testID={`decline-${p.user_id}`}
                    hitSlop={6}
                  >
                    <Ionicons name="close" size={18} color="rgba(255,255,255,0.7)" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.iconBtnAccept}
                    onPress={() => run(p.user_id, () => respondFriendRequest(auth!, p.user_id, true))}
                    testID={`accept-${p.user_id}`}
                    hitSlop={6}
                  >
                    <Ionicons name="checkmark" size={18} color="#05050A" />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))}
        </>
      ) : null}

      {friends.friends.length > 0 ? (
        <>
          <Text style={styles.section}>FRIENDS</Text>
          {friends.friends.map((f: Friend) => {
            const canFly = f.lat != null && f.lng != null;
            const when = f.online ? "Live now" : f.hidden ? "Ghost mode" : timeAgo(f.last_seen_at);
            const song = f.last_song?.name
              ? `${f.last_song.name}${f.last_song.artist ? ` — ${f.last_song.artist}` : ""}`
              : null;
            return (
              <View key={`fr-${f.user_id}`} style={styles.row} testID={`friend-${f.user_id}`}>
                <TouchableOpacity
                  style={styles.rowTap}
                  onPress={() => canFly && onFlyToFriend(f)}
                  disabled={!canFly}
                  activeOpacity={0.6}
                >
                  <Avatar uri={f.profile_image} name={f.display_name} dim={!f.online} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>{f.display_name}</Text>
                    <View style={styles.metaRow}>
                      <View style={[styles.dot, f.online ? styles.dotLive : styles.dotOff]} />
                      <Text style={[styles.sub, f.online && styles.subLive]} numberOfLines={1}>
                        {when}
                        {song ? `  ·  ${song}` : ""}
                      </Text>
                    </View>
                  </View>
                  {canFly ? <Ionicons name="navigate" size={16} color="rgba(176,38,255,0.8)" /> : null}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.iconBtnDecline}
                  onPress={() => run(f.user_id, () => removeFriend(auth!, f.user_id))}
                  testID={`remove-friend-${f.user_id}`}
                  hitSlop={6}
                >
                  {busyId === f.user_id ? (
                    <ActivityIndicator size="small" color="#B026FF" />
                  ) : (
                    <Ionicons name="person-remove-outline" size={15} color="rgba(255,255,255,0.55)" />
                  )}
                </TouchableOpacity>
              </View>
            );
          })}
        </>
      ) : null}

      {friends.outgoing.length > 0 ? (
        <>
          <Text style={styles.section}>SENT</Text>
          {friends.outgoing.map((p: FriendPerson) => (
            <View key={`out-${p.user_id}`} style={styles.row} testID={`outgoing-${p.user_id}`}>
              <Avatar uri={p.profile_image} name={p.display_name} dim />
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{p.display_name}</Text>
                <Text style={styles.sub}>request pending</Text>
              </View>
              <TouchableOpacity
                style={styles.ghostBtn}
                onPress={() => run(p.user_id, () => removeFriend(auth!, p.user_id))}
                testID={`cancel-request-${p.user_id}`}
              >
                {busyId === p.user_id ? (
                  <ActivityIndicator size="small" color="#B026FF" />
                ) : (
                  <Text style={styles.ghostBtnText}>CANCEL</Text>
                )}
              </TouchableOpacity>
            </View>
          ))}
        </>
      ) : null}

      {!hasAnything ? (
        <Text style={styles.emptyNote}>No friends yet — add someone to see where they were and what they last played.</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hintWrap: { alignItems: "center", gap: 6, paddingVertical: 22, paddingHorizontal: 12 },
  hintTitle: { color: "#fff", fontSize: 15, fontWeight: "800", textAlign: "center" },
  hintSub: { color: "rgba(255,255,255,0.45)", fontSize: 12, textAlign: "center", lineHeight: 17 },
  hint: { color: "rgba(255,255,255,0.4)", fontSize: 13, textAlign: "center", marginTop: 32 },
  note: { color: "rgba(255,255,255,0.45)", fontSize: 12, textAlign: "center", marginTop: 14, paddingHorizontal: 12, lineHeight: 17 },
  emptyNote: { color: "rgba(255,255,255,0.35)", fontSize: 12, textAlign: "center", marginTop: 8, paddingHorizontal: 24, lineHeight: 17 },
  error: { color: "#FF8A00", fontSize: 12, marginBottom: 8, textAlign: "center", marginTop: 24 },
  section: {
    color: "rgba(255,255,255,0.45)", fontSize: 10, fontWeight: "900", letterSpacing: 1.4,
    marginTop: 14, marginBottom: 4,
  },
  resultCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 12, borderRadius: 16,
    backgroundColor: "rgba(176,38,255,0.08)",
    borderWidth: 1, borderColor: "rgba(176,38,255,0.35)",
    marginTop: 4,
  },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.05)",
  },
  rowTap: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#1a1a26" },
  avatarDim: { opacity: 0.55 },
  name: { color: "#fff", fontSize: 14, fontWeight: "700" },
  sub: { color: "rgba(255,255,255,0.55)", fontSize: 12, marginTop: 2, flex: 1 },
  subLive: { color: "#B026FF" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 2 },
  dotLive: { backgroundColor: "#B026FF" },
  dotOff: { backgroundColor: "rgba(255,255,255,0.3)" },
  youTag: { color: "rgba(255,255,255,0.5)", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  friendsTag: { flexDirection: "row", alignItems: "center", gap: 4 },
  friendsTagText: { color: "#7CFF55", fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
  addBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 12, height: 34, borderRadius: 17, backgroundColor: "#B026FF",
  },
  addBtnText: { color: "#05050A", fontSize: 11, fontWeight: "900", letterSpacing: 0.8 },
  ghostBtn: {
    paddingHorizontal: 12, height: 34, borderRadius: 17, justifyContent: "center", alignItems: "center",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", minWidth: 80,
  },
  ghostBtnText: { color: "rgba(255,255,255,0.7)", fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
  iconBtnAccept: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#7CFF55", alignItems: "center", justifyContent: "center" },
  iconBtnDecline: {
    width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.15)",
  },
});
