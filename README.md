# 🎵 Music Navigator

A real-time music streaming application that combines Spotify integration with live location tracking on Google Maps. Stream your music, see friends on a map, and view what they're listening to in real-time!

## ✨ Features

### 🎧 Spotify Integration
- **OAuth 2.0 Authentication**: Secure login with your Spotify account
- **Playlist Management**: Browse and access all your Spotify playlists
- **Category Discovery**: Explore Spotify's pre-made music categories
- **Full Playback Control**: Play, pause, skip tracks, and manage your queue
- **Real-time Track Display**: See what's currently playing with album artwork

### 🗺️ Live Location Map
- **Google Maps Integration**: Beautiful dark-themed map interface
- **Multi-user Tracking**: See multiple users' locations in real-time
- **Live Music Display**: View what song each user is currently playing
- **WebSocket Real-time Updates**: Instant location and music synchronization
- **Custom Markers**: Different colors for you vs. other users

### 🎨 Beautiful UI
- **Spotify-inspired Design**: Dark theme with signature green accents
- **Modern Components**: Smooth animations and transitions
- **Responsive Layout**: Works on desktop and mobile
- **Interactive Elements**: Hover effects and micro-animations

## 🚀 Getting Started

### Prerequisites

1. **Spotify Developer Account**
2. **Google Maps API Key**

### Step 1: Spotify API Setup

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Click "Create App"
3. Fill in the details:
   - **App Name**: Music Navigator (or any name you prefer)
   - **App Description**: Real-time music streaming with location tracking
   - **Redirect URI**: `https://mapify-social.preview.emergentagent.com/auth/callback`
   - Check the Terms of Service box
4. Click "Save"
5. You'll see your **Client ID** and **Client Secret** (click "Show Client Secret")
6. Copy both values

### Step 2: Google Maps API Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the following APIs:
   - **Maps JavaScript API**
   - **Geolocation API**
   - **Geocoding API**
4. Go to "Credentials" → "Create Credentials" → "API Key"
5. Copy the API key
6. **IMPORTANT**: Restrict your API key:
   - Click on the key name
   - Under "Application restrictions", select "HTTP referrers"
   - Add: `https://mapify-social.preview.emergentagent.com/*`
   - Under "API restrictions", select "Restrict key"
   - Choose the three APIs mentioned above
   - Click "Save"

### Step 3: Configure Environment Variables

1. Open `/app/backend/.env` file
2. Replace the placeholder values:

```env
# Spotify API Configuration
SPOTIFY_CLIENT_ID="your_spotify_client_id_here"
SPOTIFY_CLIENT_SECRET="your_spotify_client_secret_here"
SPOTIFY_REDIRECT_URI="https://mapify-social.preview.emergentagent.com/auth/callback"

# Google Maps API Configuration
GOOGLE_MAPS_API_KEY="your_google_maps_api_key_here"
```

### Step 4: Restart Services

After adding your API keys, restart the backend:

```bash
sudo supervisorctl restart backend
```

## 📱 How to Use

### 1. Login
- Click "Login with Spotify" on the home page
- Authorize the application to access your Spotify account
- You'll be redirected back to the app

### 2. Home Page
- Browse your personal playlists
- Explore Spotify categories
- Click on any playlist to open it in Spotify
- Use the bottom player to control playback

### 3. Map Page
- Click "Map" in the navigation
- Click "Share Location" to enable location tracking
- See yourself (green marker) and other users (blue markers)
- Click on any marker to see what they're listening to
- Your location and current song update every 5 seconds

## 🎮 Features in Detail

### Music Player
- **Current Track Display**: Shows album art, song name, and artist
- **Playback Controls**: Play/Pause, Skip Forward, Skip Back
- **Progress Bar**: Visual representation of playback progress
- **Auto-refresh**: Updates every 3 seconds

### Real-time Location Sharing
- **Browser Geolocation**: Uses your device's GPS
- **WebSocket Connection**: Instant updates to all connected users
- **Music Integration**: Automatically fetches and displays your current song
- **Privacy**: Only shares when you click "Share Location"

## ⚙️ Technical Stack

- **Frontend**: React 19, React Router, Axios, Lucide Icons
- **Backend**: FastAPI, Motor (MongoDB), WebSockets
- **Database**: MongoDB
- **APIs**: Spotify Web API, Google Maps JavaScript API
- **Real-time**: WebSocket for location and music updates

## 🐛 Troubleshooting

### "Authentication failed"
- Check that your Spotify Client ID and Secret are correct
- Verify the Redirect URI matches exactly in Spotify Dashboard

### "Map not loading"
- Verify your Google Maps API key is correct
- Check that the required APIs are enabled in Google Cloud Console

### "No music playing"
- Spotify Premium is required for full playback control
- Make sure you're playing music in Spotify (desktop or mobile app)

### "Location not updating"
- Allow location permissions in your browser
- Make sure HTTPS is enabled (required for geolocation)

## 📝 Important Notes

- **Spotify Premium Required**: Full playback control requires a Spotify Premium subscription
- **HTTPS Required**: Geolocation API only works over HTTPS
- **API Rate Limits**: Be mindful of Spotify and Google Maps API rate limits

---

**Made with ❤️ using FastAPI + React + MongoDB**
