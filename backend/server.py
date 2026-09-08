from fastapi import FastAPI, APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Query, Header
from fastapi.responses import RedirectResponse, JSONResponse, HTMLResponse
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

@api_router.get("/auth/login")
async def spotify_login(mobile_redirect: Optional[str] = Query(None)):
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

    from urllib.parse import urlencode
    params = {
        "client_id": SPOTIFY_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": SPOTIFY_REDIRECT_URI,
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
async def spotify_login_legacy(mobile_redirect: Optional[str] = Query(None)):
    return await spotify_login(mobile_redirect=mobile_redirect)


@api_router.get("/auth/callback")
async def spotify_callback(code: str = Query(...), state: Optional[str] = Query(None)):
    """Handle Spotify OAuth callback"""
    try:
        async with httpx.AsyncClient() as http_client:
            response = await http_client.post(
                "https://accounts.spotify.com/api/token",
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": SPOTIFY_REDIRECT_URI,
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

            auth_params = {
                "access_token": access_token,
                "refresh_token": refresh_token,
                "expires_in": str(expires_in),
                "user_id": profile["id"],
                "user_name": profile.get("display_name", ""),
                "user_email": profile.get("email", "")
            }

            # If state encodes a mobile deep link, redirect there
            if state:
                try:
                    mobile_redirect = base64.urlsafe_b64decode(state.encode()).decode()
                    redirect_url = f"{mobile_redirect}?{ue(auth_params)}"
                    logger.info(f"Mobile OAuth redirect → {mobile_redirect}")
                    return RedirectResponse(url=redirect_url)
                except Exception:
                    pass

            # Web fallback
            redirect_url = f"/#callback?{ue(auth_params)}"
            logger.info(f"Web OAuth redirect → {redirect_url}")
            return RedirectResponse(url=redirect_url)

    except Exception as e:
        logger.error(f"OAuth callback error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Keep legacy path so existing TestFlight builds still work
@api_router.get("/spotify/callback")
async def spotify_callback_legacy(code: str = Query(...), state: Optional[str] = Query(None)):
    return await spotify_callback(code=code, state=state)


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
