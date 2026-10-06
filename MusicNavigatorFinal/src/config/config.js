// Backend Configuration
export const CONFIG = {
  // Set this locally to the HTTPS URL of the running backend before building
  // for a physical iPhone. Do not add credentials to this file.
  BACKEND_URL: 'https://YOUR_BACKEND_HOST',
  
  // API Configuration
  API_TIMEOUT: 10000,
  
  // WebSocket Configuration
  WS_RECONNECT_ATTEMPTS: 5,
  WS_RECONNECT_INTERVAL: 3000,
  
  // Location Configuration
  LOCATION_UPDATE_INTERVAL: 5000,
  LOCATION_TIMEOUT: 15000,
  
  // Map Configuration
  DEFAULT_REGION: {
    latitude: 37.78825,
    longitude: -122.4324,
    latitudeDelta: 0.0922,
    longitudeDelta: 0.0421,
  },
  
  // Spotify credentials and the Android Maps key are server/build settings.
  // Keep them in backend/.env and local Gradle properties, never in this app.
};

// API Endpoints (Note: /api prefix is added by AuthContext)
export const API_ENDPOINTS = {
  AUTH: {
    LOGIN: '/auth/login',
    CALLBACK: '/auth/callback',
    REFRESH: '/auth/refresh'
  },
  SPOTIFY: {
    ME: '/spotify/me',
    PLAYLISTS: '/spotify/playlists',
    CATEGORIES: '/spotify/categories',
    CURRENTLY_PLAYING: '/spotify/currently-playing',
    PREMIUM_STATUS: '/spotify/premium-status',
    PLAYER: '/spotify/player',
    PLAY: '/spotify/play',
    PAUSE: '/spotify/pause',
    NEXT: '/spotify/next',
    PREVIOUS: '/spotify/previous',
    SEEK: '/spotify/seek'
  },
  LISTEN_TOGETHER: {
    CREATE: '/listen-together/create',
    JOIN: '/listen-together/join',
    LEAVE: '/listen-together/leave',
    SESSION: '/listen-together/session'
  },
  WEBSOCKET: '/ws'
};
