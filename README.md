# Geobeats

Expo (SDK 54, React Native 0.81, expo-router) app: friends on a live map and what each is listening to on Spotify.

Package: `live.geobeats.app`. `backend/` is the previous FastAPI + MongoDB backend, included temporarily for local testing while the backend is rebuilt.

## Local testing

### 1. Backend (Python 3.11+, MongoDB running locally)

```bash
cd backend
python3 -m venv ../.venv && ../.venv/bin/pip install -r requirements.txt
cp .env.example .env     # add Spotify + Google Maps keys
../.venv/bin/python -m uvicorn server:app --host 127.0.0.1 --port 8001
```

### 2. App

Requirements: Node 18+, Yarn 1, Android Studio (emulator) or a device with a development build.

```bash
cd frontend
yarn install
cp .env.example .env     # set EXPO_PUBLIC_BACKEND_URL and the Google Maps key
npx expo start --dev-client
```

Android emulator or USB device:

```bash
adb reverse tcp:8081 tcp:8081   # Metro
adb reverse tcp:8001 tcp:8001   # backend
```

The app uses native modules (maps, location, reanimated), so Expo Go will not work. Use a development build:

```bash
npx expo prebuild --platform android
npx expo run:android
```

## Layout

```
backend/           FastAPI API + WebSocket (temporary)
frontend/app/      expo-router screens
frontend/src/      components and API client
frontend/assets/   icons, fonts, store assets
```
