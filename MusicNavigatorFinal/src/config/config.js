// Backend Configuration
export const CONFIG = {
  // Replace with your backend URL
  BACKEND_URL: 'https://musicmap-build.preview.emergentagent.com',
  
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
  
  // Spotify API Configuration (these should match your backend)
  SPOTIFY: {
    CLIENT_ID: 'YOUR_SPOTIFY_CLIENT_ID', // Replace with your Spotify Client ID
    REDIRECT_URI: 'https://musicmap-build.preview.emergentagent.com/api/auth/callback',
    SCOPES: 'user-read-private user-read-email user-read-currently-playing user-read-playback-state playlist-read-private'
  },
  
  // Google Maps API Key (Replace with your key)
  GOOGLE_MAPS_API_KEY: 'YOUR_GOOGLE_MAPS_API_KEY'
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
    CURRENTLY_PLAYING: '/spotify/currently-playing'
  },
  WEBSOCKET: '/ws'
};