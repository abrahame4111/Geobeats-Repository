# GeoBeats on a physical iPhone

Use the same `frontend/` Expo application and `backend/` API as Android.
The iOS branch is `codex/ios-expo-port`. The Expo project is
[workwork/geobeats](https://expo.dev/accounts/workwork/projects/geobeats).

A **preview** build embeds JavaScript and assets. Once it is installed, the
Mac, Xcode, and Metro do not need to stay running. The hosted API and MongoDB
still need to be online. A preview build is distinct from a development build
that loads JavaScript from Metro.

## 1. Host the shared API

If your cousin has a working API, reuse its HTTPS origin after confirming it
provides the routes required by this checkout. The former Emergent URL in the
source returned HTTP 404 on `/api/health` when checked on October 6, 2026.

Otherwise, use the repository's `render.yaml` Blueprint:

1. Create a MongoDB Atlas database and database user for testing. Grant that
   user read/write access to `geobeats_testing`. Allow the Render service's
   outbound IP addresses in Atlas Network Access.
2. In Render, connect this GitHub repository and create a Blueprint from
   **codex/ios-expo-port**. The Blueprint uses `backend/Dockerfile`, serves
   `/api/health`, and defaults to the free web-service plan. Review the plan
   in the dashboard before creating it. Automatic deployments are disabled.
3. Enter the environment values below in Render. Never place secrets in EAS,
   frontend source, Git, issues, or chat.

| Render variable | Value |
| --- | --- |
| `MONGO_URL` | Atlas connection string, including the database user's credentials |
| `DB_NAME` | `geobeats_testing` (already configured) |
| `SPOTIFY_CLIENT_ID` | Your Spotify application's client ID |
| `SPOTIFY_CLIENT_SECRET` | Your Spotify application's secret |
| `SPOTIFY_REDIRECT_URI` | `https://YOUR-SERVICE.onrender.com/api/spotify/callback` |
| `GOOGLE_MAPS_API_KEY` | Google Maps key for the backend-served map pages |
| `CORS_ORIGINS` | The hosted API origin, plus any actual web frontend origins, comma separated |
| `DEBUG_TOKEN` | Generated automatically by the Blueprint |

The API uses a capped MongoDB collection and tailable cursors for cross-process
WebSocket events. Verify `/api/health` after deployment; startup must be able
to create the collection. Use a separate testing database instead of modifying
your cousin's production database.

The container includes ffmpeg for Song Radar and the shared `frontend/assets`
directory for the backend's image/font endpoints. Local `.env` files are excluded
from the Docker context. The free Render service can sleep when idle; the first
request after that can be slow. Use an always-on plan if that becomes unsuitable
for testing, after reviewing its price.

In Spotify's dashboard, register the exact HTTPS callback above. The current
server derives `/api/spotify/callback` from the request's public host, so that
must match the host the app calls. `/api/auth/callback` is a legacy alias.
After Spotify calls the server, the server returns to the installed app using
`geobeats://auth-success`. Do not confuse that app deep link with Spotify's
server callback URL. Test users also need access to the Spotify app under its
app-specific development restrictions.

Confirm readiness (replace the example hostname):

```bash
curl --fail https://YOUR-SERVICE.onrender.com/api/health
```

It should return JSON containing `"status":"healthy"`.

## 2. Configure the Expo preview environment

In the [Expo project dashboard](https://expo.dev/accounts/workwork/projects/geobeats),
set these variables in the **preview** environment:

| Expo variable | Value |
| --- | --- |
| `EXPO_PUBLIC_BACKEND_URL` | The working HTTPS origin, without `/api` or a trailing slash |
| `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | The appropriate public/restricted Google Maps key if used by the frontend |
| `EXPO_PUBLIC_MAPBOX_TOKEN` | Optional Mapbox public token (`pk.…`), only if using Mapbox |

`EXPO_PUBLIC_*` values become part of the app and are not secret. A Google Maps
key (`AIza…`) does not belong in `EXPO_PUBLIC_MAPBOX_TOKEN`. Keep the Spotify
secret and MongoDB connection string on the backend only.

The cloud build reads EAS environment values, not your ignored local `.env`.
The pre-install hook rejects missing backend URLs, local addresses, and URLs
with embedded credentials so an unusable localhost preview is not distributed.
The root `.easignore` excludes old native projects, generated iOS/Android folders,
local credentials, and Python environments. Expo regenerates native projects
using the committed config plugins on its SDK 54 build image.

## 3. Register the iPhone and build

An active Apple Developer Program membership and access to its signing team are
required. From `frontend/`:

```bash
npx --yes eas-cli@latest whoami
npx --yes eas-cli@latest device:create
npx --yes eas-cli@latest build --platform ios --profile preview
```

Complete Apple's authentication prompts locally. Open the device registration
link on the iPhone, register it, and include it in the provisioning profile when
building. Open the completed build's installation link on that same iPhone.
Enable Developer Mode if iOS requests it. No public App Store release is needed.

For a self-contained simulator build, use the `simulator` profile instead. It
also embeds JavaScript, but it cannot be installed on a physical iPhone.

For TestFlight later, use the `production` build profile and configure the
**production** EAS environment separately, then submit the completed build to
your Apple team's App Store Connect app. Do not submit the ad hoc preview binary.

## Verification and known limits

- A Debug build was compiled, installed, and visually checked on the iPhone 17
  Pro simulator running iOS 26.5. The login screen renders, and the auth-return
  route handles both warm and cold starts (tested with a harmless error value,
  not real Spotify credentials). This local Debug build still uses Metro.
- The separate scene delegate starts React Native using the application
  delegate's initialized factory. The former patch made UIKit instantiate a
  second, uninitialized application delegate, resulting in a black screen.
- Native decorative WebViews keep the existing server-rendered animations when
  online and fall back to readable text/a usable button if the server is down.
- `npm run test:ios-config` checks fresh and existing native project transforms,
  repeated prebuilds, and invalid cloud backend configuration.
- `npx tsc --noEmit` passes. PeopleSearch now reads the exact profile from the
  lookup response instead of treating the response wrapper as a profile.
- The Render Blueprint passes Render's published schema, and EAS's upload
  filter was checked for credential exclusions and required source/assets.
  The Docker image, hosted service, and signed physical-device build have not
  yet been built or tested; they still require account setup and credentials.
- A local successful build and visible login screen do not verify Spotify
  authentication, map service keys, microphone recognition, or multi-user sync.
  Test those against the hosted API after credentials are configured.

References: [Expo internal distribution](https://docs.expo.dev/build/internal-distribution/),
[Expo preview builds](https://docs.expo.dev/tutorial/eas/internal-distribution-builds/),
[Render Docker services](https://render.com/docs/docker),
[Render free-service limits](https://render.com/docs/free).
