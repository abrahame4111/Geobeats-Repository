# Music Navigator - React Native Setup Guide

## 🚀 Complete Setup Instructions

### Prerequisites
1. **Node.js** (v16+): https://nodejs.org
2. **Android Studio**: https://developer.android.com/studio
3. **React Native CLI**: `npm install -g react-native-cli`
4. **Java JDK** (v11+): Usually comes with Android Studio

### Step 1: Copy Project Files
Copy the entire `/app/MusicNavigatorFinal/` folder to your local machine.

### Step 2: Install Dependencies
```bash
cd MusicNavigatorFinal

# Install dependencies
npm install

# For iOS (if developing for iOS)
cd ios && pod install && cd ..
```

### Step 3: Configure API Keys & Backend

#### Backend Configuration (`src/config/config.js`):
```javascript
export const CONFIG = {
  // Replace with your backend URL
  BACKEND_URL: 'https://your-backend-url.com',
  
  // Spotify Configuration
  SPOTIFY: {
    CLIENT_ID: 'your-spotify-client-id',
    REDIRECT_URI: 'https://your-backend-url.com/api/auth/callback',
  },
  
  // Google Maps API Key
  GOOGLE_MAPS_API_KEY: 'your-google-maps-api-key'
};
```

#### Android Manifest (`android/app/src/main/AndroidManifest.xml`):
Update the Google Maps API key:
```xml
<meta-data
  android:name="com.google.android.geo.API_KEY"
  android:value="YOUR_GOOGLE_MAPS_API_KEY"/>
```

### Step 4: Set Up Android Development Environment

1. **Open Android Studio**
2. **Set up Android SDK** (API level 33+)
3. **Create Virtual Device** or connect physical device
4. **Enable USB Debugging** (for physical device)

### Step 5: Environment Variables
Add to your system PATH:
- `ANDROID_HOME`: Path to Android SDK
- `JAVA_HOME`: Path to Java installation

**Windows Example:**
```
ANDROID_HOME = C:\Users\YourName\AppData\Local\Android\Sdk
JAVA_HOME = C:\Program Files\Android\Android Studio\jre
```

### Step 6: Build and Run

```bash
# Clean previous builds (if any)
cd android
./gradlew clean
cd ..

# Start Metro bundler
npx react-native start

# In new terminal - Build and run Android
npx react-native run-android
```

## 🎵 Key Features

### 1. **Glassmorphism Design**
- Translucent glass cards with blur effects
- Professional gradient backgrounds
- Smooth animations and transitions

### 2. **Advanced Song Card**
- Real-time progress bar with moving thumb
- Album artwork and metadata display
- Playback time indicators
- Smooth slide animations

### 3. **Global Map Functionality**
- **Fixed Scrolling Issues**: Unlimited pan and zoom
- **World View**: See friends globally, no location restrictions
- **User-Friendly Controls**: Easy navigation and centering
- **Real-time Updates**: Live location and song sharing

### 4. **Backend Integration**
- Spotify OAuth authentication
- WebSocket real-time communication
- Location and music data broadcasting
- Cross-platform synchronization

## 🗺️ Map Features (Fixed Issues)

### Previous Issues Fixed:
- ❌ Limited zoom levels
- ❌ Auto-reset to default location
- ❌ Cannot scroll to see international friends
- ❌ Restricted map boundaries

### New Features:
- ✅ **Unlimited scrolling and zooming**
- ✅ **Global world view** - see friends anywhere
- ✅ **Smart controls**: "Center on Me" and "Show All Users"
- ✅ **No auto-reset** - map stays where you navigate
- ✅ **Smooth animations** for better UX

## 🔧 Troubleshooting

### Common Build Issues:

**1. Gradle Build Errors:**
```bash
cd android
./gradlew clean
cd ..
npx react-native run-android
```

**2. Metro Bundler Issues:**
```bash
npx react-native start --reset-cache
```

**3. Permission Issues:**
- Ensure location permissions are granted
- Check Android device settings

**4. Maps Not Loading:**
- Verify Google Maps API key is correct
- Check API key has Maps SDK enabled
- Ensure network connectivity

### Performance Tips:
- Use physical device for better performance
- Enable hot reload for faster development
- Monitor logs: `adb logcat | grep ReactNativeJS`

## 📱 Testing on Device

### Android Studio Testing:
1. Open project in Android Studio
2. Build → Make Project
3. Run → Run 'app'
4. Select device/emulator

### Manual APK Installation:
```bash
# Build release APK
cd android
./gradlew assembleRelease

# Find APK at:
# android/app/build/outputs/apk/release/app-release.apk
```

## 🌐 Backend Requirements

### Your backend must provide these endpoints:
- `POST /api/auth/login` - Spotify OAuth
- `GET /api/auth/callback` - OAuth callback
- `GET /api/spotify/me` - User profile
- `GET /api/spotify/currently-playing` - Current track
- `GET /api/spotify/playlists` - User playlists
- `GET /api/spotify/categories` - Spotify categories
- `WebSocket /api/ws/{user_id}` - Real-time updates

### WebSocket Message Format:
```javascript
// Location update
{
  "lat": 37.7749,
  "lng": -122.4194,
  "current_track": { /* Spotify track object */ },
  "user_name": "John Doe",
  "user_id": "spotify_user_id",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

## 🎨 Customization

### Theme Colors (`src/components/GlassCard.js`):
```javascript
const gradient = ['rgba(29, 185, 84, 0.2)', 'rgba(0, 0, 0, 0.6)'];
```

### Map Styling (`src/screens/MapScreen.js`):
```javascript
const mapStyle = [
  // Custom map styling array
];
```

## 📞 Support

### For issues with:
- **React Native**: Official docs
- **Android Development**: Android Studio help
- **Spotify API**: Spotify for Developers
- **Google Maps**: Google Maps Platform docs

---

**Your Music Navigator app with global map functionality is ready! 🎵🗺️**

Enjoy seamless music sharing with friends worldwide!