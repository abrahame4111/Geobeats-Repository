from fastapi import FastAPI, APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Query, Header
from fastapi.responses import RedirectResponse, JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import json
import asyncio
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Dict, Optional
import uuid
from datetime import datetime, timezone
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Spotify Configuration (Placeholders)
SPOTIFY_CLIENT_ID = os.environ.get('SPOTIFY_CLIENT_ID', 'YOUR_SPOTIFY_CLIENT_ID_HERE')
SPOTIFY_CLIENT_SECRET = os.environ.get('SPOTIFY_CLIENT_SECRET', 'YOUR_SPOTIFY_CLIENT_SECRET_HERE')
SPOTIFY_REDIRECT_URI = os.environ.get('SPOTIFY_REDIRECT_URI', 'https://mapify-social.preview.emergentagent.com/auth/callback')

# Google Maps Configuration (Placeholder)
GOOGLE_MAPS_API_KEY = os.environ.get('GOOGLE_MAPS_API_KEY', 'YOUR_GOOGLE_MAPS_API_KEY_HERE')

# Configure logging first
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Listen Together Session Manager
class ListenTogetherManager:
    def __init__(self):
        self.sessions: Dict[str, Dict] = {}  # session_id -> session data
        self.user_sessions: Dict[str, str] = {}  # user_id -> session_id
    
    def create_session(self, host_id: str, track_uri: str, track_info: Dict) -> str:
        session_id = str(uuid.uuid4())[:8]
        self.sessions[session_id] = {
            "host_id": host_id,
            "participants": [host_id],
            "current_track_uri": track_uri,
            "track_info": track_info,
            "position_ms": 0,
            "is_playing": True,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        self.user_sessions[host_id] = session_id
        logger.info(f"🎵 Listen Together session created: {session_id} by {host_id}")
        return session_id
    
    def join_session(self, user_id: str, session_id: str) -> Optional[Dict]:
        if session_id in self.sessions:
            if user_id not in self.sessions[session_id]["participants"]:
                self.sessions[session_id]["participants"].append(user_id)
            self.user_sessions[user_id] = session_id
            logger.info(f"🎧 User {user_id} joined session {session_id}")
            return self.sessions[session_id]
        return None
    
    def leave_session(self, user_id: str):
        if user_id in self.user_sessions:
            session_id = self.user_sessions[user_id]
            if session_id in self.sessions:
                session = self.sessions[session_id]
                if user_id in session["participants"]:
                    session["participants"].remove(user_id)
                
                # If host leaves or no participants, end session
                if user_id == session["host_id"] or len(session["participants"]) == 0:
                    del self.sessions[session_id]
                    logger.info(f"🔚 Session {session_id} ended")
            
            del self.user_sessions[user_id]
    
    def update_playback(self, session_id: str, track_uri: str, track_info: Dict, position_ms: int, is_playing: bool):
        if session_id in self.sessions:
            self.sessions[session_id]["current_track_uri"] = track_uri
            self.sessions[session_id]["track_info"] = track_info
            self.sessions[session_id]["position_ms"] = position_ms
            self.sessions[session_id]["is_playing"] = is_playing
            return self.sessions[session_id]
        return None
    
    def get_session(self, session_id: str) -> Optional[Dict]:
        return self.sessions.get(session_id)
    
    def get_user_session(self, user_id: str) -> Optional[Dict]:
        session_id = self.user_sessions.get(user_id)
        if session_id:
            return self.sessions.get(session_id)
        return None

listen_together_manager = ListenTogetherManager()

# WebSocket Connection Manager for real-time location updates
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.user_locations: Dict[str, Dict] = {}
        self.user_info: Dict[str, Dict] = {}  # Store user info like premium status
    
    async def connect(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        self.active_connections[user_id] = websocket
        logger.info(f"🔗 User {user_id} connected. Total connections: {len(self.active_connections)}")
        
        # Send current locations and online count to newly connected user
        initial_message = {
            "type": "initial_state",
            "locations": self.user_locations,
            "online_count": len(self.active_connections),
            "online_users": list(self.active_connections.keys())
        }
        logger.info(f"📤 Sending initial state to {user_id}: {len(self.user_locations)} locations, {len(self.active_connections)} online")
        await websocket.send_text(json.dumps(initial_message))
        
        # Broadcast updated online count to all users
        await self.broadcast_online_count()
    
    def disconnect(self, user_id: str):
        if user_id in self.active_connections:
            del self.active_connections[user_id]
            logger.info(f"❌ User {user_id} disconnected. Remaining connections: {len(self.active_connections)}")
        if user_id in self.user_locations:
            del self.user_locations[user_id]
        if user_id in self.user_info:
            del self.user_info[user_id]
        
        # Leave any listen together session
        listen_together_manager.leave_session(user_id)
    
    async def broadcast_online_count(self):
        """Broadcast updated online count to all connected users"""
        message = json.dumps({
            "type": "online_count_update",
            "online_count": len(self.active_connections),
            "online_users": list(self.active_connections.keys())
        })
        
        for uid, connection in list(self.active_connections.items()):
            try:
                await connection.send_text(message)
            except Exception as e:
                logger.error(f"Failed to send online count to {uid}: {e}")
    
    async def broadcast_update(self, user_id: str, location_data: Dict):
        self.user_locations[user_id] = location_data
        
        message = json.dumps({
            "type": "location_update",
            "user_id": user_id,
            "location": location_data,
            "online_count": len(self.active_connections),
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        
        disconnected = []
        for uid, connection in list(self.active_connections.items()):
            try:
                await connection.send_text(message)
            except Exception as e:
                logger.error(f"❌ Failed to send to {uid}: {e}")
                disconnected.append(uid)
        
        for uid in disconnected:
            self.disconnect(uid)
            await self.broadcast_online_count()
    
    async def broadcast_listen_together(self, session_id: str, event_type: str, data: Dict):
        """Broadcast listen together events to session participants"""
        session = listen_together_manager.get_session(session_id)
        if not session:
            return
        
        message = json.dumps({
            "type": "listen_together",
            "event": event_type,
            "session_id": session_id,
            "data": data,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        
        for participant_id in session["participants"]:
            if participant_id in self.active_connections:
                try:
                    await self.active_connections[participant_id].send_text(message)
                    logger.info(f"🎵 Sent {event_type} to {participant_id}")
                except Exception as e:
                    logger.error(f"Failed to send listen together update to {participant_id}: {e}")
    
    async def send_to_user(self, user_id: str, message: Dict):
        """Send a message to a specific user"""
        if user_id in self.active_connections:
            try:
                await self.active_connections[user_id].send_text(json.dumps(message))
            except Exception as e:
                logger.error(f"Failed to send message to {user_id}: {e}")

manager = ConnectionManager()

# Create the main app
app = FastAPI(title="Music Navigator", version="1.0.0")

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

# Spotify OAuth endpoints
@api_router.get("/auth/login")
async def spotify_login():
    """Initiate Spotify OAuth flow - Redirects to Spotify"""
    scope = "user-read-private user-read-email user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative streaming"
    
    auth_url = (
        f"https://accounts.spotify.com/authorize?"
        f"client_id={SPOTIFY_CLIENT_ID}&"
        f"response_type=code&"
        f"redirect_uri={SPOTIFY_REDIRECT_URI}&"
        f"scope={scope}"
    )
    
    return RedirectResponse(url=auth_url)

@api_router.get("/auth/callback")
async def spotify_callback(code: str = Query(...)):
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
            
            # Get user profile
            profile_response = await http_client.get(
                "https://api.spotify.com/v1/me",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            
            if profile_response.status_code != 200:
                raise HTTPException(status_code=400, detail="Failed to get user profile")
            
            profile = profile_response.json()
            
            # Store or update user in database
            user_data = {
                "spotify_id": profile["id"],
                "display_name": profile.get("display_name"),
                "email": profile.get("email"),
                "access_token": access_token,
                "refresh_token": refresh_token,
                "token_expires_at": datetime.now(timezone.utc).timestamp() + expires_in,
                "updated_at": datetime.now(timezone.utc).isoformat()
            }
            
            await db.users.update_one(
                {"spotify_id": profile["id"]},
                {"$set": user_data},
                upsert=True
            )
            
            # Redirect to frontend with tokens
            from urllib.parse import urlencode
            
            # Create query parameters with auth data
            auth_params = {
                "access_token": access_token,
                "refresh_token": refresh_token,
                "expires_in": str(expires_in),
                "user_id": profile["id"],
                "user_name": profile.get("display_name", ""),
                "user_email": profile.get("email", "")
            }
            
            # Redirect with hash params so mobile WebView can intercept
            redirect_url = f"/#callback?{urlencode(auth_params)}"
            logger.info(f"Redirecting to: {redirect_url}")
            return RedirectResponse(url=redirect_url)
    except Exception as e:
        logger.error(f"OAuth callback error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/auth/refresh")
async def refresh_token(refresh_token: str):
    """Refresh Spotify access token"""
    try:
        async with httpx.AsyncClient() as http_client:
            response = await http_client.post(
                "https://accounts.spotify.com/api/token",
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Spotify API endpoints
@api_router.get("/spotify/me")
async def get_current_user(authorization: str = Header(...)):
    """Get current user profile"""
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
    except Exception as e:
        logger.error(f"Error fetching Spotify profile: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/spotify/premium-status")
async def check_premium_status(authorization: str = Header(...)):
    """Check if user has Spotify Premium"""
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
    except Exception as e:
        logger.error(f"Error checking premium status: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/spotify/playlists")
async def get_user_playlists(access_token: str = Query(...)):
    """Get user's playlists"""
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
    """Get Spotify browse categories"""
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
async def get_currently_playing(authorization: str = Header(...)):
    """Get currently playing track"""
    try:
        access_token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
        
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(
                "https://api.spotify.com/v1/me/player/currently-playing",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            
            if response.status_code == 204:
                logger.info("No track currently playing")
                return {"is_playing": False}
            
            if response.status_code != 200:
                logger.warning(f"Spotify API returned {response.status_code}")
                return {"is_playing": False}
            
            return response.json()
    except Exception as e:
        logger.error(f"Error fetching currently playing: {str(e)}")
        return {"is_playing": False}

@api_router.get("/spotify/player")
async def get_player_state(authorization: str = Header(...)):
    """Get full player state including device and progress"""
    try:
        access_token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
        
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(
                "https://api.spotify.com/v1/me/player",
                headers={"Authorization": f"Bearer {access_token}"}
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
async def get_devices(authorization: str = Header(...)):
    """Get available Spotify devices"""
    try:
        access_token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
        
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(
                "https://api.spotify.com/v1/me/player/devices",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            
            if response.status_code != 200:
                return {"devices": []}
            
            return response.json()
    except Exception as e:
        logger.error(f"Error fetching devices: {str(e)}")
        return {"devices": []}

@api_router.get("/spotify/queue")
async def get_queue(access_token: str = Query(...)):
    """Get user's playback queue"""
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
    """Play a track or resume playback"""
    try:
        access_token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
        logger.info(f"🎵 Play request - URI: {uri}, position_ms: {position_ms}")
        
        async with httpx.AsyncClient() as http_client:
            # First check if there's an active device
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
            
            # Find an active device or use the first one
            device_id = None
            for device in active_devices:
                if device.get("is_active"):
                    device_id = device.get("id")
                    break
            if not device_id and active_devices:
                device_id = active_devices[0].get("id")
            
            # Build the request
            body = {}
            if uri:
                body["uris"] = [uri]
            if position_ms:
                body["position_ms"] = position_ms
            
            # Add device_id to URL if we have one
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
    """Pause playback"""
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
    """Skip to next track"""
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
    """Skip to previous track"""
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
    """Seek to position in track"""
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
    """Get tracks from a playlist"""
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
    """Play a context (playlist, album, artist)"""
    try:
        access_token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
        logger.info(f"🎵 Play context request - URI: {context_uri}")
        
        async with httpx.AsyncClient() as http_client:
            # First check if there's an active device
            devices_response = await http_client.get(
                "https://api.spotify.com/v1/me/player/devices",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            
            devices_data = devices_response.json() if devices_response.status_code == 200 else {"devices": []}
            active_devices = devices_data.get("devices", [])
            logger.info(f"🔊 Available devices: {len(active_devices)}")
            
            if not active_devices:
                return {"success": False, "error": "No active Spotify device found. Please open Spotify on your phone or computer."}
            
            # Find an active device or use the first one
            device_id = None
            for device in active_devices:
                if device.get("is_active"):
                    device_id = device.get("id")
                    break
            if not device_id and active_devices:
                device_id = active_devices[0].get("id")
            
            # Build the request
            play_url = "https://api.spotify.com/v1/me/player/play"
            if device_id:
                play_url += f"?device_id={device_id}"
            
            response = await http_client.put(
                play_url,
                headers={"Authorization": f"Bearer {access_token}"},
                json={"context_uri": context_uri}
            )
            
            logger.info(f"🎵 Play context response: {response.status_code}")
            
            if response.status_code in [204, 200, 202]:
                return {"success": True}
            elif response.status_code == 404:
                return {"success": False, "error": "No active device found. Please open Spotify."}
            elif response.status_code == 403:
                return {"success": False, "error": "Premium required for playback control."}
            else:
                logger.error(f"Play context failed: {response.status_code} - {response.text}")
                return {"success": False, "error": f"Playback failed: {response.text}"}
    except Exception as e:
        logger.error(f"Play context error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/spotify/proxy")
async def proxy_spotify_request(url: str = Query(...), access_token: str = Query(...)):
    """Proxy any Spotify API request"""
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
    """Search Spotify for tracks"""
    try:
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(
                f"https://api.spotify.com/v1/search?q={q}&type=track&limit=30",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            
            if response.status_code != 200:
                logger.error(f"Search failed: {response.status_code}")
                raise HTTPException(status_code=response.status_code, detail="Search failed")
            
            return response.json()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Search error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/spotify/category/{category_id}/playlists")
async def get_category_playlists(category_id: str, access_token: str = Query(...)):
    """Get playlists for a category"""
    try:
        async with httpx.AsyncClient() as http_client:
            # Try direct category playlists endpoint with different locales
            for locale in ["", "US", "GB"]:
                country_param = f"&country={locale}" if locale else ""
                response = await http_client.get(
                    f"https://api.spotify.com/v1/browse/categories/{category_id}/playlists?limit=50{country_param}",
                    headers={"Authorization": f"Bearer {access_token}"}
                )
                
                if response.status_code == 200:
                    data = response.json()
                    items = data.get("playlists", {}).get("items", [])
                    # Filter out null items
                    valid_items = [item for item in items if item and item.get("id")]
                    if valid_items:
                        logger.info(f"Found {len(valid_items)} playlists for category {category_id}")
                        return {"playlists": {"items": valid_items}}
            
            # If direct endpoint fails, search for playlists by category name
            logger.info(f"Direct category fetch returned no results, trying search")
            
            # Get category info first
            cat_response = await http_client.get(
                f"https://api.spotify.com/v1/browse/categories/{category_id}",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            
            if cat_response.status_code == 200:
                cat_data = cat_response.json()
                category_name = cat_data.get("name", category_id)
                
                # Search for playlists with that name
                search_response = await http_client.get(
                    f"https://api.spotify.com/v1/search?q={category_name}&type=playlist&limit=50",
                    headers={"Authorization": f"Bearer {access_token}"}
                )
                
                if search_response.status_code == 200:
                    search_data = search_response.json()
                    items = search_data.get("playlists", {}).get("items", [])
                    valid_items = [item for item in items if item and item.get("id")]
                    if valid_items:
                        logger.info(f"Found {len(valid_items)} playlists via search for {category_name}")
                        return {"playlists": {"items": valid_items}}
            
            # Last resort: return featured playlists
            logger.info(f"Falling back to featured playlists")
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
        logger.error(f"Category playlists error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Listen Together endpoints
@api_router.post("/listen-together/create")
async def create_listen_session(authorization: str = Header(...)):
    """Create a new Listen Together session"""
    try:
        access_token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
        
        # Get current track
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
            
            # Get user ID
            profile_response = await http_client.get(
                "https://api.spotify.com/v1/me",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            profile = profile_response.json()
            user_id = profile["id"]
            
            # Create session
            session_id = listen_together_manager.create_session(
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
            
            return {
                "session_id": session_id,
                "track_info": listen_together_manager.get_session(session_id)["track_info"]
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Create session error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/listen-together/join/{session_id}")
async def join_listen_session(session_id: str, authorization: str = Header(...)):
    """Join an existing Listen Together session"""
    try:
        access_token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
        
        # Get user ID
        async with httpx.AsyncClient() as http_client:
            profile_response = await http_client.get(
                "https://api.spotify.com/v1/me",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            profile = profile_response.json()
            user_id = profile["id"]
        
        session = listen_together_manager.join_session(user_id, session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        
        # Start playing the same track
        async with httpx.AsyncClient() as http_client:
            await http_client.put(
                "https://api.spotify.com/v1/me/player/play",
                headers={"Authorization": f"Bearer {access_token}"},
                json={
                    "uris": [session["current_track_uri"]],
                    "position_ms": session["position_ms"]
                }
            )
        
        # Notify all participants
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
    """Leave current Listen Together session"""
    try:
        access_token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
        
        async with httpx.AsyncClient() as http_client:
            profile_response = await http_client.get(
                "https://api.spotify.com/v1/me",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            profile = profile_response.json()
            user_id = profile["id"]
        
        session_id = listen_together_manager.user_sessions.get(user_id)
        if session_id:
            listen_together_manager.leave_session(user_id)
            
            # Notify remaining participants
            session = listen_together_manager.get_session(session_id)
            if session:
                await manager.broadcast_listen_together(session_id, "user_left", {
                    "user_id": user_id,
                    "participants": session["participants"]
                })
        
        return {"success": True}
    except Exception as e:
        logger.error(f"Leave session error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/listen-together/session/{session_id}")
async def get_listen_session(session_id: str):
    """Get Listen Together session info"""
    session = listen_together_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session

# Google Maps API endpoint
@api_router.get("/maps/key")
async def get_maps_key():
    """Get Google Maps API key for frontend"""
    return {"api_key": GOOGLE_MAPS_API_KEY}

# Proxy endpoint for profile images (to handle CORS)
@api_router.get("/proxy/image")
async def proxy_image(url: str = Query(...)):
    """Proxy images to avoid CORS issues"""
    try:
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(url, timeout=5.0)
            
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
    except Exception as e:
        logger.error(f"Failed to proxy image: {e}")
        raise HTTPException(status_code=500, detail="Failed to load image")

# WebSocket endpoint for real-time location sharing
@api_router.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    """WebSocket endpoint for real-time location, song, and listen together updates"""
    logger.info(f"🚀 WebSocket connection requested for user: {user_id}")
    await manager.connect(websocket, user_id)
    
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            msg_type = message.get("type", "location_update")
            
            if msg_type == "location_update":
                # Handle location update
                location_data = {
                    "lat": message.get("latitude"),
                    "lng": message.get("longitude"),
                    "user_id": user_id,
                    "user_name": message.get("user_name"),
                    "current_song": message.get("current_song"),
                    "artist": message.get("artist"),
                    "album_cover": message.get("album_cover"),
                    "profile_image": message.get("profile_image"),
                    "track_uri": message.get("track_uri"),
                    "is_premium": message.get("is_premium", False),
                    "listen_session_id": listen_together_manager.user_sessions.get(user_id),
                    "last_updated": datetime.now(timezone.utc).isoformat()
                }
                
                await manager.broadcast_update(user_id, location_data)
            
            elif msg_type == "user_disconnect":
                # Handle user disconnect/hide
                manager.disconnect(user_id)
                await manager.broadcast_online_count()
            
            elif msg_type == "listen_together_sync":
                # Host syncing playback state to all participants
                session_id = listen_together_manager.user_sessions.get(user_id)
                if session_id:
                    session = listen_together_manager.get_session(session_id)
                    if session and session["host_id"] == user_id:
                        # Update session state
                        listen_together_manager.update_playback(
                            session_id,
                            message.get("track_uri"),
                            message.get("track_info", {}),
                            message.get("position_ms", 0),
                            message.get("is_playing", True)
                        )
                        
                        # Broadcast to all participants
                        await manager.broadcast_listen_together(session_id, "playback_sync", {
                            "track_uri": message.get("track_uri"),
                            "track_info": message.get("track_info"),
                            "position_ms": message.get("position_ms"),
                            "is_playing": message.get("is_playing")
                        })
            
            elif msg_type == "listen_together_invite":
                # Send invite to specific user
                target_user_id = message.get("target_user_id")
                session_id = message.get("session_id")
                
                if target_user_id and session_id:
                    session = listen_together_manager.get_session(session_id)
                    if session:
                        await manager.send_to_user(target_user_id, {
                            "type": "listen_together_invite",
                            "session_id": session_id,
                            "host_id": user_id,
                            "host_name": message.get("host_name"),
                            "track_info": session["track_info"]
                        })
                        logger.info(f"🎧 Sent listen together invite from {user_id} to {target_user_id}")
                
    except WebSocketDisconnect:
        logger.info(f"🔌 WebSocket disconnect detected for {user_id}")
        manager.disconnect(user_id)
        await manager.broadcast_online_count()
    except Exception as e:
        logger.error(f"❌ WebSocket error for user {user_id}: {e}")
        manager.disconnect(user_id)
        await manager.broadcast_online_count()

# Health check
@api_router.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "active_connections": len(manager.active_connections),
        "tracked_users": len(manager.user_locations),
        "active_listen_sessions": len(listen_together_manager.sessions),
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

# Include router
app.include_router(api_router)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add middleware for Permissions-Policy header
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

class PermissionsPolicyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["Permissions-Policy"] = "geolocation=*, camera=(), microphone=()"
        response.headers["Feature-Policy"] = "geolocation *"
        return response

app.add_middleware(PermissionsPolicyMiddleware)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
