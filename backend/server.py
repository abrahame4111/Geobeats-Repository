"""SoundMap backend - Spotify OAuth, Web API proxy, and real-time WebSocket sync."""
from fastapi import FastAPI, APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Query
from fastapi.responses import RedirectResponse, HTMLResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import json
import asyncio
import time
from pathlib import Path
from pydantic import BaseModel, Field
from typing import Optional, Dict, List
import uuid
from datetime import datetime, timezone
import spotipy
from spotipy.oauth2 import SpotifyOAuth
import requests

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
SPOTIFY_CLIENT_ID = os.environ["SPOTIFY_CLIENT_ID"]
SPOTIFY_CLIENT_SECRET = os.environ["SPOTIFY_CLIENT_SECRET"]
SPOTIFY_REDIRECT_URI = os.environ["SPOTIFY_REDIRECT_URI"]
FRONTEND_URL = os.environ["FRONTEND_URL"]

SCOPES = (
    "user-read-private user-read-email user-read-currently-playing "
    "user-read-playback-state user-modify-playback-state streaming "
    "playlist-read-private user-read-recently-played"
)

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="SoundMap API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# ------------------------ Models ------------------------

class LocationUpdate(BaseModel):
    user_id: str
    lat: float
    lng: float


class ActiveUser(BaseModel):
    user_id: str
    display_name: str
    profile_image: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    current_track: Optional[dict] = None
    is_playing: bool = False
    last_update: float = Field(default_factory=lambda: time.time())


class TokenRefreshRequest(BaseModel):
    refresh_token: str


class PlayRequest(BaseModel):
    access_token: str
    track_uri: Optional[str] = None
    position_ms: Optional[int] = 0
    device_id: Optional[str] = None


class QueueRequest(BaseModel):
    access_token: str
    track_uri: str
    device_id: Optional[str] = None


# ------------------------ In-memory state ------------------------

class StateStore:
    def __init__(self):
        self.users: Dict[str, ActiveUser] = {}
        # host_id -> set of guest user_ids
        self.sessions: Dict[str, set] = {}
        # guest_id -> host_id
        self.guest_to_host: Dict[str, str] = {}
        # user_id -> WebSocket
        self.connections: Dict[str, WebSocket] = {}

    def upsert_user(self, user_id: str, **fields):
        existing = self.users.get(user_id)
        if existing:
            for k, v in fields.items():
                if v is not None:
                    setattr(existing, k, v)
            existing.last_update = time.time()
        else:
            self.users[user_id] = ActiveUser(user_id=user_id, **fields)
        return self.users[user_id]

    def remove_user(self, user_id: str):
        self.users.pop(user_id, None)
        self.connections.pop(user_id, None)
        # Leave session
        host_id = self.guest_to_host.pop(user_id, None)
        if host_id and host_id in self.sessions:
            self.sessions[host_id].discard(user_id)
        # If host leaves, clear their session
        if user_id in self.sessions:
            guests = self.sessions.pop(user_id, set())
            for g in guests:
                self.guest_to_host.pop(g, None)

    def public_users(self) -> List[dict]:
        now = time.time()
        return [
            {
                "user_id": u.user_id,
                "display_name": u.display_name,
                "profile_image": u.profile_image,
                "lat": u.lat,
                "lng": u.lng,
                "current_track": u.current_track,
                "is_playing": u.is_playing,
                "host_session": u.user_id in self.sessions and len(self.sessions[u.user_id]) > 0,
            }
            for u in self.users.values()
            if now - u.last_update < 120  # prune stale after 2 min
        ]


state = StateStore()


async def broadcast(message: dict, exclude: Optional[str] = None):
    """Broadcast a message to all connected users."""
    dead = []
    for uid, ws in list(state.connections.items()):
        if uid == exclude:
            continue
        try:
            await ws.send_json(message)
        except Exception:
            dead.append(uid)
    for uid in dead:
        state.remove_user(uid)


async def send_to(user_id: str, message: dict):
    ws = state.connections.get(user_id)
    if ws:
        try:
            await ws.send_json(message)
        except Exception:
            state.remove_user(user_id)


# ------------------------ Spotify OAuth ------------------------

def get_oauth() -> SpotifyOAuth:
    return SpotifyOAuth(
        client_id=SPOTIFY_CLIENT_ID,
        client_secret=SPOTIFY_CLIENT_SECRET,
        redirect_uri=SPOTIFY_REDIRECT_URI,
        scope=SCOPES,
        cache_handler=spotipy.MemoryCacheHandler(),
        show_dialog=True,
    )


@api_router.get("/spotify/login")
async def spotify_login(mobile_redirect: Optional[str] = None, popup: Optional[int] = 0):
    """Return Spotify auth URL. Encode platform/return-target in `state` so the
    callback can redirect to the right place (mobile deep link, popup poster, or web)."""
    parts = []
    if mobile_redirect:
        parts.append(f"m={requests.utils.quote(mobile_redirect, safe='')}")
    if popup:
        parts.append("p=1")
    state = "&".join(parts) if parts else None
    oauth = get_oauth()
    auth_url = oauth.get_authorize_url(state=state) if state else oauth.get_authorize_url()
    return {"auth_url": auth_url}


def _parse_state(state: Optional[str]) -> dict:
    if not state:
        return {}
    out: dict = {}
    for kv in state.split("&"):
        if "=" in kv:
            k, v = kv.split("=", 1)
            out[k] = requests.utils.unquote(v)
        else:
            out[kv] = "1"
    return out


@api_router.get("/spotify/callback")
async def spotify_callback(code: Optional[str] = None, error: Optional[str] = None, state: Optional[str] = None):
    """Spotify redirects here after user login. Exchange code for tokens and redirect back to app."""
    st = _parse_state(state)
    mobile_redirect = st.get("m")

    def _build_redirect(params: str) -> str:
        if mobile_redirect:
            sep = "&" if ("?" in mobile_redirect) else "?"
            return f"{mobile_redirect}{sep}{params}"
        # Web: route to /auth-success (popup or top-level both work the same)
        return f"{FRONTEND_URL}/auth-success?{params}"

    def _render_redirect(target: str):
        """Render an HTML page that JS-redirects to `target`. Some browsers block 307
        redirects to non-http(s) schemes (e.g. exp:// for Expo Go) — this works reliably."""
        if mobile_redirect:
            html = f"""<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>SoundMap</title>
<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">
<style>body{{margin:0;background:#05050A;color:#fff;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:12px}}
.s{{width:32px;height:32px;border:3px solid #D4FF00;border-top-color:transparent;border-radius:50%;animation:s 1s linear infinite}}
@keyframes s{{to{{transform:rotate(360deg)}}}}</style>
</head><body><div class=\"s\"></div><div>Returning to SoundMap…</div>
<script>window.location.replace({json.dumps(target)});setTimeout(function(){{window.location.href={json.dumps(target)}}},250);</script>
</body></html>"""
            return HTMLResponse(html)
        return RedirectResponse(target)

    if error:
        return _render_redirect(_build_redirect(f"error={error}"))
    if not code:
        return _render_redirect(_build_redirect("error=missing_code"))
    try:
        oauth = get_oauth()
        token_info = oauth.get_access_token(code, as_dict=True, check_cache=False)
        access_token = token_info["access_token"]
        refresh_token = token_info.get("refresh_token", "")
        expires_in = token_info.get("expires_in", 3600)

        # Fetch profile
        sp = spotipy.Spotify(auth=access_token)
        me = sp.me()
        user_id = me["id"]
        display_name = me.get("display_name") or user_id
        images = me.get("images", [])
        profile_image = images[0]["url"] if images else ""

        # Persist minimal profile
        await db.users.update_one(
            {"user_id": user_id},
            {
                "$set": {
                    "user_id": user_id,
                    "display_name": display_name,
                    "profile_image": profile_image,
                    "product": me.get("product", "free"),
                    "last_login": datetime.now(timezone.utc).isoformat(),
                }
            },
            upsert=True,
        )

        # Redirect back with params in query string
        params = (
            f"access_token={access_token}&refresh_token={refresh_token}"
            f"&expires_in={expires_in}&user_id={user_id}"
            f"&display_name={requests.utils.quote(display_name)}"
            f"&profile_image={requests.utils.quote(profile_image)}"
            f"&product={me.get('product', 'free')}"
        )
        return _render_redirect(_build_redirect(params))
    except Exception as e:
        logger.exception("Spotify callback failed")
        return _render_redirect(_build_redirect(f"error={requests.utils.quote(str(e))}"))


@api_router.post("/spotify/refresh")
async def spotify_refresh(body: TokenRefreshRequest):
    try:
        oauth = get_oauth()
        token_info = oauth.refresh_access_token(body.refresh_token)
        return {
            "access_token": token_info["access_token"],
            "refresh_token": token_info.get("refresh_token", body.refresh_token),
            "expires_in": token_info.get("expires_in", 3600),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ------------------------ Spotify Web API proxy ------------------------

def _sp(token: str) -> spotipy.Spotify:
    return spotipy.Spotify(auth=token, requests_timeout=10, retries=1)


@api_router.get("/spotify/me")
async def spotify_me(access_token: str):
    try:
        return _sp(access_token).me()
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e))


@api_router.get("/spotify/currently-playing")
async def spotify_currently_playing(access_token: str):
    try:
        state_data = _sp(access_token).current_playback()
        if not state_data:
            return {"is_playing": False, "item": None}
        return state_data
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@api_router.get("/spotify/devices")
async def spotify_devices(access_token: str):
    try:
        return _sp(access_token).devices()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@api_router.post("/spotify/play")
async def spotify_play(body: PlayRequest):
    try:
        sp = _sp(body.access_token)
        kwargs = {}
        if body.device_id:
            kwargs["device_id"] = body.device_id
        if body.track_uri:
            kwargs["uris"] = [body.track_uri]
        if body.position_ms is not None:
            kwargs["position_ms"] = body.position_ms
        sp.start_playback(**kwargs)
        return {"status": "playing"}
    except spotipy.SpotifyException as e:
        raise HTTPException(status_code=e.http_status or 400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@api_router.post("/spotify/pause")
async def spotify_pause(body: PlayRequest):
    try:
        sp = _sp(body.access_token)
        sp.pause_playback(device_id=body.device_id)
        return {"status": "paused"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@api_router.post("/spotify/next")
async def spotify_next(body: PlayRequest):
    try:
        _sp(body.access_token).next_track(device_id=body.device_id)
        return {"status": "skipped"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@api_router.post("/spotify/previous")
async def spotify_previous(body: PlayRequest):
    try:
        _sp(body.access_token).previous_track(device_id=body.device_id)
        return {"status": "previous"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@api_router.post("/spotify/seek")
async def spotify_seek(body: PlayRequest):
    try:
        _sp(body.access_token).seek_track(body.position_ms or 0, device_id=body.device_id)
        return {"status": "seeked"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@api_router.post("/spotify/queue")
async def spotify_queue(body: QueueRequest):
    try:
        _sp(body.access_token).add_to_queue(body.track_uri, device_id=body.device_id)
        return {"status": "queued"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@api_router.get("/spotify/search")
async def spotify_search(q: str, access_token: str):
    try:
        return _sp(access_token).search(q, limit=15, type="track")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ------------------------ Public API ------------------------

@api_router.get("/")
async def root():
    return {"service": "soundmap", "status": "ok"}


@api_router.get("/map.html")
async def map_html(key: str):
    """Serve the map HTML so the WebView gets a proper HTTPS origin
    (raw HTML strings get a `null` origin which Google Maps rejects)."""
    html = f"""<!DOCTYPE html>
<html><head>
<meta name="viewport" content="initial-scale=1.0, width=device-width, user-scalable=no" />
<style>
  html, body, #map {{ height: 100vh; width: 100vw; margin: 0; padding: 0; background:#05050A; overflow: hidden; }}
  #status {{ position: absolute; top:0; left:0; right:0; bottom:0; display:flex; align-items:center; justify-content:center; flex-direction:column; gap:10px; color:#fff; font-family:-apple-system,sans-serif; font-size:14px; text-align:center; padding:20px; pointer-events:none; }}
  #status .err {{ color:#FF4500; max-width: 80vw; word-break: break-word; }}
  .bubble {{ position: relative; display: flex; flex-direction: column; align-items: center; transform: translate(-50%, -100%); pointer-events: auto; cursor: pointer; }}
  .avatar-wrap {{ width: 56px; height: 56px; border-radius: 50%; padding: 3px; background: linear-gradient(135deg, #D4FF00, #BEE600); box-shadow: 0 0 18px rgba(212,255,0,0.55); animation: pulse 2.4s ease-in-out infinite; }}
  .avatar-wrap.self {{ background: linear-gradient(135deg, #FF4500, #FF8A00); box-shadow: 0 0 18px rgba(255,69,0,0.55);}}
  .avatar-wrap.hosting {{ background: linear-gradient(135deg, #D4FF00, #00FFE0); animation: pulse 1.3s ease-in-out infinite;}}
  .avatar-wrap.paused {{ background: rgba(255,255,255,0.25); box-shadow: none; animation: none;}}
  .avatar {{ width: 100%; height: 100%; border-radius: 50%; background-size: cover; background-position: center; background-color: #12121A; border: 2px solid #05050A; }}
  .pill {{ margin-top: 6px; max-width: 160px; padding: 4px 10px; background: rgba(0,0,0,0.75); border: 1px solid rgba(255,255,255,0.1); border-radius: 999px; color: #fff; font: 600 11px -apple-system, BlinkMacSystemFont, sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 6px; }}
  .pill .dot {{ width:6px; height:6px; border-radius:50%; background:#D4FF00; box-shadow:0 0 6px #D4FF00;}}
  .pill.paused .dot {{ background: rgba(255,255,255,0.35); box-shadow:none; }}
  @keyframes pulse {{ 0%,100% {{ transform: scale(1); }} 50% {{ transform: scale(1.08); }} }}
</style>
</head><body>
<div id="map"></div>
<div id="status">Initializing…</div>
<script>
  let map; let markers = {{}}; let meId = null;
  const statusEl = document.getElementById('status');
  function setStatus(t, isError){{ if(!statusEl) return; statusEl.style.display='flex'; statusEl.innerHTML = isError ? '<div class="err">'+t+'</div>' : t; }}
  function post(msg){{
    try {{ window.ReactNativeWebView.postMessage(JSON.stringify(msg)); }} catch(e) {{}}
    try {{ window.parent && window.parent.postMessage(JSON.stringify(msg), '*'); }} catch(e) {{}}
  }}
  post({{ type: 'map:html_loaded' }});
  setStatus('Loading Google Maps…');
  const mapsTimeout = setTimeout(function(){{
    if (!map) {{
      setStatus('Google Maps did not load within 10s. Enable Maps JavaScript API in Google Cloud Console, and remove HTTP referrer restrictions on the API key.', true);
      post({{ type: 'map:timeout' }});
    }}
  }}, 10000);
  window.gm_authFailure = function(){{
    clearTimeout(mapsTimeout);
    setStatus('Google Maps key blocked this request. Enable Maps JavaScript API or remove restrictions on the key.', true);
    post({{ type: 'map:auth_failure' }});
  }};
  window.addEventListener('error', function(e){{
    if (!map) {{
      const msg = (e && (e.message || (e.error && e.error.message))) || 'unknown';
      setStatus('Script error: ' + msg, true);
      post({{ type: 'map:script_error', message: String(msg) }});
    }}
  }});
  window.initMap = function() {{
    clearTimeout(mapsTimeout);
    if (statusEl) statusEl.style.display = 'none';
    AdvancedBubble.prototype = new google.maps.OverlayView();
    AdvancedBubble.prototype.onAdd = function(){{ const panes = this.getPanes(); this.el.style.position = 'absolute'; panes.overlayMouseTarget.appendChild(this.el); }};
    AdvancedBubble.prototype.draw = function(){{ const proj = this.getProjection(); if (!proj) return; const p = proj.fromLatLngToDivPixel(this.position); this.el.style.left = p.x + 'px'; this.el.style.top = p.y + 'px'; }};
    AdvancedBubble.prototype.onRemove = function(){{ if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el); }};
    AdvancedBubble.prototype.setPosition = function(latLng){{ this.position = latLng; this.draw(); }};
    map = new google.maps.Map(document.getElementById('map'), {{
      center: {{ lat: 40.758, lng: -73.9855 }},
      zoom: 12,
      disableDefaultUI: true,
      gestureHandling: 'greedy',
      backgroundColor: '#05050A',
      styles: DARK_STYLE,
    }});
    post({{ type: 'map:ready' }});
  }};
  function upsertMarker(u) {{
    if (!u.lat || !u.lng) return;
    const existing = markers[u.user_id];
    if (existing) {{
      existing.setPosition(new google.maps.LatLng(u.lat, u.lng));
      existing.__data = u; refreshContent(existing); return;
    }}
    const div = document.createElement('div');
    div.className = 'bubble';
    div.addEventListener('click', () => post({{ type: 'marker:click', user_id: u.user_id }}));
    const marker = new AdvancedBubble(new google.maps.LatLng(u.lat, u.lng), map, div);
    marker.__el = div; marker.__data = u; refreshContent(marker);
    markers[u.user_id] = marker;
  }}
  function refreshContent(marker) {{
    const u = marker.__data;
    const self = u.user_id === meId;
    const hosting = !!u.host_session;
    const playing = !!u.is_playing;
    const track = u.current_track;
    const title = track && track.item ? track.item.name : (track && track.name ? track.name : '');
    const img = u.profile_image || '';
    const classes = ['avatar-wrap'];
    if (self) classes.push('self'); else if (hosting) classes.push('hosting'); else if (!playing) classes.push('paused');
    marker.__el.innerHTML = '<div class="'+classes.join(' ')+'"><div class="avatar" style="background-image:url('+img+')"></div></div>' + (title ? '<div class="pill '+(playing?'':'paused')+'"><span class="dot"></span><span>'+escapeHtml(title)+'</span></div>' : '');
  }}
  function escapeHtml(s){{ return (s||'').replace(/[&<>"']/g,c=>({{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}}[c])); }}
  function removeMarker(uid){{ if(markers[uid]){{ markers[uid].setMap(null); delete markers[uid]; }} }}
  function handle(data) {{
    if (data.type === 'set_self') {{ meId = data.user_id; }}
    else if (data.type === 'set_markers') {{
      const keep = new Set();
      (data.markers || []).forEach(m => {{ upsertMarker(m); keep.add(m.user_id); }});
      Object.keys(markers).forEach(id => {{ if (!keep.has(id)) removeMarker(id); }});
    }} else if (data.type === 'center') {{ if (map) map.panTo({{ lat: data.lat, lng: data.lng }}); }}
  }}
  window.__handle = handle;
  window.addEventListener('message', (e) => {{ try {{ const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; handle(d); }} catch(_){{}} }});
  document.addEventListener('message', (e) => {{ try {{ const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; handle(d); }} catch(_){{}} }});
  function AdvancedBubble(position, map, el){{ this.position = position; this.el = el; this.setMap(map); }}
  const DARK_STYLE = [
    {{elementType:'geometry',stylers:[{{color:'#0a0a12'}}]}},
    {{elementType:'labels.text.stroke',stylers:[{{color:'#0a0a12'}}]}},
    {{elementType:'labels.text.fill',stylers:[{{color:'#746855'}}]}},
    {{featureType:'poi.park',elementType:'geometry',stylers:[{{color:'#10231a'}}]}},
    {{featureType:'road',elementType:'geometry',stylers:[{{color:'#1a1a28'}}]}},
    {{featureType:'road',elementType:'labels.text.fill',stylers:[{{color:'#9ca3af'}}]}},
    {{featureType:'water',elementType:'geometry',stylers:[{{color:'#020617'}}]}},
  ];
</script>
<script src="https://maps.googleapis.com/maps/api/js?key={key}&callback=initMap" async defer></script>
</body></html>"""
    return HTMLResponse(html)


@api_router.get("/users/active")
async def active_users():
    return {"users": state.public_users()}


@api_router.get("/sessions/{host_id}")
async def get_session(host_id: str):
    if host_id not in state.users:
        raise HTTPException(status_code=404, detail="Host not found")
    host = state.users[host_id]
    return {
        "host_id": host_id,
        "display_name": host.display_name,
        "profile_image": host.profile_image,
        "current_track": host.current_track,
        "is_playing": host.is_playing,
        "guests": list(state.sessions.get(host_id, set())),
    }


# ------------------------ WebSocket ------------------------

@app.websocket("/api/ws")
async def websocket_endpoint(websocket: WebSocket, user_id: str = Query(...), display_name: str = Query("Guest"), profile_image: str = Query("")):
    await websocket.accept()
    state.connections[user_id] = websocket
    state.upsert_user(user_id, display_name=display_name, profile_image=profile_image)

    # Send current users snapshot to new connection
    try:
        await websocket.send_json({"type": "users:snapshot", "users": state.public_users()})
        # Notify everyone a new user is online
        await broadcast({"type": "user:online", "user": {
            "user_id": user_id, "display_name": display_name, "profile_image": profile_image
        }}, exclude=user_id)

        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "location:update":
                lat = float(data.get("lat"))
                lng = float(data.get("lng"))
                state.upsert_user(user_id, lat=lat, lng=lng)
                await broadcast({
                    "type": "location:update",
                    "user_id": user_id,
                    "lat": lat,
                    "lng": lng,
                }, exclude=user_id)

            elif msg_type == "user:active_track":
                track = data.get("track")
                is_playing = bool(data.get("is_playing", False))
                state.upsert_user(user_id, current_track=track, is_playing=is_playing)
                await broadcast({
                    "type": "user:active_track",
                    "user_id": user_id,
                    "track": track,
                    "is_playing": is_playing,
                }, exclude=user_id)
                # Also forward to any guests in this user's session
                for guest in state.sessions.get(user_id, set()):
                    await send_to(guest, {
                        "type": "session:update",
                        "host_id": user_id,
                        "track": track,
                        "is_playing": is_playing,
                        "position_ms": data.get("position_ms", 0),
                        "timestamp": time.time(),
                    })

            elif msg_type == "session:join":
                host_id = data.get("host_id")
                # Leave previous session
                prev_host = state.guest_to_host.pop(user_id, None)
                if prev_host and prev_host in state.sessions:
                    state.sessions[prev_host].discard(user_id)
                if host_id and host_id in state.users:
                    state.sessions.setdefault(host_id, set()).add(user_id)
                    state.guest_to_host[user_id] = host_id
                    host = state.users[host_id]
                    # Send current host playback state
                    await websocket.send_json({
                        "type": "session:joined",
                        "host_id": host_id,
                        "track": host.current_track,
                        "is_playing": host.is_playing,
                    })
                    # Notify host of new guest
                    await send_to(host_id, {
                        "type": "session:guest_joined",
                        "guest_id": user_id,
                        "display_name": state.users[user_id].display_name,
                    })

            elif msg_type == "session:leave":
                host_id = state.guest_to_host.pop(user_id, None)
                if host_id and host_id in state.sessions:
                    state.sessions[host_id].discard(user_id)
                    await send_to(host_id, {"type": "session:guest_left", "guest_id": user_id})
                await websocket.send_json({"type": "session:left"})

            elif msg_type == "session:sync":
                # Host pushes sync info to guests
                for guest in state.sessions.get(user_id, set()):
                    await send_to(guest, {
                        "type": "session:sync",
                        "host_id": user_id,
                        "track": data.get("track"),
                        "is_playing": data.get("is_playing"),
                        "position_ms": data.get("position_ms"),
                        "timestamp": time.time(),
                    })

            elif msg_type == "ping":
                await websocket.send_json({"type": "pong", "ts": time.time()})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.exception(f"WS error for {user_id}: {e}")
    finally:
        state.remove_user(user_id)
        await broadcast({"type": "user:offline", "user_id": user_id})


# ------------------------ Mount ------------------------

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
