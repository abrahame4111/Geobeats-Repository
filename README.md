# Geobeats (Music Navigator)

See friends on a live map and what each of them is listening to on Spotify. Real-time location and playback over WebSockets, with Listen Together sessions.

Everything runs locally. There is no cloud dependency for development.

## Layout

```
backend/    FastAPI + MongoDB API and WebSocket server
frontend/   React web app
docs/       Product requirements (product/), guides (guides/), old build notes (archive/)
archive/    Earlier React Native attempts, kept only as reference for the new mobile app
```

A new mobile app (React Native, development builds, iOS + Android, background location) will live in `mobile/`. It will not use Expo Go.

## Run it locally

Requirements: Python 3.11+, Node 18+, Yarn 1, Docker (for MongoDB only).

```bash
make setup      # creates backend/.env and frontend/.env, Python venv, installs web deps
# edit backend/.env: add your Spotify client id/secret and Google Maps key
make mongo      # terminal 1 (returns immediately)
make backend    # terminal 2: http://127.0.0.1:8001  (health: /api/health)
make web        # terminal 3: http://127.0.0.1:3000
```

Open **http://127.0.0.1:3000** (use 127.0.0.1, not localhost, so it matches the Spotify redirect).

### One-time provider setup

- **Spotify:** create an app at the Spotify developer dashboard and add the redirect URI `http://127.0.0.1:8001/api/auth/callback`.
- **Google Maps:** enable the Maps JavaScript API and restrict the key to `http://127.0.0.1:3000/*` and `http://localhost:3000/*`.

## Tests

```bash
make test       # backend API + WebSocket tests against http://127.0.0.1:8001
```

## Secrets

`backend/.env` and `frontend/.env` are git-ignored. Only the `.env.example` files are committed.
