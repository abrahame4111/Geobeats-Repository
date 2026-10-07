# GeoBeats iOS progress handoff

Last updated: 2026-10-07

This file is a compact handoff for an agent or developer continuing the iOS/TestFlight work. Keep future updates short and avoid pasting secrets, full logs, or large command output.

## Current branch

- Branch: `codex/ios-expo-port`
- Remote: `origin/codex/ios-expo-port`
- Purpose: iOS/Expo port and TestFlight testing path for the GeoBeats mobile app.

## Current state

- iOS production build completed through EAS.
- Latest EAS iOS build:
  - Build number: `107`
  - App version: `1.0.1`
  - Bundle identifier used for TestFlight: `com.leounib.geobeats`
  - Git commit included: `687d6fb5 Harden iOS Spotify login redirect`
  - Build status: `FINISHED`
- EAS submission to App Store Connect:
  - Submission id: `52ce08cb-3e06-44da-b9fa-40267a426ffc`
  - Last checked status: `IN_QUEUE`
- Backend health was verified at the Render production API.
- Spotify login endpoint responds quickly from production backend.

## Important local note

`frontend/app.json` may be locally modified for the TestFlight bundle id `com.leounib.geobeats`. Do not commit that file unless the owner explicitly wants the bundle id change stored in git.

Known local noise to ignore unless explicitly requested:

- `.DS_Store`
- `MusicNavigatorFinal/`

## What has been fixed so far

### iOS OAuth handoff

The mobile Spotify login flow was hardened in `frontend/app/index.tsx`.

- Uses fixed mobile callback scheme: `geobeats://auth-success`
- Wraps the login URL request in a 12 second timeout.
- Opens Spotify auth through `WebBrowser.openAuthSessionAsync`.
- Uses a non-ephemeral browser session so Spotify login state can persist better on iPhone.

### Backend OAuth/log safety

Backend OAuth logging was reduced so access tokens, refresh tokens, callback query params, and secrets should not be printed in normal Render logs.

- Uvicorn access log disabled in production container.
- OAuth callback logs now avoid token/query details.

### Compatibility routes

Backend keeps legacy Spotify paths for older builds:

- `/api/spotify/login`
- `/api/spotify/callback`

Main auth routes also exist:

- `/api/auth/login`
- `/api/auth/callback`

## Validation already run

From `frontend/`:

```bash
npm run test:ios-config --if-present
npx tsc --noEmit --pretty false
```

Both passed after the iOS OAuth fix.

## How to check current TestFlight submission status

From `frontend/`:

```bash
npx eas-cli@latest submit:view 52ce08cb-3e06-44da-b9fa-40267a426ffc --json
```

Only summarize the status fields. Do not paste full signed artifact/log URLs into issues or chat unless needed.

## Next test plan

After Apple processing finishes and build `107` appears in TestFlight:

1. Install or update GeoBeats from TestFlight.
2. Fully close the old GeoBeats app.
3. Open build `107`.
4. Tap the Spotify connect button.
5. Expected result:
   - Spotify auth opens.
   - User approves.
   - iOS returns to GeoBeats through `geobeats://auth-success`.
   - App saves auth tokens and routes into the map/app flow.

If the button still spins, classify the failure:

- Spotify never opens: frontend button or login URL fetch problem.
- Spotify opens but errors: Spotify dashboard redirect URI or tester/account problem.
- Spotify login succeeds but does not return: iOS deep link callback problem.
- Returns to app but stays on login: token parsing or auth state persistence problem.

## Spotify dashboard requirements

The Spotify app must include the production backend callback URL exactly:

```text
https://geobeats-api.onrender.com/api/spotify/callback
```

Do not use `127.0.0.1` for TestFlight. Localhost only applies to local web/dev testing.

If the Spotify app is still in development mode, every tester must be added in the Spotify Developer Dashboard.

## Environment variables

Do not commit real values. Production values should live in Render/EAS/Apple/Spotify dashboards only.

Backend needs:

- `MONGO_URL`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SPOTIFY_REDIRECT_URI`
- `GOOGLE_MAPS_API_KEY`
- `CORS_ORIGINS`

Frontend/EAS needs public config only:

- `EXPO_PUBLIC_BACKEND_URL`
- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`
- `EXPO_PUBLIC_MAPBOX_TOKEN` if map fallback is used

## Suggested agent prompt

Use this with a future coding agent:

```text
Continue GeoBeats iOS/TestFlight work on branch codex/ios-expo-port. First read docs/IOS_PROGRESS_HANDOFF.md, then inspect only the files needed for the current failure. Keep output concise, avoid dumping logs, and never print secrets. Do not commit frontend/app.json unless I explicitly ask. Current priority: verify TestFlight build 107 Spotify login. If it fails, classify whether the issue is frontend fetch, Spotify dashboard redirect, iOS deep link return, or auth token parsing, then make the smallest safe fix and run targeted validation.
```

## Token discipline for future agents

- Start by reading this file and `git status --short --branch`.
- Use `rg` to find relevant code instead of scanning the whole repo.
- Prefer targeted commands and summarize output.
- Never paste full EAS, Render, OAuth, or signed artifact URLs into the final report.
- Ask for screenshots or exact failure stage only when the app behavior cannot be inferred from logs.
