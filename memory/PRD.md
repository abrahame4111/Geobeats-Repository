# Music Navigator - Comprehensive Product Requirements Document

## App Summary

**Music Navigator** is a full-stack mobile application that combines real-time social location sharing with Spotify music integration. Users log in with their Spotify accounts, see what friends are listening to on a live interactive map, and can control playback, browse music, and even sync listening sessions. Think of it as a "Snapchat Map meets Spotify" experience.

**Platform:** Android (React Native 0.72.6)
**Backend:** FastAPI (Python) + MongoDB
**Target Users:** Spotify users who want to discover what friends are listening to and share their own listening activity in real-time on a map.

---

## Architecture Overview

```
User's Android Device                    Cloud Server
+-------------------------+             +---------------------------+
| React Native App        |             | FastAPI Backend (port 8001)|
|  - LoginScreen          |  REST/WS    |  - Spotify OAuth proxy     |
|  - HomeScreen           | <---------> |  - Spotify API proxy       |
|  - MapScreen            |             |  - WebSocket manager       |
|  - AuthContext           |             |  - Listen Together mgr     |
|  - SimpleStorage         |             |  - MongoDB (users)         |
+-------------------------+             +---------------------------+
       |                                        |
       v                                        v
  Google Maps SDK                         Spotify Web API
  (Maps, Markers)                    (Auth, Playback, Search)
```

### Tech Stack
| Layer | Technology | Version |
|-------|-----------|---------|
| Mobile App | React Native | 0.72.6 |
| Navigation | React Navigation (Stack) | 6.x |
| Maps | react-native-maps (Google) | 1.10.0 |
| Location | @react-native-community/geolocation | 3.0.6 |
| HTTP Client | Axios | 1.6.0 |
| UI Components | react-native-linear-gradient, react-native-vector-icons | 2.8.3, 10.0.3 |
| Auth WebView | react-native-webview | 13.6.4 |
| Backend | FastAPI | 0.110.1 |
| Database | MongoDB (Motor async driver) | motor 3.3.1 |
| Real-time | WebSockets (native) | built-in |
| HTTP (Backend) | httpx (async) | 0.28.1 |

### File Structure
```
/app/
+-- backend/
|   +-- .env                          # Spotify & Google Maps credentials, MongoDB
|   +-- requirements.txt              # Python dependencies
|   +-- server.py                     # All backend logic (1135 lines)
+-- MusicNavigatorFinal/
|   +-- App.js                        # Root component, navigation setup
|   +-- package.json                  # RN dependencies
|   +-- android/                      # Android native project
|   |   +-- app/build.gradle          # App-level Gradle config
|   |   +-- build.gradle              # Project-level Gradle config
|   |   +-- settings.gradle
|   |   +-- app/src/main/
|   |       +-- AndroidManifest.xml   # Permissions, API key
|   +-- src/
|       +-- components/
|       |   +-- GlassCard.js          # Reusable glassmorphism card (68 lines)
|       +-- config/
|       |   +-- config.js             # Backend URL, API endpoints, Spotify config (63 lines)
|       +-- context/
|       |   +-- AuthContext.js         # Auth state, login/logout, token management (146 lines)
|       +-- screens/
|       |   +-- LoginScreen.js        # Spotify OAuth via WebView (383 lines)
|       |   +-- HomeScreen.js         # Music browsing, search, mini-player (1538 lines)
|       |   +-- MapScreen.js          # Live map with markers, song cards (2090 lines)
|       +-- utils/
|           +-- SimpleStorage.js      # In-memory key-value storage (23 lines)
```

---

## Complete Feature List

### 1. Authentication (LoginScreen)

| # | Feature | Description | Status |
|---|---------|-------------|--------|
| 1.1 | Spotify OAuth Login | Opens Spotify login page in a WebView; intercepts callback URL with tokens | IMPLEMENTED |
| 1.2 | Token Persistence | Saves access_token, refresh_token, user data to SimpleStorage | IMPLEMENTED (in-memory only, lost on app restart) |
| 1.3 | Auto-Login Check | On app start, checks SimpleStorage for existing auth data | IMPLEMENTED |
| 1.4 | Token Refresh | POST to /api/auth/refresh to get new access token | IMPLEMENTED |
| 1.5 | Full Logout | Clears SimpleStorage, clears cookies (CookieManager), resets auth state | IMPLEMENTED |
| 1.6 | Login UI | Animated background dots, gradient logo, feature cards, "Login with Spotify" button | IMPLEMENTED |

**Known Issue:** SimpleStorage is in-memory only (not backed by AsyncStorage), so tokens are lost on app restart. The user must re-login every time the app is killed.

---

### 2. Home Screen (HomeScreen)

| # | Feature | Description | Status |
|---|---------|-------------|--------|
| 2.1 | User Profile Header | Shows user name, avatar placeholder, Premium badge | IMPLEMENTED |
| 2.2 | Search Button | Opens a full-screen search modal | IMPLEMENTED |
| 2.3 | Mini Player | Shows currently playing track with album art, title, artist, play/pause/skip controls | IMPLEMENTED |
| 2.4 | Mini Player (No Music) | Shows "No music playing" placeholder with refresh button | IMPLEMENTED |
| 2.5 | Open Global Map Button | Large green CTA that navigates to MapScreen | IMPLEMENTED |
| 2.6 | Your Playlists Section | Horizontal scrolling list of user's Spotify playlists with cover art | IMPLEMENTED |
| 2.7 | Playlist Detail Modal | Full-screen modal showing playlist cover, description, "Play All" button, track list | IMPLEMENTED |
| 2.8 | Browse Categories Section | Horizontal scrolling list of Spotify genre categories | IMPLEMENTED |
| 2.9 | Category Playlist Modal | Full-screen modal showing playlists within a category | IMPLEMENTED |
| 2.10 | Search Modal | Full-screen search with text input, search button, results list | IMPLEMENTED |
| 2.11 | Track Playback | Tapping a track sends play request via backend to Spotify | IMPLEMENTED |
| 2.12 | Playlist Playback | "Play All" sends context_uri to Spotify for playlist playback | IMPLEMENTED |
| 2.13 | Premium Status Check | Checks if user has Spotify Premium; shows lock banners and alerts for non-premium | IMPLEMENTED |
| 2.14 | Music Stats | Shows count of playlists and categories in glassmorphic cards | IMPLEMENTED |
| 2.15 | Logout Button | Confirmation dialog then full logout | IMPLEMENTED |
| 2.16 | Auto-Refresh | Currently playing track auto-refreshes every 5 seconds | IMPLEMENTED |

---

### 3. Map Screen (MapScreen)

| # | Feature | Description | Status |
|---|---------|-------------|--------|
| 3.1 | Google Maps | Full-screen interactive map with custom themes | IMPLEMENTED |
| 3.2 | Custom Map Themes | 6 themes: Neon, Blue, Green, Vintage, Dark, Standard | IMPLEMENTED |
| 3.3 | Theme Picker Menu | Dropdown menu from top-right button to switch themes | IMPLEMENTED |
| 3.4 | User Location Marker | Shows user's profile picture inside a circular marker on the map | IMPLEMENTED |
| 3.5 | Profile Image Loading | Prefetches profile image, shows gradient placeholder while loading | IMPLEMENTED |
| 3.6 | Song Card on Marker | Shows album art, song title, artist name above the user's marker | IMPLEMENTED |
| 3.7 | Marquee Text on Song Card | Horizontally scrolling text for long song names | IMPLEMENTED (Needs verification) |
| 3.8 | Artist Name Display | Shows artist names joined by comma on the song card | IMPLEMENTED (Needs verification - was showing "undefined") |
| 3.9 | Sound Wave Indicator | Animated sound bars on the song card | IMPLEMENTED (CSS-only, not truly animated) |
| 3.10 | Other Users' Markers | Shows other connected users' locations, profile pics, and song cards | IMPLEMENTED |
| 3.11 | User Modal | Tapping another user's marker opens a bottom sheet with profile, song info, action buttons | IMPLEMENTED |
| 3.12 | Share Toggle | Toggle button to start/stop broadcasting location and listening activity | IMPLEMENTED (Default: OFF) |
| 3.13 | Top Bar | Home button, "Live Map" title, theme picker, online user count, share button | IMPLEMENTED |
| 3.14 | Online User Count | Shows number of connected WebSocket users with pulsing green dot | IMPLEMENTED |
| 3.15 | Center on Me Button | Floating button to animate map to user's current location | IMPLEMENTED |
| 3.16 | Show All Users Button | Floating button to fit all user markers in the map viewport | IMPLEMENTED |
| 3.17 | Refresh Button | Floating button to re-fetch profile and currently playing track | IMPLEMENTED |
| 3.18 | Playback Controls | Play/pause, skip next/previous from the map screen | IMPLEMENTED |
| 3.19 | Location Permission Request | Requests fine location, falls back to coarse, shows guidance alerts | IMPLEMENTED |
| 3.20 | Multi-Fallback Location | High accuracy -> Low accuracy -> Very relaxed, with timeouts | IMPLEMENTED |
| 3.21 | Location Watch | Continuous position watching with distanceFilter and interval | IMPLEMENTED |
| 3.22 | WebSocket Connection | Persistent connection for real-time location/song broadcasting | IMPLEMENTED |
| 3.23 | Auto-Reconnect | WebSocket reconnects after 5 seconds on close | IMPLEMENTED |
| 3.24 | Connection Status Indicator | Visual indicator (green dot) for WebSocket connection state | IMPLEMENTED |

---

### 4. Listen Together (Social Feature)

| # | Feature | Description | Status |
|---|---------|-------------|--------|
| 4.1 | Create Session | Host creates a listening session; gets a session ID | IMPLEMENTED |
| 4.2 | Join Session | Other users can join by session ID; playback auto-syncs | IMPLEMENTED |
| 4.3 | Leave Session | User can leave; if host leaves, session ends | IMPLEMENTED |
| 4.4 | Playback Sync | Host's playback changes are broadcast to all participants via WebSocket | IMPLEMENTED |
| 4.5 | Invite via Map | Host can send invite to another user visible on the map | IMPLEMENTED |
| 4.6 | Invite Modal | Recipients see a modal with track info and accept/decline buttons | IMPLEMENTED |
| 4.7 | Session Indicator | Markers with active sessions show headset icon and green border | IMPLEMENTED |
| 4.8 | Join from User Modal | "Join Listen Together" button when tapping a user with an active session | IMPLEMENTED |
| 4.9 | Play Their Song | "Play This Song" button to play the same track as another user | IMPLEMENTED |

---

### 5. Backend API

| # | Endpoint | Method | Description | Status |
|---|----------|--------|-------------|--------|
| 5.1 | /api/health | GET | Health check with connection stats | IMPLEMENTED |
| 5.2 | /api/auth/login | GET | Redirects to Spotify OAuth | IMPLEMENTED |
| 5.3 | /api/auth/callback | GET | Handles OAuth callback, stores user, redirects with tokens | IMPLEMENTED |
| 5.4 | /api/auth/refresh | POST | Refreshes Spotify access token | IMPLEMENTED |
| 5.5 | /api/spotify/me | GET | Get user profile (proxies to Spotify) | IMPLEMENTED |
| 5.6 | /api/spotify/premium-status | GET | Check if user has Premium | IMPLEMENTED |
| 5.7 | /api/spotify/playlists | GET | Get user's playlists | IMPLEMENTED |
| 5.8 | /api/spotify/categories | GET | Get Spotify browse categories | IMPLEMENTED |
| 5.9 | /api/spotify/currently-playing | GET | Get currently playing track | IMPLEMENTED |
| 5.10 | /api/spotify/player | GET | Get full player state | IMPLEMENTED |
| 5.11 | /api/spotify/devices | GET | Get available Spotify devices | IMPLEMENTED |
| 5.12 | /api/spotify/queue | GET | Get playback queue | IMPLEMENTED |
| 5.13 | /api/spotify/play | PUT | Play a track (with device detection) | IMPLEMENTED |
| 5.14 | /api/spotify/pause | PUT | Pause playback | IMPLEMENTED |
| 5.15 | /api/spotify/next | POST | Skip to next track | IMPLEMENTED |
| 5.16 | /api/spotify/previous | POST | Skip to previous track | IMPLEMENTED |
| 5.17 | /api/spotify/seek | PUT | Seek to position in track | IMPLEMENTED |
| 5.18 | /api/spotify/playlist/{id}/tracks | GET | Get playlist tracks | IMPLEMENTED |
| 5.19 | /api/spotify/play/context | PUT | Play a playlist/album/artist | IMPLEMENTED |
| 5.20 | /api/spotify/proxy | GET | Proxy any Spotify API request | IMPLEMENTED |
| 5.21 | /api/spotify/search | GET | Search for tracks | IMPLEMENTED |
| 5.22 | /api/spotify/category/{id}/playlists | GET | Get playlists for a category | IMPLEMENTED |
| 5.23 | /api/listen-together/create | POST | Create listening session | IMPLEMENTED |
| 5.24 | /api/listen-together/join/{id} | POST | Join listening session | IMPLEMENTED |
| 5.25 | /api/listen-together/leave | POST | Leave listening session | IMPLEMENTED |
| 5.26 | /api/listen-together/session/{id} | GET | Get session info | IMPLEMENTED |
| 5.27 | /api/proxy/image | GET | Proxy images for CORS | IMPLEMENTED |
| 5.28 | /api/maps/key | GET | Get Google Maps API key | IMPLEMENTED |
| 5.29 | /api/ws/{user_id} | WS | Real-time WebSocket for location, songs, listen-together | IMPLEMENTED |

---

### 6. WebSocket Message Types

| Message Type | Direction | Description |
|-------------|-----------|-------------|
| location_update | Client -> Server -> All | Broadcasts user location, song, profile image |
| initial_state | Server -> Client | Sends all current locations on connect |
| online_count_update | Server -> All | Updates online user count |
| user_disconnect | Client -> Server -> All | User hides from map |
| listen_together_sync | Client -> Server -> Participants | Host syncs playback state |
| listen_together_invite | Client -> Server -> Target | Invite specific user to session |
| listen_together (events) | Server -> Participants | user_joined, user_left, playback_sync |

---

### 7. UI/UX Design

| # | Element | Description |
|---|---------|-------------|
| 7.1 | Dark Theme | Spotify-inspired dark color scheme (#191414, #0d0d0d, #000000) |
| 7.2 | Glassmorphism | Semi-transparent cards with gradient overlays and border highlights |
| 7.3 | Spotify Green Accents | #1DB954 / #1ED760 used for primary actions and highlights |
| 7.4 | Gradient Buttons | LinearGradient buttons throughout the app |
| 7.5 | Material Icons | react-native-vector-icons MaterialIcons for all icons |
| 7.6 | Pulse Animation | Animated green dot for connection status |
| 7.7 | Premium Badges | Gold (#FFD700) badges for Spotify Premium users |
| 7.8 | Bottom Sheet Modals | Slide-up modals for user details and invites |

---

### 8. Android Configuration

| Setting | Value |
|---------|-------|
| Package Name | com.musicnavigatorfinal |
| Min SDK | 21 (Android 5.0) |
| Target SDK | 34 (Android 14) |
| Compile SDK | 34 |
| Build Tools | 34.0.0 |
| Java/Kotlin JVM Target | 1.8 |
| Hermes Enabled | Yes |
| Permissions | INTERNET, ACCESS_NETWORK_STATE, ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION, ACCESS_BACKGROUND_LOCATION |

---

## Known Issues

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | Marquee (scrolling) text on song card may not work | P1 | Needs Verification |
| 2 | Artist name sometimes shows "undefined" on song card | P1 | Needs Verification |
| 3 | SimpleStorage is in-memory only - tokens lost on app restart | P2 | Known Limitation |
| 4 | No token auto-refresh mechanism on expiry | P2 | Not Implemented |
| 5 | WebSocket has no authentication/token validation | P3 | By Design (for now) |
| 6 | Sound wave bars on song card are static (not animated) | P3 | Cosmetic |

---

## 3rd Party Integrations

| Service | Purpose | Auth Method | Keys Location |
|---------|---------|-------------|---------------|
| Spotify Web API | OAuth, profiles, playback, search, categories | OAuth 2.0 (PKCE via backend) | backend/.env |
| Google Maps SDK (Android) | Map display, markers | API Key | AndroidManifest.xml |
| MongoDB | User data persistence | Connection string | backend/.env |

---

## Pending Tasks (Priority Order)

1. **P0 - Comprehensive Backend API Testing** - Test all 29 API endpoints
2. **P0 - Fix & Verify Marquee Text** - Confirm scrolling works for long song names
3. **P0 - Fix & Verify Artist Name** - Confirm no "undefined" appears
4. **P0 - Package & Deliver** - Create clean archive with updated setup guide
5. **P2 - Refactor Monolithic Files** - Break down MapScreen (2090 lines) and HomeScreen (1538 lines)
6. **P3 - Persistent Storage** - Replace SimpleStorage with AsyncStorage
7. **P3 - Token Auto-Refresh** - Implement automatic token renewal before expiry

---

## User's Environment

- **OS:** Windows (Command Prompt / PowerShell)
- **Package Manager:** npm (not yarn)
- **Build Tool:** Android Gradle
- **Testing Device:** Physical Android device or emulator
- **Backend Hosting:** Emergent Platform (preview environment)

---

*Last Updated: 2026-03-24*
