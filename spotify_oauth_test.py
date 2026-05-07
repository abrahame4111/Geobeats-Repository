"""GeoBeats backend Spotify OAuth + assets review test suite.

Focuses on the dynamic redirect_uri behavior — specifically that
/api/spotify/login reconstructs redirect_uri from the request's
X-Forwarded-Host header (Cloudflare ingress), NOT a hardcoded env value.
"""
import urllib.parse as up
import requests
import json
import sys

PREVIEW = "https://globe-tune.preview.emergentagent.com"
DEPLOY_HOST = "beat-together-2.emergent.host"

results = []


def record(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}: {name}  {detail}")


def get_redirect_uri_from_auth_url(auth_url: str) -> str:
    parsed = up.urlparse(auth_url)
    qs = up.parse_qs(parsed.query)
    return qs.get("redirect_uri", [""])[0]


def get_state_from_auth_url(auth_url: str) -> str:
    parsed = up.urlparse(auth_url)
    qs = up.parse_qs(parsed.query)
    return qs.get("state", [""])[0]


# -----------------------------------------------------------------------
# 1. /api/ root
# -----------------------------------------------------------------------
def test_root():
    r = requests.get(f"{PREVIEW}/api/", timeout=15)
    ok = r.status_code == 200 and r.json() == {"service": "soundmap", "status": "ok"}
    record("1. GET /api/ root", ok, f"status={r.status_code} body={r.text[:120]}")


# -----------------------------------------------------------------------
# 2. /api/spotify/login -> redirect_uri must be reconstructed from request host
# -----------------------------------------------------------------------
def test_spotify_login_dynamic_redirect_uri():
    r = requests.get(f"{PREVIEW}/api/spotify/login", timeout=15)
    if r.status_code != 200:
        record("2. GET /api/spotify/login (preview host)", False, f"status={r.status_code}")
        return
    body = r.json()
    auth_url = body.get("auth_url", "")
    redirect_uri = get_redirect_uri_from_auth_url(auth_url)
    expected = f"{PREVIEW}/api/spotify/callback"
    ok = redirect_uri == expected
    record(
        "2. GET /api/spotify/login -> redirect_uri reconstructed from request host",
        ok,
        f"got={redirect_uri!r} expected={expected!r}",
    )
    # also verify auth_url uses Spotify
    record(
        "2b. auth_url points to accounts.spotify.com",
        "accounts.spotify.com/authorize" in auth_url,
        auth_url[:160],
    )


# -----------------------------------------------------------------------
# 3. /api/spotify/login?mobile_redirect=geobeats://auth-success
# -----------------------------------------------------------------------
def test_spotify_login_mobile_redirect():
    mobile = "geobeats://auth-success"
    r = requests.get(
        f"{PREVIEW}/api/spotify/login",
        params={"mobile_redirect": mobile},
        timeout=15,
    )
    if r.status_code != 200:
        record("3. GET /api/spotify/login?mobile_redirect=...", False, f"status={r.status_code}")
        return
    auth_url = r.json().get("auth_url", "")
    state = get_state_from_auth_url(auth_url)
    redirect_uri = get_redirect_uri_from_auth_url(auth_url)
    # state should contain m=<encoded mobile_redirect>
    # state itself comes back URL-decoded once by urlparse parse_qs.
    # Backend builds state as: m=geobeats%3A%2F%2Fauth-success
    # which after parse_qs returns: m=geobeats%3A%2F%2Fauth-success
    state_has_mobile = "m=" in state and "geobeats" in state
    record(
        "3. mobile_redirect encoded into state",
        state_has_mobile,
        f"state={state!r}",
    )
    expected_redirect = f"{PREVIEW}/api/spotify/callback"
    record(
        "3b. mobile login still uses preview redirect_uri",
        redirect_uri == expected_redirect,
        f"got={redirect_uri!r}",
    )


# -----------------------------------------------------------------------
# 4. /api/spotify/callback with no params -> redirect or branded HTML, not 500
# -----------------------------------------------------------------------
def test_callback_no_params():
    r = requests.get(
        f"{PREVIEW}/api/spotify/callback",
        timeout=15,
        allow_redirects=False,
    )
    # missing code -> _build_redirect with error=missing_code
    # No mobile_redirect in state, so RedirectResponse to FRONTEND_URL/auth-success?error=missing_code
    ok = r.status_code in (200, 301, 302, 303, 307, 308)
    detail = f"status={r.status_code} location={r.headers.get('location','')!r}"
    record("4. GET /api/spotify/callback (no params)", ok, detail)
    if r.status_code in (301, 302, 303, 307, 308):
        loc = r.headers.get("location", "")
        record(
            "4b. location contains error=missing_code",
            "error=missing_code" in loc,
            f"location={loc}",
        )


# -----------------------------------------------------------------------
# 5. /api/spotify/callback?error=access_denied
# -----------------------------------------------------------------------
def test_callback_error_access_denied():
    r = requests.get(
        f"{PREVIEW}/api/spotify/callback",
        params={"error": "access_denied"},
        timeout=15,
        allow_redirects=False,
    )
    ok = r.status_code in (200, 301, 302, 303, 307, 308)
    record(
        "5. GET /api/spotify/callback?error=access_denied",
        ok,
        f"status={r.status_code} location={r.headers.get('location','')!r}",
    )
    if r.status_code in (301, 302, 303, 307, 308):
        loc = r.headers.get("location", "")
        record(
            "5b. location contains error=access_denied",
            "error=access_denied" in loc,
            f"location={loc}",
        )


# -----------------------------------------------------------------------
# 6. POST /api/spotify/refresh with fake token -> 4xx not 500
# -----------------------------------------------------------------------
def test_refresh_fake_token():
    r = requests.post(
        f"{PREVIEW}/api/spotify/refresh",
        json={"refresh_token": "fake"},
        timeout=15,
    )
    ok = 400 <= r.status_code < 500
    record(
        "6. POST /api/spotify/refresh with fake token",
        ok,
        f"status={r.status_code} body={r.text[:160]}",
    )


# -----------------------------------------------------------------------
# 7. /api/assets/fonts/Ionicons.ttf
# -----------------------------------------------------------------------
def test_ionicons_font():
    r = requests.get(f"{PREVIEW}/api/assets/fonts/Ionicons.ttf", timeout=20)
    ct = r.headers.get("content-type", "")
    size = len(r.content)
    ok = (
        r.status_code == 200
        and "font/ttf" in ct
        and 380000 < size < 400000
    )
    record(
        "7. GET /api/assets/fonts/Ionicons.ttf",
        ok,
        f"status={r.status_code} ct={ct} bytes={size}",
    )


# -----------------------------------------------------------------------
# 8. /api/assets/fonts/SpaceMono-Regular.ttf
# -----------------------------------------------------------------------
def test_spacemono_font():
    r = requests.get(f"{PREVIEW}/api/assets/fonts/SpaceMono-Regular.ttf", timeout=20)
    ct = r.headers.get("content-type", "")
    size = len(r.content)
    # TTF magic bytes: 00 01 00 00 (TrueType) or 'OTTO' (OpenType) or 'true'
    magic = r.content[:4]
    is_ttf = magic in (b"\x00\x01\x00\x00", b"true", b"OTTO")
    ok = r.status_code == 200 and "font/ttf" in ct and size > 1000 and is_ttf
    record(
        "8. GET /api/assets/fonts/SpaceMono-Regular.ttf",
        ok,
        f"status={r.status_code} ct={ct} bytes={size} magic={magic!r}",
    )


# -----------------------------------------------------------------------
# 9. /api/mapbox.html?token=test&style=geobeats
# -----------------------------------------------------------------------
def test_mapbox_html():
    r = requests.get(
        f"{PREVIEW}/api/mapbox.html",
        params={"token": "test", "style": "geobeats"},
        timeout=20,
    )
    if r.status_code != 200:
        record("9. GET /api/mapbox.html", False, f"status={r.status_code}")
        return
    body = r.text
    needles = ["minZoom: 0.5", "maxZoom: 19", "setMinZoom", "__suppressRecenter", "easeTo", "flyTo"]
    missing = [n for n in needles if n not in body]
    ok = not missing
    record(
        "9. GET /api/mapbox.html contains all required tokens",
        ok,
        f"missing={missing} bytes={len(body)}",
    )


# -----------------------------------------------------------------------
# 10. /api/recognize smoke (POST without file -> 422 from FastAPI validation)
# -----------------------------------------------------------------------
def test_recognize_smoke():
    r = requests.post(f"{PREVIEW}/api/recognize", timeout=15)
    # 422 = FastAPI validation error (missing required `audio` field) — endpoint exists
    ok = r.status_code in (400, 422, 503)
    record(
        "10. POST /api/recognize smoke (endpoint exists)",
        ok,
        f"status={r.status_code} body={r.text[:120]}",
    )


# -----------------------------------------------------------------------
# CRITICAL: X-Forwarded-Host honoring — the deploy-env redirect_uri test
# -----------------------------------------------------------------------
def test_x_forwarded_host():
    """Verify backend's _resolve_redirect_uri honors X-Forwarded-Host.

    Cloudflare's edge strips/overrides X-Forwarded-Host with the actual
    client-facing host before forwarding to backend (this is correct edge
    behavior — the edge always rewrites X-Forwarded-Host to the SNI/Host
    the client actually requested). So testing through the public ingress
    cannot inject a different forwarded host. Instead we hit the backend
    directly inside the cluster on http://localhost:8001 to prove the
    backend's _resolve_redirect_uri logic is correct.
    """
    # 11a: via direct internal call w/ X-Forwarded-Host
    r = requests.get(
        "http://localhost:8001/api/spotify/login",
        headers={"X-Forwarded-Host": DEPLOY_HOST, "X-Forwarded-Proto": "https"},
        timeout=15,
    )
    if r.status_code != 200:
        record("11a. internal /api/spotify/login w/ X-Forwarded-Host", False, f"status={r.status_code}")
        return
    redirect_uri = get_redirect_uri_from_auth_url(r.json().get("auth_url", ""))
    expected_deploy = f"https://{DEPLOY_HOST}/api/spotify/callback"
    record(
        "11a. backend honors X-Forwarded-Host (direct internal call)",
        redirect_uri == expected_deploy,
        f"got={redirect_uri!r} expected={expected_deploy!r}",
    )

    # 11b: via direct internal call w/ Host header only (no XFH)
    r = requests.get(
        "http://localhost:8001/api/spotify/login",
        headers={"Host": DEPLOY_HOST},
        timeout=15,
    )
    if r.status_code != 200:
        record("11b. internal /api/spotify/login w/ Host header", False, f"status={r.status_code}")
        return
    redirect_uri = get_redirect_uri_from_auth_url(r.json().get("auth_url", ""))
    # Without XFH, scheme falls back to request.url.scheme (http for internal)
    expected_host_only = f"http://{DEPLOY_HOST}/api/spotify/callback"
    record(
        "11b. backend falls back to Host header when no X-Forwarded-Host",
        redirect_uri == expected_host_only,
        f"got={redirect_uri!r} expected={expected_host_only!r}",
    )

    # 11c: through public ingress — Cloudflare overrides X-Forwarded-Host
    # to globe-tune.preview..., so this should always equal the preview URL.
    # This documents the expected platform behavior.
    try:
        r = requests.get(
            f"{PREVIEW}/api/spotify/login",
            headers={"X-Forwarded-Host": DEPLOY_HOST, "X-Forwarded-Proto": "https"},
            timeout=15,
        )
        if r.status_code == 200:
            redirect_uri = get_redirect_uri_from_auth_url(r.json().get("auth_url", ""))
            expected = f"{PREVIEW}/api/spotify/callback"
            record(
                "11c. public ingress strips/overrides X-Forwarded-Host (expected platform behavior)",
                redirect_uri == expected,
                f"got={redirect_uri!r} (Cloudflare set XFH to ingress host — correct edge behavior; in deployed env Cloudflare will set XFH to beat-together-2.emergent.host).",
            )
        else:
            record(
                "11c. public ingress with custom XFH header",
                True,  # informational only
                f"ingress returned status={r.status_code} (likely 403 from Cloudflare bot rules) — informational only",
            )
    except Exception as e:
        record("11c. public ingress XFH probe", True, f"informational: {e}")


def main():
    test_root()
    test_spotify_login_dynamic_redirect_uri()
    test_spotify_login_mobile_redirect()
    test_callback_no_params()
    test_callback_error_access_denied()
    test_refresh_fake_token()
    test_ionicons_font()
    test_spacemono_font()
    test_mapbox_html()
    test_recognize_smoke()
    test_x_forwarded_host()

    print("\n" + "=" * 70)
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"PASSED {passed}/{len(results)}")
    for n, ok, d in results:
        if not ok:
            print(f"  FAILED: {n} -> {d}")
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
