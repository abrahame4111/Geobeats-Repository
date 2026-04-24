# SoundMap — PRD

## Overview
Real-time social music app (Expo mobile + web) where users see each other on a live map and join any other user's Spotify playback in sync.

## Stack
- **Frontend**: Expo SDK 54 (React Native + web), expo-router, react-native-webview (iframe on web) for Google Maps JS
- **Backend**: FastAPI + WebSockets, MongoDB, spotipy for Spotify OAuth + Web API
- **Real-time**: Native `/api/ws` WebSocket (location / track / session / sync events)
- **Maps**: Google Maps JS API (dark style) with DOM-overlay custom bubble markers
- **Auth**: Spotify OAuth 2.0 Authorization Code flow (server-side token exchange)

## Features Delivered
1. Spotify OAuth login → token stored in AsyncStorage, auto-refresh
2. Live Google Map with glowing avatar+track bubble markers
3. Location broadcast every 5 s via WebSocket (`location:update`)
4. Track broadcast every 5 s from each user's Spotify `currently-playing`
5. Tap marker → glass "Listen Along" card with track + CTA
6. `session:join` / `session:leave` / `session:update` / `session:sync` WebSocket events
7. Guest auto-syncs playback (play same URI, seek to host position, re-sync every 5 s → target 1–3 s accuracy)
8. Host playback controls (play / pause / next / previous) via Spotify Web API proxy
9. Dark SnapMap-style UI, Volt-green accents, persistent player bottom sheet with sync-status badge

## Environment
- Backend `.env`: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI`, `FRONTEND_URL`
- Frontend `.env`: `EXPO_PUBLIC_BACKEND_URL`, `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`

## Required Setup (by user)
- In [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), add this Redirect URI to the app:
  `https://beat-together-2.preview.emergentagent.com/api/spotify/callback`
- Testing requires at least one **Spotify Premium** account (playback control is Premium-only per Spotify API). Free accounts can still appear on the map with their currently-playing track.
