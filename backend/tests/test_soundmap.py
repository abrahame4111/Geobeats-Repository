"""SoundMap backend tests: REST endpoints + WebSocket flows."""
import asyncio
import json
import os
import pytest
import requests
import websockets

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://beat-together-2.preview.emergentagent.com").rstrip("/")
WS_BASE = BASE.replace("http", "ws", 1) + "/api/ws"
API = BASE + "/api"


# ---------- REST ----------
class TestHealth:
    def test_root(self):
        r = requests.get(f"{API}/", timeout=10)
        assert r.status_code == 200
        j = r.json()
        assert j.get("service") == "soundmap"
        assert j.get("status") == "ok"


class TestSpotifyAuthURLs:
    def test_login_returns_valid_url(self):
        r = requests.get(f"{API}/spotify/login", timeout=10)
        assert r.status_code == 200
        url = r.json().get("auth_url", "")
        assert "accounts.spotify.com/authorize" in url
        assert "client_id=f50dc62b9eab4292a2b0c48992ef153f" in url
        assert "redirect_uri=" in url
        assert "beat-together-2.preview.emergentagent.com" in url

    def test_refresh_invalid_token(self):
        r = requests.post(f"{API}/spotify/refresh", json={"refresh_token": "bogus-refresh"}, timeout=15)
        assert r.status_code == 400


class TestSpotifyProxyBogusToken:
    """All Spotify proxy endpoints must raise HTTPException (4xx) not crash (500)."""
    BOGUS = "bogus_access_token"

    def test_currently_playing(self):
        r = requests.get(f"{API}/spotify/currently-playing", params={"access_token": self.BOGUS}, timeout=15)
        assert 400 <= r.status_code < 500, f"got {r.status_code} body={r.text[:200]}"

    @pytest.mark.parametrize("ep", ["play", "pause", "next", "previous", "seek"])
    def test_playback_endpoints(self, ep):
        r = requests.post(f"{API}/spotify/{ep}", json={"access_token": self.BOGUS, "position_ms": 0}, timeout=15)
        assert 400 <= r.status_code < 500, f"{ep}: got {r.status_code} body={r.text[:200]}"

    def test_queue(self):
        r = requests.post(
            f"{API}/spotify/queue",
            json={"access_token": self.BOGUS, "track_uri": "spotify:track:xxx"},
            timeout=15,
        )
        assert 400 <= r.status_code < 500


class TestPublicState:
    def test_active_users_initially_list(self):
        r = requests.get(f"{API}/users/active", timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert "users" in body and isinstance(body["users"], list)

    def test_session_unknown_host_404(self):
        r = requests.get(f"{API}/sessions/nonexistent_host_xyz", timeout=10)
        assert r.status_code == 404


# ---------- WebSocket ----------
async def _recv_until(ws, wanted_type, timeout=5.0):
    """Receive messages until we get one of wanted_type (str or set/list)."""
    wanted = {wanted_type} if isinstance(wanted_type, str) else set(wanted_type)
    end = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < end:
        try:
            remaining = max(0.1, end - asyncio.get_event_loop().time())
            raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
        except asyncio.TimeoutError:
            break
        msg = json.loads(raw)
        if msg.get("type") in wanted:
            return msg
    return None


def _ws_url(uid, name, img=""):
    from urllib.parse import quote
    return f"{WS_BASE}?user_id={quote(uid)}&display_name={quote(name)}&profile_image={quote(img)}"


class TestWebSocket:
    def test_snapshot_on_connect(self):
        async def run():
            async with websockets.connect(_ws_url("TEST_u_solo", "Alice")) as ws:
                snap = await _recv_until(ws, "users:snapshot", timeout=5)
                assert snap is not None, "no users:snapshot received"
                users = snap.get("users", [])
                assert any(u.get("user_id") == "TEST_u_solo" for u in users)
        asyncio.run(run())

    def test_active_users_reflects_connected(self):
        async def run():
            async with websockets.connect(_ws_url("TEST_u_active", "Bob")):
                await asyncio.sleep(0.5)
                r = requests.get(f"{API}/users/active", timeout=10)
                assert r.status_code == 200
                users = r.json().get("users", [])
                assert any(u.get("user_id") == "TEST_u_active" for u in users)
        asyncio.run(run())

    def test_location_broadcast(self):
        async def run():
            async with websockets.connect(_ws_url("TEST_u1", "Alice")) as w1, \
                       websockets.connect(_ws_url("TEST_u2", "Bob")) as w2:
                # drain initial snapshots
                await _recv_until(w1, "users:snapshot", 3)
                await _recv_until(w2, "users:snapshot", 3)
                await asyncio.sleep(0.3)
                await w1.send(json.dumps({"type": "location:update", "lat": 40.7, "lng": -74.0}))
                msg = await _recv_until(w2, "location:update", 5)
                assert msg is not None
                assert msg["user_id"] == "TEST_u1"
                assert msg["lat"] == 40.7
        asyncio.run(run())

    def test_active_track_broadcast(self):
        async def run():
            async with websockets.connect(_ws_url("TEST_t1", "Host")) as w1, \
                       websockets.connect(_ws_url("TEST_t2", "Guest")) as w2:
                await _recv_until(w1, "users:snapshot", 3)
                await _recv_until(w2, "users:snapshot", 3)
                await asyncio.sleep(0.3)
                await w1.send(json.dumps({
                    "type": "user:active_track",
                    "track": {"item": {"name": "SongX", "uri": "spotify:track:abc"}},
                    "is_playing": True,
                }))
                msg = await _recv_until(w2, "user:active_track", 5)
                assert msg is not None
                assert msg["user_id"] == "TEST_t1"
                assert msg["is_playing"] is True
        asyncio.run(run())

    def test_session_join_sync_leave(self):
        async def run():
            async with websockets.connect(_ws_url("TEST_host", "Host")) as host, \
                       websockets.connect(_ws_url("TEST_guest", "Guest")) as guest:
                await _recv_until(host, "users:snapshot", 3)
                await _recv_until(guest, "users:snapshot", 3)
                # Ensure host is known
                await asyncio.sleep(0.3)

                # guest joins host
                await guest.send(json.dumps({"type": "session:join", "host_id": "TEST_host"}))
                joined = await _recv_until(guest, "session:joined", 5)
                assert joined is not None
                assert joined["host_id"] == "TEST_host"
                guest_joined_notice = await _recv_until(host, "session:guest_joined", 5)
                assert guest_joined_notice is not None
                assert guest_joined_notice["guest_id"] == "TEST_guest"

                # host pushes session:sync
                await host.send(json.dumps({
                    "type": "session:sync",
                    "track": {"item": {"name": "Sync Song", "uri": "spotify:track:zzz"}},
                    "is_playing": True,
                    "position_ms": 5000,
                }))
                sync = await _recv_until(guest, "session:sync", 5)
                assert sync is not None
                assert sync["host_id"] == "TEST_host"
                assert sync["is_playing"] is True

                # guest leaves
                await guest.send(json.dumps({"type": "session:leave"}))
                left = await _recv_until(guest, "session:left", 5)
                assert left is not None
                guest_left_notice = await _recv_until(host, "session:guest_left", 5)
                assert guest_left_notice is not None
                assert guest_left_notice["guest_id"] == "TEST_guest"
        asyncio.run(run())
