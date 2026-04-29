#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: "Build full-stack real-time social music app with Spotify (login/sync), live map, listen-along, and a custom WebGL login screen using PixelBlast + ASCII text. NEW: Add a Shazam-like 'Song Radar' feature — a pulsing mic FAB next to the search icon on the map that records 10 seconds of ambient audio via the device microphone, identifies the song using shazamio, and updates the user's map marker as a live broadcast (no listen-along capability)."

backend:
  - task: "Song Radar /api/recognize endpoint (shazamio-powered audio recognition)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Added POST /api/recognize endpoint accepting an UploadFile audio blob and routing through shazamio. Imports File/UploadFile from fastapi. Falls back to writing the bytes to a temp file with the proper extension if shazamio.recognize(bytes) raises (handles m4a/wav/mp3/ogg/webm). ffmpeg installed system-wide so pydub can decode arbitrary containers. On match, returns {matched, title, subtitle, art, isrc, shazam_id, spotify_uri, spotify_url}. On no-match returns {matched: false}. Backend restarted cleanly."
        -working: true
        -agent: "testing"
        -comment: "Comprehensive backend tests via public ingress (https://beat-together-2.preview.emergentagent.com). All 5 acceptance test cases PASS: (1) Health GET /api/ returns 200 {service:soundmap,status:ok}. (2) Empty/missing file → 422 (FastAPI validation). (3) Tiny <1024 byte clip → 400 'Audio clip too short'. (4) Synthetic 10s 440Hz sine m4a (89KB) generated via ffmpeg lavfi → 200 OK with body {matched:false} (correctly no match for synthetic tone). (5) Synthetic 10s sine wav (882KB) → 200 OK with body {matched:false} — valid JSON with `matched` key. shazamio loaded successfully on startup (logs show 'shazamio_core module initialized successfully', 'Recognizer created with segment_duration_seconds = 10') so 503 path not hit. Recognition completed well under 30s for both formats — no timeouts. Regression checks: GET /api/users/active → 200 {users:[]} ✓, GET /api/spotify/login → 200 with valid auth_url ✓. ffmpeg confirmed installed at /usr/bin/ffmpeg (v5.1.8). No critical issues."

frontend:
  - task: "Login Screen WebGL background fills full viewport on mobile (PixelBlast + ASCIIText)"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/components/PixelBlastBackground.tsx, /app/frontend/src/components/ASCIIText.tsx, /app/backend/server.py"
    stuck_count: 1
    priority: "high"
    needs_retesting: true
    status_history:
        -working: false
        -agent: "main"
        -comment: "First fix relied on window.innerWidth/innerHeight inside the WebView and 100vw/100vh CSS — both unreliable inside react-native-webview. Background was clipped to a small box on Expo Go."
        -working: "NA"
        -agent: "main"
        -comment: "Reworked: RN side now passes measured viewport (useWindowDimensions + onLayout) into the WebView via injectedJavaScriptBeforeContentLoaded as window.__RN_VIEWPORT. HTML's setSize() reads __RN_VIEWPORT first; CSS swapped from position:fixed/100vw/100vh to position:absolute/100% with explicit canvas pixel sizing. WebView is keyed on size to remount on rotation. Web preview verified visually. Awaiting user verification on Expo Go mobile."
        -working: "NA"
        -agent: "main"
        -comment: "Tuned PixelBlast props (pixelSize 6→4, density 1.2→1.6, edgeFade 0.25→0, etc.) for richer edge-to-edge fill. Replaced lime CTA button with StarBorder component (new /api/starborder.html endpoint + StarBorder.tsx WebView wrapper). Bitbucket icon removed, plain text 'CONNECT WITH SPOTIFY' kept. onPress bridged via window.ReactNativeWebView.postMessage('star_press')."
        -working: "NA"
        -agent: "main"
        -comment: "Recolored entire app from lime (#D4FF00) to neon purple (#B026FF). 9 files updated incl. server.py, map.tsx, all bottom sheets, ListenAlong card, sound map markers/clusters/avatars, auth-success spinner, ASCII gradient. Map terrain restyled with purple-noir Google Maps style (deep purple land, navy water, magenta highways) and PixelBlast iframe layered behind the map at z=0 with map opacity:0.88 so the dot pattern subtly bleeds through the terrain — gives the home map the same GeoBeats aesthetic as the login screen."

  - task: "Song Radar — pulsing mic FAB + 10s recording + WS broadcast of recognized track"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/components/SongRadarFab.tsx, /app/frontend/app/map.tsx, /app/frontend/app.json, /app/frontend/src/components/ListenAlongCard.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Created /app/frontend/src/components/SongRadarFab.tsx — a self-contained mic FAB that records exactly 10 seconds of audio via expo-av, animates two staggered pulse rings + a breathing scale while recording, shows a countdown badge, then uploads to /api/recognize and reports the result. Added next to the search icon (left side of top bar) via a new sideRow flex layout. Wired handleRadarResult in map.tsx that synthesizes a Spotify-shaped track ({is_radar:true, item:{name,album.images,artists,uri}}) and broadcasts it via the existing user:active_track WS message so the user's marker pill updates exactly like a Spotify session — but with no Listen Along capability. Spotify-poll loop now respects radar state: if the user has a radar track and Spotify isn't actively playing, the radar track is preserved (real Spotify content always takes precedence). ListenAlongCard updated to render 'RADAR' label and suppress the Listen Along button when ct.is_radar is true. app.json updated with NSMicrophoneUsageDescription (iOS) and android.permission.RECORD_AUDIO. Toast shown on match/no-match."

metadata:
  created_by: "main_agent"
  version: "1.1"
  test_sequence: 1
  run_ui: false

test_plan:
  current_focus: []
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    -agent: "main"
    -message: "Implemented Song Radar feature. Need to test the new POST /api/recognize endpoint. It accepts a multipart form upload field named 'audio' containing an audio clip (m4a preferred, but mp3/wav/ogg/webm also accepted via Content-Type sniffing + ffmpeg fallback). Expected response shape on success: {matched: true, title, subtitle (artist), art, isrc, shazam_id, spotify_uri, spotify_url}. On no-match: {matched: false}. On clip too short (<1024 bytes): 400 error. On service unavailable (shazamio not loaded): 503. A simple test clip can be generated with: ffmpeg -f lavfi -i 'sine=frequency=440:duration=10' -ar 44100 -ac 1 /tmp/test_audio.m4a — note that a synthetic sine wave should NOT match (matched:false expected). For a positive match test, please use a known commercial track snippet if available, otherwise just verify the endpoint accepts the upload and returns valid JSON with matched:false. Also verify the existing /api/, /api/users/active and /api/spotify/login endpoints still respond correctly (no regression). DO NOT test frontend — user has not yet authorized that. Backend URL is http://localhost:8001 internally, but please use the public ingress at the configured EXPO_PUBLIC_BACKEND_URL with /api prefix."
    -agent: "testing"
    -message: "Backend testing for /api/recognize complete — ALL TESTS PASS via public ingress (https://beat-together-2.preview.emergentagent.com). Test script at /app/backend_test.py. Results: (1) GET /api/ → 200 OK ✓. (2) POST /api/recognize without file → 422 (FastAPI validation, expected). (3) POST /api/recognize with 100-byte file → 400 'Audio clip too short' ✓. (4) POST /api/recognize with synthetic 10s 440Hz sine wave m4a (89KB, ffmpeg lavfi) → 200 OK {matched:false} ✓ (synthetic tone correctly not matched). (5) Same with wav (882KB) → 200 OK {matched:false} ✓ — valid JSON with `matched` key. shazamio loaded successfully on backend startup (verified in logs: 'shazamio_core module initialized successfully', 'Recognizer created with segment_duration_seconds = 10') so the 503 path is not active. Recognition completed in well under 30s — no 504s. Regression: GET /api/users/active → 200 {users:[]} ✓, GET /api/spotify/login → 200 with valid Spotify auth_url ✓. ffmpeg confirmed at /usr/bin/ffmpeg (v5.1.8). The /api/recognize endpoint is production-ready. Note: shazamio's bytes path raises on synthetic m4a (server logs show 'invalid mpeg audio header' / 'skipping junk' warnings — these are from the temp-file fallback path with pydub, not errors), and the temp-file fallback successfully completes recognition; both paths return clean {matched:false} JSON. No critical issues — no further main-agent fixes needed for this task."
