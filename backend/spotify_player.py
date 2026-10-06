"""Spotify playback-control endpoints consumed by the mobile app.

All routes take the access token in the JSON body (`PlayRequest`), matching
frontend/src/api.ts (`playerAction`, `playNow`, `addToQueue`, `setRepeat`).
"""
import logging
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/spotify")

SPOTIFY = "https://api.spotify.com/v1"
NO_DEVICE_MSG = "No Spotify devices available. Open Spotify on any of your devices to start playback."


class PlayRequest(BaseModel):
    access_token: str
    track_uri: Optional[str] = None
    position_ms: Optional[int] = 0
    device_id: Optional[str] = None


class RepeatRequest(BaseModel):
    access_token: str
    state: str  # off | track | context


def _headers(token: str):
    return {"Authorization": f"Bearer {token}"}


async def _resolve_device(http: httpx.AsyncClient, token: str, device_id: Optional[str]) -> Optional[str]:
    """Return an active/available device id, transferring playback to the
    first available device when none is active. None = no devices at all."""
    r = await http.get(f"{SPOTIFY}/me/player/devices", headers=_headers(token))
    devs = (r.json() or {}).get("devices", []) if r.status_code == 200 else []
    if not devs:
        return None
    if device_id and any(d.get("id") == device_id for d in devs):
        return device_id
    active = next((d for d in devs if d.get("is_active")), None)
    if active:
        return active.get("id")
    target = next((d for d in devs if not d.get("is_restricted")), devs[0])
    target_id = target.get("id")
    try:
        await http.put(f"{SPOTIFY}/me/player", headers=_headers(token), json={"device_ids": [target_id], "play": False})
    except Exception:
        pass
    return target_id


def _raise_if_failed(r: httpx.Response):
    if r.status_code in (200, 202, 204):
        return
    if r.status_code == 403:
        raise HTTPException(status_code=403, detail="Spotify Premium is required for playback control.")
    if r.status_code == 404:
        raise HTTPException(status_code=404, detail=NO_DEVICE_MSG)
    raise HTTPException(status_code=400, detail=f"Spotify error {r.status_code}: {r.text}")


@router.post("/play")
async def play(body: PlayRequest):
    async with httpx.AsyncClient(timeout=10) as http:
        device = await _resolve_device(http, body.access_token, body.device_id)
        if device is None:
            raise HTTPException(status_code=404, detail=NO_DEVICE_MSG)
        payload = {}
        if body.track_uri:
            payload["uris"] = [body.track_uri]
        if body.position_ms:
            payload["position_ms"] = body.position_ms
        r = await http.put(f"{SPOTIFY}/me/player/play", params={"device_id": device},
                           headers=_headers(body.access_token), json=payload or None)
        _raise_if_failed(r)
        return {"status": "playing", "device_id": device}


@router.post("/play-now")
async def play_now(body: PlayRequest):
    """Play `track_uri` immediately while preserving the user's upcoming queue."""
    if not body.track_uri:
        raise HTTPException(status_code=400, detail="track_uri required")
    async with httpx.AsyncClient(timeout=10) as http:
        device = await _resolve_device(http, body.access_token, body.device_id)
        if device is None:
            raise HTTPException(status_code=404, detail=NO_DEVICE_MSG)
        queue_uris = []
        try:
            q = await http.get(f"{SPOTIFY}/me/player/queue", headers=_headers(body.access_token))
            if q.status_code == 200:
                for t in (q.json() or {}).get("queue") or []:
                    uri = t.get("uri")
                    if uri and uri != body.track_uri:
                        queue_uris.append(uri)
        except Exception:
            pass
        r = await http.put(f"{SPOTIFY}/me/player/play", params={"device_id": device},
                           headers=_headers(body.access_token),
                           json={"uris": [body.track_uri] + queue_uris[:99]})
        _raise_if_failed(r)
        return {"status": "playing", "device_id": device, "preserved_queue_size": len(queue_uris)}


@router.post("/pause")
async def pause(body: PlayRequest):
    async with httpx.AsyncClient(timeout=10) as http:
        r = await http.put(f"{SPOTIFY}/me/player/pause", headers=_headers(body.access_token))
        _raise_if_failed(r)
        return {"status": "paused"}


@router.post("/next")
async def next_track(body: PlayRequest):
    async with httpx.AsyncClient(timeout=10) as http:
        r = await http.post(f"{SPOTIFY}/me/player/next", headers=_headers(body.access_token))
        _raise_if_failed(r)
        return {"status": "skipped"}


@router.post("/previous")
async def previous_track(body: PlayRequest):
    async with httpx.AsyncClient(timeout=10) as http:
        r = await http.post(f"{SPOTIFY}/me/player/previous", headers=_headers(body.access_token))
        _raise_if_failed(r)
        return {"status": "previous"}


@router.post("/seek")
async def seek(body: PlayRequest):
    async with httpx.AsyncClient(timeout=10) as http:
        r = await http.put(f"{SPOTIFY}/me/player/seek", params={"position_ms": body.position_ms or 0},
                           headers=_headers(body.access_token))
        _raise_if_failed(r)
        return {"status": "seeked"}


@router.post("/queue")
async def add_to_queue(body: PlayRequest):
    if not body.track_uri:
        raise HTTPException(status_code=400, detail="track_uri required")
    async with httpx.AsyncClient(timeout=10) as http:
        device = await _resolve_device(http, body.access_token, body.device_id)
        if device is None:
            raise HTTPException(status_code=404, detail=NO_DEVICE_MSG)
        r = await http.post(f"{SPOTIFY}/me/player/queue", params={"uri": body.track_uri, "device_id": device},
                            headers=_headers(body.access_token))
        _raise_if_failed(r)
        return {"status": "queued", "device_id": device}


@router.post("/repeat")
async def set_repeat(body: RepeatRequest):
    async with httpx.AsyncClient(timeout=10) as http:
        r = await http.put(f"{SPOTIFY}/me/player/repeat", params={"state": body.state},
                           headers=_headers(body.access_token))
        _raise_if_failed(r)
        return {"status": "ok", "repeat": body.state}
