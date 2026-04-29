"""SoundMap backend - Spotify OAuth, Web API proxy, and real-time WebSocket sync."""
from fastapi import FastAPI, APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Query
from fastapi.responses import RedirectResponse, HTMLResponse, Response
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
    visible: bool = True
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
            # Provide sane defaults so partial upserts don't fail validation
            fields.setdefault("display_name", fields.get("display_name") or "Guest")
            self.users[user_id] = ActiveUser(user_id=user_id, **fields)
        return self.users[user_id]

    def remove_user(self, user_id: str):
        # Hard removal: used when user explicitly logs out. Not called on WS
        # disconnect so short network blips don't wipe everyone off the map.
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

    def drop_connection(self, user_id: str):
        """Soft removal: WS dropped, but keep user state for reconnection grace period."""
        self.connections.pop(user_id, None)

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
            if now - u.last_update < 120 and getattr(u, "visible", True)  # prune stale; hide ghosts
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
.s{{width:32px;height:32px;border:3px solid #B026FF;border-top-color:transparent;border-radius:50%;animation:s 1s linear infinite}}
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


def _ensure_device(sp, device_id: Optional[str] = None) -> Optional[str]:
    """Return an active or available device id. If none is active, transfer
    playback to the first available device so subsequent commands succeed.
    Returns the resolved device id, or None if no devices exist at all."""
    try:
        devs = (sp.devices() or {}).get("devices", [])
    except Exception:
        return device_id
    if not devs:
        return None
    if device_id and any(d.get("id") == device_id for d in devs):
        return device_id
    active = next((d for d in devs if d.get("is_active")), None)
    if active:
        return active.get("id")
    # No active device — pick first non-restricted device and transfer
    target = next((d for d in devs if not d.get("is_restricted")), devs[0])
    target_id = target.get("id")
    try:
        sp.transfer_playback(target_id, force_play=False)
    except Exception:
        pass
    return target_id


class PlayNowRequest(BaseModel):
    access_token: str
    track_uri: str
    device_id: Optional[str] = None


@api_router.post("/spotify/play-now")
async def spotify_play_now(body: PlayNowRequest):
    """Play the given track immediately while preserving the upcoming queue.

    Spotify's start_playback with `uris=[X]` would clear the user-built queue.
    Workaround: read current queue first, then start_playback with [X, ...queue]
    so the clicked track plays now and the prior queue continues after.
    """
    try:
        sp = _sp(body.access_token)
        resolved = _ensure_device(sp, body.device_id)
        if resolved is None:
            raise HTTPException(status_code=404, detail="No Spotify devices available. Open Spotify on any of your devices to start playback.")
        queue_uris: list = []
        try:
            qresp = sp._get("me/player/queue") or {}
            for t in (qresp.get("queue") or []):
                uri = t.get("uri")
                if uri and uri != body.track_uri:
                    queue_uris.append(uri)
        except Exception:
            pass
        # Spotify start_playback `uris` is capped at 100 items; trim defensively.
        uris = [body.track_uri] + queue_uris[:99]
        sp.start_playback(device_id=resolved, uris=uris)
        return {"status": "playing", "device_id": resolved, "preserved_queue_size": len(queue_uris)}
    except HTTPException:
        raise
    except spotipy.SpotifyException as e:
        raise HTTPException(status_code=e.http_status or 400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@api_router.post("/spotify/play")
async def spotify_play(body: PlayRequest):
    try:
        sp = _sp(body.access_token)
        # Auto-pick a device if none is active so users can start playback
        # straight from our app without having to open Spotify first.
        resolved = _ensure_device(sp, body.device_id)
        if resolved is None:
            raise HTTPException(status_code=404, detail="No Spotify devices available. Open Spotify on any of your devices to start playback.")
        kwargs = {"device_id": resolved}
        if body.track_uri:
            kwargs["uris"] = [body.track_uri]
        if body.position_ms is not None:
            kwargs["position_ms"] = body.position_ms
        sp.start_playback(**kwargs)
        return {"status": "playing", "device_id": resolved}
    except HTTPException:
        raise
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


PIXELBLAST_HTML = """<!doctype html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no" />
<title>PixelBlast Background</title>
<style>
  html,body{margin:0;padding:0;width:100%;height:100%;background:#05050A;overflow:hidden;}
  #root{position:absolute;left:0;top:0;right:0;bottom:0;width:100%;height:100%;}
  canvas{display:block;position:absolute;left:0;top:0;width:100%!important;height:100%!important;}
</style>
</head>
<body>
<div id="root"></div>
<script type="importmap">
{ "imports": {
    "three": "https://esm.sh/three@0.166.0",
    "postprocessing": "https://esm.sh/postprocessing@6.36.0?deps=three@0.166.0"
} }
</script>
<script type="module">
import * as THREE from 'three';
import { Effect, EffectComposer, EffectPass, RenderPass } from 'postprocessing';

const params = new URLSearchParams(location.search);
const num = (k, d) => { const v = parseFloat(params.get(k)); return Number.isFinite(v) ? v : d; };
const str = (k, d) => params.get(k) || d;
const bool = (k, d) => { const v = params.get(k); if (v === null) return d; return v !== '0' && v !== 'false'; };

const variant = str('variant', 'circle');
const pixelSize = num('pixelSize', 6);
const color = str('color', '#B026FF');
const patternScale = num('patternScale', 3);
const patternDensity = num('patternDensity', 1.2);
const pixelSizeJitter = num('pixelSizeJitter', 0.5);
const enableRipples = bool('enableRipples', true);
const rippleSpeed = num('rippleSpeed', 0.4);
const rippleThickness = num('rippleThickness', 0.12);
const rippleIntensityScale = num('rippleIntensityScale', 1.5);
const liquid = bool('liquid', true);
const liquidStrength = num('liquidStrength', 0.12);
const liquidRadius = num('liquidRadius', 1.2);
const liquidWobbleSpeed = num('liquidWobbleSpeed', 5);
const speed = num('speed', 0.6);
const edgeFade = num('edgeFade', 0.25);
const noiseAmount = num('noiseAmount', 0);
const transparent = bool('transparent', false);

const SHAPE_MAP = { square:0, circle:1, triangle:2, diamond:3 };
const MAX_CLICKS = 10;
const VERTEX_SRC = `void main(){gl_Position=vec4(position,1.0);}`;
const FRAGMENT_SRC = `precision highp float;
uniform vec3 uColor;uniform vec2 uResolution;uniform float uTime;
uniform float uPixelSize;uniform float uScale;uniform float uDensity;uniform float uPixelJitter;
uniform int uEnableRipples;uniform float uRippleSpeed;uniform float uRippleThickness;
uniform float uRippleIntensity;uniform float uEdgeFade;uniform int uShapeType;
const int SHAPE_SQUARE=0,SHAPE_CIRCLE=1,SHAPE_TRIANGLE=2,SHAPE_DIAMOND=3;
const int MAX_CLICKS=10;uniform vec2 uClickPos[MAX_CLICKS];uniform float uClickTimes[MAX_CLICKS];
out vec4 fragColor;
float Bayer2(vec2 a){a=floor(a);return fract(a.x/2.+a.y*a.y*.75);}
#define Bayer4(a) (Bayer2(.5*(a))*0.25 + Bayer2(a))
#define Bayer8(a) (Bayer4(.5*(a))*0.25 + Bayer2(a))
#define FBM_OCTAVES 5
#define FBM_LACUNARITY 1.25
#define FBM_GAIN 1.0
float hash11(float n){return fract(sin(n)*43758.5453);}
float vnoise(vec3 p){vec3 ip=floor(p);vec3 fp=fract(p);
float n000=hash11(dot(ip+vec3(0.,0.,0.),vec3(1.,57.,113.)));float n100=hash11(dot(ip+vec3(1.,0.,0.),vec3(1.,57.,113.)));
float n010=hash11(dot(ip+vec3(0.,1.,0.),vec3(1.,57.,113.)));float n110=hash11(dot(ip+vec3(1.,1.,0.),vec3(1.,57.,113.)));
float n001=hash11(dot(ip+vec3(0.,0.,1.),vec3(1.,57.,113.)));float n101=hash11(dot(ip+vec3(1.,0.,1.),vec3(1.,57.,113.)));
float n011=hash11(dot(ip+vec3(0.,1.,1.),vec3(1.,57.,113.)));float n111=hash11(dot(ip+vec3(1.,1.,1.),vec3(1.,57.,113.)));
vec3 w=fp*fp*fp*(fp*(fp*6.-15.)+10.);
float x00=mix(n000,n100,w.x);float x10=mix(n010,n110,w.x);float x01=mix(n001,n101,w.x);float x11=mix(n011,n111,w.x);
float y0=mix(x00,x10,w.y);float y1=mix(x01,x11,w.y);return mix(y0,y1,w.z)*2.-1.;}
float fbm2(vec2 uv,float t){vec3 p=vec3(uv*uScale,t);float amp=1.,freq=1.,sum=1.;
for(int i=0;i<FBM_OCTAVES;++i){sum+=amp*vnoise(p*freq);freq*=FBM_LACUNARITY;amp*=FBM_GAIN;}return sum*0.5+0.5;}
float maskCircle(vec2 p,float cov){float r=sqrt(cov)*.25;float d=length(p-0.5)-r;float aa=0.5*fwidth(d);return cov*(1.-smoothstep(-aa,aa,d*2.));}
float maskTriangle(vec2 p,vec2 id,float cov){bool flip=mod(id.x+id.y,2.)>0.5;if(flip)p.x=1.-p.x;float r=sqrt(cov);float d=p.y-r*(1.-p.x);float aa=fwidth(d);return cov*clamp(0.5-d/aa,0.,1.);}
float maskDiamond(vec2 p,float cov){float r=sqrt(cov)*0.564;return step(abs(p.x-0.49)+abs(p.y-0.49),r);}
void main(){float pixelSize=uPixelSize;vec2 fragCoord=gl_FragCoord.xy-uResolution*.5;float ar=uResolution.x/uResolution.y;
vec2 pixelId=floor(fragCoord/pixelSize);vec2 pixelUV=fract(fragCoord/pixelSize);
float cellPixelSize=8.*pixelSize;vec2 cellId=floor(fragCoord/cellPixelSize);vec2 cellCoord=cellId*cellPixelSize;
vec2 uv=cellCoord/uResolution*vec2(ar,1.);float base=fbm2(uv,uTime*0.05);base=base*0.5-0.65;
float feed=base+(uDensity-0.5)*0.3;float speed=uRippleSpeed;float thickness=uRippleThickness;
const float dampT=1.;const float dampR=10.;
if(uEnableRipples==1){for(int i=0;i<MAX_CLICKS;++i){vec2 pos=uClickPos[i];if(pos.x<0.)continue;
float cellPixelSize=8.*pixelSize;vec2 cuv=(((pos-uResolution*.5-cellPixelSize*.5)/(uResolution)))*vec2(ar,1.);
float t=max(uTime-uClickTimes[i],0.);float r=distance(uv,cuv);float waveR=speed*t;
float ring=exp(-pow((r-waveR)/thickness,2.));float atten=exp(-dampT*t)*exp(-dampR*r);
feed=max(feed,ring*atten*uRippleIntensity);}}
float bayer=Bayer8(fragCoord/uPixelSize)-0.5;float bw=step(0.5,feed+bayer);
float h=fract(sin(dot(floor(fragCoord/uPixelSize),vec2(127.1,311.7)))*43758.5453);
float jitterScale=1.+(h-0.5)*uPixelJitter;float coverage=bw*jitterScale;
float M;if(uShapeType==SHAPE_CIRCLE)M=maskCircle(pixelUV,coverage);
else if(uShapeType==SHAPE_TRIANGLE)M=maskTriangle(pixelUV,pixelId,coverage);
else if(uShapeType==SHAPE_DIAMOND)M=maskDiamond(pixelUV,coverage);
else M=coverage;
if(uEdgeFade>0.){vec2 norm=gl_FragCoord.xy/uResolution;
float edge=min(min(norm.x,norm.y),min(1.-norm.x,1.-norm.y));float fade=smoothstep(0.,uEdgeFade,edge);M*=fade;}
vec3 col=uColor;
vec3 srgb=mix(col*12.92,1.055*pow(col,vec3(1./2.4))-0.055,step(0.0031308,col));
fragColor=vec4(srgb,M);}`;

// --- Touch texture for liquid effect ---
function createTouchTexture(){const size=64;const c=document.createElement('canvas');c.width=size;c.height=size;const ctx=c.getContext('2d');
ctx.fillStyle='black';ctx.fillRect(0,0,size,size);const tex=new THREE.Texture(c);
tex.minFilter=THREE.LinearFilter;tex.magFilter=THREE.LinearFilter;tex.generateMipmaps=false;
const trail=[];let last=null;const maxAge=64;let radius=0.1*size;const sp=1/maxAge;
const clear=()=>{ctx.fillStyle='black';ctx.fillRect(0,0,size,size);};
const drawPoint=p=>{const pos={x:p.x*size,y:(1-p.y)*size};let inten=1;
const easeOutSine=t=>Math.sin((t*Math.PI)/2);const easeOutQuad=t=>-t*(t-2);
if(p.age<maxAge*0.3)inten=easeOutSine(p.age/(maxAge*0.3));else inten=easeOutQuad(1-(p.age-maxAge*0.3)/(maxAge*0.7))||0;
inten*=p.force;const col=`${((p.vx+1)/2)*255}, ${((p.vy+1)/2)*255}, ${inten*255}`;const off=size*5;
ctx.shadowOffsetX=off;ctx.shadowOffsetY=off;ctx.shadowBlur=radius;ctx.shadowColor=`rgba(${col},${0.22*inten})`;
ctx.beginPath();ctx.fillStyle='rgba(255,0,0,1)';ctx.arc(pos.x-off,pos.y-off,radius,0,Math.PI*2);ctx.fill();};
return{canvas:c,texture:tex,
addTouch(n){let f=0,vx=0,vy=0;if(last){const dx=n.x-last.x,dy=n.y-last.y;if(dx===0&&dy===0)return;
const dd=dx*dx+dy*dy,d=Math.sqrt(dd);vx=dx/(d||1);vy=dy/(d||1);f=Math.min(dd*10000,1);}
last={x:n.x,y:n.y};trail.push({x:n.x,y:n.y,age:0,force:f,vx,vy});},
update(){clear();for(let i=trail.length-1;i>=0;i--){const p=trail[i];const f=p.force*sp*(1-p.age/maxAge);p.x+=p.vx*f;p.y+=p.vy*f;p.age++;if(p.age>maxAge)trail.splice(i,1);}for(let i=0;i<trail.length;i++)drawPoint(trail[i]);tex.needsUpdate=true;},
set radiusScale(v){radius=0.1*size*v;},get radiusScale(){return radius/(0.1*size);},size};}

function createLiquidEffect(texture,opts){
const fragment=`uniform sampler2D uTexture;uniform float uStrength;uniform float uTime;uniform float uFreq;
void mainUv(inout vec2 uv){vec4 tex=texture2D(uTexture,uv);float vx=tex.r*2.-1.;float vy=tex.g*2.-1.;float intensity=tex.b;
float wave=0.5+0.5*sin(uTime*uFreq+intensity*6.2831853);float amt=uStrength*intensity*wave;
uv+=vec2(vx,vy)*amt;}`;
return new Effect('LiquidEffect',fragment,{uniforms:new Map([
['uTexture',new THREE.Uniform(texture)],['uStrength',new THREE.Uniform(opts?.strength??0.025)],
['uTime',new THREE.Uniform(0)],['uFreq',new THREE.Uniform(opts?.freq??4.5)]])});}

const container = document.getElementById('root');
const canvas = document.createElement('canvas');
const renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:true, powerPreference:'high-performance'});
renderer.domElement.style.width='100%';renderer.domElement.style.height='100%';
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
container.appendChild(renderer.domElement);
if(transparent) renderer.setClearAlpha(0); else renderer.setClearColor(0x05050A,1);

const uniforms={
  uResolution:{value:new THREE.Vector2(0,0)},
  uTime:{value:0},
  uColor:{value:new THREE.Color(color)},
  uClickPos:{value:Array.from({length:MAX_CLICKS},()=>new THREE.Vector2(-1,-1))},
  uClickTimes:{value:new Float32Array(MAX_CLICKS)},
  uShapeType:{value:SHAPE_MAP[variant]??0},
  uPixelSize:{value:pixelSize*renderer.getPixelRatio()},
  uScale:{value:patternScale},
  uDensity:{value:patternDensity},
  uPixelJitter:{value:pixelSizeJitter},
  uEnableRipples:{value:enableRipples?1:0},
  uRippleSpeed:{value:rippleSpeed},
  uRippleThickness:{value:rippleThickness},
  uRippleIntensity:{value:rippleIntensityScale},
  uEdgeFade:{value:edgeFade}
};

const scene=new THREE.Scene();
const camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
const material=new THREE.ShaderMaterial({vertexShader:VERTEX_SRC,fragmentShader:FRAGMENT_SRC,uniforms,transparent:true,depthTest:false,depthWrite:false,glslVersion:THREE.GLSL3});
const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);
scene.add(quad);
const clock=new THREE.Clock();

let composer, touch, liquidEffect;
if(liquid){
  touch = createTouchTexture(); touch.radiusScale = liquidRadius;
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  liquidEffect = createLiquidEffect(touch.texture, { strength: liquidStrength, freq: liquidWobbleSpeed });
  const ep = new EffectPass(camera, liquidEffect); ep.renderToScreen = true;
  composer.addPass(ep);
}

function setSize(){
  // PRIORITY ORDER for mobile WebView reliability:
  // 1) RN-injected explicit dims (most reliable inside react-native-webview)
  // 2) document.documentElement.clientWidth/Height (reliable on Android WebView)
  // 3) visualViewport
  // 4) window.innerWidth/innerHeight
  // 5) container.clientWidth/Height
  const rn = window.__RN_VIEWPORT;
  let vw, vh;
  if (rn && rn.w > 0 && rn.h > 0) {
    vw = rn.w; vh = rn.h;
  } else {
    const docEl = document.documentElement;
    vw = docEl.clientWidth || (window.visualViewport && window.visualViewport.width) || window.innerWidth || container.clientWidth || 1;
    vh = docEl.clientHeight || (window.visualViewport && window.visualViewport.height) || window.innerHeight || container.clientHeight || 1;
  }
  // Force CSS size of canvas explicitly so it always fills the viewport,
  // even if parent layout reports zero on first frame.
  renderer.setSize(vw, vh, true);
  renderer.domElement.style.width = vw + 'px';
  renderer.domElement.style.height = vh + 'px';
  uniforms.uResolution.value.set(renderer.domElement.width, renderer.domElement.height);
  uniforms.uPixelSize.value = pixelSize * renderer.getPixelRatio();
  if(composer) composer.setSize(renderer.domElement.width, renderer.domElement.height);
}
setSize();
// Mobile WebViews often lay out after the script runs — re-measure twice to
// catch the final size once the WebView has settled.
setTimeout(setSize, 100);
setTimeout(setSize, 600);
window.addEventListener('resize', setSize);
if(window.visualViewport) window.visualViewport.addEventListener('resize', setSize);
new ResizeObserver(setSize).observe(container);

let clickIx=0;
function mapToPixels(e){
  const rect=renderer.domElement.getBoundingClientRect();
  const sx=renderer.domElement.width/rect.width;
  const sy=renderer.domElement.height/rect.height;
  const fx=(e.clientX-rect.left)*sx;
  const fy=(rect.height-(e.clientY-rect.top))*sy;
  return {fx,fy,w:renderer.domElement.width,h:renderer.domElement.height};
}
renderer.domElement.addEventListener('pointerdown', e=>{
  const {fx,fy}=mapToPixels(e);
  uniforms.uClickPos.value[clickIx].set(fx,fy);
  uniforms.uClickTimes.value[clickIx]=uniforms.uTime.value;
  clickIx=(clickIx+1)%MAX_CLICKS;
}, {passive:true});
renderer.domElement.addEventListener('pointermove', e=>{
  if(!touch) return;
  const {fx,fy,w,h}=mapToPixels(e);
  touch.addTouch({x:fx/w,y:fy/h});
}, {passive:true});

const timeOffset = Math.random()*1000;
function animate(){
  uniforms.uTime.value = timeOffset + clock.getElapsedTime() * speed;
  if(liquidEffect) liquidEffect.uniforms.get('uTime').value = uniforms.uTime.value;
  if(composer){ if(touch) touch.update(); composer.render(); }
  else renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
</script>
</body></html>
"""


@api_router.get("/pixelblast.html")
async def pixelblast_html():
    return Response(content=PIXELBLAST_HTML, media_type="text/html")


ASCIITEXT_HTML = """<!doctype html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no" />
<title>ASCII Text</title>
<style>
  html,body{margin:0;padding:0;width:100%;height:100%;background:transparent;overflow:hidden;}
  #root{position:absolute;left:0;top:0;right:0;bottom:0;width:100%;height:100%;}
  #root canvas{position:absolute;left:0;top:0;width:100%;height:100%;
    image-rendering:pixelated;image-rendering:crisp-edges;}
  #root pre{margin:0;padding:0;line-height:1em;text-align:left;position:absolute;left:0;top:0;
    user-select:none;
    background-image:radial-gradient(circle, #B026FF 0%, #7E1FB8 50%, #fdf9f3 100%);
    background-attachment:fixed;
    -webkit-text-fill-color:transparent;-webkit-background-clip:text;background-clip:text;
    z-index:9;mix-blend-mode:difference;}
</style>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet">
</head>
<body>
<div id="root"></div>
<script type="importmap">
{ "imports": { "three": "https://esm.sh/three@0.166.0" } }
</script>
<script type="module">
import * as THREE from 'three';
const params = new URLSearchParams(location.search);
const text = params.get('text') || 'GeoBeats';
const asciiFontSize = parseFloat(params.get('asciiFontSize') || '8');
const textFontSize = parseFloat(params.get('textFontSize') || '200');
const textColor = params.get('textColor') || '#fdf9f3';
const planeBaseHeight = parseFloat(params.get('planeBaseHeight') || '8');
const enableWaves = (params.get('enableWaves') ?? '1') !== '0';

Math.map = function(n, a, b, c, d){ return ((n-a)/(b-a))*(d-c)+c; };
const PX_RATIO = window.devicePixelRatio || 1;

const vertexShader = `varying vec2 vUv; uniform float uTime; uniform float uEnableWaves;
void main(){ vUv=uv; float t=uTime*5.; float wf=uEnableWaves; vec3 p=position;
p.x+=sin(t+position.y)*0.5*wf; p.y+=cos(t+position.z)*0.15*wf; p.z+=sin(t+position.x)*wf;
gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0); }`;
const fragmentShader = `varying vec2 vUv; uniform float uTime; uniform sampler2D uTexture;
void main(){ float t=uTime; vec2 pos=vUv;
float r=texture2D(uTexture, pos+cos(t*2.-t+pos.x)*.01).r;
float g=texture2D(uTexture, pos+tan(t*.5+pos.x-t)*.01).g;
float b=texture2D(uTexture, pos-cos(t*2.+t+pos.y)*.01).b;
float a=texture2D(uTexture, pos).a;
gl_FragColor = vec4(r,g,b,a); }`;

class AsciiFilter {
  constructor(renderer, opts={}){ this.renderer=renderer;
    this.domElement=document.createElement('div');
    Object.assign(this.domElement.style,{position:'absolute',top:'0',left:'0',width:'100%',height:'100%'});
    this.pre=document.createElement('pre'); this.domElement.appendChild(this.pre);
    this.canvas=document.createElement('canvas'); this.context=this.canvas.getContext('2d');
    this.domElement.appendChild(this.canvas);
    this.deg=0; this.invert=opts.invert??true; this.fontSize=opts.fontSize??12;
    this.fontFamily=opts.fontFamily??"'IBM Plex Mono', 'Courier New', monospace";
    this.charset=opts.charset??' .\\'\\`^",:;Il!i~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';
    this.context.imageSmoothingEnabled=false;
    this._mm=this.onMouseMove.bind(this); document.addEventListener('mousemove', this._mm);
  }
  setSize(w,h){ this.width=w;this.height=h;this.renderer.setSize(w,h);this.reset();
    this.center={x:w/2,y:h/2}; this.mouse={x:this.center.x,y:this.center.y}; }
  reset(){ this.context.font=`${this.fontSize}px ${this.fontFamily}`;
    const cw=this.context.measureText('A').width;
    this.cols=Math.floor(this.width/(this.fontSize*(cw/this.fontSize)));
    this.rows=Math.floor(this.height/this.fontSize);
    this.canvas.width=this.cols; this.canvas.height=this.rows;
    Object.assign(this.pre.style,{fontFamily:this.fontFamily,fontSize:`${this.fontSize}px`,margin:'0',padding:'0',lineHeight:'1em',position:'absolute',left:'0',top:'0',zIndex:'9',backgroundAttachment:'fixed',mixBlendMode:'difference'}); }
  render(scene,camera){ this.renderer.render(scene,camera);
    const w=this.canvas.width,h=this.canvas.height; this.context.clearRect(0,0,w,h);
    if(w&&h) this.context.drawImage(this.renderer.domElement,0,0,w,h);
    this.asciify(this.context,w,h); this.hue(); }
  onMouseMove(e){ this.mouse={x:e.clientX*PX_RATIO,y:e.clientY*PX_RATIO}; }
  get dx(){return this.mouse.x-this.center.x;} get dy(){return this.mouse.y-this.center.y;}
  hue(){ const d=(Math.atan2(this.dy,this.dx)*180)/Math.PI; this.deg+=(d-this.deg)*0.075;
    this.domElement.style.filter=`hue-rotate(${this.deg.toFixed(1)}deg)`; }
  asciify(ctx,w,h){ if(!w||!h) return; const data=ctx.getImageData(0,0,w,h).data; let s='';
    for(let y=0;y<h;y++){ for(let x=0;x<w;x++){ const i=x*4+y*4*w;
      const r=data[i],g=data[i+1],b=data[i+2],a=data[i+3];
      if(a===0){ s+=' '; continue; }
      const gray=(0.3*r+0.6*g+0.1*b)/255;
      let idx=Math.floor((1-gray)*(this.charset.length-1));
      if(this.invert) idx=this.charset.length-idx-1;
      s+=this.charset[idx]; } s+='\\n'; } this.pre.innerHTML=s; }
  dispose(){ document.removeEventListener('mousemove', this._mm); }
}
class CanvasTxt {
  constructor(txt,opts={}){ this.canvas=document.createElement('canvas'); this.context=this.canvas.getContext('2d');
    this.txt=txt; this.fontSize=opts.fontSize||200; this.fontFamily=opts.fontFamily||'Arial';
    this.color=opts.color||'#fdf9f3'; this.font=`600 ${this.fontSize}px ${this.fontFamily}`; }
  resize(){ this.context.font=this.font; const m=this.context.measureText(this.txt);
    const tw=Math.ceil(m.width)+20;
    const th=Math.ceil(m.actualBoundingBoxAscent+m.actualBoundingBoxDescent)+20;
    this.canvas.width=tw; this.canvas.height=th; }
  render(){ this.context.clearRect(0,0,this.canvas.width,this.canvas.height);
    this.context.fillStyle=this.color; this.context.font=this.font;
    const m=this.context.measureText(this.txt); const y=10+m.actualBoundingBoxAscent;
    this.context.fillText(this.txt,10,y); }
  get width(){return this.canvas.width;} get height(){return this.canvas.height;}
  get texture(){return this.canvas;}
}
class CanvAscii {
  constructor(cfg, container, w, h){
    Object.assign(this, cfg); this.container=container; this.width=w; this.height=h;
    this.camera=new THREE.PerspectiveCamera(45, w/h, 1, 1000); this.camera.position.z=30;
    this.scene=new THREE.Scene(); this.mouse={x:w/2,y:h/2};
    this._mm=this.onMouseMove.bind(this);
  }
  async init(){ try{ await document.fonts.load('600 200px "IBM Plex Mono"'); await document.fonts.load('500 12px "IBM Plex Mono"'); }catch(e){}
    await document.fonts.ready; this.setMesh(); this.setRenderer(); }
  setMesh(){ this.textCanvas=new CanvasTxt(this.text,{fontSize:this.textFontSize,fontFamily:'IBM Plex Mono',color:this.textColor});
    this.textCanvas.resize(); this.textCanvas.render();
    this.texture=new THREE.CanvasTexture(this.textCanvas.texture); this.texture.minFilter=THREE.NearestFilter;
    const ar=this.textCanvas.width/this.textCanvas.height; const baseH=this.planeBaseHeight;
    this.geometry=new THREE.PlaneGeometry(baseH*ar, baseH, 36, 36);
    this.material=new THREE.ShaderMaterial({vertexShader,fragmentShader,transparent:true,
      uniforms:{ uTime:{value:0}, uTexture:{value:this.texture}, uEnableWaves:{value:this.enableWaves?1.0:0.0} } });
    this.mesh=new THREE.Mesh(this.geometry,this.material); this.scene.add(this.mesh); }
  setRenderer(){ this.renderer=new THREE.WebGLRenderer({antialias:false,alpha:true});
    this.renderer.setPixelRatio(1); this.renderer.setClearColor(0x000000,0);
    this.filter=new AsciiFilter(this.renderer,{fontFamily:'IBM Plex Mono',fontSize:this.asciiFontSize,invert:true});
    this.container.appendChild(this.filter.domElement); this.setSize(this.width,this.height);
    this.container.addEventListener('mousemove', this._mm); this.container.addEventListener('touchmove', this._mm); }
  setSize(w,h){ this.width=w; this.height=h; this.camera.aspect=w/h; this.camera.updateProjectionMatrix();
    this.filter.setSize(w,h); this.center={x:w/2,y:h/2}; }
  load(){ const tick=()=>{ this.raf=requestAnimationFrame(tick); this.render(); }; tick(); }
  onMouseMove(evt){ const e=evt.touches?evt.touches[0]:evt; const r=this.container.getBoundingClientRect();
    this.mouse={x:e.clientX-r.left,y:e.clientY-r.top}; }
  render(){ const t=Date.now()*0.001; this.textCanvas.render(); this.texture.needsUpdate=true;
    this.mesh.material.uniforms.uTime.value=Math.sin(t);
    const x=Math.map(this.mouse.y,0,this.height,0.5,-0.5);
    const y=Math.map(this.mouse.x,0,this.width,-0.5,0.5);
    this.mesh.rotation.x+=(x-this.mesh.rotation.x)*0.05;
    this.mesh.rotation.y+=(y-this.mesh.rotation.y)*0.05;
    this.filter.render(this.scene,this.camera); }
}

const root = document.getElementById('root');
function getDims(){
  const rn = window.__RN_VIEWPORT;
  if (rn && rn.w > 0 && rn.h > 0) return { w: rn.w, h: rn.h };
  const r = root.getBoundingClientRect();
  const docEl = document.documentElement;
  const w = r.width || docEl.clientWidth || window.innerWidth || 0;
  const h = r.height || docEl.clientHeight || window.innerHeight || 0;
  return { w, h };
}
const cfg = { text, asciiFontSize, textFontSize, textColor, planeBaseHeight, enableWaves };
const d0 = getDims();
const inst = new CanvAscii(cfg, root, d0.w || 1, d0.h || 1);
await inst.init();
inst.load();
// Re-measure shortly after init in case layout settles late inside RN WebViews
setTimeout(()=>{ const d=getDims(); inst.setSize(d.w, d.h); }, 80);
setTimeout(()=>{ const d=getDims(); inst.setSize(d.w, d.h); }, 400);
window.addEventListener('resize', ()=>{ const d=getDims(); inst.setSize(d.w, d.h); });
if(window.visualViewport) window.visualViewport.addEventListener('resize', ()=>{ const d=getDims(); inst.setSize(d.w, d.h); });
new ResizeObserver(()=>{ const d=getDims(); inst.setSize(d.w, d.h); }).observe(root);
</script>
</body></html>
"""


@api_router.get("/asciitext.html")
async def asciitext_html():
    return Response(content=ASCIITEXT_HTML, media_type="text/html")


STARBORDER_HTML = """<!doctype html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no" />
<title>StarBorder</title>
<style>
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;width:100%;height:100%;background:transparent;overflow:hidden;
    display:flex;align-items:center;justify-content:center;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;}
  .star-border-container {
    display:flex;
    align-items:center;
    justify-content:center;
    position:relative;
    border-radius:999px;
    overflow:hidden;
    width:100%;
    height:100%;
    border:none;
    background:transparent;
    cursor:pointer;
    -webkit-tap-highlight-color: transparent;
    padding:0;
  }
  .border-gradient-bottom {
    position:absolute;
    width:300%;
    height:30%;
    opacity:0.55;
    bottom:-6px;
    right:-250%;
    border-radius:50%;
    animation: star-movement-bottom linear infinite alternate;
    z-index:0;
    pointer-events:none;
    filter: blur(0.5px);
  }
  .border-gradient-top {
    position:absolute;
    opacity:0.55;
    width:300%;
    height:30%;
    top:-6px;
    left:-250%;
    border-radius:50%;
    animation: star-movement-top linear infinite alternate;
    z-index:0;
    pointer-events:none;
    filter: blur(0.5px);
  }
  .inner-content {
    position:relative;
    border:1px solid #222;
    background:#000;
    color:#fff;
    font-size:14px;
    font-weight:900;
    letter-spacing:1.5px;
    text-align:center;
    padding:12px 22px;
    border-radius:999px;
    z-index:1;
    user-select:none;
    width:calc(100% - 4px);
    height:calc(100% - 4px);
    margin:2px;
    display:flex;
    align-items:center;
    justify-content:center;
    transition: transform 0.12s ease;
  }
  .star-border-container:active .inner-content { transform: scale(0.98); }
  .star-border-container.is-busy { cursor: default; }
  .star-border-container.is-busy .inner-content { color: rgba(255,255,255,0.6); }
  @keyframes star-movement-bottom {
    0% { transform: translate(0%, 0%); opacity:1; }
    100% { transform: translate(-100%, 0%); opacity:0; }
  }
  @keyframes star-movement-top {
    0% { transform: translate(0%, 0%); opacity:1; }
    100% { transform: translate(100%, 0%); opacity:0; }
  }
  .dot { width:6px; height:6px; border-radius:50%; background:#fff; margin:0 3px; opacity:0.4;
    animation: dot-pulse 1.2s ease-in-out infinite; }
  .dot:nth-child(2){ animation-delay:0.15s; }
  .dot:nth-child(3){ animation-delay:0.3s; }
  @keyframes dot-pulse {
    0%,80%,100% { opacity:0.3; transform:scale(0.85); }
    40% { opacity:1; transform:scale(1); }
  }
</style>
</head>
<body>
<button class="star-border-container" id="btn" type="button">
  <div class="border-gradient-bottom" id="bg-bot"></div>
  <div class="border-gradient-top" id="bg-top"></div>
  <div class="inner-content" id="label">CONNECT</div>
</button>
<script>
(function(){
  const params = new URLSearchParams(location.search);
  const color = params.get('color') || '#B026FF';
  const speed = params.get('speed') || '5s';
  const label = params.get('label') || 'CONNECT WITH SPOTIFY';
  const busy = params.get('busy') === '1';
  const top = document.getElementById('bg-top');
  const bot = document.getElementById('bg-bot');
  const btn = document.getElementById('btn');
  const lab = document.getElementById('label');
  const grad = `radial-gradient(circle, ${color}, transparent 10%)`;
  top.style.background = grad;
  bot.style.background = grad;
  top.style.animationDuration = speed;
  bot.style.animationDuration = speed;
  if (busy) {
    btn.classList.add('is-busy');
    lab.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  } else {
    lab.textContent = label;
  }
  function fire(){
    if (busy) return;
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage('star_press');
    } else if (window.parent && window.parent !== window) {
      try { window.parent.postMessage({ __starborder_press: true }, '*'); } catch(e) {}
    }
  }
  // Use both click and touchend so iOS/Android WebViews fire reliably without
  // 300ms tap delay. Prevent the synthesized click after touchend.
  let touched = false;
  btn.addEventListener('touchend', (e)=>{ touched = true; e.preventDefault(); fire(); }, { passive:false });
  btn.addEventListener('click', ()=>{ if (touched) { touched = false; return; } fire(); });
})();
</script>
</body></html>
"""


@api_router.get("/starborder.html")
async def starborder_html():
    return Response(content=STARBORDER_HTML, media_type="text/html")


@api_router.get("/geobeats-style.json")
async def geobeats_style_json():
    """Serves the NFS Neon map style JSON for pasting into Google Cloud
    Console → Map Styles → JSON tab. Open this URL in a browser, Ctrl+A,
    Ctrl+C, then paste it into the Cloud Console JSON editor."""
    style_path = ROOT_DIR / "geobeats_style.json"
    if not style_path.exists():
        return Response(content="[]", media_type="application/json")
    return Response(content=style_path.read_text(), media_type="application/json")


@api_router.post("/spotify/queue")
async def spotify_queue(body: QueueRequest):
    try:
        sp = _sp(body.access_token)
        resolved = _ensure_device(sp, body.device_id)
        if resolved is None:
            raise HTTPException(status_code=404, detail="No Spotify devices available. Open Spotify to start playback.")
        sp.add_to_queue(body.track_uri, device_id=resolved)
        return {"status": "queued", "device_id": resolved}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@api_router.get("/spotify/queue")
async def spotify_get_queue(access_token: str):
    """Returns currently_playing + the upcoming queue."""
    try:
        sp = _sp(access_token)
        # spotipy doesn't expose this directly in 2.26; call the endpoint manually
        return sp._get("me/player/queue")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@api_router.get("/spotify/devices")
async def spotify_devices(access_token: str):
    """Returns list of available Spotify Connect devices for this user."""
    try:
        return _sp(access_token).devices()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


class RepeatRequest(BaseModel):
    access_token: str
    state: str  # 'off' | 'track' | 'context'


@api_router.post("/spotify/repeat")
async def spotify_repeat(body: RepeatRequest):
    try:
        _sp(body.access_token).repeat(body.state)
        return {"status": "ok", "repeat": body.state}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@api_router.get("/spotify/search")
async def spotify_search(q: str, access_token: str):
    try:
        # NOTE: Spotify Feb-2026 dev-mode apps cap catalog endpoint limit at 10.
        # Larger values return a misleading "Invalid limit" 400. Stay <= 10.
        return _sp(access_token).search(q, limit=10, type="track")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ------------------------ Public API ------------------------

@api_router.get("/")
async def root():
    return {"service": "soundmap", "status": "ok"}


@api_router.get("/mapbox.html")
async def mapbox_html(token: str):
    """Mapbox GL JS globe view — Snapchat-style 3D Earth with atmosphere,
    stars, and satellite terrain. The marker/message protocol matches
    /api/map.html so the SoundMapView WebView swap is drop-in."""
    html = f"""<!DOCTYPE html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="initial-scale=1.0, width=device-width, user-scalable=no" />
<link href="https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.css" rel="stylesheet" />
<script src="https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.js"></script>
<style>
  html, body, #map {{ height: 100vh; width: 100vw; margin: 0; padding: 0; background:#000; overflow: hidden; }}
  #status {{ position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); color:#fff; font-family:-apple-system,sans-serif; font-size:14px; text-align:center; pointer-events:none; z-index:5; }}
  .bubble {{
    position: relative;
    display: flex; flex-direction: column; align-items: center;
    pointer-events: auto;
    cursor: pointer;
    transform-origin: 50% 100%;
  }}
  .avatar-wrap {{
    width: 56px; height: 56px; border-radius: 50%;
    padding: 3px;
    background: linear-gradient(135deg, #B026FF, #7E1FB8);
    box-shadow: 0 6px 20px rgba(176,38,255,0.45), 0 0 0 1px rgba(255,255,255,0.08);
  }}
  .avatar-wrap img {{
    width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: block;
    background: #1a0a24;
  }}
  .pill {{
    margin-top: 4px;
    background: rgba(0,0,0,0.78);
    color: #fff;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    font-family: -apple-system, sans-serif;
    max-width: 160px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    border: 1px solid rgba(176,38,255,0.6);
    display: flex; align-items: center; gap: 6px;
  }}
  .pill .dot {{ width: 6px; height: 6px; border-radius: 50%; background:#B026FF; box-shadow: 0 0 6px #B026FF; flex-shrink: 0; }}
  .self .avatar-wrap {{ background: linear-gradient(135deg, #00E5FF, #B026FF); box-shadow: 0 6px 24px rgba(0,229,255,0.55); }}
  .host .avatar-wrap {{ background: linear-gradient(135deg, #FF1493, #B026FF); box-shadow: 0 6px 24px rgba(255,20,147,0.6); }}
  /* Hide Mapbox attribution for cleaner UI (still link in console per Mapbox ToS for free tier) */
  .mapboxgl-ctrl-bottom-right, .mapboxgl-ctrl-bottom-left {{ display: none !important; }}
</style>
</head><body>
<div id="map"></div>
<div id="status">Initializing globe…</div>
<script>
(function(){{
  mapboxgl.accessToken = {token!r};
  const meIdRef = {{ id: null }};
  const markers = {{}};
  let map;
  let userInteracting = false;
  let spinEnabled = true;
  function post(msg){{
    try {{
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {{
        window.ReactNativeWebView.postMessage(JSON.stringify(msg));
      }} else if (window.parent && window.parent !== window) {{
        window.parent.postMessage(msg, '*');
      }}
    }} catch(e) {{}}
  }}
  function makeBubbleEl(u){{
    const el = document.createElement('div');
    el.className = 'bubble' + (u.isSelf ? ' self' : '') + (u.host_session ? ' host' : '');
    const img = u.profile_image || ('https://placehold.co/100x100/1a0a24/B026FF?text=' + encodeURIComponent((u.display_name||'?').slice(0,1)));
    // current_track may arrive in two shapes:
    //  1) From local Spotify poll (self):  {{ item: {{ name, artists }} }}
    //  2) From server WS broadcast (others): {{ name, artists }} or {{ item: {{ name, artists }} }}
    const ct = u.current_track || {{}};
    const trackObj = ct.item || ct;
    const trackName = trackObj && trackObj.name ? String(trackObj.name) : '';
    const artistName = trackObj && Array.isArray(trackObj.artists) && trackObj.artists.length ? String(trackObj.artists[0].name || '') : '';
    const trackLabel = artistName ? (trackName + ' — ' + artistName) : trackName;
    const safeLabel = trackLabel.replace(/[<>&]/g, '');
    el.innerHTML = '<div class="avatar-wrap"><img src="'+img+'" onerror="this.src=\\'https://placehold.co/100x100/1a0a24/B026FF?text=?\\'" /></div>' +
                   (safeLabel ? '<div class="pill"><span class="dot"></span><span>'+safeLabel+'</span></div>' : '');
    el.addEventListener('click', () => post({{ type: 'marker:click', user_id: u.user_id }}));
    return el;
  }}
  function upsertMarker(u){{
    if (!u.lat || !u.lng) return;
    if (u.isSelf && !window.__flown) {{
      window.__flown = true;
      spinEnabled = false;
      // Cinematic fly from globe to user location
      map.flyTo({{ center: [u.lng, u.lat], zoom: 13.5, pitch: 45, speed: 0.7, curve: 1.6, essential: true }});
    }}
    const existing = markers[u.user_id];
    if (existing) {{
      // Replace contents in-place to update track/avatar without flicker
      existing.setLngLat([u.lng, u.lat]);
      const newEl = makeBubbleEl(u);
      const oldEl = existing.getElement();
      // Mapbox owns the parent container of getElement(); easiest to remove
      // and recreate the marker so the click handlers/anchor are correct.
      existing.remove();
      delete markers[u.user_id];
    }}
    const el = makeBubbleEl(u);
    const m = new mapboxgl.Marker({{ element: el, anchor: 'bottom' }})
      .setLngLat([u.lng, u.lat]).addTo(map);
    markers[u.user_id] = m;
  }}
  function setMarkersBulk(list){{
    const seen = new Set();
    (list||[]).forEach(u => {{ if (u && u.user_id) {{ seen.add(u.user_id); upsertMarker(u); }} }});
    // Remove markers that are no longer present in the latest snapshot
    Object.keys(markers).forEach(uid => {{ if (!seen.has(uid)) {{ markers[uid].remove(); delete markers[uid]; }} }});
  }}
  function removeMarker(uid){{
    const m = markers[uid];
    if (m) {{ m.remove(); delete markers[uid]; }}
  }}
  // RN -> map message bridge
  function handle(msg){{
    if (typeof msg === 'string') {{ try {{ msg = JSON.parse(msg); }} catch(e) {{ return; }} }}
    if (!msg || !msg.type) return;
    if (msg.type === 'me:set') meIdRef.id = msg.user_id;
    else if (msg.type === 'set_markers') setMarkersBulk(msg.markers);
    else if (msg.type === 'markers:bulk') setMarkersBulk(msg.users || msg.markers);
    else if (msg.type === 'marker:upsert') upsertMarker(msg.user);
    else if (msg.type === 'marker:remove') removeMarker(msg.user_id);
    else if (msg.type === 'center') {{
      if (!map) return;
      // Reset bearing to 0 (north up) and pitch to a tasteful 45° tilt so
      // the user re-orients no matter how badly they rotated the globe.
      // This makes "Locate Me" function as a true reset button.
      map.flyTo({{
        center: [msg.lng, msg.lat],
        zoom: msg.zoom || 14,
        pitch: 45,
        bearing: 0,
        speed: 1.2,
        curve: 1.5,
        essential: true
      }});
    }}
  }}
  window.__handle = handle;
  document.addEventListener('message', e => handle(e.data));
  window.addEventListener('message', e => handle(e.data));
  // Init globe
  map = new mapboxgl.Map({{
    container: 'map',
    style: 'mapbox://styles/mapbox/satellite-streets-v12',
    center: [20, 20],
    zoom: 1.4,
    projection: 'globe',
    pitch: 0,
    bearing: 0,
    attributionControl: false,
    antialias: true,
  }});
  map.on('style.load', () => {{
    // Snapchat-style atmospheric fog + stars in space
    map.setFog({{
      color: 'rgb(186, 210, 235)',
      'high-color': 'rgb(36, 92, 223)',
      'horizon-blend': 0.05,
      'space-color': 'rgb(8, 4, 18)',
      'star-intensity': 0.85
    }});
    document.getElementById('status').style.display = 'none';
    post({{ type: 'map:ready' }});
  }});
  map.on('error', (e) => {{
    const s = document.getElementById('status');
    s.textContent = 'Map error: ' + (e && e.error && e.error.message || 'unknown');
    s.style.color = '#FF4500';
  }});
  // Slow auto-rotation when idle and zoomed out (Snapchat-style ambient spin)
  function spinGlobe(){{
    if (!spinEnabled || userInteracting) return;
    const z = map.getZoom();
    if (z > 3) return; // stop spinning when user zoomed in
    const c = map.getCenter();
    c.lng = ((c.lng + 540) % 360) - 180; // normalize
    c.lng -= 6; // step
    map.easeTo({{ center: c, duration: 1500, easing: t => t }});
  }}
  map.on('moveend', spinGlobe);
  map.on('mousedown', () => {{ userInteracting = true; }});
  map.on('touchstart', () => {{ userInteracting = true; }});
  map.on('dragstart', () => {{ userInteracting = true; spinEnabled = false; }});
  map.on('zoomstart', () => {{ userInteracting = true; }});
  map.on('moveend', () => {{ userInteracting = false; }});
  // Kick off first spin once loaded
  map.once('load', () => setTimeout(spinGlobe, 800));
}})();
</script>
</body></html>"""
    return Response(content=html, media_type="text/html")


@api_router.get("/map.html")
async def map_html(key: str):
    """Serve the map HTML so the WebView gets a proper HTTPS origin
    (raw HTML strings get a `null` origin which Google Maps rejects)."""
    html = f"""<!DOCTYPE html>
<html><head>
<meta name="viewport" content="initial-scale=1.0, width=device-width, user-scalable=no" />
<style>
  html, body, #map {{ height: 100vh; width: 100vw; margin: 0; padding: 0; background:#05050A; overflow: hidden; }}
  /* PixelBlast pattern sits behind the map. With water layer set to
     visibility:off in the cloud-based map style, the map canvas is
     transparent over the oceans/lakes/rivers so the pulsing purple
     pattern shows through ONLY the water — land keeps its NFS palette. */
  #bg-pixels {{ position: fixed; inset: 0; width: 100vw; height: 100vh; border: 0; z-index: 0; pointer-events: none; opacity: 1; }}
  #map-wrap {{ position: relative; z-index: 1; width: 100vw; height: 100vh; }}
  #map {{ position: absolute; inset: 0; background: transparent !important; }}
  /* Markers / overlays should stay fully opaque, so we re-overlay them
     on a non-blended layer via Google Maps' floatPane. */
  #status {{ position: absolute; top:0; left:0; right:0; bottom:0; display:flex; align-items:center; justify-content:center; flex-direction:column; gap:10px; color:#fff; font-family:-apple-system,sans-serif; font-size:14px; text-align:center; padding:20px; pointer-events:none; z-index:2; }}
  #status .err {{ color:#FF4500; max-width: 80vw; word-break: break-word; }}
  .bubble {{ position: relative; display: flex; flex-direction: column; align-items: center; transform: translate(-50%, -100%); pointer-events: auto; cursor: pointer; }}
  .cluster {{ position: relative; transform: translate(-50%, -50%); pointer-events: auto; cursor: pointer; }}
  .cluster-circle {{ width: 52px; height: 52px; border-radius: 50%; background: rgba(176,38,255,0.92); color:#05050A; font: 800 17px -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; border: 2px solid #fff; box-shadow: 0 0 14px rgba(176,38,255,0.5), inset 0 0 0 2px rgba(255,255,255,0.18); }}
  .cluster-circle.lg {{ width: 62px; height: 62px; font-size: 19px; }}
  .avatar-wrap {{ width: 56px; height: 56px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #B026FF, #7E1FB8); box-sizing: border-box; }}
  .avatar-wrap.self {{ background: linear-gradient(135deg, #FF4500, #FF8A00); }}
  .avatar-wrap.hosting {{ background: linear-gradient(135deg, #B026FF, #00FFE0); }}
  .avatar-wrap.paused {{ background: rgba(255,255,255,0.25); }}
  .avatar {{ width: 50px; height: 50px; border-radius: 50%; background-size: cover; background-position: center; background-color: #12121A; box-sizing: border-box; }}
  .pill {{ margin-top: 6px; max-width: 160px; padding: 4px 10px; background: rgba(0,0,0,0.75); border: 1px solid rgba(255,255,255,0.1); border-radius: 999px; color: #fff; font: 600 11px -apple-system, BlinkMacSystemFont, sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 6px; }}
  .pill .dot {{ width:6px; height:6px; border-radius:50%; background:#B026FF; box-shadow:0 0 6px #B026FF;}}
  .pill.paused .dot {{ background: rgba(255,255,255,0.35); box-shadow:none; }}
  @keyframes pulse {{ 0%,100% {{ transform: scale(1); }} 50% {{ transform: scale(1.08); }} }}
</style>
</head><body>
<iframe id="bg-pixels" src="/api/pixelblast.html?variant=circle&pixelSize=2&color=%23B026FF&patternScale=1.2&patternDensity=1.6&pixelSizeJitter=0.4&enableRipples=0&liquid=0&speed=0.25&edgeFade=0" frameborder="0" scrolling="no"></iframe>
<div id="map-wrap"><div id="map"></div></div>
<div id="status">Initializing…</div>
<script>
  let map; let markers = {{}}; let meId = null;
  let clusterOverlays = [];
  const CLUSTER_PX = 80; // pixel proximity for clustering
  const CLUSTER_DISABLE_ZOOM = 13; // at >= this zoom, never cluster
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
      // Cinematic intro: open at globe-in-space view; we auto-fly to the
      // user's location when their first WS location update arrives.
      center: {{ lat: 20, lng: 0 }},
      zoom: 1.5,
      mapId: '2c42daaa74a7741732d7690f', // Vector map — enables globe view + tilt + heading
      mapTypeId: 'roadmap',  // CRITICAL: globe view only works with roadmap, not hybrid/satellite
      // Force LIGHT color scheme so the user's "NFS Neon" map style (saved
      // as Light mode in Cloud Console) is always applied, regardless of
      // device dark-mode preference. Without this, the device's system theme
      // would pick the Dark slot which is still Google's default.
      colorScheme: 'LIGHT',
      tilt: 0,
      heading: 0,
      disableDefaultUI: true,
      gestureHandling: 'greedy',
      backgroundColor: 'transparent', // canvas clear is transparent so PixelBlast iframe shows through hidden water layer
      isFractionalZoomEnabled: true,
      minZoom: 1,
      maxZoom: 20,
    }});
    map.addListener('idle', recomputeClusters);
    // Cinematic auto-fly to user once their location arrives. We trigger this
    // from upsertMarker the first time we see the self-marker.
    window.__flyToUser = function(lat, lng){{
      if (window.__flown) return;
      window.__flown = true;
      // Two-stage flight: zoom from 2 → 5 → 14 with smooth easing + tilt.
      try {{ map.panTo({{ lat: lat, lng: lng }}); }} catch(e) {{}}
      setTimeout(function(){{ try {{ map.setZoom(5); }} catch(e) {{}} }}, 700);
      setTimeout(function(){{ try {{ map.setZoom(10); map.setTilt(45); }} catch(e) {{}} }}, 1500);
      setTimeout(function(){{ try {{ map.setZoom(14); }} catch(e) {{}} }}, 2300);
    }};
    post({{ type: 'map:ready' }});
  }};
  function recomputeClusters(){{
    if (!map) return;
    const proj = map.getProjection();
    if (!proj) return;
    // Tear down previous cluster overlays
    clusterOverlays.forEach(c => c.setMap(null));
    clusterOverlays = [];
    const bubbles = Object.values(markers);
    const z = map.getZoom();
    if (z >= CLUSTER_DISABLE_ZOOM || bubbles.length < 2) {{
      bubbles.forEach(b => b.setMap(map));
      return;
    }}
    const scale = Math.pow(2, z);
    const points = bubbles.map(b => {{
      const w = proj.fromLatLngToPoint(b.position);
      return {{ b: b, x: w.x * scale, y: w.y * scale, used: false }};
    }});
    // Hide all individual bubbles; we'll re-add singletons below
    bubbles.forEach(b => b.setMap(null));
    for (let i = 0; i < points.length; i++) {{
      if (points[i].used) continue;
      const grp = [points[i]];
      points[i].used = true;
      for (let j = i + 1; j < points.length; j++) {{
        if (points[j].used) continue;
        const dx = points[i].x - points[j].x;
        const dy = points[i].y - points[j].y;
        if (Math.sqrt(dx*dx + dy*dy) < CLUSTER_PX) {{
          grp.push(points[j]);
          points[j].used = true;
        }}
      }}
      if (grp.length === 1) {{
        grp[0].b.setMap(map);
      }} else {{
        let lat = 0, lng = 0;
        grp.forEach(p => {{ lat += p.b.position.lat(); lng += p.b.position.lng(); }});
        lat /= grp.length; lng /= grp.length;
        const div = document.createElement('div');
        div.className = 'cluster';
        const sz = grp.length >= 5 ? 'lg' : '';
        div.innerHTML = '<div class="cluster-circle '+sz+'">'+grp.length+'</div>';
        div.addEventListener('click', () => {{
          map.panTo({{ lat: lat, lng: lng }});
          map.setZoom(Math.min((map.getZoom() || 12) + 2, 18));
        }});
        const cm = new AdvancedBubble(new google.maps.LatLng(lat, lng), map, div);
        clusterOverlays.push(cm);
      }}
    }}
  }}
  function upsertMarker(u) {{
    if (!u.lat || !u.lng) return;
    // Cinematic auto-fly: when our own (self) location arrives for the first
    // time, smoothly transition from globe-in-space → user's location.
    if (u.user_id && meId && u.user_id === meId && window.__flyToUser) {{
      window.__flyToUser(u.lat, u.lng);
    }}
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
    marker.__el.innerHTML = '<div class="'+classes.join(' ')+'"><div class="avatar" style="background-image:url('+img+')"></div></div>' + (title && playing ? '<div class="pill"><span class="dot"></span><span>'+escapeHtml(title)+'</span></div>' : '');
  }}
  function escapeHtml(s){{ return (s||'').replace(/[&<>"']/g,c=>({{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}}[c])); }}
  function removeMarker(uid){{ if(markers[uid]){{ markers[uid].setMap(null); delete markers[uid]; }} }}
  function handle(data) {{
    if (data.type === 'set_self') {{ meId = data.user_id; }}
    else if (data.type === 'set_markers') {{
      const keep = new Set();
      (data.markers || []).forEach(m => {{ upsertMarker(m); keep.add(m.user_id); }});
      Object.keys(markers).forEach(id => {{ if (!keep.has(id)) removeMarker(id); }});
      recomputeClusters();
    }} else if (data.type === 'center') {{
      if (map) {{
        map.panTo({{ lat: data.lat, lng: data.lng }});
        if (typeof data.zoom === 'number') map.setZoom(data.zoom);
      }}
    }}
  }}
  window.__handle = handle;
  window.addEventListener('message', (e) => {{ try {{ const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; handle(d); }} catch(_){{}} }});
  document.addEventListener('message', (e) => {{ try {{ const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; handle(d); }} catch(_){{}} }});
  function AdvancedBubble(position, map, el){{ this.position = position; this.el = el; this.setMap(map); }}
  const DARK_STYLE = [
    {{elementType:'geometry',stylers:[{{color:'#0a0414'}}]}},
    {{elementType:'labels.text.stroke',stylers:[{{color:'#0a0414'}}]}},
    {{elementType:'labels.text.fill',stylers:[{{color:'#8a6fb3'}}]}},
    {{featureType:'administrative',elementType:'geometry.stroke',stylers:[{{color:'#3a1a52'}}]}},
    {{featureType:'poi',elementType:'labels',stylers:[{{visibility:'off'}}]}},
    {{featureType:'poi.park',elementType:'geometry',stylers:[{{color:'#1a0a24'}}]}},
    {{featureType:'road',elementType:'geometry',stylers:[{{color:'#1c0e2c'}}]}},
    {{featureType:'road',elementType:'labels.text.fill',stylers:[{{color:'#a78bd1'}}]}},
    {{featureType:'road.highway',elementType:'geometry',stylers:[{{color:'#321647'}}]}},
    {{featureType:'road.highway',elementType:'geometry.stroke',stylers:[{{color:'#5a2a85'}}]}},
    {{featureType:'transit',elementType:'geometry',stylers:[{{color:'#190a25'}}]}},
    {{featureType:'water',elementType:'geometry',stylers:[{{color:'#03000a'}}]}},
    {{featureType:'water',elementType:'labels.text.fill',stylers:[{{color:'#5a3d80'}}]}},
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
    # If the same user_id already has an open socket, close the stale one first
    stale = state.connections.get(user_id)
    if stale is not None and stale is not websocket:
        try:
            await stale.close(code=1000)
        except Exception:
            pass
    state.connections[user_id] = websocket
    state.upsert_user(user_id, display_name=display_name, profile_image=profile_image)

    # Send current users snapshot to new connection
    try:
        await websocket.send_json({"type": "users:snapshot", "users": state.public_users()})
        # Notify everyone a new user is online — include any lat/lng we already know
        existing = state.users.get(user_id)
        await broadcast({"type": "user:online", "user": {
            "user_id": user_id,
            "display_name": display_name,
            "profile_image": profile_image,
            "lat": existing.lat if existing else None,
            "lng": existing.lng if existing else None,
            "current_track": existing.current_track if existing else None,
            "is_playing": existing.is_playing if existing else False,
        }}, exclude=user_id)

        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "location:update":
                lat = float(data.get("lat"))
                lng = float(data.get("lng"))
                state.upsert_user(user_id, lat=lat, lng=lng)
                u = state.users.get(user_id)
                # Broadcast full user payload so late-joiners (who only got a
                # lightweight user:online) can populate the avatar on their map.
                await broadcast({
                    "type": "location:update",
                    "user_id": user_id,
                    "lat": lat,
                    "lng": lng,
                    "display_name": u.display_name if u else display_name,
                    "profile_image": u.profile_image if u else profile_image,
                    "current_track": u.current_track if u else None,
                    "is_playing": u.is_playing if u else False,
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

            elif msg_type == "reaction:send":
                target_id = data.get("target_user_id")
                emoji = data.get("emoji")
                if target_id and emoji:
                    sender = state.users.get(user_id)
                    await send_to(target_id, {
                        "type": "reaction:incoming",
                        "emoji": emoji,
                        "from_user_id": user_id,
                        "from_display_name": sender.display_name if sender else "Someone",
                        "from_profile_image": sender.profile_image if sender else None,
                    })

            elif msg_type == "session:queue_add":
                track_uri = data.get("track_uri")
                track_name = data.get("track_name") or ""
                host_id = state.guest_to_host.get(user_id)
                if host_id and track_uri:
                    guest = state.users.get(user_id)
                    await send_to(host_id, {
                        "type": "session:queue_add",
                        "track_uri": track_uri,
                        "track_name": track_name,
                        "from_user_id": user_id,
                        "from_display_name": guest.display_name if guest else "Guest",
                        "from_profile_image": guest.profile_image if guest else None,
                    })

            elif msg_type == "user:set_visibility":
                # Allow user to go ghost / come back online
                visible = bool(data.get("visible", True))
                user = state.users.get(user_id)
                if user is not None:
                    setattr(user, "visible", visible)
                if visible:
                    # Re-broadcast online with last known data
                    u = state.users.get(user_id)
                    if u:
                        await broadcast({"type": "user:online", "user": {
                            "user_id": user_id,
                            "display_name": u.display_name,
                            "profile_image": u.profile_image,
                            "lat": u.lat,
                            "lng": u.lng,
                            "current_track": u.current_track,
                            "is_playing": u.is_playing,
                        }}, exclude=user_id)
                else:
                    await broadcast({"type": "user:offline", "user_id": user_id}, exclude=user_id)

            elif msg_type == "ping":
                await websocket.send_json({"type": "pong", "ts": time.time()})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.exception(f"WS error for {user_id}: {e}")
    finally:
        # Only drop the connection; keep user state so a quick reconnect
        # (mobile background/resume, tunnel flaps) doesn't yank them off the
        # map for everyone else. The 120s stale-prune in public_users() will
        # clean truly-gone users.
        state.drop_connection(user_id)


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
