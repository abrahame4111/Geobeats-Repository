from fastapi import FastAPI, APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Query, Header
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
