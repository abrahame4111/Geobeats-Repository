# 🚀 Build Instructions for Music Navigator Android App

## ✅ What's Ready

All dependencies are installed and the app is configured:
- ✅ React Native 0.72.6
- ✅ React Navigation configured
- ✅ Google Maps integrated
- ✅ Glassmorphism UI components
- ✅ Location services configured
- ✅ WebSocket support
- ✅ All required permissions added

## 📱 Building the App

### Option 1: Build on Your Local Machine

#### Prerequisites
1. **Node.js** (v16 or higher)
2. **JDK 11 or higher**
3. **Android Studio** with Android SDK 33
4. **Android Device** or **Emulator**

#### Steps:

1. **Download the project** from this directory:
   ```bash
   # Copy the entire MusicNavigatorFinal folder to your local machine
   ```

2. **Install dependencies**:
   ```bash
   cd MusicNavigatorFinal
   npm install
   # or
   yarn install
   ```

3. **Configure Android SDK path** (if not done):
   ```bash
   # Create local.properties in android/ folder
   echo "sdk.dir=/path/to/your/Android/sdk" > android/local.properties
   ```

4. **Connect your Android device** via USB:
   - Enable **Developer Options** on your device
   - Enable **USB Debugging**
   - Connect device and authorize the computer

5. **Build and run**:
   ```bash
   npx react-native run-android
   ```

### Option 2: Build APK File

To create an installable APK:

```bash
cd android
./gradlew assembleRelease

# APK will be at:
# android/app/build/outputs/apk/release/app-release.apk
```

### Option 3: Use Expo EAS Build (If needed)

For cloud builds without local Android Studio:

1. Install EAS CLI:
   ```bash
   npm install -g eas-cli
   ```

2. Configure and build:
   ```bash
   eas build --platform android
   ```

## 🔧 Configuration

### Backend URL
The app is already configured to connect to:
```
https://musicmap-build.preview.emergentagent.com
```

If you need to change it, edit: `src/config/config.js`

### Google Maps API Key
Already configured in:
- `src/config/config.js`
- `android/app/src/main/AndroidManifest.xml`

### Spotify Credentials
Already configured in `src/config/config.js`

## 📦 What's Included

### Features
- ✨ Glassmorphism UI design
- 🗺️ Google Maps with unlimited scrolling
- 📍 Real-time location sharing
- 🎵 Spotify integration
- 💬 WebSocket live updates
- 🎯 "Center on Me" button
- 👥 "Show All Users" button
- 🎨 Animated song card with progress bar

### Screens
1. **Login Screen** - Spotify OAuth via WebView
2. **Home Screen** - Playlists and categories
3. **Map Screen** - Live location map with user markers

### Components
- **GlassCard** - Glassmorphism container
- **SongCard** - Animated music player card

## 🐛 Troubleshooting

### "SDK location not found"
Create `android/local.properties`:
```
sdk.dir=/path/to/Android/sdk
```

### "Could not find or load main class org.gradle.wrapper.GradleWrapperMain"
```bash
cd android
./gradlew wrapper --gradle-version 8.0.1
```

### Permission Errors
Ensure these permissions are in AndroidManifest.xml (already added):
- `ACCESS_FINE_LOCATION`
- `ACCESS_COARSE_LOCATION`
- `INTERNET`
- `ACCESS_NETWORK_STATE`

### Metro Bundler Issues
```bash
npx react-native start --reset-cache
```

## 📱 Device Requirements

- **Android**: 5.0 (API 21) or higher
- **Storage**: ~50MB for app
- **Internet**: Required for maps and Spotify
- **Location**: GPS enabled

## 🎯 Quick Start Checklist

- [ ] Copy project to local machine
- [ ] Install Node.js dependencies
- [ ] Set up Android Studio
- [ ] Configure Android SDK path
- [ ] Connect Android device
- [ ] Enable USB debugging
- [ ] Run `npx react-native run-android`
- [ ] Test login with Spotify
- [ ] Check map functionality
- [ ] Verify location sharing

## 📞 Need Help?

If you encounter build issues:
1. Check the Android Studio logs
2. Ensure all prerequisites are installed
3. Try cleaning the build: `cd android && ./gradlew clean`
4. Reset Metro cache: `npx react-native start --reset-cache`

---

**Note**: This project requires a local development environment with Android Studio to build. The cloud container doesn't have Android SDK/JDK installed, so you'll need to build on your local machine or use a cloud build service like EAS.
