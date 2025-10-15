# Music Navigator - React Native Android App

A React Native Android application for real-time music streaming and location sharing with friends.

## Features

- **Spotify Integration**: Login with Spotify, view playlists and categories
- **Real-time Location Sharing**: Share your location with friends on a live map
- **Live Music Display**: See what songs your friends are currently playing
- **WebSocket Communication**: Real-time updates for location and music
- **Native Android Experience**: Full native app performance and features

## Prerequisites

1. **Node.js** (v16 or higher)
2. **React Native CLI**: `npm install -g react-native-cli`
3. **Android Studio** (with Android SDK)
4. **Java Development Kit (JDK)** (v11 or higher)
5. **Android device** or emulator for testing

## Setup Instructions

### 1. Clone/Copy the Project

```bash
# Create a new directory for your project
mkdir MusicNavigatorRN
cd MusicNavigatorRN

# Copy all the files from this directory to your local project
```

### 2. Install Dependencies

```bash
# Install Node.js dependencies
npm install
# or
yarn install
```

### 3. Android Setup

1. **Open Android Studio**
2. **Set up Android SDK** (if not already done)
3. **Create a virtual device** or connect a physical Android device
4. **Enable USB Debugging** on physical device (if using)

### 4. Configure Environment

1. **Update API URLs** (if needed):
   - Edit `src/context/AuthContext.js`
   - Change `BACKEND_URL` if your backend is hosted elsewhere

2. **Google Maps API Key**:
   - The API key is already configured in `android/app/src/main/AndroidManifest.xml`
   - Replace with your own key if needed

### 5. Build and Run

```bash
# Start the Metro bundler
npx react-native start

# In a new terminal, run the Android app
npx react-native run-android
```

## Project Structure

```
MusicNavigatorRN/
├── android/                 # Android native code
├── src/
│   ├── components/         # Reusable UI components
│   ├── context/           # React Context (Auth, etc.)
│   ├── screens/           # App screens
│   ├── utils/             # Utility functions
│   └── App.js             # Main app component
├── package.json           # Dependencies
└── README.md             # This file
```

## Key Components

### Authentication
- **LoginScreen**: Spotify OAuth login via WebView
- **AuthContext**: Manages user authentication state

### Main Features
- **HomeScreen**: Display playlists and categories
- **MapScreen**: Real-time location sharing with Google Maps
- **WebSocket Manager**: Handles real-time communication

### Native Features
- **Location Services**: GPS location access
- **Permissions**: Android runtime permissions
- **Maps Integration**: Google Maps with custom markers

## Troubleshooting

### Common Issues

1. **Metro bundler issues**:
   ```bash
   npx react-native start --reset-cache
   ```

2. **Android build errors**:
   ```bash
   cd android
   ./gradlew clean
   cd ..
   npx react-native run-android
   ```

3. **Permission issues**:
   - Make sure location permissions are granted
   - Check Android device settings

4. **WebSocket connection issues**:
   - Verify backend URL is accessible
   - Check network connectivity
   - Ensure WebSocket endpoint is working

### Development Tips

1. **Enable hot reload** for faster development
2. **Use Android device** for better performance than emulator
3. **Monitor logs** with `adb logcat` or Metro bundler
4. **Test on multiple devices** to ensure compatibility

## Backend Integration

This app connects to the FastAPI backend at:
- **Production**: `https://musicmap-build.preview.emergentagent.com`
- **WebSocket**: `wss://geobeats.preview.emergentagent.com/api/ws/`

The backend handles:
- Spotify OAuth authentication
- User profile management
- Real-time WebSocket communication
- Location and music data broadcasting

## Building Release APK

1. **Generate signing key**:
   ```bash
   keytool -genkeypair -v -storetype PKCS12 -keystore my-upload-key.keystore -alias my-key-alias -keyalg RSA -keysize 2048 -validity 10000
   ```

2. **Build release APK**:
   ```bash
   cd android
   ./gradlew assembleRelease
   ```

3. **Find APK**:
   ```
   android/app/build/outputs/apk/release/app-release.apk
   ```

## Next Steps

1. **Test the app** thoroughly on your Android device
2. **Customize UI/UX** as needed
3. **Add more features** (push notifications, chat, etc.)
4. **Optimize performance** for production use
5. **Publish to Google Play Store** when ready

## Support

For issues with:
- **React Native**: Check official documentation
- **Android Development**: Android Studio help
- **Backend API**: Contact backend developer
- **Spotify Integration**: Spotify API documentation

Enjoy building your Music Navigator app! 🎵📍