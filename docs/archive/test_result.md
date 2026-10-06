# Music Navigator Final - Test Plan

## Backend API Tests Required

### Authentication
- [ ] GET /api/auth/login - Spotify OAuth initiation
- [ ] GET /api/auth/callback - OAuth callback handling
- [ ] POST /api/auth/refresh - Token refresh

### Spotify Endpoints
- [ ] GET /api/spotify/me - Get user profile
- [ ] GET /api/spotify/premium-status - Check premium status
- [ ] GET /api/spotify/playlists - Get user playlists
- [ ] GET /api/spotify/categories - Get browse categories
- [ ] GET /api/spotify/currently-playing - Get current track
- [ ] GET /api/spotify/search - Search for tracks
- [ ] GET /api/spotify/playlist/{id}/tracks - Get playlist tracks
- [ ] GET /api/spotify/category/{id}/playlists - Get category playlists
- [ ] PUT /api/spotify/play - Play track
- [ ] PUT /api/spotify/pause - Pause playback
- [ ] POST /api/spotify/next - Skip to next
- [ ] POST /api/spotify/previous - Skip to previous

### Listen Together
- [ ] POST /api/listen-together/create - Create session
- [ ] POST /api/listen-together/join/{id} - Join session
- [ ] POST /api/listen-together/leave - Leave session

### WebSocket
- [ ] WS /api/ws/{user_id} - Real-time location updates

### Health
- [ ] GET /api/health - Server health check

## Frontend Features to Test
- Login flow
- Home screen with playlists and categories
- Mini player
- Search functionality
- Map screen with location
- Share toggle
- Theme switcher
- Logout and re-login

