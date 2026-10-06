"""
Regression test for GeoBeats map-visibility bug: two WS-connected users must
see each other and REMAIN visible for >180s (STALE_USER_SECONDS) via
periodic 'location_update' resends. Also covers REST fallback endpoints
GET /api/users/active and POST /api/location/update, and static asset /
Spotify OAuth spot-checks.
"""
import json
import os
import time
import uuid

import pytest
import requests
import websocket  # websocket-client

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")

USER_A = f"TEST_map_user_A_{uuid.uuid4().hex[:8]}"
USER_B = f"TEST_map_user_B_{uuid.uuid4().hex[:8]}"

LAT_A, LNG_A = 37.7749, -122.4194
LAT_B, LNG_B = 37.7750, -122.4195


def _loc_payload(lat, lng, name):
    return {
        "type": "location_update",
        "latitude": lat,
        "longitude": lng,
        "user_name": name,
        "profile_image": "",
        "current_song": None,
        "artist": None,
        "album_cover": None,
        "track_uri": None,
        "is_premium": False,
    }


@pytest.fixture(scope="module")
def cleanup_users():
    yield
    for uid in (USER_A, USER_B):
        try:
            requests.post(f"{BASE_URL}/api/location/update", json={
                "user_id": uid, "display_name": uid, "profile_image": "", "lat": 0, "lng": 0
            }, timeout=10)
        except Exception:
            pass


class TestRestFallback:
    """Standalone REST endpoints (no WS needed)"""

    def test_post_location_update_ok(self):
        resp = requests.post(f"{BASE_URL}/api/location/update", json={
            "user_id": USER_A, "display_name": "Rest Tester", "profile_image": "", "lat": LAT_A, "lng": LNG_A
        }, timeout=10)
        assert resp.status_code == 200, resp.text
        assert resp.json().get("status") == "ok"

    def test_get_active_users_reflects_rest_update(self):
        get_resp = requests.get(f"{BASE_URL}/api/users/active", timeout=10)
        assert get_resp.status_code == 200
        users = {u["user_id"]: u for u in get_resp.json()["users"]}
        assert USER_A in users, f"{USER_A} missing from active users after REST update: {list(users)}"
        assert users[USER_A]["lat"] == pytest.approx(LAT_A, abs=0.001)
        assert users[USER_A]["lng"] == pytest.approx(LNG_A, abs=0.001)
        assert "_id" not in users[USER_A]


class TestWebSocketLongRunVisibility:
    """
    CRITICAL regression test: connect two users via WS, resend location_update
    every 5s for > STALE_USER_SECONDS (180s) and confirm neither is dropped.
    """

    def test_two_users_remain_visible_past_stale_threshold(self, cleanup_users):
        import threading
        ws_a = websocket.create_connection(f"{WS_BASE}/api/ws/{USER_A}", timeout=15)
        ws_b = websocket.create_connection(f"{WS_BASE}/api/ws/{USER_B}", timeout=15)

        # consume initial_state from both BEFORE starting reader threads
        init_a = json.loads(ws_a.recv())
        init_b = json.loads(ws_b.recv())
        assert init_a["type"] == "initial_state"
        assert init_b["type"] == "initial_state"

        # A background reader is required so the client responds to the
        # server's protocol-level ping frames (uvicorn/websockets sends
        # these periodically and closes with 1011 if unanswered). Real
        # browsers handle this automatically at the WS API layer; the raw
        # websocket-client lib used here needs an explicit recv loop.
        stop_flag = {"stop": False}

        def _reader(ws):
            ws.settimeout(2)
            while not stop_flag["stop"]:
                try:
                    ws.recv()
                except websocket.WebSocketTimeoutException:
                    continue
                except Exception:
                    break

        t_a = threading.Thread(target=_reader, args=(ws_a,), daemon=True)
        t_b = threading.Thread(target=_reader, args=(ws_b,), daemon=True)
        t_a.start()
        t_b.start()
        try:
            # Send first location for A, then B
            ws_a.send(json.dumps(_loc_payload(LAT_A, LNG_A, "User A")))
            ws_b.send(json.dumps(_loc_payload(LAT_B, LNG_B, "User B")))

            time.sleep(1)

            # Both should now appear in GET /api/users/active
            resp = requests.get(f"{BASE_URL}/api/users/active", timeout=10)
            users = {u["user_id"] for u in resp.json()["users"]}
            assert USER_A in users and USER_B in users, f"Initial visibility failed: {users}"

            TOTAL_SECONDS = 200  # > STALE_USER_SECONDS(180)
            INTERVAL = 5
            elapsed = 0
            while elapsed < TOTAL_SECONDS:
                time.sleep(INTERVAL)
                elapsed += INTERVAL
                ws_a.send(json.dumps(_loc_payload(LAT_A, LNG_A, "User A")))
                ws_b.send(json.dumps(_loc_payload(LAT_B, LNG_B, "User B")))

            # After crossing 180s threshold with periodic resends, both must
            # STILL be present (this is the exact regression being fixed).
            resp = requests.get(f"{BASE_URL}/api/users/active", timeout=10)
            users_after = {u["user_id"] for u in resp.json()["users"]}
            assert USER_A in users_after, (
                f"REGRESSION: {USER_A} dropped after {elapsed}s despite periodic resends. "
                f"Active users: {users_after}"
            )
            assert USER_B in users_after, (
                f"REGRESSION: {USER_B} dropped after {elapsed}s despite periodic resends. "
                f"Active users: {users_after}"
            )
            print(f"PASS: both users still visible after {elapsed}s of periodic location_update resends")
        finally:
            stop_flag["stop"] = True
            ws_a.close()
            ws_b.close()


class TestStaticAssetsAndOAuth:
    """Lower priority spot-checks"""

    @pytest.mark.parametrize("path", [
        "/api/mapbox.html?token=test123",
        "/api/map.html?key=test123",
        "/api/starborder.html",
        "/api/pixelblast.html",
        "/api/asciitext.html",
        "/api/tiltedcard.html",
    ])
    def test_static_html_returns_200(self, path):
        resp = requests.get(f"{BASE_URL}{path}", timeout=10)
        assert resp.status_code == 200, f"{path} -> {resp.status_code}"

    def test_spotify_login_redirects_with_dynamic_host(self):
        resp = requests.get(f"{BASE_URL}/api/spotify/login", timeout=10, allow_redirects=False)
        assert resp.status_code in (302, 307), f"Expected redirect, got {resp.status_code}"
        location = resp.headers.get("location", "")
        assert "accounts.spotify.com" in location, f"Unexpected redirect target: {location}"
        assert "redirect_uri=" in location
        print(f"Spotify login redirect Location: {location}")
