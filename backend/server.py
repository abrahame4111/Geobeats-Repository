from fastapi import FastAPI, APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Query, Header, Request
from fastapi.responses import RedirectResponse, JSONResponse, HTMLResponse, Response, FileResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import CursorType
from pymongo.errors import CollectionInvalid
import os
import logging
import json
import asyncio
import base64
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Any
import uuid
from datetime import datetime, timezone
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Spotify Configuration
SPOTIFY_CLIENT_ID = os.environ['SPOTIFY_CLIENT_ID']
SPOTIFY_CLIENT_SECRET = os.environ['SPOTIFY_CLIENT_SECRET']
SPOTIFY_REDIRECT_URI = os.environ['SPOTIFY_REDIRECT_URI']

# Google Maps Configuration
GOOGLE_MAPS_API_KEY = os.environ.get('GOOGLE_MAPS_API_KEY', '')

# Optional: protects the debug endpoint. Set this in your env and pass it as
# ?token=... when hitting /api/debug/state from a device you can't attach logs to.
DEBUG_TOKEN = os.environ.get('DEBUG_TOKEN')

# How long a now-playing song can go unrefreshed before we clear it from the
# user's marker. This is what fixes "song stays on the map after it stopped" -
# previously nothing ever expired this field.
STALE_SONG_SECONDS = int(os.environ.get('STALE_SONG_SECONDS', '90'))
# How long a user can go without any update before we consider them offline
# and drop them (covers apps killed/backgrounded without a clean disconnect).
STALE_USER_SECONDS = int(os.environ.get('STALE_USER_SECONDS', '180'))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Unique id per running process - only used in logs, to make it obvious when
# two testers are (or aren't) talking to the same instance.
INSTANCE_ID = str(uuid.uuid4())[:8]

LIVE_USERS_COLLECTION = "live_users"
LISTEN_SESSIONS_COLLECTION = "listen_sessions"
EVENTS_COLLECTION = "realtime_events"

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def now_ts() -> float:
    return datetime.now(timezone.utc).timestamp()

# ---------------------------------------------------------------------------
# Event bus: every "broadcast" writes an event into a capped Mongo collection.
# Every process (this one included) tails that collection and does the actual
# local WebSocket delivery when it reads an event back out.
#
# This is what makes real-time updates work no matter how many instances/
# workers you're running - previously, delivery only ever reached whichever
# single process happened to hold the sender's and recipient's WebSocket
# connections, which is very likely NOT the same process across two different
# app builds/devices.
# ---------------------------------------------------------------------------
class EventBus:
    def __init__(self, connection_manager: "ConnectionManager"):
        self.connection_manager = connection_manager
        self._tail_task: Optional[asyncio.Task] = None

    async def ensure_capped_collection(self):
        try:
            await db.create_collection(EVENTS_COLLECTION, capped=True, size=5 * 1024 * 1024, max=5000)
            logger.info(f"[{INSTANCE_ID}] Created capped collection {EVENTS_COLLECTION}")
        except CollectionInvalid:
            pass  # already exists

    async def publish(self, event_type: str, payload: Dict[str, Any]):
        await db[EVENTS_COLLECTION].insert_one({
            "type": event_type,
            "payload": payload,
            "created_at": now_iso(),
        })

    def start(self):
        self._tail_task = asyncio.create_task(self._tail_forever())

    def stop(self):
        if self._tail_task:
            self._tail_task.cancel()

    async def _tail_forever(self):
        coll = db[EVENTS_COLLECTION]
        latest = await coll.find_one(sort=[("_id", -1)])
        last_id = latest["_id"] if latest else None
        logger.info(f"[{INSTANCE_ID}] Event tailer starting after _id={last_id}")

        while True:
            try:
                query = {"_id": {"$gt": last_id}} if last_id else {}
                cursor = coll.find(query, cursor_type=CursorType.TAILABLE_AWAIT)
                async for doc in cursor:
                    last_id = doc["_id"]
                    await self._dispatch(doc)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error(f"[{INSTANCE_ID}] Event tailer error, retrying: {e}")
                await asyncio.sleep(1)

    async def _dispatch(self, doc: Dict[str, Any]):
        event_type = doc.get("type")
        payload = doc.get("payload", {})
        cm = self.connection_manager
        try:
            if event_type == "location_update":
                await cm._deliver_location_update(payload)
            elif event_type == "online_count_update":
                await cm._deliver_online_count(payload)
            elif event_type == "listen_together":
                await cm._deliver_listen_together(payload)
            elif event_type == "direct_message":
                await cm._deliver_direct_message(payload)
        except Exception as e:
            logger.error(f"[{INSTANCE_ID}] Failed dispatching event {event_type}: {e}")


class ListenTogetherManager:
    """
    Mongo-backed so any instance can create/join/update a session regardless
    of which instance the host is actually connected to. The old version kept
    sessions in a plain dict, so a join request landing on a different process
    than the host's would always 404.
    """

    def __init__(self):
        self.collection = db[LISTEN_SESSIONS_COLLECTION]

    async def create_session(self, host_id: str, track_uri: str, track_info: Dict) -> str:
        session_id = str(uuid.uuid4())[:8]
        doc = {
            "session_id": session_id,
            "host_id": host_id,
            "participants": [host_id],
            "current_track_uri": track_uri,
            "track_info": track_info,
            "position_ms": 0,
            "is_playing": True,
            "created_at": now_iso(),
        }
        await self.collection.insert_one(doc)
        logger.info(f"[{INSTANCE_ID}] 🎵 Listen Together session created: {session_id} by {host_id}")
        return session_id

    async def join_session(self, user_id: str, session_id: str) -> Optional[Dict]:
        session = await self.collection.find_one({"session_id": session_id})
        if not session:
            return None
        await self.collection.update_one(
            {"session_id": session_id},
            {"$addToSet": {"participants": user_id}},
        )
        # also drop the user from any other session they were in
        await self.collection.update_many(
            {"session_id": {"$ne": session_id}, "participants": user_id},
            {"$pull": {"participants": user_id}},
        )
        logger.info(f"[{INSTANCE_ID}] 🎧 User {user_id} joined session {session_id}")
        return await self.collection.find_one({"session_id": session_id})

    async def leave_session(self, user_id: str):
        session = await self.collection.find_one({"participants": user_id})
        if not session:
            return
        session_id = session["session_id"]
        if user_id == session["host_id"]:
            await self.collection.delete_one({"session_id": session_id})
            logger.info(f"[{INSTANCE_ID}] 🔚 Session {session_id} ended (host left)")
            return
        await self.collection.update_one(
            {"session_id": session_id},
            {"$pull": {"participants": user_id}},
        )
        remaining = await self.collection.find_one({"session_id": session_id})
        if remaining and len(remaining.get("participants", [])) == 0:
            await self.collection.delete_one({"session_id": session_id})
            logger.info(f"[{INSTANCE_ID}] 🔚 Session {session_id} ended (empty)")

    async def update_playback(self, session_id: str, track_uri: str, track_info: Dict, position_ms: int, is_playing: bool) -> Optional[Dict]:
        result = await self.collection.find_one_and_update(
            {"session_id": session_id},
            {"$set": {
                "current_track_uri": track_uri,
                "track_info": track_info,
                "position_ms": position_ms,
                "is_playing": is_playing,
            }},
            return_document=True,
        )
        return result

    async def get_session(self, session_id: str) -> Optional[Dict]:
        return await self.collection.find_one({"session_id": session_id})

    async def get_user_session(self, user_id: str) -> Optional[Dict]:
        return await self.collection.find_one({"participants": user_id})


listen_together_manager = ListenTogetherManager()


class ConnectionManager:
    """
    Local WebSocket connections stay in-process (they have to - a socket
    object can't be shared across processes). Everything else - who's
    online, where they are, what they're playing - is mirrored to Mongo so
    it's true globally, and delivery to OTHER processes happens through the
    EventBus rather than being silently dropped.
    """

    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.live_users = db[LIVE_USERS_COLLECTION]
        self.event_bus = EventBus(self)
        self._stale_task: Optional[asyncio.Task] = None

    def set_event_bus_started(self):
        self.event_bus.start()
        self._stale_task = asyncio.create_task(self._expire_stale_loop())

    def shutdown(self):
        self.event_bus.stop()
        if self._stale_task:
            self._stale_task.cancel()

    async def connect(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        self.active_connections[user_id] = websocket
        logger.info(f"[{INSTANCE_ID}] 🔗 User {user_id} connected. Local connections: {len(self.active_connections)}")

        await self.live_users.update_one(
            {"user_id": user_id},
            {"$set": {"connected_at": now_iso(), "instance_id": INSTANCE_ID}},
            upsert=True,
        )

        # Build initial_state from Mongo (global truth), not just this
        # process's local dict, so a brand-new connection immediately sees
        # every user who's online anywhere, not just on this instance.
        locations = {}
        cursor = self.live_users.find({"location": {"$exists": True}})
        async for doc in cursor:
            locations[doc["user_id"]] = doc["location"]

        online_count = await self.live_users.count_documents({})
        online_users = [d["user_id"] async for d in self.live_users.find({}, {"user_id": 1})]

        initial_message = {
            "type": "initial_state",
            "locations": locations,
            "online_count": online_count,
            "online_users": online_users,
        }
        await websocket.send_text(json.dumps(initial_message))

        await self.event_bus.publish("online_count_update", {
            "online_count": online_count,
            "online_users": online_users,
        })

    async def disconnect(self, user_id: str):
        if user_id in self.active_connections:
            del self.active_connections[user_id]
            logger.info(f"[{INSTANCE_ID}] ❌ User {user_id} disconnected locally. Remaining local: {len(self.active_connections)}")

        await self.live_users.delete_one({"user_id": user_id})
        await listen_together_manager.leave_session(user_id)

        online_count = await self.live_users.count_documents({})
        online_users = [d["user_id"] async for d in self.live_users.find({}, {"user_id": 1})]
        await self.event_bus.publish("online_count_update", {
            "online_count": online_count,
            "online_users": online_users,
        })

    async def update_location(self, user_id: str, message: Dict):
        """
        Handles a location_update message from the client. Only touches the
        song fields if the client actually sent song info - and separately
        tracks when the song was last confirmed playing, so we can expire it
        if updates stop arriving (see _expire_stale_loop).
        """
        existing = await self.live_users.find_one({"user_id": user_id}) or {}
        existing_location = existing.get("location", {})

        has_song = bool(message.get("current_song"))

        location_data = {
            "lat": message.get("latitude") or message.get("lat"),
            "lng": message.get("longitude") or message.get("lng"),
            "user_id": user_id,
            "user_name": message.get("user_name"),
            "current_song": message.get("current_song") if has_song else None,
            "artist": message.get("artist") if has_song else None,
            "album_cover": message.get("album_cover") if has_song else None,
            "profile_image": message.get("profile_image", existing_location.get("profile_image")),
            "track_uri": message.get("track_uri") if has_song else None,
            "is_premium": message.get("is_premium", False),
            "listen_session_id": (await listen_together_manager.get_user_session(user_id) or {}).get("session_id"),
            "last_updated": now_iso(),
        }

        update_fields = {"location": location_data, "last_location_update": now_ts()}
        if has_song:
            update_fields["last_song_update"] = now_ts()

        await self.live_users.update_one(
            {"user_id": user_id},
            {"$set": update_fields},
            upsert=True,
        )

        online_count = await self.live_users.count_documents({})
        await self.event_bus.publish("location_update", {
            "user_id": user_id,
            "location": location_data,
            "online_count": online_count,
            "timestamp": now_iso(),
        })

    async def clear_now_playing(self, user_id: str):
        """
        Lets the client immediately clear its own marker's song info the
        moment it detects playback stopped, instead of waiting up to
        STALE_SONG_SECONDS for the server-side expiry to catch it.
        """
        doc = await self.live_users.find_one({"user_id": user_id})
        if not doc or "location" not in doc:
            return
        location_data = doc["location"]
        location_data.update({
            "current_song": None,
            "artist": None,
            "album_cover": None,
            "track_uri": None,
            "last_updated": now_iso(),
        })
        await self.live_users.update_one(
            {"user_id": user_id},
            {"$set": {"location": location_data}, "$unset": {"last_song_update": ""}},
        )
        await self.event_bus.publish("location_update", {
            "user_id": user_id,
            "location": location_data,
            "online_count": await self.live_users.count_documents({}),
            "timestamp": now_iso(),
        })

    async def _expire_stale_loop(self):
        """
        Background sweep: clears song info that hasn't been refreshed in
        STALE_SONG_SECONDS, and drops users who've gone fully silent for
        STALE_USER_SECONDS (covers apps killed without a clean WS close).
        This is the direct fix for bug #1 - previously nothing ever expired.
        """
        while True:
            try:
                await asyncio.sleep(15)
                cutoff_song = now_ts() - STALE_SONG_SECONDS
                cutoff_user = now_ts() - STALE_USER_SECONDS

                stale_song_cursor = self.live_users.find({
                    "last_song_update": {"$lt": cutoff_song},
                    "location.current_song": {"$ne": None},
                })
                async for doc in stale_song_cursor:
                    logger.info(f"[{INSTANCE_ID}] Expiring stale now-playing for {doc['user_id']}")
                    await self.clear_now_playing(doc["user_id"])

                stale_user_cursor = self.live_users.find({"last_location_update": {"$lt": cutoff_user}})
                async for doc in stale_user_cursor:
                    logger.info(f"[{INSTANCE_ID}] Dropping stale user {doc['user_id']} (no updates)")
                    await self.disconnect(doc["user_id"])
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error(f"[{INSTANCE_ID}] Stale-expiry loop error: {e}")

    async def broadcast_listen_together(self, session_id: str, event_type: str, data: Dict):
        session = await listen_together_manager.get_session(session_id)
        if not session:
            return
        await self.event_bus.publish("listen_together", {
            "event": event_type,
            "session_id": session_id,
            "data": data,
            "participants": session["participants"],
            "timestamp": now_iso(),
        })

    async def send_to_user(self, user_id: str, message: Dict):
        await self.event_bus.publish("direct_message", {
            "target_user_id": user_id,
            "message": message,
        })

    # -- Local delivery (called by EventBus tailer on every instance) -------

    async def _deliver_location_update(self, payload: Dict):
        message = json.dumps({"type": "location_update", **payload})
        await self._send_to_all_local(message)

    async def _deliver_online_count(self, payload: Dict):
        message = json.dumps({"type": "online_count_update", **payload})
        await self._send_to_all_local(message)

    async def _deliver_listen_together(self, payload: Dict):
        message = json.dumps({
            "type": "listen_together",
            "event": payload["event"],
            "session_id": payload["session_id"],
            "data": payload["data"],
            "timestamp": payload["timestamp"],
        })
        for participant_id in payload.get("participants", []):
            ws = self.active_connections.get(participant_id)
            if ws:
                try:
                    await ws.send_text(message)
                except Exception as e:
                    logger.error(f"[{INSTANCE_ID}] Failed sending listen_together to {participant_id}: {e}")

    async def _deliver_direct_message(self, payload: Dict):
        target_user_id = payload["target_user_id"]
        ws = self.active_connections.get(target_user_id)
        if ws:
            try:
                await ws.send_text(json.dumps(payload["message"]))
            except Exception as e:
                logger.error(f"[{INSTANCE_ID}] Failed sending direct message to {target_user_id}: {e}")

    async def _send_to_all_local(self, message: str):
        disconnected = []
        for uid, connection in list(self.active_connections.items()):
            try:
                await connection.send_text(message)
            except Exception as e:
                logger.error(f"[{INSTANCE_ID}] ❌ Failed to send to {uid}: {e}")
                disconnected.append(uid)
        for uid in disconnected:
            await self.disconnect(uid)


manager = ConnectionManager()

# Create the main app
app = FastAPI(title="GeoBeats", version="2.0.0")

# Create API router
api_router = APIRouter(prefix="/api")

# Models
class User(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    spotify_id: str
    display_name: Optional[str] = None
    email: Optional[str] = None
    access_token: str
    refresh_token: str
    token_expires_at: datetime
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class LocationUpdate(BaseModel):
    lat: float
    lng: float
    current_track: Optional[Dict] = None
    timestamp: Optional[str] = None

class RefreshTokenRequest(BaseModel):
    refresh_token: str


# ---------------------------------------------------------------------------
# Spotify OAuth endpoints
# ---------------------------------------------------------------------------

def _resolve_public_base(request: Request) -> str:
    """Reconstruct the public https://host base URL from the incoming request.

    Honors reverse-proxy headers (X-Forwarded-Proto / X-Forwarded-Host) set
    by Emergent's Cloudflare ingress so this works identically on the preview
    domain AND the deployed/production domain — no env-var swap needed on
    publish. The redirect_uri sent to Spotify (and used again during the
    token exchange) is derived from this, so OAuth "just works" regardless
    of which environment the request originated from — as long as that
    domain's callback URL is registered in the Spotify Dashboard.
    """
    proto = (
        request.headers.get("x-forwarded-proto")
        or request.url.scheme
        or "https"
    )
    host = (
        request.headers.get("x-forwarded-host")
        or request.headers.get("host")
        or request.url.netloc
    )
    return f"{proto}://{host}"


def _resolve_redirect_uri(request: Request) -> str:
    # Uses the /api/spotify/callback path since that's what's registered
    # in the Spotify Developer Dashboard today.
    return f"{_resolve_public_base(request)}/api/spotify/callback"


@api_router.get("/auth/login")
async def spotify_login(request: Request, mobile_redirect: Optional[str] = Query(None)):
    """
    Initiate Spotify OAuth flow.
    - If mobile_redirect is provided, encodes it in the OAuth state so the
      callback can redirect back to the mobile app deep link.
    - Without mobile_redirect, redirects the browser straight to Spotify
      (used by web clients that open this URL in a popup or tab).
    """
    scope = "user-read-private user-read-email user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative streaming"

    state = ""
    if mobile_redirect:
        state = base64.urlsafe_b64encode(mobile_redirect.encode()).decode()

    redirect_uri = _resolve_redirect_uri(request)

    from urllib.parse import urlencode
    params = {
        "client_id": SPOTIFY_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "scope": scope,
    }
    if state:
        params["state"] = state

    auth_url = f"https://accounts.spotify.com/authorize?{urlencode(params)}"

    if mobile_redirect:
        # Return JSON so the mobile app can open the URL in WebBrowser
        return JSONResponse({"auth_url": auth_url})

    # Web: do a direct browser redirect
    return RedirectResponse(url=auth_url)


# Keep legacy path so existing TestFlight builds still work
@api_router.get("/spotify/login")
async def spotify_login_legacy(request: Request, mobile_redirect: Optional[str] = Query(None)):
    return await spotify_login(request, mobile_redirect=mobile_redirect)


@api_router.get("/auth/callback")
async def spotify_callback(request: Request, code: str = Query(...), state: Optional[str] = Query(None)):
    """Handle Spotify OAuth callback"""
    try:
        # Must be the exact same redirect_uri sent during /auth/login —
        # Spotify rejects the token exchange otherwise.
        redirect_uri = _resolve_redirect_uri(request)
        async with httpx.AsyncClient() as http_client:
            response = await http_client.post(
                "https://accounts.spotify.com/api/token",
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": redirect_uri,
                    "client_id": SPOTIFY_CLIENT_ID,
                    "client_secret": SPOTIFY_CLIENT_SECRET,
                },
            )

            if response.status_code != 200:
                raise HTTPException(status_code=400, detail="Failed to get access token")

            token_data = response.json()
            access_token = token_data["access_token"]
            refresh_token = token_data["refresh_token"]
            expires_in = token_data["expires_in"]

            profile_response = await http_client.get(
                "https://api.spotify.com/v1/me",
                headers={"Authorization": f"Bearer {access_token}"}
            )

            if profile_response.status_code != 200:
                raise HTTPException(status_code=400, detail="Failed to get user profile")

            profile = profile_response.json()

            user_data = {
                "spotify_id": profile["id"],
                "display_name": profile.get("display_name"),
                "email": profile.get("email"),
                "access_token": access_token,
                "refresh_token": refresh_token,
                "token_expires_at": now_ts() + expires_in,
                "updated_at": now_iso()
            }

            await db.users.update_one(
                {"spotify_id": profile["id"]},
                {"$set": user_data},
                upsert=True
            )

            from urllib.parse import urlencode as ue

            images = profile.get("images") or []
            profile_image = images[0]["url"] if images else ""

            auth_params = {
                "access_token": access_token,
                "refresh_token": refresh_token,
                "expires_in": str(expires_in),
                "user_id": profile["id"],
                "display_name": profile.get("display_name", "") or profile["id"],
                "profile_image": profile_image,
                "product": profile.get("product", "free"),
            }

            # If state encodes a mobile deep link, redirect there
            if state:
                try:
                    mobile_redirect = base64.urlsafe_b64decode(state.encode()).decode()
                    sep = "&" if "?" in mobile_redirect else "?"
                    redirect_url = f"{mobile_redirect}{sep}{ue(auth_params)}"
                    logger.info(f"Mobile OAuth redirect → {mobile_redirect}")
                    return RedirectResponse(url=redirect_url)
                except Exception:
                    pass

            # Web fallback — route to /auth-success (handles both popup
            # postMessage-to-opener and top-level redirect flows).
            redirect_url = f"{_resolve_public_base(request)}/auth-success?{ue(auth_params)}"
            logger.info(f"Web OAuth redirect → {redirect_url}")
            return RedirectResponse(url=redirect_url)

    except Exception as e:
        logger.error(f"OAuth callback error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Keep legacy path so existing TestFlight builds still work
@api_router.get("/spotify/callback")
async def spotify_callback_legacy(request: Request, code: str = Query(...), state: Optional[str] = Query(None)):
    return await spotify_callback(request, code=code, state=state)


@api_router.post("/auth/refresh")
async def refresh_token(body: RefreshTokenRequest):
    """Refresh Spotify access token"""
    try:
        async with httpx.AsyncClient() as http_client:
            response = await http_client.post(
                "https://accounts.spotify.com/api/token",
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": body.refresh_token,
                    "client_id": SPOTIFY_CLIENT_ID,
                    "client_secret": SPOTIFY_CLIENT_SECRET,
                },
            )

            if response.status_code != 200:
                raise HTTPException(status_code=400, detail="Failed to refresh token")

            token_data = response.json()
            return {
                "access_token": token_data["access_token"],
                "expires_in": token_data["expires_in"]
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Keep legacy path
@api_router.post("/spotify/refresh")
async def refresh_token_legacy(body: RefreshTokenRequest):
    return await refresh_token(body)


# ---------------------------------------------------------------------------
# Spotify API endpoints
# ---------------------------------------------------------------------------

@api_router.get("/spotify/me")
async def get_current_user(authorization: str = Header(...)):
    try:
        access_token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(
                "https://api.spotify.com/v1/me",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail="Failed to get user")
            return response.json()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching Spotify profile: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/spotify/premium-status")
async def check_premium_status(authorization: str = Header(...)):
    try:
        access_token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(
                "https://api.spotify.com/v1/me",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail="Failed to get user")
            profile = response.json()
            product = profile.get("product", "free")
            is_premium = product == "premium"
            logger.info(f"🎫 User {profile.get('id')} product: {product}, is_premium: {is_premium}")
            return {
                "is_premium": is_premium,
                "product": product,
                "user_id": profile.get("id"),
                "display_name": profile.get("display_name")
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error checking premium status: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/spotify/playlists")
async def get_user_playlists(access_token: str = Query(...)):
    try:
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(
                "https://api.spotify.com/v1/me/playlists?limit=50",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail="Failed to get playlists")
            return response.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/spotify/categories")
async def get_categories(access_token: str = Query(...)):
    try:
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(
                "https://api.spotify.com/v1/browse/categories?limit=50",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail="Failed to get categories")
            return response.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/spotify/currently-playing")
async def get_currently_playing(authorization: str = Header(None), access_token: str = Query(None)):
    try:
        token = None
        if authorization:
            token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
        elif access_token:
            token = access_token
        else:
            raise HTTPException(status_code=400, detail="Authorization required")
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(
                "https://api.spotify.com/v1/me/player/currently-playing",
                headers={"Authorization": f"Bearer {token}"}
            )
            if response.status_code == 204:
                return {"is_playing": False}
            if response.status_code != 200:
                return {"is_playing": False}
            return response.json()
    except Exception as e:
        logger.error(f"Error fetching currently playing: {str(e)}")
        return {"is_playing": False}

@api_router.get("/spotify/player")
async def get_player_state(authorization: str = Header(None), access_token: str = Query(None)):
    try:
        token = None
        if authorization:
            token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
        elif access_token:
            token = access_token
        else:
            raise HTTPException(status_code=400, detail="Authorization required")
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(
                "https://api.spotify.com/v1/me/player",
                headers={"Authorization": f"Bearer {token}"}
            )
            if response.status_code == 204:
                return {"is_playing": False, "device": None}
            if response.status_code != 200:
                return {"is_playing": False, "device": None}
            return response.json()
    except Exception as e:
        logger.error(f"Error fetching player state: {str(e)}")
        return {"is_playing": False, "device": None}

@api_router.get("/spotify/devices")
async def get_devices(authorization: str = Header(None), access_token: str = Query(None)):
    try:
        token = None
        if authorization:
            token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
        elif access_token:
            token = access_token
        else:
            raise HTTPException(status_code=400, detail="Authorization required")
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(
                "https://api.spotify.com/v1/me/player/devices",
                headers={"Authorization": f"Bearer {token}"}
            )
            if response.status_code != 200:
                return {"devices": []}
            return response.json()
    except Exception as e:
        logger.error(f"Error fetching devices: {str(e)}")
        return {"devices": []}

@api_router.get("/spotify/queue")
async def get_queue(access_token: str = Query(...)):
    try:
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(
                "https://api.spotify.com/v1/me/player/queue",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            if response.status_code != 200:
                return {"queue": []}
            return response.json()
    except Exception as e:
        return {"queue": []}

@api_router.put("/spotify/play")
async def play_track(authorization: str = Header(...), uri: Optional[str] = None, position_ms: Optional[int] = 0):
    try:
        access_token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
        logger.info(f"🎵 Play request - URI: {uri}, position_ms: {position_ms}")
        async with httpx.AsyncClient() as http_client:
            devices_response = await http_client.get(
                "https://api.spotify.com/v1/me/player/devices",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            devices_data = devices_response.json() if devices_response.status_code == 200 else {"devices": []}
            active_devices = devices_data.get("devices", [])
            logger.info(f"🔊 Available devices: {len(active_devices)}")

            if not active_devices:
                logger.warning("No active Spotify devices found")
                return {"success": False, "error": "No active Spotify device found. Please open Spotify on your phone or computer."}

            device_id = None
            for device in active_devices:
                if device.get("is_active"):
                    device_id = device.get("id")
                    break
            if not device_id and active_devices:
                device_id = active_devices[0].get("id")

            body = {}
            if uri:
                body["uris"] = [uri]
            if position_ms:
                body["position_ms"] = position_ms

            play_url = "https://api.spotify.com/v1/me/player/play"
            if device_id:
                play_url += f"?device_id={device_id}"

            logger.info(f"🎵 Sending play request to {play_url} with body: {body}")

            response = await http_client.put(
                play_url,
                headers={"Authorization": f"Bearer {access_token}"},
                json=body if body else None
            )

            logger.info(f"🎵 Play response: {response.status_code}")

            if response.status_code in [204, 200, 202]:
                return {"success": True, "device_id": device_id}
            elif response.status_code == 404:
                return {"success": False, "error": "No active device found. Please open Spotify."}
            elif response.status_code == 403:
                return {"success": False, "error": "Premium required for playback control."}
            else:
                error_text = response.text
                logger.error(f"Play failed: {response.status_code} - {error_text}")
                return {"success": False, "error": f"Playback failed: {error_text}"}
    except Exception as e:
        logger.error(f"Play error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.put("/spotify/pause")
async def pause_playback(authorization: str = Header(...)):
    try:
        access_token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
        async with httpx.AsyncClient() as http_client:
            response = await http_client.put(
                "https://api.spotify.com/v1/me/player/pause",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            return {"success": response.status_code in [204, 200]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/spotify/next")
async def next_track(authorization: str = Header(...)):
    try:
        access_token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
        async with httpx.AsyncClient() as http_client:
            response = await http_client.post(
                "https://api.spotify.com/v1/me/player/next",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            return {"success": response.status_code in [204, 200]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/spotify/previous")
async def previous_track(authorization: str = Header(...)):
    try:
        access_token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
        async with httpx.AsyncClient() as http_client:
            response = await http_client.post(
                "https://api.spotify.com/v1/me/player/previous",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            return {"success": response.status_code in [204, 200]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.put("/spotify/seek")
async def seek_to_position(authorization: str = Header(...), position_ms: int = Query(...)):
    try:
        access_token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
        async with httpx.AsyncClient() as http_client:
            response = await http_client.put(
                f"https://api.spotify.com/v1/me/player/seek?position_ms={position_ms}",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            return {"success": response.status_code in [204, 200]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/spotify/playlist/{playlist_id}/tracks")
async def get_playlist_tracks(playlist_id: str, access_token: str = Query(...)):
    try:
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(
                f"https://api.spotify.com/v1/playlists/{playlist_id}/tracks?limit=50",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            if response.status_code != 200:
                logger.error(f"Failed to get playlist tracks: {response.status_code}")
                raise HTTPException(status_code=response.status_code, detail="Failed to get playlist tracks")
            return response.json()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching playlist tracks: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.put("/spotify/play/context")
async def play_context(authorization: str = Header(...), context_uri: str = Query(...)):
    try:
        access_token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
        logger.info(f"🎵 Play context request - URI: {context_uri}")
        async with httpx.AsyncClient() as http_client:
            devices_response = await http_client.get(
                "https://api.spotify.com/v1/me/player/devices",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            devices_data = devices_response.json() if devices_response.status_code == 200 else {"devices": []}
            active_devices = devices_data.get("devices", [])

            if not active_devices:
                return {"success": False, "error": "No active Spotify device found. Please open Spotify on your phone or computer."}

            device_id = None
            for device in active_devices:
                if device.get("is_active"):
                    device_id = device.get("id")
                    break
            if not device_id and active_devices:
                device_id = active_devices[0].get("id")

            play_url = "https://api.spotify.com/v1/me/player/play"
            if device_id:
                play_url += f"?device_id={device_id}"

            response = await http_client.put(
                play_url,
                headers={"Authorization": f"Bearer {access_token}"},
                json={"context_uri": context_uri}
            )

            if response.status_code in [204, 200, 202]:
                return {"success": True}
            elif response.status_code == 404:
                return {"success": False, "error": "No active device found. Please open Spotify."}
            elif response.status_code == 403:
                return {"success": False, "error": "Premium required for playback control."}
            else:
                return {"success": False, "error": f"Playback failed: {response.text}"}
    except Exception as e:
        logger.error(f"Play context error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/spotify/proxy")
async def proxy_spotify_request(url: str = Query(...), access_token: str = Query(...)):
    """Proxy a Spotify API request. Locked to api.spotify.com to prevent SSRF."""
    if not url.startswith("https://api.spotify.com/"):
        raise HTTPException(status_code=400, detail="Only api.spotify.com URLs are allowed")
    try:
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(
                url,
                headers={"Authorization": f"Bearer {access_token}"}
            )
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail="Spotify API request failed")
            return response.json()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Proxy error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/spotify/search")
async def search_spotify(q: str = Query(...), access_token: str = Query(...)):
    try:
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(
                "https://api.spotify.com/v1/search",
                params={"q": q, "type": "track", "limit": 30},
                headers={"Authorization": f"Bearer {access_token}"}
            )
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail="Search failed")
            return response.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/spotify/category/{category_id}/playlists")
async def get_category_playlists(category_id: str, access_token: str = Query(...)):
    try:
        async with httpx.AsyncClient() as http_client:
            for locale in ["", "US", "GB"]:
                country_param = f"&country={locale}" if locale else ""
                response = await http_client.get(
                    f"https://api.spotify.com/v1/browse/categories/{category_id}/playlists?limit=50{country_param}",
                    headers={"Authorization": f"Bearer {access_token}"}
                )
                if response.status_code == 200:
                    data = response.json()
                    items = data.get("playlists", {}).get("items", [])
                    valid_items = [item for item in items if item and item.get("id")]
                    if valid_items:
                        return {"playlists": {"items": valid_items}}

            featured_response = await http_client.get(
                "https://api.spotify.com/v1/browse/featured-playlists?limit=50",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            if featured_response.status_code == 200:
                data = featured_response.json()
                items = data.get("playlists", {}).get("items", [])
                valid_items = [item for item in items if item and item.get("id")]
                return {"playlists": {"items": valid_items}}

            return {"playlists": {"items": []}}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Listen Together endpoints
# ---------------------------------------------------------------------------

@api_router.post("/listen-together/create")
async def create_listen_session(authorization: str = Header(...)):
    try:
        access_token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(
                "https://api.spotify.com/v1/me/player/currently-playing",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            if response.status_code != 200 or not response.text:
                raise HTTPException(status_code=400, detail="No track currently playing")

            player_data = response.json()
            if not player_data.get("item"):
                raise HTTPException(status_code=400, detail="No track currently playing")

            track = player_data["item"]
            track_uri = track["uri"]

            profile_response = await http_client.get(
                "https://api.spotify.com/v1/me",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            profile = profile_response.json()
            user_id = profile["id"]

            session_id = await listen_together_manager.create_session(
                host_id=user_id,
                track_uri=track_uri,
                track_info={
                    "name": track["name"],
                    "artists": [a["name"] for a in track.get("artists", [])],
                    "album": track.get("album", {}).get("name"),
                    "album_cover": track.get("album", {}).get("images", [{}])[0].get("url"),
                    "uri": track_uri,
                    "duration_ms": track.get("duration_ms", 0)
                }
            )

            session = await listen_together_manager.get_session(session_id)
            return {
                "session_id": session_id,
                "track_info": session["track_info"]
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Create session error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/listen-together/join/{session_id}")
async def join_listen_session(session_id: str, authorization: str = Header(...)):
    try:
        access_token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization

        async with httpx.AsyncClient() as http_client:
            profile_response = await http_client.get(
                "https://api.spotify.com/v1/me",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            if profile_response.status_code != 200:
                raise HTTPException(status_code=401, detail="Invalid or expired access token")
            profile = profile_response.json()
            user_id = profile.get("id")
            if not user_id:
                raise HTTPException(status_code=401, detail="Could not retrieve user ID")

        session = await listen_together_manager.join_session(user_id, session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        async with httpx.AsyncClient() as http_client:
            await http_client.put(
                "https://api.spotify.com/v1/me/player/play",
                headers={"Authorization": f"Bearer {access_token}"},
                json={
                    "uris": [session["current_track_uri"]],
                    "position_ms": session["position_ms"]
                }
            )

        await manager.broadcast_listen_together(session_id, "user_joined", {
            "user_id": user_id,
            "participants": session["participants"]
        })

        return {
            "success": True,
            "session": session
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Join session error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/listen-together/leave")
async def leave_listen_session(authorization: str = Header(...)):
    try:
        access_token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization

        async with httpx.AsyncClient() as http_client:
            profile_response = await http_client.get(
                "https://api.spotify.com/v1/me",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            if profile_response.status_code != 200:
                raise HTTPException(status_code=401, detail="Invalid or expired access token")
            profile = profile_response.json()
            user_id = profile.get("id")
            if not user_id:
                raise HTTPException(status_code=401, detail="Could not retrieve user ID")

        session = await listen_together_manager.get_user_session(user_id)
        if session:
            session_id = session["session_id"]
            await listen_together_manager.leave_session(user_id)
            remaining = await listen_together_manager.get_session(session_id)
            if remaining:
                await manager.broadcast_listen_together(session_id, "user_left", {
                    "user_id": user_id,
                    "participants": remaining["participants"]
                })

        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Leave session error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/listen-together/session/{session_id}")
async def get_listen_session(session_id: str):
    session = await listen_together_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    session.pop("_id", None)
    return session


# ---------------------------------------------------------------------------
# Utility endpoints
# ---------------------------------------------------------------------------

@api_router.get("/maps/key")
async def get_maps_key():
    return {"api_key": GOOGLE_MAPS_API_KEY}

@api_router.get("/proxy/image")
async def proxy_image(url: str = Query(...)):
    """Proxy images to avoid CORS issues. Restricted to http/https to prevent SSRF."""
    if not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(status_code=400, detail="Only http/https URLs are allowed")
    try:
        async with httpx.AsyncClient(follow_redirects=True) as http_client:
            response = await http_client.get(url, timeout=10.0)
            if response.status_code == 200:
                from fastapi.responses import Response
                return Response(
                    content=response.content,
                    media_type=response.headers.get("content-type", "image/jpeg"),
                    headers={
                        "Cache-Control": "public, max-age=3600",
                        "Access-Control-Allow-Origin": "*"
                    }
                )
            else:
                raise HTTPException(status_code=404, detail="Image not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to proxy image: {e}")
        raise HTTPException(status_code=500, detail="Failed to load image")


# ---------------------------------------------------------------------------
# WebSocket endpoint for real-time location sharing
# ---------------------------------------------------------------------------

@api_router.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    """WebSocket endpoint for real-time location, song, and listen together updates"""
    logger.info(f"[{INSTANCE_ID}] 🚀 WebSocket connection requested for user: {user_id}")
    await manager.connect(websocket, user_id)

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            msg_type = message.get("type", "location_update")

            if msg_type == "location_update":
                await manager.update_location(user_id, message)

            elif msg_type == "now_playing_stopped":
                await manager.clear_now_playing(user_id)

            elif msg_type == "user_disconnect":
                await manager.disconnect(user_id)

            elif msg_type == "listen_together_sync":
                session = await listen_together_manager.get_user_session(user_id)
                if session and session["host_id"] == user_id:
                    await listen_together_manager.update_playback(
                        session["session_id"],
                        message.get("track_uri"),
                        message.get("track_info", {}),
                        message.get("position_ms", 0),
                        message.get("is_playing", True)
                    )
                    await manager.broadcast_listen_together(session["session_id"], "playback_sync", {
                        "track_uri": message.get("track_uri"),
                        "track_info": message.get("track_info"),
                        "position_ms": message.get("position_ms"),
                        "is_playing": message.get("is_playing")
                    })

            elif msg_type == "listen_together_invite":
                target_user_id = message.get("target_user_id")
                session_id = message.get("session_id")
                if target_user_id and session_id:
                    session = await listen_together_manager.get_session(session_id)
                    if session:
                        await manager.send_to_user(target_user_id, {
                            "type": "listen_together_invite",
                            "session_id": session_id,
                            "host_id": user_id,
                            "host_name": message.get("host_name"),
                            "track_info": session["track_info"]
                        })

    except WebSocketDisconnect:
        logger.info(f"[{INSTANCE_ID}] 🔌 WebSocket disconnect detected for {user_id}")
        await manager.disconnect(user_id)
    except Exception as e:
        logger.error(f"[{INSTANCE_ID}] ❌ WebSocket error for user {user_id}: {e}")
        await manager.disconnect(user_id)


# ---------------------------------------------------------------------------
# Health + debug
# ---------------------------------------------------------------------------

@api_router.get("/health")
async def health_check():
    online_count = await manager.live_users.count_documents({})
    active_sessions = await listen_together_manager.collection.count_documents({})
    return {
        "status": "healthy",
        "instance_id": INSTANCE_ID,
        "local_connections": len(manager.active_connections),
        "global_online_users": online_count,
        "active_listen_sessions": active_sessions,
        "timestamp": now_iso()
    }

@api_router.get("/debug/state")
async def debug_state(token: Optional[str] = Query(None)):
    if DEBUG_TOKEN and token != DEBUG_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid debug token")

    users = []
    async for doc in manager.live_users.find({}):
        doc.pop("_id", None)
        users.append(doc)

    sessions = []
    async for doc in listen_together_manager.collection.find({}):
        doc.pop("_id", None)
        sessions.append(doc)

    return {
        "instance_id": INSTANCE_ID,
        "local_connections_here": list(manager.active_connections.keys()),
        "global_users": users,
        "global_sessions": sessions,
    }



# ---------------------------------------------------------------------------
# WebView-rendered UI assets (PixelBlast bg, ASCIIText logo, StarBorder button,
# TiltedCard) + font/icon/store asset serving. Restored from pre-v2 server.py
# (these routes are required by frontend components: PixelBlastBackground.tsx,
# ASCIIText.tsx, StarBorder.tsx, TiltedCard.tsx, and _layout.tsx font loader).
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# TiltedCard (React Bits port — vanilla JS, no React/framer-motion required).
# Renders a 3D-perspective tilting card driven by mouse/touch position with
# spring smoothing. Used as the centerpiece of the "Song Found" radar modal.
# Query params:
#   src   = image URL (album art)
#   alt   = alt text
#   cap   = small caption shown on tooltip following the cursor
#   title = bigger overlay text pinned to bottom-left of the card
#   amp   = rotateAmplitude (default 14)
#   sc    = scaleOnHover (default 1.10)
#   w/h   = container size in px (default 320)
#   iw/ih = image size in px (default = w/h)
# ---------------------------------------------------------------------------
TILTEDCARD_HTML = r"""<!doctype html>
<html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<title>TiltedCard</title>
<style>
  html,body{margin:0;padding:0;background:transparent;height:100%;width:100%;
    -webkit-tap-highlight-color:transparent;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Inter","Helvetica Neue",sans-serif;}
  .stage{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;}
  .figure{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;
    perspective:800px;-webkit-perspective:800px;will-change:transform;}
  .inner{position:relative;transform-style:preserve-3d;-webkit-transform-style:preserve-3d;
    transform:translateZ(0);will-change:transform;}
  .img{position:absolute;top:0;left:0;border-radius:18px;object-fit:cover;
    box-shadow:0 30px 60px -20px rgba(0,0,0,0.65),0 0 0 1px rgba(176,38,255,0.35),
      0 0 60px rgba(176,38,255,0.35);
    will-change:transform;transform:translateZ(0);}
  .overlay{position:absolute;top:0;left:0;width:100%;height:100%;z-index:2;
    transform:translateZ(30px);-webkit-transform:translateZ(30px);
    pointer-events:none;display:flex;align-items:flex-end;}
  .overlay-inner{padding:14px 16px;width:100%;
    background:linear-gradient(to top,rgba(0,0,0,0.75) 0%,rgba(0,0,0,0.35) 55%,rgba(0,0,0,0) 100%);
    border-bottom-left-radius:18px;border-bottom-right-radius:18px;}
  .overlay-title{color:#fff;font-weight:900;font-size:18px;letter-spacing:0.3px;line-height:1.2;
    text-shadow:0 1px 8px rgba(0,0,0,0.6);}
  .caption{pointer-events:none;position:absolute;left:0;top:0;
    background:#fff;color:#0A0A12;border-radius:6px;padding:4px 10px;
    font-size:11px;font-weight:700;letter-spacing:0.4px;opacity:0;z-index:3;
    box-shadow:0 6px 18px rgba(0,0,0,0.35);white-space:nowrap;}
  /* Subtle border sheen */
  .img::after{content:"";position:absolute;inset:0;border-radius:18px;
    box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06);}
</style></head>
<body>
<div class="stage" id="stage">
  <figure class="figure" id="figure">
    <div class="inner" id="inner">
      <img class="img" id="img" alt="" />
      <div class="overlay" id="overlay" style="display:none">
        <div class="overlay-inner"><div class="overlay-title" id="overlayTitle"></div></div>
      </div>
    </div>
    <div class="caption" id="caption"></div>
  </figure>
</div>
<script>
(function(){
  // ---- Read query params ---------------------------------------------------
  var P = new URLSearchParams(location.search);
  var src   = P.get('src') || '';
  var alt   = P.get('alt') || 'Album art';
  var cap   = P.get('cap') || '';
  var title = P.get('title') || '';
  var amp   = parseFloat(P.get('amp') || '14');
  var sc    = parseFloat(P.get('sc')  || '1.10');
  var W     = parseInt(P.get('w')  || '320', 10);
  var H     = parseInt(P.get('h')  || '320', 10);
  var IW    = parseInt(P.get('iw') || String(W), 10);
  var IH    = parseInt(P.get('ih') || String(H), 10);
  var showCap = (P.get('showCap') || '1') !== '0';
  var showOverlay = !!title;

  // ---- DOM refs ------------------------------------------------------------
  var fig = document.getElementById('figure');
  var inner = document.getElementById('inner');
  var img = document.getElementById('img');
  var overlay = document.getElementById('overlay');
  var overlayTitle = document.getElementById('overlayTitle');
  var caption = document.getElementById('caption');

  fig.style.width = W + 'px';
  fig.style.height = H + 'px';
  inner.style.width = IW + 'px';
  inner.style.height = IH + 'px';
  img.style.width = IW + 'px';
  img.style.height = IH + 'px';
  if (src) img.src = src;
  img.alt = alt;
  if (showOverlay){
    overlay.style.display = 'flex';
    overlay.style.width = IW + 'px';
    overlay.style.height = IH + 'px';
    overlayTitle.textContent = title;
  }
  if (showCap){
    caption.textContent = cap || '';
  } else {
    caption.style.display = 'none';
  }

  // ---- Spring physics (port of framer-motion useSpring) --------------------
  // Critically-damped-ish spring done with stiffness/damping/mass.
  function makeSpring(initial, stiffness, damping, mass){
    var pos = initial, vel = 0, target = initial;
    return {
      set: function(v){ target = v; },
      tick: function(dt){
        var fSpring = -stiffness * (pos - target);
        var fDamp = -damping * vel;
        var a = (fSpring + fDamp) / mass;
        vel += a * dt;
        pos += vel * dt;
        return pos;
      },
      get: function(){ return pos; },
      reset: function(v){ pos = v; vel = 0; target = v; }
    };
  }

  // Match the React Bits springValues: stiffness 100, damping 30, mass 2
  var rotX = makeSpring(0, 100, 30, 2);
  var rotY = makeSpring(0, 100, 30, 2);
  var scale = makeSpring(1, 100, 30, 2);
  // Tooltip rotation gets a snappier feel: stiffness 350, damping 30, mass 1
  var capRot = makeSpring(0, 350, 30, 1);
  // Caption opacity (linear-ish, also use a spring for smoothness)
  var opacity = makeSpring(0, 200, 26, 1);

  var lastY = 0;
  var px = 0, py = 0; // pointer pos relative to figure top-left

  function onPointerMove(clientX, clientY){
    var rect = fig.getBoundingClientRect();
    var ox = clientX - rect.left - rect.width/2;
    var oy = clientY - rect.top  - rect.height/2;
    var rxv = (oy / (rect.height/2)) * -amp;
    var ryv = (ox / (rect.width/2))  *  amp;
    rotX.set(rxv);
    rotY.set(ryv);
    px = clientX - rect.left;
    py = clientY - rect.top;
    var velocityY = oy - lastY;
    capRot.set(-velocityY * 0.6);
    lastY = oy;
  }
  function onEnter(){ scale.set(sc); opacity.set(1); }
  function onLeave(){ scale.set(1); opacity.set(0); rotX.set(0); rotY.set(0); capRot.set(0); }

  // Mouse listeners (desktop)
  fig.addEventListener('mouseenter', onEnter);
  fig.addEventListener('mouseleave', onLeave);
  fig.addEventListener('mousemove', function(e){ onPointerMove(e.clientX, e.clientY); });

  // Touch listeners (mobile) — first finger drives tilt.
  function onTouch(e){
    if (!e.touches || !e.touches[0]) return;
    var t = e.touches[0];
    onPointerMove(t.clientX, t.clientY);
  }
  fig.addEventListener('touchstart', function(e){ onEnter(); onTouch(e); }, {passive:true});
  fig.addEventListener('touchmove',  onTouch, {passive:true});
  fig.addEventListener('touchend',   onLeave);
  fig.addEventListener('touchcancel',onLeave);

  // ---- Ambient idle wobble (mobile users won't always touch the card) -----
  var t0 = performance.now();
  function ambient(now){
    var t = (now - t0) / 1000;
    // very gentle ±2deg sway; gets overridden the moment the user touches.
    if (Math.abs(rotX.get()) < 0.1 && Math.abs(rotY.get()) < 0.1 && scale.get() < 1.001){
      rotX.set(Math.sin(t*0.6) * 2.0);
      rotY.set(Math.cos(t*0.5) * 2.5);
    }
  }

  // ---- Main RAF loop -------------------------------------------------------
  var lastT = performance.now();
  function loop(now){
    var dt = Math.min(0.04, (now - lastT) / 1000);
    lastT = now;
    ambient(now);
    var rx = rotX.tick(dt);
    var ry = rotY.tick(dt);
    var s  = scale.tick(dt);
    var op = opacity.tick(dt);
    var cr = capRot.tick(dt);
    inner.style.transform =
      'rotateX(' + rx.toFixed(3) + 'deg) rotateY(' + ry.toFixed(3) + 'deg) scale(' + s.toFixed(4) + ')';
    if (showCap){
      caption.style.opacity = String(Math.max(0, Math.min(1, op)));
      caption.style.transform = 'translate(' + px + 'px,' + py + 'px) rotate(' + cr.toFixed(3) + 'deg)';
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ---- Listen for postMessage updates (so RN can swap art live) -----------
  function handleMsg(d){
    try {
      if (typeof d === 'string') d = JSON.parse(d);
    } catch(_) { return; }
    if (!d || typeof d !== 'object') return;
    if (d.src){ img.src = d.src; }
    if (typeof d.title === 'string'){
      overlayTitle.textContent = d.title;
      overlay.style.display = d.title ? 'flex' : 'none';
    }
    if (typeof d.cap === 'string'){
      caption.textContent = d.cap;
    }
  }
  window.addEventListener('message', function(e){ handleMsg(e.data); });
  document.addEventListener('message', function(e){ handleMsg(e.data); });
})();
</script>
</body></html>
"""



# ---------------------------------------------------------------------------
# Map WebView routes (Mapbox GL JS globe + Google Maps fallback). Required by
# SoundMapView.tsx which loads /api/mapbox.html or /api/map.html in a WebView.
# ---------------------------------------------------------------------------

@api_router.get("/mapbox.html")
async def mapbox_html(token: str, style: str = "geobeats"):
    """Mapbox GL JS globe view — Snapchat-style 3D Earth with atmosphere,
    stars, and configurable terrain style (custom GeoBeats neon or
    Mapbox satellite-streets). The marker/message protocol matches
    /api/map.html so the SoundMapView WebView swap is drop-in.

    style param:
      - "geobeats" (default): custom dark-v11 base with NFS neon paint overrides
      - "satellite": Mapbox satellite-streets-v12 (photorealistic terrain)
    """
    is_satellite = style == "satellite"
    base_style = "mapbox://styles/mapbox/satellite-streets-v12" if is_satellite else "mapbox://styles/mapbox/dark-v11"
    apply_paint = "false" if is_satellite else "true"
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
    display: flex;
    flex-direction: column;
    align-items: center;
    pointer-events: auto;
    cursor: pointer;
    /* Smooth opacity fade for the cross-zoom transition */
    transition: opacity 0.35s ease;
  }}
  /* Inner wrapper that we scale based on zoom. transform-origin at the
     bottom means as we shrink, the avatar collapses *down* onto the pill
     (which is anchored at the lat/lng), so the marker visually rests on
     the user's actual location at low zoom. */
  .bubble-inner {{
    display: flex;
    flex-direction: column;
    align-items: center;
    transform-origin: 50% 100%;
    transform: scale(var(--marker-scale, 1)) translateY(var(--marker-lift, 0px));
    transition: transform 0.55s cubic-bezier(0.2, 0.65, 0.2, 1);
    will-change: transform;
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

  /* ===== Profile Cluster (Life360-style for both 2 AND 3+ users) =====
     A unified white rounded pill that holds 2 (side-by-side, touching)
     OR 3+ (triangular, touching) avatars. Avatars overlap with no gap
     — their white borders form the cluster's visual cohesion. */
  /* ===== Profile Cluster (compact horizontal pill) =====
     One white pill containing 2, 3, or 3+"…" avatars side-by-side with
     overlap. Width auto-shrinks via inline-flex — no fixed box, no whitespace.
     Tail points down at the actual lat/lng pin. */
  .cluster {{
    position: relative;
    display: inline-flex;
    align-items: center;
    pointer-events: auto;
    cursor: pointer;
    background: #ffffff;
    border-radius: 999px;
    padding: 5px;
    margin-bottom: 12px;
    box-shadow: 0 10px 26px rgba(20, 0, 40, 0.4),
                0 2px 6px rgba(0, 0, 0, 0.18),
                inset 0 0 0 1px rgba(176, 38, 255, 0.10);
    transform-origin: 50% calc(100% + 12px);
    transform: scale(var(--marker-scale, 1)) translateY(var(--marker-lift, 0px));
    transition: transform 0.55s cubic-bezier(0.2, 0.65, 0.2, 1), opacity 0.35s ease;
    will-change: transform;
  }}
  /* Tail/triangle pointing down at the pin location. Sits BELOW the pill. */
  .cluster .tail {{
    position: absolute;
    bottom: -8px;
    left: 50%;
    width: 18px; height: 18px;
    background: #ffffff;
    transform: translateX(-50%) rotate(45deg);
    border-bottom-right-radius: 4px;
    box-shadow: 6px 6px 12px rgba(20, 0, 40, 0.2);
    z-index: 0;
  }}
  .cluster .av {{
    flex: 0 0 auto;
    width: 44px; height: 44px;
    border-radius: 50%;
    overflow: hidden;
    border: 3px solid #fff;
    background: #1a0a24;
    margin-left: -12px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
    position: relative;
    z-index: 2;
  }}
  .cluster .av:first-child {{ margin-left: 0; }}
  .cluster .av img {{
    width: 100%; height: 100%; object-fit: cover; display: block;
  }}
  /* "..." indicator for clusters of 4+ users */
  .cluster .ellipsis {{
    flex: 0 0 auto;
    margin-left: 4px;
    padding: 0 10px 0 4px;
    color: #4a3a5e;
    font-weight: 800;
    font-size: 22px;
    line-height: 0.4;
    letter-spacing: 1.5px;
    user-select: none;
    z-index: 2;
  }}
  /* Tap feedback */
  .cluster:active {{ transform: scale(calc(var(--marker-scale, 1) * 0.94)); }}

  /* Cinematic intro guard — completely hide markers (no fade, no transition)
     during the first fly-from-globe so they don't visibly slide up from
     off-screen into their final lat/lng pin positions. Removed on moveend. */
  body.cinematic-pending .cluster,
  body.cinematic-pending .bubble {{
    opacity: 0 !important;
    visibility: hidden !important;
    transition: none !important;
  }}

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
    el.innerHTML = '<div class="bubble-inner">' +
                   '<div class="avatar-wrap"><img src="'+img+'" onerror="this.src=\\'https://placehold.co/100x100/1a0a24/B026FF?text=?\\'" /></div>' +
                   (safeLabel ? '<div class="pill"><span class="dot"></span><span>'+safeLabel+'</span></div>' : '') +
                   '</div>';
    el.addEventListener('click', () => post({{ type: 'marker:click', user_id: u.user_id }}));
    return el;
  }}
  function makeClusterEl(usersInCluster){{
    // Compact horizontal pill: 2 or 3 overlapping avatars side-by-side.
    // For 4+ users we still show 3 avatars but append a "..." indicator
    // next to the last one (per user spec). The wrapper uses inline-flex
    // so the pill auto-shrinks to fit content exactly (no whitespace).
    const el = document.createElement('div');
    el.className = 'cluster';
    const shown = usersInCluster.slice(0, 3);
    const hasMore = usersInCluster.length > 3;
    const parts = [];
    for (const u of shown) {{
      const img = u.profile_image || ('https://placehold.co/100x100/1a0a24/B026FF?text=' + encodeURIComponent((u.display_name||'?').slice(0,1)));
      parts.push('<div class="av"><img src="'+img+'" onerror="this.src=\\'https://placehold.co/100x100/1a0a24/B026FF?text=?\\'" /></div>');
    }}
    if (hasMore) parts.push('<div class="ellipsis">…</div>');
    parts.push('<div class="tail"></div>');
    el.innerHTML = parts.join('');
    el.addEventListener('click', () => {{
      try {{
        const b = new mapboxgl.LngLatBounds();
        usersInCluster.forEach(u => {{ b.extend([u.lng, u.lat]); }});
        const sw = b.getSouthWest(), ne = b.getNorthEast();
        const sameSpot = sw && ne && Math.abs(sw.lng - ne.lng) < 1e-5 && Math.abs(sw.lat - ne.lat) < 1e-5;
        if (sameSpot) {{
          map.flyTo({{ center: [usersInCluster[0].lng, usersInCluster[0].lat], zoom: Math.max(map.getZoom()+2.2, 16), speed: 1.1, curve: 1.5, essential: true }});
        }} else {{
          map.fitBounds(b, {{ padding: {{ top: 120, bottom: 220, left: 80, right: 80 }}, maxZoom: 16, duration: 900, essential: true }});
        }}
        post({{ type: 'cluster:click', user_ids: usersInCluster.map(u => u.user_id) }});
      }} catch(e) {{}}
    }});
    return el;
  }}

  // ===== Cluster engine =====
  // Holds the most recent flat user list so we can re-cluster on zoom
  // (kept for compat — clustering itself is now zoom-independent because
  // we measure real-world distance in metres, not screen pixels).
  let latestUsers = [];
  // CLUSTER if two users are within this REAL-WORLD distance in metres.
  // 150m ≈ "same building / same block" — matches user expectation for
  // a Life360-style grouping (people in the same place cluster, people
  // in different parts of town don't).
  const CLUSTER_M = 150;
  // HYSTERESIS: once two users are clustered, require them to be
  // SEPARATED by this larger real-world distance before un-clustering.
  // Combined with the TTL below, this absorbs GPS jitter AND brief WS
  // disconnects without breaking the cluster apart.
  const CLUSTER_M_STICKY = 300;
  // Sticky-pair TTL: passes a pair stays "sticky" after it was last grouped.
  // 5 passes ≈ 25s — survives a friend's momentary WS dropout.
  const STICKY_TTL = 5;
  // Map<"a|b", remainingPasses>
  let stickyPairAges = new Map();

  // Equirectangular approximation — fast & accurate for small distances.
  function metersBetween(lat1, lng1, lat2, lng2){{
    const dLat = (lat2 - lat1) * 111000;
    const dLng = (lng2 - lng1) * 111000 * Math.cos(lat1 * Math.PI / 180);
    return Math.sqrt(dLat*dLat + dLng*dLng);
  }}

  // Per-user content signature — fingerprints everything the marker can
  // visually express. Used to detect when a friend's avatar / track / play
  // state has changed so we can refresh the marker element in place
  // (without removing & recreating the marker, which would flicker).
  function userSig(u){{
    if (!u) return '';
    const t = u.current_track || u.track || {{}};
    const trackName = t.item ? (t.item.name || '') : (t.name || '');
    return [
      u.user_id, u.display_name || '', u.profile_image || '',
      u.is_playing ? '1' : '0', u.host_session ? 'h' : '',
      trackName,
    ].join('|');
  }}
  function clusterSig(users){{
    return (users || []).map(userSig).sort().join('::');
  }}

  function recluster(){{
    if (!map || !map.loaded) return;
    // Greedy-cluster ALL users (self included) by pixel distance. Including
    // self in clustering means when another user is near you, you and them
    // merge into a single Life360-style pill that stays visually unified at
    // every zoom level (instead of drifting apart at low zoom because each
    // bubble was anchored to its own slightly-different lat/lng pin).
    const valid = [];
    for (const u of latestUsers) {{
      if (!u || typeof u.lat !== 'number' || typeof u.lng !== 'number') continue;
      valid.push(u);
    }}
    const groups = []; // each: lng, lat (centroid) + users[]
    // Process self FIRST so it always anchors the cluster (renders first).
    valid.sort((a, b) => {{
      const sa = (a.isSelf || a.user_id === meIdRef.id) ? 0 : 1;
      const sb = (b.isSelf || b.user_id === meIdRef.id) ? 0 : 1;
      return sa - sb;
    }});
    for (const u of valid) {{
      let placed = false;
      for (const g of groups) {{
        const distM = metersBetween(g.lat, g.lng, u.lat, u.lng);
        // HYSTERESIS: if this user was clustered with ANY existing member
        // of g.users in the recent past (sticky TTL), use the larger
        // sticky threshold to keep them together. Otherwise use the
        // normal threshold.
        let wasStickyToThisGroup = false;
        for (const peer of g.users) {{
          const pair = u.user_id < peer.user_id
            ? (u.user_id + '|' + peer.user_id)
            : (peer.user_id + '|' + u.user_id);
          if (stickyPairAges.has(pair)) {{ wasStickyToThisGroup = true; break; }}
        }}
        const thresh = wasStickyToThisGroup ? CLUSTER_M_STICKY : CLUSTER_M;
        if (distM <= thresh) {{
          g.users.push(u);
          const k = g.users.length;
          g.lng = ((g.lng * (k-1)) + u.lng) / k;
          g.lat = ((g.lat * (k-1)) + u.lat) / k;
          placed = true; break;
        }}
      }}
      if (!placed) groups.push({{ lng: u.lng, lat: u.lat, users: [u] }});
    }}
    // Refresh sticky pairs with TTL decay
    const groupedThisPass = new Set();
    for (const g of groups) {{
      if (g.users.length < 2) continue;
      for (let i = 0; i < g.users.length; i++) {{
        for (let j = i+1; j < g.users.length; j++) {{
          const a = g.users[i].user_id, b = g.users[j].user_id;
          const key = a < b ? (a + '|' + b) : (b + '|' + a);
          groupedThisPass.add(key);
          stickyPairAges.set(key, STICKY_TTL);
        }}
      }}
    }}
    for (const [pair, age] of Array.from(stickyPairAges.entries())) {{
      if (groupedThisPass.has(pair)) continue;
      if (age <= 1) stickyPairAges.delete(pair);
      else stickyPairAges.set(pair, age - 1);
    }}

    // Stable signature for diffing (so we update in-place when contents unchanged)
    const desired = {{}};
    for (const g of groups) {{
      if (g.users.length === 1) {{
        const u = g.users[0];
        // Self user (when alone) keeps the cyan/purple solo-bubble look;
        // other users get the standard purple bubble. Both are solo.
        const prefix = (u.isSelf || u.user_id === meIdRef.id) ? 'self:' : 'solo:';
        desired[prefix + u.user_id] = {{
          kind: 'solo', user: u, lng: u.lng, lat: u.lat,
          offset: [0, 0], sig: userSig(u),
        }};
      }} else {{
        // 2+ users: unified Life360-style white-pill cluster.
        // makeClusterEl renders side-by-side for n=2 and triangular for n=3+.
        const key = 'cl:' + g.users.map(x => x.user_id).sort().join('|');
        desired[key] = {{
          kind: 'cluster', users: g.users, lng: g.lng, lat: g.lat,
          offset: [0, 0], sig: clusterSig(g.users),
        }};
      }}
    }}

    // Remove markers that are no longer needed
    Object.keys(markers).forEach(key => {{
      if (!desired[key]) {{ markers[key].remove(); delete markers[key]; }}
    }});
    // Add / update remaining
    Object.entries(desired).forEach(([key, spec]) => {{
      const existing = markers[key];
      if (existing) {{
        existing.setLngLat([spec.lng, spec.lat]);
        try {{ existing.setOffset(spec.offset || [0, 0]); }} catch(e) {{}}
        // If the visual content of the user/cluster changed (new avatar
        // URL, new track, play-state toggled, friend joined/left), refresh
        // the element's innerHTML in place — preserves the Mapbox Marker
        // (no flicker, no animation reset) while showing fresh data.
        const prevSig = existing.__sig;
        if (prevSig !== spec.sig) {{
          try {{
            const el = existing.getElement();
            const fresh = spec.kind === 'solo' ? makeBubbleEl(spec.user) : makeClusterEl(spec.users);
            // Match the wrapper class (e.g. swap .cluster.n2 <-> .cluster.n3
            // if size changed inside an unchanged user_id set).
            el.className = fresh.className;
            el.innerHTML = fresh.innerHTML;
            // The click handler is bound on the fresh element; rebind by
            // copying its click listener data via cloning behaviour: we
            // can't easily transfer JS listeners, so re-attach explicitly
            // for clusters (solo bubbles delegate clicks via map events).
            if (spec.kind === 'cluster') {{
              // Rebuild click handler on the live element (mirrors makeClusterEl)
              el.onclick = () => {{
                try {{
                  const b = new mapboxgl.LngLatBounds();
                  spec.users.forEach(u => {{ b.extend([u.lng, u.lat]); }});
                  const sw = b.getSouthWest(), ne = b.getNorthEast();
                  const sameSpot = sw && ne && Math.abs(sw.lng - ne.lng) < 1e-5 && Math.abs(sw.lat - ne.lat) < 1e-5;
                  if (sameSpot) {{
                    map.flyTo({{ center: [spec.users[0].lng, spec.users[0].lat], zoom: Math.max(map.getZoom()+2.2, 16), speed: 1.1, curve: 1.5, essential: true }});
                  }} else {{
                    map.fitBounds(b, {{ padding: {{ top: 120, bottom: 220, left: 80, right: 80 }}, maxZoom: 16, duration: 900, essential: true }});
                  }}
                  post({{ type: 'cluster:click', user_ids: spec.users.map(u => u.user_id) }});
                }} catch(e) {{}}
              }};
            }}
            existing.__sig = spec.sig;
          }} catch(e) {{}}
        }}
        return;
      }}
      const el = spec.kind === 'solo' ? makeBubbleEl(spec.user) : makeClusterEl(spec.users);
      const m = new mapboxgl.Marker({{ element: el, anchor: 'bottom', offset: spec.offset || [0, 0] }})
        .setLngLat([spec.lng, spec.lat]).addTo(map);
      m.__sig = spec.sig;
      markers[key] = m;
    }});
    updateMarkerVisibility();
  }}

  function upsertMarker(u){{
    if (!u.lat || !u.lng) return;
    if (u.isSelf && !window.__flown) {{
      window.__flown = true;
      spinEnabled = false;
      // Hide all markers during the cinematic intro fly-in so they don't
      // appear to "float up" from the wrong screen position as the camera
      // animates from globe view down to user's lat/lng. We unblock as
      // soon as moveend fires OR (whichever comes first) as soon as zoom
      // passes 8 — at that point the marker projection is already near
      // its final screen position so there's no visible "float up".
      document.body.classList.add('cinematic-pending');
      let guardLifted = false;
      const liftGuard = () => {{
        if (guardLifted) return;
        guardLifted = true;
        document.body.classList.remove('cinematic-pending');
        try {{ recluster(); }} catch(e) {{}}
      }};
      const onZoomLift = () => {{
        if (map.getZoom() >= 8) {{ map.off('zoom', onZoomLift); liftGuard(); }}
      }};
      map.on('zoom', onZoomLift);
      map.once('moveend', () => {{ map.off('zoom', onZoomLift); liftGuard(); }});
      // HARD SAFETY NET: if for ANY reason flyTo doesn't fire (map not
      // ready, tile-fetch hung, network hiccup), force-lift the guard
      // after 5 seconds so markers always show up. Without this the
      // cinematic-pending class can stick forever and the user sees a
      // map with no avatars at all.
      setTimeout(liftGuard, 5000);
      try {{
        map.flyTo({{ center: [u.lng, u.lat], zoom: 13.5, pitch: 45, speed: 0.7, curve: 1.6, essential: true }});
      }} catch(e) {{
        // flyTo failed synchronously — lift immediately so markers render.
        liftGuard();
      }}
    }}
    // Merge into latestUsers (replace by user_id) then re-cluster.
    const idx = latestUsers.findIndex(x => x && x.user_id === u.user_id);
    if (idx >= 0) latestUsers[idx] = u; else latestUsers.push(u);
    recluster();
  }}
  function setMarkersBulk(list){{
    latestUsers = (list || []).filter(u => u && u.user_id);
    recluster();
    updateHeatmap(latestUsers);
  }}
  function updateHeatmap(list){{
    const features = (list || [])
      .filter(u => u && typeof u.lat === 'number' && typeof u.lng === 'number')
      .map(u => ({{
        type: 'Feature',
        geometry: {{ type: 'Point', coordinates: [u.lng, u.lat] }},
        // Active listeners contribute more "warmth" than idle/ghost users.
        properties: {{ weight: u.is_playing ? 1 : 0.35 }}
      }}));
    const src = map && map.getSource && map.getSource('listeners-heat-src');
    if (src) src.setData({{ type: 'FeatureCollection', features }});
  }}
  // ---- Zoom-driven marker scale ----
  // Returns the scale factor (0..1) for the bubble-inner element based on
  // current zoom. At low zoom the marker shrinks down toward its bottom
  // anchor (which is the user's actual lat/lng), eliminating the visual
  // "drift" where the avatar appeared far from the user's pin location.
  function zoomToMarkerScale(z){{
    if (z >= 12) return 1;        // high zoom: full size, full hover
    if (z >= 9)  return 0.65 + (z - 9) * (0.35 / 3);  // 9→0.65, 12→1.0
    if (z >= 6)  return 0.35 + (z - 6) * (0.30 / 3);  // 6→0.35, 9→0.65
    if (z >= 4)  return 0.18 + (z - 4) * (0.17 / 2);  // 4→0.18, 6→0.35
    return 0;                      // <4: invisible (heatmap takes over)
  }}
  function updateMarkerVisibility(){{
    if (!map) return;
    const z = map.getZoom();
    const scale = zoomToMarkerScale(z);
    Object.values(markers).forEach(m => {{
      try {{
        const el = m.getElement();
        el.style.setProperty('--marker-scale', String(scale));
        el.style.opacity = scale > 0.05 ? '1' : '0';
      }} catch(e) {{}}
    }});
  }}
  function removeMarker(uid){{
    // Remove the user from latestUsers and re-cluster.
    const idx = latestUsers.findIndex(u => u && u.user_id === uid);
    if (idx >= 0) latestUsers.splice(idx, 1);
    recluster();
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
      // Suppress auto-recenter for the duration of the user-initiated flight
      // so it doesn't yank the camera back to [20,20] mid-animation.
      window.__suppressRecenter = true;
      if (window.__recenterTimer) {{ clearTimeout(window.__recenterTimer); window.__recenterTimer = null; }}
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
      // Lift suppression once the flight ends.
      map.once('moveend', () => {{ window.__suppressRecenter = false; }});
    }}
  }}
  window.__handle = handle;
  document.addEventListener('message', e => handle(e.data));
  window.addEventListener('message', e => handle(e.data));
  // Init globe — base style is configurable; we recolor layers to GeoBeats
  // theme on style.load when apply_paint is true (otherwise we keep the
  // satellite-streets photo terrain as-is).
  map = new mapboxgl.Map({{
    container: 'map',
    style: '{base_style}',
    center: [20, 20],
    zoom: 1.4,
    minZoom: 0.5,   // allow zoom-out to see whole Earth on tall phone viewports
    maxZoom: 19,
    projection: 'globe',
    pitch: 0,
    bearing: 0,
    attributionControl: false,
    antialias: true,
    renderWorldCopies: false,  // keep single Earth, no horizontal repeat
    dragRotate: true,
    touchZoomRotate: true,
    pitchWithRotate: false,
  }});
  // Belt-and-suspenders: also enforce after init in case style-load or
  // resize re-derives bounds (some Android WebViews over-eager pinch).
  try {{ map.setMinZoom(0.5); }} catch(e) {{}}
  try {{ map.setMaxZoom(19); }} catch(e) {{}}
  // Expose globally for debug + testing harness
  window.map = map;

  // Auto-recenter to Earth's geometric center when zoomed out so the
  // globe sits perfectly centered in the viewport instead of being
  // anchored to the user's lat/lng (which would push it off-screen on
  // tall phone viewports). When zoomed in, the user's marker stays put.
  // The __suppressRecenter flag (set by the 'center' message handler) lets
  // explicit user-initiated flights to a location skip the auto-recenter.
  window.__suppressRecenter = false;
  window.__recenterTimer = null;
  map.on('zoomend', () => {{
    try {{
      if (window.__suppressRecenter) return;
      const z = map.getZoom();
      if (z < 2.2) {{
        // Throttle so consecutive pinch-zoom-out events don't fight.
        if (window.__recenterTimer) clearTimeout(window.__recenterTimer);
        window.__recenterTimer = setTimeout(() => {{
          if (window.__suppressRecenter) return;
          try {{
            map.easeTo({{
              center: [20, 20],
              duration: 700,
              essential: true,
            }});
          }} catch(e) {{}}
        }}, 60);
      }}
      // Re-cluster on every zoom-end since pixel distances between fixed
      // lng/lat pairs change with zoom — clusters should split when you
      // zoom in and re-form when you zoom out.
      try {{ recluster(); }} catch(e) {{}}
    }} catch(e) {{}}
  }});
  // GeoBeats neon palette (mirrors the NFS aesthetic from the rest of the app)
  const PALETTE = {{
    bg:           '#05010f', // outer space / void behind the globe
    land:         '#1a0a2e', // continent base — visible at all zooms
    landAccent:   '#231038', // urban/man-made tint
    park:         '#0c1f12', // dim green-purple parks
    water:        '#02060f', // deep ocean — near black with cyan undertone
    waterDeep:    '#03081a', // intracoastal water
    road:         '#1a0e2c', // local streets
    roadCase:     '#000000', // road outlines
    roadArterial: '#321648', // bigger streets
    roadStroke:   '#7a1ec2', // glow stroke for arterials
    highway:      '#FF00AA', // magenta highway body
    highwayCase:  '#00E5FF', // cyan highway glow
    interstate:   '#FF1493', // pink interstate
    interstateCase: '#00FFE5',
    label:        '#00E5FF', // city / general labels (cyan)
    labelCountry: '#FF66E0', // country labels (hot pink)
    labelStroke:  '#000000',
    labelDim:     '#B026FF', // smaller / neighborhood labels
    border:       '#FF00AA',
    borderCountry:'#FF1493',
    building:     '#180a25', // extruded building base
    buildingTop:  '#2a1145', // building top accent (taller = lighter)
  }};
  function paintGeoBeats(){{
    if (!map || !map.getStyle()) return;
    const layers = map.getStyle().layers || [];
    const set = (id, prop, val) => {{ try {{ if (map.getLayer(id)) map.setPaintProperty(id, prop, val); }} catch(e) {{}} }};
    const setLayout = (id, prop, val) => {{ try {{ if (map.getLayer(id)) map.setLayoutProperty(id, prop, val); }} catch(e) {{}} }};
    // Background / land base
    set('background', 'background-color', PALETTE.bg);
    set('land', 'background-color', PALETTE.land);
    // Iterate through every layer and apply rules by id pattern + type
    layers.forEach(L => {{
      const id = L.id, type = L.type;
      // ----- WATER -----
      if (id.includes('water') && type === 'fill') {{
        set(id, 'fill-color', PALETTE.water);
      }}
      if (id === 'waterway' || id.includes('waterway')) {{
        set(id, 'line-color', PALETTE.waterDeep);
      }}
      // ----- LANDCOVER / LAND -----
      if (type === 'fill' && (id.includes('land') || id.includes('landcover'))) {{
        if (id.includes('park') || id.includes('grass') || id.includes('wood') || id.includes('crop')) {{
          set(id, 'fill-color', PALETTE.park);
        }} else if (id.includes('sand') || id.includes('rock') || id.includes('snow')) {{
          set(id, 'fill-color', PALETTE.landAccent);
        }} else {{
          set(id, 'fill-color', PALETTE.land);
        }}
      }}
      if (id.includes('park') && type === 'fill') {{
        set(id, 'fill-color', PALETTE.park);
      }}
      // ----- ROADS (lowest -> highest priority) -----
      // Local / minor streets
      if ((id.includes('road-street') || id.includes('road-minor') || id.includes('road-path') || id.includes('road-pedestrian')) && type === 'line') {{
        set(id, 'line-color', PALETTE.road);
      }}
      // Arterial / secondary / tertiary
      if ((id.includes('road-secondary') || id.includes('road-tertiary') || id.includes('road-primary')) && type === 'line') {{
        if (id.endsWith('-case')) {{
          set(id, 'line-color', PALETTE.roadStroke);
        }} else {{
          set(id, 'line-color', PALETTE.roadArterial);
        }}
      }}
      // Trunk / motorway case = cyan glow rim
      if ((id.includes('road-trunk') || id.includes('road-motorway')) && type === 'line') {{
        if (id.endsWith('-case')) {{
          set(id, 'line-color', PALETTE.highwayCase);
        }} else if (id.includes('motorway')) {{
          set(id, 'line-color', PALETTE.highway);
        }} else {{
          set(id, 'line-color', PALETTE.interstate);
        }}
      }}
      // Bridges / tunnels reuse same patterns (already covered above)
      // ----- BUILDINGS -----
      if (id === 'building' && type === 'fill') {{
        set(id, 'fill-color', PALETTE.building);
        set(id, 'fill-outline-color', PALETTE.roadStroke);
      }}
      if (id === 'building-extrusion' && type === 'fill-extrusion') {{
        set(id, 'fill-extrusion-color', PALETTE.building);
        // Taller buildings glow purple at the top via interpolation on height
        set(id, 'fill-extrusion-opacity', 0.85);
      }}
      // ----- BORDERS -----
      if (id.includes('admin-0') && type === 'line') {{
        set(id, 'line-color', PALETTE.borderCountry);
        set(id, 'line-width', ['interpolate', ['linear'], ['zoom'], 1, 0.6, 6, 1.4]);
      }}
      if (id.includes('admin-1') && type === 'line') {{
        set(id, 'line-color', PALETTE.border);
      }}
      // ----- LABELS -----
      if (type === 'symbol') {{
        if (id.includes('country')) {{
          set(id, 'text-color', PALETTE.labelCountry);
          set(id, 'text-halo-color', PALETTE.labelStroke);
          set(id, 'text-halo-width', 2);
        }} else if (id.includes('settlement') || id.includes('place') || id.includes('state') || id.includes('continent')) {{
          set(id, 'text-color', PALETTE.label);
          set(id, 'text-halo-color', PALETTE.labelStroke);
          set(id, 'text-halo-width', 2);
        }} else if (id.includes('road')) {{
          set(id, 'text-color', PALETTE.labelCountry);
          set(id, 'text-halo-color', PALETTE.labelStroke);
        }} else if (id.includes('poi') || id.includes('transit') || id.includes('airport')) {{
          // Hide POI labels for cleaner Snap-style look
          setLayout(id, 'visibility', 'none');
        }} else {{
          set(id, 'text-color', PALETTE.labelDim);
          set(id, 'text-halo-color', PALETTE.labelStroke);
        }}
      }}
      // Hide POI dots / icons
      if (type === 'circle' && id.includes('poi')) {{
        setLayout(id, 'visibility', 'none');
      }}
    }});
    // Extra: ensure building-extrusion has subtle glow gradient by height
    try {{
      if (map.getLayer('building-extrusion')) {{
        map.setPaintProperty('building-extrusion', 'fill-extrusion-color', [
          'interpolate', ['linear'], ['get', 'height'],
          0, PALETTE.building,
          50, PALETTE.building,
          150, '#2a1145',
          300, '#3a1660'
        ]);
      }}
    }} catch(e) {{}}
  }}
  map.on('style.load', () => {{
    // Atmospheric fog (Snapchat-style cyan halo + space backdrop)
    map.setFog({{
      color: 'rgb(186, 210, 235)',
      'high-color': 'rgb(36, 92, 223)',
      'horizon-blend': 0.05,
      'space-color': 'rgb(8, 4, 18)',
      'star-intensity': 0.85
    }});
    // Apply our GeoBeats neon palette only when configured (not for satellite)
    if ({apply_paint}) paintGeoBeats();
    // Snap-style listener heatmap source + layer. Seeded empty; populated
    // from setMarkersBulk every time marker data arrives.
    if (!map.getSource('listeners-heat-src')) {{
      map.addSource('listeners-heat-src', {{
        type: 'geojson',
        data: {{ type: 'FeatureCollection', features: [] }}
      }});
    }}
    if (!map.getLayer('listeners-heat')) {{
      map.addLayer({{
        id: 'listeners-heat',
        type: 'heatmap',
        source: 'listeners-heat-src',
        maxzoom: 13,
        paint: {{
          // Active listeners weighted higher than idle ones (set per-feature)
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'weight'], 0, 0.3, 1, 1],
          // Intensity ramps up with zoom so single users still produce a
          // visible bloom at globe scale.
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 0.8, 4, 1.4, 9, 2.0],
          // Snap-style cyan -> purple -> yellow -> orange -> red gradient
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0,   'rgba(0, 0, 0, 0)',
            0.1, 'rgba(0, 229, 255, 0.55)',
            0.3, 'rgba(176, 38, 255, 0.7)',
            0.5, 'rgba(255, 196, 0, 0.85)',
            0.7, 'rgba(255, 100, 0, 0.92)',
            1,   'rgba(255, 0, 50, 0.96)'
          ],
          // Halo grows with zoom so individual users have presence at every scale
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 18, 4, 38, 9, 70, 13, 110],
          // Heatmap fully opaque while zoomed out, fades out as user zooms in
          // (avatars take over for street-level detail).
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.95, 9, 0.75, 12, 0.25, 13, 0]
        }}
      }});
    }}
    // Re-emit any previously-set markers so the new heatmap source gets data
    // even if set_markers arrived before style.load.
    if (Object.keys(markers).length > 0) {{
      const list = Object.values(markers).map(m => {{
        const ll = m.getLngLat();
        return {{ lat: ll.lat, lng: ll.lng, is_playing: true }};
      }});
      updateHeatmap(list);
    }}
    document.getElementById('status').style.display = 'none';
    post({{ type: 'map:ready' }});
  }});
  // Hide individual avatars at globe scale, fade them in as user zooms toward city level
  map.on('zoom', () => updateMarkerVisibility());
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



@api_router.get("/tiltedcard.html")
async def tiltedcard_html():
    return Response(content=TILTEDCARD_HTML, media_type="text/html")


@api_router.get("/assets/icon.png")
async def geobeats_icon():
    """Serve the GeoBeats app icon (1024x1024) for easy download."""
    from fastapi.responses import FileResponse
    import os as _os
    icon_path = _os.path.join(_os.path.dirname(__file__), "..", "frontend", "assets", "images", "icon.png")
    icon_path = _os.path.abspath(icon_path)
    if not _os.path.exists(icon_path):
        raise HTTPException(status_code=404, detail="icon not found")
    return FileResponse(
        icon_path,
        media_type="image/png",
        filename="geobeats_icon_1024.png",
    )


@api_router.get("/assets/fonts/{filename}")
async def geobeats_font_asset(filename: str):
    """Serve bundled TTF fonts over HTTPS — fallback path for Expo Go SDK 54
    fast-resolver bug that returns empty buffers for required font assets.
    The frontend uses Font.loadAsync({ ionicons: { uri: <this URL> } }) to
    bypass Metro's broken asset bundler entirely.
    """
    from fastapi.responses import FileResponse
    import os as _os
    if "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="invalid filename")
    if not filename.lower().endswith(".ttf"):
        raise HTTPException(status_code=400, detail="only .ttf supported")
    base = _os.path.abspath(
        _os.path.join(_os.path.dirname(__file__), "..", "frontend", "assets", "fonts")
    )
    path = _os.path.join(base, filename)
    if not _os.path.exists(path):
        raise HTTPException(status_code=404, detail="font not found")
    return FileResponse(
        path,
        media_type="font/ttf",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@api_router.get("/assets/store/{filename}")
async def geobeats_store_asset(filename: str):
    """Serve Play Store listing assets (icon_512.png, feature_graphic.png)."""
    from fastapi.responses import FileResponse
    import os as _os
    # basic path-traversal guard
    if "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="invalid filename")
    base = _os.path.abspath(
        _os.path.join(_os.path.dirname(__file__), "..", "frontend", "assets", "store")
    )
    path = _os.path.join(base, filename)
    if not _os.path.exists(path):
        raise HTTPException(status_code=404, detail="asset not found")
    return FileResponse(path, media_type="image/png", filename=filename)


@api_router.get("/assets/store/screenshots/{filename}")
async def geobeats_store_screenshot(filename: str):
    """Serve Play Store phone screenshots (1080x1920 PNG)."""
    from fastapi.responses import FileResponse
    import os as _os
    if "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="invalid filename")
    base = _os.path.abspath(
        _os.path.join(_os.path.dirname(__file__), "..", "frontend", "assets", "store", "screenshots")
    )
    path = _os.path.join(base, filename)
    if not _os.path.exists(path):
        raise HTTPException(status_code=404, detail="screenshot not found")
    return FileResponse(path, media_type="image/png", filename=filename)




# ---------------------------------------------------------------------------
# Static pages (App Store required URLs)
# ---------------------------------------------------------------------------

@api_router.get("/privacy", response_class=HTMLResponse)
async def privacy_policy():
    template_path = ROOT_DIR / "templates" / "privacy.html"
    if template_path.exists():
        return HTMLResponse(content=template_path.read_text())
    return HTMLResponse(content="<h1>Privacy Policy</h1><p>Contact support@geobeats.live</p>")

@api_router.get("/support", response_class=HTMLResponse)
async def support_page():
    template_path = ROOT_DIR / "templates" / "support.html"
    if template_path.exists():
        return HTMLResponse(content=template_path.read_text())
    return HTMLResponse(content="<h1>Support</h1><p>Email support@geobeats.live</p>")


# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '').split(',') if os.environ.get('CORS_ORIGINS') else ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

class PermissionsPolicyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["Permissions-Policy"] = "geolocation=*, camera=(), microphone=()"
        response.headers["Feature-Policy"] = "geolocation *"
        return response

app.add_middleware(PermissionsPolicyMiddleware)

@app.on_event("startup")
async def startup_event():
    await manager.event_bus.ensure_capped_collection()
    manager.set_event_bus_started()
    logger.info(f"[{INSTANCE_ID}] GeoBeats v2 startup complete")

@app.on_event("shutdown")
async def shutdown_db_client():
    manager.shutdown()
    client.close()
