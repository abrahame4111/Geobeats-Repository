"""Backend tests for Song Radar /api/recognize endpoint and regression checks."""
import os
import subprocess
import json
import sys
import requests

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8001")
API = f"{BACKEND_URL}/api"

results = []

def record(name, ok, detail=""):
    results.append((name, ok, detail))
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name}: {detail}")


def test_health():
    try:
        r = requests.get(f"{API}/", timeout=15)
        ok = r.status_code == 200 and r.json().get("status") == "ok"
        record("Health GET /api/", ok, f"status={r.status_code} body={r.text[:200]}")
    except Exception as e:
        record("Health GET /api/", False, f"exception: {e}")


def test_reject_tiny_clip():
    """POST /api/recognize with a tiny <1024 byte file -> expect 400."""
    try:
        files = {"audio": ("tiny.m4a", b"\x00" * 100, "audio/m4a")}
        r = requests.post(f"{API}/recognize", files=files, timeout=15)
        ok = r.status_code == 400
        record("Reject tiny clip <1024 bytes", ok, f"status={r.status_code} body={r.text[:200]}")
    except Exception as e:
        record("Reject tiny clip <1024 bytes", False, f"exception: {e}")


def test_reject_no_file():
    """POST /api/recognize with no file -> expect 4xx (422 typically)."""
    try:
        r = requests.post(f"{API}/recognize", timeout=15)
        ok = r.status_code in (400, 422)
        record("Reject missing file", ok, f"status={r.status_code} body={r.text[:200]}")
    except Exception as e:
        record("Reject missing file", False, f"exception: {e}")


def gen_sine_audio(path, fmt="m4a"):
    """Generate a 10-second 440Hz sine tone."""
    if os.path.exists(path):
        os.remove(path)
    cmd = [
        "ffmpeg", "-f", "lavfi", "-i", "sine=frequency=440:duration=10",
        "-ar", "44100", "-ac", "1", "-y", path
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {proc.stderr[-500:]}")
    if not os.path.exists(path) or os.path.getsize(path) < 1024:
        raise RuntimeError("ffmpeg produced no/empty file")
    return path


def test_synthetic_m4a():
    """Generate sine wave m4a, POST it, expect 200 with matched key."""
    path = "/tmp/test_audio.m4a"
    try:
        gen_sine_audio(path, "m4a")
        size = os.path.getsize(path)
        with open(path, "rb") as f:
            files = {"audio": ("test.m4a", f, "audio/m4a")}
            r = requests.post(f"{API}/recognize", files=files, timeout=120)
        ok = r.status_code == 200
        body_preview = r.text[:300]
        if ok:
            try:
                j = r.json()
                ok = "matched" in j
                # Synthetic tone: should NOT match
                if j.get("matched") is True:
                    record("Synthetic m4a 440Hz tone", False,
                           f"unexpectedly MATCHED: {json.dumps(j)[:300]}")
                    return
                record("Synthetic m4a 440Hz tone", ok,
                       f"status=200 size={size}B body={body_preview}")
            except Exception as e:
                record("Synthetic m4a 440Hz tone", False, f"json parse error: {e} body={body_preview}")
        else:
            record("Synthetic m4a 440Hz tone", False,
                   f"status={r.status_code} body={body_preview}")
    except Exception as e:
        record("Synthetic m4a 440Hz tone", False, f"exception: {e}")


def test_synthetic_wav():
    """Generate sine wave wav, POST it, expect 200 with matched key."""
    path = "/tmp/test_audio.wav"
    try:
        gen_sine_audio(path, "wav")
        size = os.path.getsize(path)
        with open(path, "rb") as f:
            files = {"audio": ("test.wav", f, "audio/wav")}
            r = requests.post(f"{API}/recognize", files=files, timeout=120)
        ok = r.status_code == 200
        body_preview = r.text[:300]
        if ok:
            try:
                j = r.json()
                ok = "matched" in j
                record("Synthetic wav (matched key present)", ok,
                       f"status=200 size={size}B body={body_preview}")
            except Exception as e:
                record("Synthetic wav (matched key present)", False, f"json parse error: {e} body={body_preview}")
        else:
            record("Synthetic wav (matched key present)", False,
                   f"status={r.status_code} body={body_preview}")
    except Exception as e:
        record("Synthetic wav (matched key present)", False, f"exception: {e}")


def test_active_users_regression():
    try:
        r = requests.get(f"{API}/users/active", timeout=15)
        ok = r.status_code == 200
        # Body should be a list
        if ok:
            try:
                body = r.json()
                ok = isinstance(body, list)
            except Exception:
                ok = False
        record("Regression GET /api/users/active", ok,
               f"status={r.status_code} body={r.text[:200]}")
    except Exception as e:
        record("Regression GET /api/users/active", False, f"exception: {e}")


def test_spotify_login_regression():
    try:
        r = requests.get(f"{API}/spotify/login", timeout=15)
        ok = r.status_code == 200 and "auth_url" in r.json()
        record("Regression GET /api/spotify/login", ok,
               f"status={r.status_code} body={r.text[:300]}")
    except Exception as e:
        record("Regression GET /api/spotify/login", False, f"exception: {e}")


if __name__ == "__main__":
    print(f"Testing backend at: {API}")
    test_health()
    test_reject_no_file()
    test_reject_tiny_clip()
    test_synthetic_m4a()
    test_synthetic_wav()
    test_active_users_regression()
    test_spotify_login_regression()

    print("\n=== SUMMARY ===")
    passed = sum(1 for _, ok, _ in results if ok)
    failed = sum(1 for _, ok, _ in results if not ok)
    print(f"Passed: {passed}/{len(results)}")
    for name, ok, detail in results:
        print(f"  {'PASS' if ok else 'FAIL'} - {name}")
    sys.exit(0 if failed == 0 else 1)
