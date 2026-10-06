# 🎵 Music Navigator - Global Real-Time Music & Location Sharing

A React Native application that combines Spotify music streaming with real-time location sharing on a global map. See what your friends are listening to and where they are, anywhere in the world.

## ✨ Key Features

### 🎨 **Professional Glassmorphism Design**
- Translucent glass cards with blur effects
- Smooth gradient backgrounds
- Animated transitions and micro-interactions
- Modern iOS/Android design language

### 🎶 **Advanced Music Integration**
- Spotify OAuth authentication
- Real-time currently playing track display
- Animated progress bar with playback position
- Album artwork and metadata
- Playlist and category browsing

### 🗺️ **Global Map with Fixed Scrolling**
- **Unlimited pan and zoom** - no restrictions
- **World view** - see friends globally
- **No auto-reset** - map stays where you navigate
- **Smart controls** - center on user, show all friends
- Real-time location and music updates

### 🔄 **Real-Time Communication**
- WebSocket connection for live updates
- Cross-platform synchronization
- Automatic reconnection handling
- Connection status indicators

## 🏗️ Technical Architecture

### Frontend (React Native)
- **Navigation**: React Navigation v6
- **Maps**: React Native Maps (Google Maps)
- **Location**: React Native Geolocation Service
- **UI**: Custom glassmorphism components
- **Animations**: React Native Animated API
- **HTTP**: Axios for API calls

### Backend Integration
- **Authentication**: Spotify OAuth 2.0
- **Real-time**: WebSocket connections
- **APIs**: Spotify Web API integration
- **Location**: GPS coordinates sharing

## 🚀 Quick Start

### Prerequisites
- Node.js (v16+)
- Android Studio
- React Native CLI
- Spotify Developer Account
- Google Maps API Key

### Installation
```bash
# Clone/copy the project
cd MusicNavigatorFinal

# Install dependencies
npm install

# Configure API keys in src/config/config.js
# Update Android manifest with Google Maps key

# Run on Android
npx react-native run-android
```

## 📱 Screenshots & Features

### Login Screen
- Glassmorphism welcome interface
- Spotify OAuth integration
- Feature highlights with animated icons

### Home Screen
- User profile display
- Spotify playlists grid
- Browse categories
- Quick access to global map

### Global Map Screen
- **Fixed scrolling issues** - unlimited navigation
- Real-time friend locations worldwide
- Currently playing music display
- Song cards with progress bars
- Connection status indicators

## 🔧 Configuration

### Backend URL (`src/config/config.js`)
```javascript
export const CONFIG = {
  BACKEND_URL: 'https://your-backend-url.com',
  SPOTIFY: {
    CLIENT_ID: 'your-spotify-client-id',
    REDIRECT_URI: 'your-redirect-uri'
  },
  GOOGLE_MAPS_API_KEY: 'your-maps-api-key'
};
```

### Android Configuration
Update `android/app/src/main/AndroidManifest.xml`:
```xml
<meta-data
  android:name="com.google.android.geo.API_KEY"
  android:value="YOUR_GOOGLE_MAPS_API_KEY"/>
```

## 🎯 Map Improvements

### Previous Limitations (Fixed)
- ❌ Limited zoom levels
- ❌ Auto-reset to default location
- ❌ Cannot scroll to see international friends
- ❌ Restricted map boundaries

### New Features
- ✅ **Unlimited scrolling and zooming**
- ✅ **Global world view** (latitude: -90 to 90, longitude: -180 to 180)
- ✅ **Smart controls**: Center on user, show all friends
- ✅ **No restrictions** - navigate anywhere in the world
- ✅ **Smooth animations** for better user experience

## 🔌 API Integration

### Required Backend Endpoints
```
POST /api/auth/login          # Spotify OAuth
GET  /api/auth/callback       # OAuth callback
GET  /api/spotify/me          # User profile
GET  /api/spotify/currently-playing # Current track
GET  /api/spotify/playlists   # User playlists
GET  /api/spotify/categories  # Browse categories
WebSocket /api/ws/{user_id}   # Real-time updates
```

### WebSocket Message Format
```javascript
{
  "lat": 37.7749,
  "lng": -122.4194,
  "current_track": {
    "name": "Song Name",
    "artists": [{"name": "Artist"}],
    "album": {"name": "Album", "images": [...]},
    "duration_ms": 180000,
    "progress_ms": 45000
  },
  "user_name": "John Doe",
  "user_id": "spotify_user_id",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

## 🎨 UI Components

### GlassCard
Reusable glassmorphism component with customizable:
- Background gradients
- Border radius
- Shadow effects
- Blur intensity

### SongCard
Advanced music player card featuring:
- Album artwork display
- Animated progress bar
- Real-time playback position
- Smooth slide animations
- Play/pause status

## 🔄 Real-Time Features

### WebSocket Connection
- Automatic connection management
- Reconnection on failure
- Connection status indicators
- Message broadcasting to all users

### Location Sharing
- GPS permission handling
- 5-second update intervals
- Global coordinate support
- Battery-optimized tracking

## 📦 Build & Deployment

### Development Build
```bash
npx react-native run-android
```

### Production APK
```bash
cd android
./gradlew assembleRelease
# Output: android/app/build/outputs/apk/release/app-release.apk
```

### Testing
- Physical device recommended
- Location services required
- Network connectivity needed
- Multiple devices for multi-user testing

## 🐛 Troubleshooting

### Common Issues
1. **Build Errors**: Clean and rebuild
2. **Maps Not Loading**: Check API key
3. **Location Issues**: Verify permissions
4. **WebSocket Fails**: Check backend URL

### Debug Commands
```bash
# Clean build
cd android && ./gradlew clean && cd ..

# Reset Metro cache
npx react-native start --reset-cache

# View logs
adb logcat | grep ReactNativeJS
```

## 🌍 Global Compatibility

- **Worldwide Coverage**: No geographical restrictions
- **Cross-Platform**: Android and iOS support
- **Multi-Language**: Unicode and emoji support
- **Timezone Aware**: UTC timestamp handling

## 📄 License

MIT License - Feel free to use and modify for your projects.

## 🤝 Contributing

Contributions welcome! Please read the setup guide and ensure all tests pass.

---

**Built with ❤️ for music lovers worldwide 🌍🎵**