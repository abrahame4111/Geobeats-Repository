# Music Navigator - Final Delivery Package

## Files Included

### 1. `MusicNavigatorFinal_FINAL.tar.gz` (2.1 MB)
The complete React Native Android app source code.

### 2. `backend_FINAL.tar.gz` (9.1 KB)
The FastAPI backend server.

---

## Quick Start Guide (Windows)

### Prerequisites
- **Node.js** 16+ (https://nodejs.org/)
- **JDK 17** (https://adoptium.net/)
- **Android Studio** with SDK 34 (https://developer.android.com/studio)
- **Python 3.11+** (for backend) (https://python.org/)

### Step 1: Extract Files
```cmd
mkdir C:\Projects
cd C:\Projects
tar -xzf MusicNavigatorFinal_FINAL.tar.gz
tar -xzf backend_FINAL.tar.gz
```

### Step 2: Configure API Keys

**Backend (.env):**
Edit `backend/.env` and set your Spotify credentials:
```
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=http://your-backend-url/api/auth/callback
```

**Frontend (config.js):**
Edit `MusicNavigatorFinal/src/config/config.js`:
- Set `BACKEND_URL` to your backend server address
- Set `SPOTIFY.CLIENT_ID` to your Spotify Client ID
- Set `SPOTIFY.REDIRECT_URI` to match backend

**Google Maps (AndroidManifest.xml):**
Edit `MusicNavigatorFinal/android/app/src/main/AndroidManifest.xml`:
- Replace the Google Maps API key value

### Step 3: Install Dependencies

**Backend:**
```cmd
cd C:\Projects\backend
pip install -r requirements.txt
```

**Frontend:**
```cmd
cd C:\Projects\MusicNavigatorFinal
npm install
```

### Step 4: Run Backend
```cmd
cd C:\Projects\backend
python -m uvicorn server:app --host 0.0.0.0 --port 8001
```

### Step 5: Run Mobile App

**Terminal 1 - Start Metro:**
```cmd
cd C:\Projects\MusicNavigatorFinal
npx react-native start
```

**Terminal 2 - Build & Run:**
```cmd
cd C:\Projects\MusicNavigatorFinal
npx react-native run-android
```

### Step 6: Build APK
```cmd
cd C:\Projects\MusicNavigatorFinal\android
.\gradlew assembleDebug
```
APK location: `android/app/build/outputs/apk/debug/app-debug.apk`

---

## Troubleshooting

### Gradle Build Errors
```cmd
cd MusicNavigatorFinal\android
.\gradlew clean
cd ..
npx react-native run-android
```

### If that doesn't work, clear all caches:
```cmd
rmdir /s /q %USERPROFILE%\.gradle\caches
rmdir /s /q MusicNavigatorFinal\android\app\build
rmdir /s /q MusicNavigatorFinal\android\.gradle
cd MusicNavigatorFinal
npm install
cd android
.\gradlew clean
cd ..
npx react-native run-android
```

### Metro not connecting to device
```cmd
adb reverse tcp:8081 tcp:8081
adb reverse tcp:8001 tcp:8001
```

---

## Feature Summary

- Spotify OAuth login/logout
- Home screen with playlists, categories, search, mini-player
- Live map with user markers, profile pictures, song cards
- 6 custom map themes (Neon, Blue, Green, Vintage, Dark, Standard)
- Real-time location sharing via WebSocket
- "Listen Together" - sync playback with friends
- Playback controls (play/pause/skip)
- Premium status detection
- Share toggle for privacy control

## API Endpoints (29 total)
All prefixed with `/api/`:
- Auth: login, callback, refresh
- Spotify: me, premium-status, playlists, categories, search, currently-playing, player, devices, queue, play, pause, next, previous, seek, playlist tracks, play context, category playlists, proxy
- Listen Together: create, join, leave, session
- Utility: health, maps key, image proxy
- WebSocket: /api/ws/{user_id}
