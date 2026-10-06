"""Song Radar — Shazam-style audio recognition via the unofficial shazamio lib."""
import logging
import os
import tempfile

from fastapi import APIRouter, File, HTTPException, UploadFile

logger = logging.getLogger(__name__)
router = APIRouter()

try:
    from shazamio import Shazam  # type: ignore
    _shazam = Shazam()
except Exception as _e:  # noqa: BLE001
    _shazam = None
    logger.warning("shazamio unavailable: %s", _e)


@router.post("/recognize")
async def recognize_audio(audio: UploadFile = File(...)):
    """Accepts a short audio clip (m4a/aac/wav, ideally 4-6s) and returns the
    recognized track so the user's marker pill can reflect the song around them."""
    if _shazam is None:
        raise HTTPException(status_code=503, detail="Recognition service unavailable")

    raw = await audio.read()
    if not raw or len(raw) < 1024:
        raise HTTPException(status_code=400, detail="Audio clip too short")

    ct = (audio.content_type or "").lower()
    suffix = ".m4a"
    for key, ext in (("wav", ".wav"), ("mp3", ".mp3"), ("mpeg", ".mp3"), ("ogg", ".ogg"), ("webm", ".webm")):
        if key in ct:
            suffix = ext
            break

    result = None
    last_err = None
    try:
        result = await _shazam.recognize(raw)
    except Exception as e:  # noqa: BLE001
        last_err = e
        logger.warning("Shazam recognize(bytes) failed, retrying via temp file: %s", e)
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp.write(raw)
                tmp_path = tmp.name
            result = await _shazam.recognize(tmp_path)
        except Exception as e2:  # noqa: BLE001
            last_err = e2
            logger.warning("Shazam recognize(file) also failed: %s", e2)
        finally:
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass
    if result is None:
        return {"matched": False, "error": str(last_err) if last_err else "no result"}

    track = result.get("track") if isinstance(result, dict) else None
    if not track:
        return {"matched": False}

    spotify_uri = None
    spotify_url = None
    for hub in (track.get("hub", {}) or {}).get("providers", []) or []:
        if (hub.get("type") or "").lower() == "spotify":
            for action in hub.get("actions") or []:
                if action.get("uri"):
                    spotify_uri = action["uri"]
                if action.get("name") == "hub:spotify:searchdeeplink" and action.get("uri"):
                    spotify_url = action["uri"]
    images = track.get("images") or {}
    return {
        "matched": True,
        "title": track.get("title"),
        "subtitle": track.get("subtitle"),
        "art": images.get("coverart") or images.get("background"),
        "isrc": track.get("isrc"),
        "shazam_id": track.get("key"),
        "spotify_uri": spotify_uri,
        "spotify_url": spotify_url,
    }
