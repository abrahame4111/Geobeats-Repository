"""Backend tests for GeoBeats — Round 2.

Covers:
  - Privacy Policy HTML page (/api/privacy and /api/privacy.html)
  - Play Store asset endpoints (/api/assets/icon.png, /api/assets/store/{filename},
    /api/assets/store/screenshots/{filename})
  - Improved Spotify callback page with branded fallback (/api/spotify/callback)

Plus regressions for /api/, /api/users/active, /api/spotify/login, /api/recognize.
"""
import os
import subprocess
import json
import sys
import requests

# Public ingress URL (per testing instructions)
BACKEND_URL = os.environ.get(
    "BACKEND_URL", "https://globe-tune.preview.emergentagent.com"
)
API = f"{BACKEND_URL}/api"

results = []


def record(name, ok, detail=""):
    results.append((name, ok, detail))
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name}: {detail}")


# ---------------------------------------------------------------------------
# Privacy Policy
# ---------------------------------------------------------------------------

def _check_privacy_response(name, r):
    ok = r.status_code == 200
    detail = f"status={r.status_code} ct={r.headers.get('content-type', '')} len={len(r.content)}"
    if not ok:
        record(name, False, detail + f" body={r.text[:200]}")
        return
    ctype = r.headers.get("content-type", "").lower()
    if "text/html" not in ctype:
        record(name, False, detail + " (content-type not text/html)")
        return
    body = r.text
    missing = [
        s for s in ("GeoBeats", "Privacy Policy", "privacy@geobeats.live")
        if s not in body
    ]
    if missing:
        record(name, False, detail + f" missing strings: {missing}")
        return
    record(name, True, detail + " (all required strings present)")


def test_privacy():
    try:
        r = requests.get(f"{API}/privacy", timeout=20)
        _check_privacy_response("GET /api/privacy", r)
    except Exception as e:
        record("GET /api/privacy", False, f"exception: {e}")


def test_privacy_html():
    try:
        r = requests.get(f"{API}/privacy.html", timeout=20)
        _check_privacy_response("GET /api/privacy.html", r)
    except Exception as e:
        record("GET /api/privacy.html", False, f"exception: {e}")


# ---------------------------------------------------------------------------
# Play Store assets
# ---------------------------------------------------------------------------

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def _check_png(name, r, min_bytes=None, max_bytes=None, expect_status=200):
    detail = (
        f"status={r.status_code} ct={r.headers.get('content-type', '')} "
        f"len={len(r.content)}"
    )
    if r.status_code != expect_status:
        record(name, False, detail + f" body={r.text[:200]}")
        return
    if expect_status != 200:
        record(name, True, detail)
        return
    ctype = r.headers.get("content-type", "").lower()
    if "image/png" not in ctype:
        record(name, False, detail + " (content-type not image/png)")
        return
    if not r.content.startswith(PNG_MAGIC):
        record(name, False, detail + " (PNG magic bytes missing)")
        return
    sz = len(r.content)
    if min_bytes is not None and sz < min_bytes:
        record(name, False, detail + f" (too small, expected >={min_bytes}B)")
        return
    if max_bytes is not None and sz > max_bytes:
        record(name, False, detail + f" (too large, expected <={max_bytes}B)")
        return
    record(name, True, detail)


def test_icon_png():
    try:
        r = requests.get(f"{API}/assets/icon.png", timeout=30)
        # >100KB requirement
        _check_png("GET /api/assets/icon.png", r, min_bytes=100 * 1024)
    except Exception as e:
        record("GET /api/assets/icon.png", False, f"exception: {e}")


def test_store_icon_512():
    try:
        r = requests.get(f"{API}/assets/store/icon_512.png", timeout=30)
        # ~210KB; allow generous range 100KB-400KB
        _check_png(
            "GET /api/assets/store/icon_512.png", r,
            min_bytes=100 * 1024, max_bytes=400 * 1024,
        )
    except Exception as e:
        record("GET /api/assets/store/icon_512.png", False, f"exception: {e}")


def test_store_feature_graphic():
    try:
        r = requests.get(f"{API}/assets/store/feature_graphic.png", timeout=30)
        # ~600KB; allow 300KB-1MB
        _check_png(
            "GET /api/assets/store/feature_graphic.png", r,
            min_bytes=300 * 1024, max_bytes=1024 * 1024,
        )
    except Exception as e:
        record("GET /api/assets/store/feature_graphic.png", False, f"exception: {e}")


def test_store_screenshots():
    names = [
        "ss_01_map.png",
        "ss_02_listen_along.png",
        "ss_03_song_radar.png",
        "ss_04_login.png",
        "ss_05_heatmap.png",
    ]
    for n in names:
        try:
            r = requests.get(
                f"{API}/assets/store/screenshots/{n}", timeout=60
            )
            # 1.5 - 2.5 MB (per spec); allow slightly outside (1.0-3.0MB)
            _check_png(
                f"GET /api/assets/store/screenshots/{n}", r,
                min_bytes=1_000_000, max_bytes=3_500_000,
            )
        except Exception as e:
            record(
                f"GET /api/assets/store/screenshots/{n}", False,
                f"exception: {e}",
            )


def test_store_404():
    try:
        r = requests.get(f"{API}/assets/store/nonexistent.png", timeout=15)
        ok = r.status_code == 404
        record(
            "GET /api/assets/store/nonexistent.png -> 404", ok,
            f"status={r.status_code} body={r.text[:200]}",
        )
    except Exception as e:
        record(
            "GET /api/assets/store/nonexistent.png -> 404", False,
            f"exception: {e}",
        )


def test_screenshots_404():
    try:
        r = requests.get(
            f"{API}/assets/store/screenshots/nonexistent.png", timeout=15
        )
        ok = r.status_code == 404
        record(
            "GET /api/assets/store/screenshots/nonexistent.png -> 404", ok,
            f"status={r.status_code} body={r.text[:200]}",
        )
    except Exception as e:
        record(
            "GET /api/assets/store/screenshots/nonexistent.png -> 404", False,
            f"exception: {e}",
        )


def test_path_traversal():
    """Path traversal attempt MUST NOT leak .env file."""
    # Two encodings to try — one with %2F for the slash
    attempts = [
        f"{API}/assets/store/..%2F..%2Fbackend%2F.env",
        f"{API}/assets/store/..%2Fbackend%2F.env",
    ]
    for url in attempts:
        try:
            r = requests.get(url, timeout=15)
            # MUST NOT be 200 with .env contents.
            body = r.text
            leaked = (r.status_code == 200) and (
                "MONGO_URL" in body or "SPOTIFY_CLIENT" in body or "=" in body[:200]
            )
            ok = (r.status_code in (400, 404)) and not leaked
            # Allow 200 only if body is clearly NOT the .env (e.g. some HTML)
            if r.status_code == 200 and not leaked:
                ok = False  # strictly require 4xx per spec
            record(
                f"Path traversal {url.split('/api')[-1]}", ok,
                f"status={r.status_code} leaked={leaked} body={body[:200]}",
            )
        except Exception as e:
            record(
                f"Path traversal {url.split('/api')[-1]}", False,
                f"exception: {e}",
            )


# ---------------------------------------------------------------------------
# Spotify callback (branded fallback page)
# ---------------------------------------------------------------------------

def _check_spotify_callback(name, r):
    detail = (
        f"status={r.status_code} ct={r.headers.get('content-type', '')} "
        f"len={len(r.content)}"
    )
    if r.status_code != 200:
        record(name, False, detail + f" body={r.text[:300]}")
        return
    ctype = r.headers.get("content-type", "").lower()
    if "text/html" not in ctype:
        record(name, False, detail + " (content-type not text/html)")
        return
    body = r.text
    required = ["Open GeoBeats", "Signed in to Spotify", "window.location.replace"]
    missing = [s for s in required if s not in body]
    if missing:
        record(name, False, detail + f" missing strings: {missing} body[:300]={body[:300]}")
        return
    record(name, True, detail + " (all required strings present)")


def test_spotify_callback_success_path():
    """code=fake will fail token exchange but backend should still render
    branded HTML page with Open GeoBeats button (the error path)."""
    try:
        url = (
            f"{API}/spotify/callback?code=fake"
            f"&state=m=geobeats%3A%2F%2Fauth-success"
        )
        r = requests.get(url, timeout=30, allow_redirects=False)
        _check_spotify_callback(
            "GET /api/spotify/callback?code=fake (branded fallback)", r
        )
    except Exception as e:
        record(
            "GET /api/spotify/callback?code=fake (branded fallback)", False,
            f"exception: {e}",
        )


def test_spotify_callback_error_path():
    try:
        url = (
            f"{API}/spotify/callback?error=access_denied"
            f"&state=m=geobeats%3A%2F%2Fauth-success"
        )
        r = requests.get(url, timeout=30, allow_redirects=False)
        _check_spotify_callback(
            "GET /api/spotify/callback?error=access_denied (branded fallback)", r
        )
    except Exception as e:
        record(
            "GET /api/spotify/callback?error=access_denied (branded fallback)",
            False, f"exception: {e}",
        )


# ---------------------------------------------------------------------------
# Regression checks
# ---------------------------------------------------------------------------

def test_health():
    try:
        r = requests.get(f"{API}/", timeout=15)
        ok = (
            r.status_code == 200
            and r.json().get("status") == "ok"
            and r.json().get("service") == "soundmap"
        )
        record(
            "Regression GET /api/", ok,
            f"status={r.status_code} body={r.text[:200]}",
        )
    except Exception as e:
        record("Regression GET /api/", False, f"exception: {e}")


def test_active_users_regression():
    try:
        r = requests.get(f"{API}/users/active", timeout=15)
        ok = r.status_code == 200
        if ok:
            try:
                body = r.json()
                # Backend returns {"users": [...]}
                ok = isinstance(body, dict) and isinstance(body.get("users"), list)
            except Exception:
                ok = False
        record(
            "Regression GET /api/users/active", ok,
            f"status={r.status_code} body={r.text[:200]}",
        )
    except Exception as e:
        record("Regression GET /api/users/active", False, f"exception: {e}")


def test_spotify_login_regression():
    try:
        r = requests.get(f"{API}/spotify/login", timeout=15)
        ok = r.status_code == 200 and "auth_url" in r.json()
        record(
            "Regression GET /api/spotify/login", ok,
            f"status={r.status_code} body={r.text[:300]}",
        )
    except Exception as e:
        record("Regression GET /api/spotify/login", False, f"exception: {e}")


def gen_sine_audio(path):
    """Generate a 10-second 440Hz sine tone."""
    if os.path.exists(path):
        os.remove(path)
    cmd = [
        "ffmpeg", "-f", "lavfi", "-i", "sine=frequency=440:duration=10",
        "-ar", "44100", "-ac", "1", "-y", path,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {proc.stderr[-500:]}")
    if not os.path.exists(path) or os.path.getsize(path) < 1024:
        raise RuntimeError("ffmpeg produced no/empty file")
    return path


def test_recognize_regression():
    """Synthetic m4a -> 200 {matched: false}."""
    path = "/tmp/test_audio_round2.m4a"
    try:
        gen_sine_audio(path)
        size = os.path.getsize(path)
        with open(path, "rb") as f:
            files = {"audio": ("test.m4a", f, "audio/m4a")}
            r = requests.post(f"{API}/recognize", files=files, timeout=120)
        if r.status_code != 200:
            record(
                "Regression POST /api/recognize (synthetic m4a)", False,
                f"status={r.status_code} size={size}B body={r.text[:300]}",
            )
            return
        try:
            j = r.json()
        except Exception as e:
            record(
                "Regression POST /api/recognize (synthetic m4a)", False,
                f"json parse error: {e} body={r.text[:300]}",
            )
            return
        ok = ("matched" in j) and (j.get("matched") is False)
        record(
            "Regression POST /api/recognize (synthetic m4a)", ok,
            f"status=200 size={size}B body={json.dumps(j)[:300]}",
        )
    except Exception as e:
        record(
            "Regression POST /api/recognize (synthetic m4a)", False,
            f"exception: {e}",
        )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print(f"Testing backend at: {API}")
    print("=" * 70)

    print("\n--- Privacy Policy ---")
    test_privacy()
    test_privacy_html()

    print("\n--- Play Store Assets ---")
    test_icon_png()
    test_store_icon_512()
    test_store_feature_graphic()
    test_store_screenshots()
    test_store_404()
    test_screenshots_404()
    test_path_traversal()

    print("\n--- Spotify Callback (branded fallback) ---")
    test_spotify_callback_success_path()
    test_spotify_callback_error_path()

    print("\n--- Regression ---")
    test_health()
    test_active_users_regression()
    test_spotify_login_regression()
    test_recognize_regression()

    print("\n" + "=" * 70)
    print("=== SUMMARY ===")
    passed = sum(1 for _, ok, _ in results if ok)
    failed = sum(1 for _, ok, _ in results if not ok)
    print(f"Passed: {passed}/{len(results)}  Failed: {failed}")
    for name, ok, detail in results:
        marker = "PASS" if ok else "FAIL"
        print(f"  [{marker}] {name}")
        if not ok:
            print(f"         -> {detail}")
    sys.exit(0 if failed == 0 else 1)
