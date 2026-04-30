# GeoBeats Deployment — Migrating to geobeats.live

This codebase is **fully env-driven** — there are no hardcoded preview-domain
URLs in the executable code. To deploy to your custom domain, you only need to
update env variables.

---

## 🅰️ Path A — Migrate to a Full-Stack Web project on Emergent

Custom domains (geobeats.live) are exclusive to **Full-Stack Web** projects
(E1 / E1.5 / E2). The current project is a Mobile Agent project, which only
exposes the "Publish" button.

### Step-by-step

1. **Push this repo to GitHub** from the current Emergent project
   - Settings → GitHub Push → connect repo → push
2. **Start a new E1 / E1.5 / E2 task** on Emergent
3. In the new task, **pull the GitHub repo** that was just pushed
4. Update **`/app/backend/.env`** with production values:
   ```
   MONGO_URL="mongodb://localhost:27017"
   DB_NAME="soundmap_database"
   SPOTIFY_CLIENT_ID="<your existing client id>"
   SPOTIFY_CLIENT_SECRET="<your existing client secret>"
   SPOTIFY_REDIRECT_URI="https://geobeats.live/api/spotify/callback"
   FRONTEND_URL="https://geobeats.live"
   ```
5. Update **`/app/frontend/.env`** with production values:
   ```
   EXPO_PUBLIC_BACKEND_URL=https://geobeats.live
   EXPO_PUBLIC_MAPBOX_TOKEN=<your existing mapbox token>
   ```
   *(Keep the EXPO_PACKAGER_* and METRO_CACHE_ROOT entries as-is.)*
6. Click **Deploy** in the Emergent UI
7. Once deployed, click **Link Domain** → enter `geobeats.live` → Entri
   walks you through DNS setup at GoDaddy:
   - Add the **A record** + **CNAME** records Entri provides
   - Wait 5-30 min for DNS + SSL provisioning
8. **Spotify Developer Dashboard**:
   - Open your app → Settings → Redirect URIs → Add:
     `https://geobeats.live/api/spotify/callback`
   - User Management → add up to 5 tester Spotify-account emails
9. **Smoke test** — open `https://geobeats.live` on phone and desktop:
   - OAuth flow completes
   - Map renders (Mapbox globe)
   - Currently-playing pill shows
   - Listen Along works between two testers
   - Song Radar finds a song
   - WebSocket connects (check browser console for `wss://geobeats.live/api/ws`)

---

## What's already done (codebase-side)

- ✅ All backend redirect URIs read from `SPOTIFY_REDIRECT_URI` and `FRONTEND_URL`
- ✅ All frontend API calls use `EXPO_PUBLIC_BACKEND_URL`
- ✅ All WebSocket connections derived from the same env var
- ✅ All inline HTML/WebGL routes (`/api/mapbox.html`, `/api/pixelblast.html`,
  `/api/asciitext.html`, `/api/starborder.html`, `/api/tiltedcard.html`) served
  relative to the API host — no domain hardcoding
- ✅ Test file is now domain-agnostic (`/api/spotify/callback` substring check)
- ✅ The leftover preview-domain string in `SoundMapView.tsx` error message
  has been replaced with generic deployment-domain wording

---

## Reminders

- 💎 **You (the app owner) need active Spotify Premium** or the entire app
  stops working in Dev Mode (Spotify policy as of Feb 2026).
- 🎧 **Each of your 5 testers also needs Premium** for playback / listen-along.
- 🔔 The redirect URI value in **Spotify Developer Dashboard MUST exactly
  match** the value in `SPOTIFY_REDIRECT_URI` — Spotify rejects mismatches.
- 📝 You can keep the preview-domain redirect URI registered in Spotify too;
  Spotify allows multiple redirect URIs per app.
