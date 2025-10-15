# React Native Android App Setup Guide

## 🚀 Complete Setup Instructions for Music Navigator RN

### Step 1: Prerequisites Check

**Before starting, make sure you have:**

1. **Node.js** (v16+): Download from https://nodejs.org
2. **Android Studio**: Download from https://developer.android.com/studio
3. **Java JDK** (v11+): Usually comes with Android Studio
4. **Git**: For version control

### Step 2: Download the Project

1. **Copy the entire `/app/MusicNavigatorRN` folder** to your local machine
2. **Open terminal/command prompt** in the project folder

### Step 3: Install Dependencies

```bash
# Navigate to project directory
cd MusicNavigatorRN

# Install React Native CLI globally (if not already installed)
npm install -g react-native-cli

# Install project dependencies
npm install
# OR use yarn
yarn install
```

### Step 4: Android Studio Setup

1. **Open Android Studio**
2. **Go to Tools → SDK Manager**
3. **Install required SDK versions**:
   - Android 13 (API level 33)
   - Android SDK Build-Tools 33.0.0
4. **Set up environment variables** (add to your system PATH):
   - `ANDROID_HOME`: Path to your Android SDK
   - `JAVA_HOME`: Path to your Java installation

**Example (Windows):**
```
ANDROID_HOME = C:\Users\YourName\AppData\Local\Android\Sdk
JAVA_HOME = C:\Program Files\Android\Android Studio\jre
```

**Example (Mac/Linux):**
```bash
export ANDROID_HOME=$HOME/Android/Sdk
export JAVA_HOME=/Applications/Android\ Studio.app/Contents/jre/Contents/Home
```

### Step 5: Set Up Android Device/Emulator

**Option A: Physical Device**
1. Enable **Developer Options** on your Android phone
2. Enable **USB Debugging**
3. Connect via USB cable

**Option B: Android Emulator**
1. Open Android Studio
2. Go to **Tools → AVD Manager**
3. Create new **Virtual Device**
4. Choose **Pixel 4** or similar
5. Download and select **Android 13** system image
6. Start the emulator

### Step 6: Build and Run the App

```bash
# Start Metro bundler (keep this terminal open)
npx react-native start

# In a NEW terminal window, run the Android app
npx react-native run-android
```

### Step 7: Test the App

1. **App should install** and launch automatically
2. **Login with Spotify** when prompted
3. **Grant location permissions** when asked
4. **Navigate to Map** to test location sharing
5. **Test with friends** by sharing the same Spotify app

## 🚑 Troubleshooting Common Issues

### Issue: "SDK location not found"
**Solution:**
```bash
# Create local.properties file in android folder
echo "sdk.dir=/path/to/your/android/sdk" > android/local.properties
```

### Issue: "Command not found: react-native"
**Solution:**
```bash
# Use npx instead
npx react-native run-android
```

### Issue: Build fails with Gradle errors
**Solution:**
```bash
# Clean and rebuild
cd android
./gradlew clean
cd ..
npx react-native run-android
```

### Issue: Metro bundler connection issues
**Solution:**
```bash
# Reset Metro cache
npx react-native start --reset-cache
```

### Issue: App crashes on startup
**Solution:**
1. Check Android device logs: `adb logcat`
2. Ensure all permissions are granted
3. Try on a different device/emulator

## 📱 Building Release APK

When you're ready to create an installable APK:

```bash
# Navigate to android folder
cd android

# Build release APK
./gradlew assembleRelease

# Find your APK at:
# android/app/build/outputs/apk/release/app-release.apk
```

## 🔧 Development Tips

1. **Enable Hot Reload**: Shake device → Enable Hot Reloading
2. **Debug with Chrome**: Shake device → Debug → Chrome DevTools
3. **View Logs**: `adb logcat | grep ReactNativeJS`
4. **Reload App**: Double tap R key or shake device → Reload

## 🌐 Backend Connection

The app connects to: `https://musicmap-build.preview.emergentagent.com`

- **Spotify OAuth**: `/api/auth/login`
- **WebSocket**: `/api/ws/{user_id}`
- **API Endpoints**: All prefixed with `/api/`

## 🎆 Success Checklist

- ✅ **Dependencies installed**: `npm install` completed
- ✅ **Android Studio setup**: SDK and emulator ready
- ✅ **App builds**: `npx react-native run-android` works
- ✅ **Login works**: Spotify OAuth successful
- ✅ **Location works**: GPS permissions granted
- ✅ **Map displays**: Google Maps loads correctly
- ✅ **WebSocket connects**: Real-time features working

## 📞 Need Help?

If you encounter issues:

1. **Check logs** in terminal and `adb logcat`
2. **Google the error message** with "React Native"
3. **Try on different device/emulator**
4. **Clean and rebuild** the project
5. **Check React Native documentation**: https://reactnative.dev

---

**Your Music Navigator Android app is now ready to test! 🎵📱**

Share the APK with friends to test multi-user location sharing and real-time music features.