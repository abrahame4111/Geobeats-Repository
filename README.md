# Geobeats

Expo (SDK 54, React Native 0.81, expo-router) app: friends on a live map and what each is listening to on Spotify.

Package: `live.geobeats.app`. `backend/` is the previous FastAPI + MongoDB backend, included temporarily for local testing while the backend is rebuilt.

For an iPhone build that runs without Metro or Xcode, follow
[iOS cloud testing](docs/IOS_CLOUD_TESTING.md). This branch includes EAS preview
build profiles and a Render backend deployment template; hosting credentials
and Apple device registration are still required.

## Local testing

### 1. Backend (Python 3.11+, MongoDB running locally)

```bash
cd backend
python3 -m venv ../.venv && ../.venv/bin/pip install -r requirements.txt
cp .env.example .env     # add Spotify + Google Maps keys
../.venv/bin/python -m uvicorn server:app --host 127.0.0.1 --port 8001
```

### 2. App

Requirements: Node 18+, npm, Android Studio or Xcode, and a device or simulator with a development build.

```bash
cd frontend
npm ci
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

### iOS Simulator / iPhone

The Expo app shares its screens, assets, Spotify flow, live map, location, song radar, and WebSocket functionality across Android and iOS. It requires a development build because it uses native modules; Expo Go is not supported.

```bash
cd frontend
npm ci
cp .env.example .env     # set EXPO_PUBLIC_BACKEND_URL and map credentials
npx expo prebuild --platform ios
cd ios && pod install && cd ..
```

Open the generated `ios/GeoBeats.xcworkspace` in Xcode, choose an iPhone Simulator or a signed physical iPhone, then press Run. On the first launch, accept microphone access for Song Radar and location access for the live map. For a physical iPhone, `EXPO_PUBLIC_BACKEND_URL` must be an HTTPS-reachable backend rather than `localhost`.

## Layout

```
backend/           FastAPI API + WebSocket (temporary)
frontend/app/      expo-router screens
frontend/src/      components and API client
frontend/assets/   icons, fonts, store assets
```
