"""Friends: exact Spotify profile lookup, friend requests (accept/decline),
friend list with last-known presence (location + last listened song).

Collections
  users            — presence fields written by server.py on every location
                     update: last_location, last_seen_at, last_song, ghost
  friend_requests  — {from_user_id, to_user_id, created_at, target_*}
  friendships      — {users: [a, b], created_at}
"""
import os
import re
import time
from datetime import datetime, timezone
from typing import Dict, Optional

import httpx
from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel

from database import db

router = APIRouter()
_manager = None  # set by server.py so we can push realtime events cross-pod


def configure(manager):
    global _manager
    _manager = manager


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# --- auth -----------------------------------------------------------------

_uid_cache: Dict[str, tuple] = {}
# Optional test hook: with DEBUG_TOKEN set in the env, a bearer of the form
# "debug:<DEBUG_TOKEN>:<user_id>" resolves to <user_id> without Spotify.
DEBUG_TOKEN = os.environ.get("DEBUG_TOKEN")
def _debug_uid(token: str) -> Optional[str]:
    if DEBUG_TOKEN and token.startswith(f"debug:{DEBUG_TOKEN}:"):
        return token.split(":", 2)[2] or None
    return None


async def resolve_user_id(token: str) -> str:
    debug_uid = _debug_uid(token)
    if debug_uid:
        return debug_uid
    hit = _uid_cache.get(token)
    if hit and hit[1] > time.time():
        return hit[0]
    async with httpx.AsyncClient(timeout=10) as http:
        r = await http.get("https://api.spotify.com/v1/me", headers={"Authorization": f"Bearer {token}"})
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid or expired access token")
    uid = r.json()["id"]
    if len(_uid_cache) > 500:
        _uid_cache.clear()
    _uid_cache[token] = (uid, time.time() + 1800)
    return uid


# --- helpers ----------------------------------------------------------------

_URL_RE = re.compile(r"open\.spotify\.com/(?:intl-[a-z]{2}/)?user/([^/?#\s]+)", re.I)
_URI_RE = re.compile(r"spotify:user:([^\s:?#]+)", re.I)


def parse_spotify_user_id(q: str) -> str:
    q = q.strip()
    m = _URL_RE.search(q) or _URI_RE.search(q)
    if m:
        return m.group(1)
    return q.lstrip("@").split("?")[0].strip()


async def _relation(me: str, other: str) -> str:
    if me == other:
        return "self"
    if await db.friendships.find_one({"users": {"$all": [me, other]}}):
        return "friends"
    if await db.friend_requests.find_one({"from_user_id": me, "to_user_id": other}):
        return "pending_out"
    if await db.friend_requests.find_one({"from_user_id": other, "to_user_id": me}):
        return "pending_in"
    return "none"


def _profile_of(doc: Optional[dict], fallback_id: str, fallback: Optional[dict] = None) -> dict:
    doc = doc or {}
    fb = fallback or {}
    return {
        "user_id": fallback_id,
        "display_name": doc.get("display_name") or fb.get("display_name") or fallback_id,
        "profile_image": doc.get("profile_image") or fb.get("profile_image") or "",
    }


async def _notify(user_id: str, message: dict):
    if _manager is not None:
        await _manager.send_to_user(user_id, message)


# --- endpoints --------------------------------------------------------------

@router.get("/people/lookup")
async def lookup_person(q: str = Query(..., min_length=1),
                        authorization: Optional[str] = Header(None),
                        access_token: Optional[str] = Query(None)):
    """Find people by exact Spotify username / profile link.

    Spotify removed GET /v1/users/{id} in Feb 2026, so profiles come from
    GeoBeats' own user table (populated at Spotify sign-in). An unknown
    username still returns a bare entry so a request can be sent ahead of
    time — it lands the moment that person signs in. As a convenience we
    also return GeoBeats users whose display name matches the query.
    """
    token = _token(authorization, access_token)
    pid = parse_spotify_user_id(q)
    if not pid:
        raise HTTPException(status_code=400, detail="Enter a Spotify username or profile link")
    me = await resolve_user_id(token)

    async def entry(doc: Optional[dict], uid: str) -> dict:
        p = _profile_of(doc, uid)
        p["on_geobeats"] = doc is not None
        p["relation"] = await _relation(me, uid)
        return p

    exact_doc = await db.users.find_one({"spotify_id": pid}) or \
        await db.users.find_one({"spotify_id": re.compile(f"^{re.escape(pid)}$", re.I)})
    exact = await entry(exact_doc, exact_doc["spotify_id"] if exact_doc else pid)

    matches = []
    if len(pid) >= 2:
        rx = re.compile(re.escape(pid), re.I)
        async for d in db.users.find({"display_name": rx}, {"spotify_id": 1, "display_name": 1, "profile_image": 1}).limit(8):
            if d["spotify_id"] == exact["user_id"]:
                continue
            matches.append(await entry(d, d["spotify_id"]))
    return {"exact": exact, "matches": matches}


class FriendRequestBody(BaseModel):
    target_user_id: str
    display_name: Optional[str] = None
    profile_image: Optional[str] = None


@router.post("/friends/request")
async def send_friend_request(body: FriendRequestBody, authorization: Optional[str] = Header(None),
                              access_token: Optional[str] = Query(None)):
    me = await resolve_user_id(_token(authorization, access_token))
    target = body.target_user_id.strip()
    if not target or target == me:
        raise HTTPException(status_code=400, detail="You can't add yourself")
    if await db.friendships.find_one({"users": {"$all": [me, target]}}):
        return {"relation": "friends"}

    me_doc = await db.users.find_one({"spotify_id": me})
    my_profile = _profile_of(me_doc, me)

    # They already asked us → accept immediately.
    reverse = await db.friend_requests.find_one({"from_user_id": target, "to_user_id": me})
    if reverse:
        await _accept(from_user_id=target, to_user_id=me, to_profile=my_profile)
        return {"relation": "friends"}

    await db.friend_requests.update_one(
        {"from_user_id": me, "to_user_id": target},
        {"$set": {"created_at": now_iso(),
                  "target_display_name": body.display_name,
                  "target_profile_image": body.profile_image}},
        upsert=True,
    )
    await _notify(target, {"type": "friend:request", "from_user_id": me,
                           "from_display_name": my_profile["display_name"],
                           "from_profile_image": my_profile["profile_image"]})
    return {"relation": "pending_out"}


async def _accept(from_user_id: str, to_user_id: str, to_profile: dict):
    await db.friend_requests.delete_many({"$or": [
        {"from_user_id": from_user_id, "to_user_id": to_user_id},
        {"from_user_id": to_user_id, "to_user_id": from_user_id},
    ]})
    await db.friendships.update_one(
        {"users": {"$all": [from_user_id, to_user_id]}},
        {"$setOnInsert": {"users": sorted([from_user_id, to_user_id]), "created_at": now_iso()}},
        upsert=True,
    )
    await _notify(from_user_id, {"type": "friend:accepted", "user_id": to_user_id,
                                 "display_name": to_profile["display_name"],
                                 "profile_image": to_profile["profile_image"]})


class RespondBody(BaseModel):
    from_user_id: str
    accept: bool


@router.post("/friends/respond")
async def respond_friend_request(body: RespondBody, authorization: Optional[str] = Header(None),
                                 access_token: Optional[str] = Query(None)):
    me = await resolve_user_id(_token(authorization, access_token))
    req = await db.friend_requests.find_one({"from_user_id": body.from_user_id, "to_user_id": me})
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if body.accept:
        me_doc = await db.users.find_one({"spotify_id": me})
        await _accept(body.from_user_id, me, _profile_of(me_doc, me))
        return {"relation": "friends"}
    await db.friend_requests.delete_one({"_id": req["_id"]})
    return {"relation": "none"}


@router.delete("/friends/{other_id}")
async def remove_friend(other_id: str, authorization: Optional[str] = Header(None),
                        access_token: Optional[str] = Query(None)):
    """Unfriend, or cancel a pending request in either direction."""
    me = await resolve_user_id(_token(authorization, access_token))
    removed = await db.friendships.delete_one({"users": {"$all": [me, other_id]}})
    await db.friend_requests.delete_many({"$or": [
        {"from_user_id": me, "to_user_id": other_id},
        {"from_user_id": other_id, "to_user_id": me},
    ]})
    if removed.deleted_count:
        await _notify(other_id, {"type": "friend:removed", "user_id": me})
    return {"relation": "none"}


@router.get("/friends")
async def list_friends(authorization: Optional[str] = Header(None), access_token: Optional[str] = Query(None)):
    me = await resolve_user_id(_token(authorization, access_token))

    friend_ids = []
    async for f in db.friendships.find({"users": me}):
        friend_ids.extend(u for u in f.get("users", []) if u != me)
    incoming_reqs = [r async for r in db.friend_requests.find({"to_user_id": me})]
    outgoing_reqs = [r async for r in db.friend_requests.find({"from_user_id": me})]

    all_ids = set(friend_ids) | {r["from_user_id"] for r in incoming_reqs} | {r["to_user_id"] for r in outgoing_reqs}
    users = {}
    if all_ids:
        async for u in db.users.find({"spotify_id": {"$in": list(all_ids)}},
                                     {"spotify_id": 1, "display_name": 1, "profile_image": 1,
                                      "last_location": 1, "last_seen_at": 1, "last_song": 1, "ghost": 1}):
            users[u["spotify_id"]] = u
    live = {}
    if friend_ids:
        async for d in db.live_users.find({"user_id": {"$in": friend_ids}, "location.lat": {"$ne": None}}):
            live[d["user_id"]] = d.get("location") or {}

    friends = []
    for fid in friend_ids:
        u = users.get(fid) or {}
        loc = live.get(fid)
        online = loc is not None
        ghost = bool(u.get("ghost")) and not online
        last_loc = u.get("last_location") or {}
        item = _profile_of(u, fid)
        item.update({
            "online": online,
            "hidden": ghost,
            "lat": loc.get("lat") if online else (None if ghost else last_loc.get("lat")),
            "lng": loc.get("lng") if online else (None if ghost else last_loc.get("lng")),
            "last_seen_at": u.get("last_seen_at"),
            "last_song": None if ghost else u.get("last_song"),
        })
        friends.append(item)
    friends.sort(key=lambda f: (not f["online"], -(f.get("last_seen_at") or 0)))

    incoming = [dict(_profile_of(users.get(r["from_user_id"]), r["from_user_id"]), created_at=r.get("created_at"))
                for r in incoming_reqs]
    outgoing = [dict(_profile_of(users.get(r["to_user_id"]), r["to_user_id"],
                                 {"display_name": r.get("target_display_name"),
                                  "profile_image": r.get("target_profile_image")}),
                     created_at=r.get("created_at"))
                for r in outgoing_reqs]
    return {"friends": friends, "incoming": incoming, "outgoing": outgoing}
