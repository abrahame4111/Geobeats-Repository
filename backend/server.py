from fastapi import FastAPI, APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Query
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
SPOTIFY_REDIRECT_URI = os.environ.get('SPOTIFY_REDIRECT_URI', 'https://musicmap-build.preview.emergentagent.com/auth/callback')

# Google Maps Configuration (Placeholder)
GOOGLE_MAPS_API_KEY = os.environ.get('GOOGLE_MAPS_API_KEY', 'YOUR_GOOGLE_MAPS_API_KEY_HERE')

# WebSocket Connection Manager for real-time location updates
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.user_locations: Dict[str, Dict] = {}
    
    async def connect(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        self.active_connections[user_id] = websocket
        logger.info(f"🔗 User {user_id} connected. Total connections: {len(self.active_connections)}")
        logger.info(f"📍 Current active users: {list(self.active_connections.keys())}")
        
        # Send current locations to newly connected user
        if self.user_locations:
            initial_message = {
                "type": "initial_locations",
                "locations": self.user_locations
            }
            logger.info(f"📤 Sending initial locations to {user_id}: {len(self.user_locations)} locations")
            await websocket.send_text(json.dumps(initial_message))
        else:
            logger.info(f"📍 No existing locations to send to {user_id}")
    
    def disconnect(self, user_id: str):
        if user_id in self.active_connections:
            del self.active_connections[user_id]
            logger.info(f"❌ User {user_id} disconnected. Remaining connections: {len(self.active_connections)}")
        if user_id in self.user_locations:
            del self.user_locations[user_id]
            logger.info(f"📍 Removed location for {user_id}. Remaining locations: {len(self.user_locations)}")
    
    async def broadcast_update(self, user_id: str, location_data: Dict):
        self.user_locations[user_id] = location_data
        logger.info(f"📍 Storing location for {user_id}: lat={location_data.get('lat')}, lng={location_data.get('lng')}")
        
        message = json.dumps({
            "type": "location_update",
            "user_id": user_id,
            "location": location_data,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        
        logger.info(f"📡 Broadcasting update from {user_id} to {len(self.active_connections)} connections")
        logger.info(f"📤 Recipients: {list(self.active_connections.keys())}")
        
        disconnected = []
        broadcast_count = 0
        for uid, connection in self.active_connections.items():
            try:
                await connection.send_text(message)
                broadcast_count += 1
                logger.info(f"✅ Successfully sent to {uid}")
            except Exception as e:
                logger.error(f"❌ Failed to send to {uid}: {e}")
                disconnected.append(uid)
        
        logger.info(f"📊 Broadcast summary: {broadcast_count} successful, {len(disconnected)} failed")
        
        for uid in disconnected:
            self.disconnect(uid)

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
    """Initiate Spotify OAuth flow"""
    scope = "user-read-private user-read-email user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative streaming"
    
    auth_url = (
        f"https://accounts.spotify.com/authorize?"
        f"client_id={SPOTIFY_CLIENT_ID}&"
        f"response_type=code&"
        f"redirect_uri={SPOTIFY_REDIRECT_URI}&"
        f"scope={scope}"
    )
    
    return {"auth_url": auth_url}

@api_router.get("/auth/callback")
async def spotify_callback(code: str = Query(...)):
    """Handle Spotify OAuth callback"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
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
            profile_response = await client.get(
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
            from fastapi.responses import RedirectResponse
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
            
            # Redirect to frontend login page with auth data
            redirect_url = f"/?{urlencode(auth_params)}"
            return RedirectResponse(url=redirect_url)
    except Exception as e:
        logger.error(f"OAuth callback error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/auth/refresh")
async def refresh_token(refresh_token: str):
    """Refresh Spotify access token"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
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
async def get_current_user(access_token: str = Query(...)):
    """Get current user profile"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.spotify.com/v1/me",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail="Failed to get user")
            
            return response.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/spotify/playlists")
async def get_user_playlists(access_token: str = Query(...)):
    """Get user's playlists"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
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
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.spotify.com/v1/browse/categories?limit=50",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail="Failed to get categories")
            
            return response.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/spotify/currently-playing")
async def get_currently_playing(access_token: str = Query(...)):
    """Get currently playing track"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.spotify.com/v1/me/player/currently-playing",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            
            if response.status_code == 204:
                return {"is_playing": False}
            
            if response.status_code != 200:
                return {"is_playing": False}
            
            return response.json()
    except Exception as e:
        return {"is_playing": False}

@api_router.get("/spotify/queue")
async def get_queue(access_token: str = Query(...)):
    """Get user's playback queue"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.spotify.com/v1/me/player/queue",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            
            if response.status_code != 200:
                return {"queue": []}
            
            return response.json()
    except Exception as e:
        return {"queue": []}

@api_router.post("/spotify/play")
async def play_track(access_token: str = Query(...), uri: Optional[str] = None):
    """Play a track or resume playback"""
    try:
        async with httpx.AsyncClient() as client:
            body = {"uris": [uri]} if uri else None
            response = await client.put(
                "https://api.spotify.com/v1/me/player/play",
                headers={"Authorization": f"Bearer {access_token}"},
                json=body
            )
            
            return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/spotify/pause")
async def pause_playback(access_token: str = Query(...)):
    """Pause playback"""
    try:
        async with httpx.AsyncClient() as client:
            await client.put(
                "https://api.spotify.com/v1/me/player/pause",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            
            return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/spotify/next")
async def next_track(access_token: str = Query(...)):
    """Skip to next track"""
    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                "https://api.spotify.com/v1/me/player/next",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            
            return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/spotify/previous")
async def previous_track(access_token: str = Query(...)):
    """Skip to previous track"""
    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                "https://api.spotify.com/v1/me/player/previous",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            
            return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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
        async with httpx.AsyncClient() as client:
            response = await client.get(url, timeout=5.0)
            
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
    """WebSocket endpoint for real-time location and song updates"""
    logger.info(f"🚀 WebSocket connection requested for user: {user_id}")
    await manager.connect(websocket, user_id)
    
    try:
        while True:
            data = await websocket.receive_text()
            logger.info(f"📥 Received data from {user_id}: {data}")
            location_data = json.loads(data)
            
            # Validate location data
            if "lat" in location_data and "lng" in location_data:
                location_data["user_id"] = user_id
                location_data["last_updated"] = datetime.now(timezone.utc).isoformat()
                
                logger.info(f"📍 Valid location data from {user_id}, broadcasting to all users")
                await manager.broadcast_update(user_id, location_data)
            else:
                logger.warning(f"⚠️ Invalid location data from {user_id}: missing lat/lng")
                
    except WebSocketDisconnect:
        logger.info(f"🔌 WebSocket disconnect detected for {user_id}")
        manager.disconnect(user_id)
        await manager.broadcast_update(user_id, {"disconnected": True})
    except Exception as e:
        logger.error(f"❌ WebSocket error for user {user_id}: {e}")
        manager.disconnect(user_id)

# Health check
@api_router.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "active_connections": len(manager.active_connections),
        "tracked_users": len(manager.user_locations),
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
        # Allow geolocation for all origins (needed for iframe/preview environments)
        response.headers["Permissions-Policy"] = "geolocation=*, camera=(), microphone=()"
        # Also set Feature-Policy for older browsers
        response.headers["Feature-Policy"] = "geolocation *"
        return response

app.add_middleware(PermissionsPolicyMiddleware)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
