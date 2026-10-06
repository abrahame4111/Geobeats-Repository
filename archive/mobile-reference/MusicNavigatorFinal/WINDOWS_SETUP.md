# 🪟 Windows Setup Guide for Music Navigator

## ✅ What You Need

1. **Node.js** (v16+) - [Download](https://nodejs.org/)
2. **JDK 11+** - [Download](https://adoptium.net/)
3. **Android Studio** - [Download](https://developer.android.com/studio)
4. **Android SDK** (installed via Android Studio)

---

## 📋 Step-by-Step Setup

### **Step 1: Install Prerequisites**

#### A. Install Node.js
1. Download from https://nodejs.org/
2. Run installer (use default options)
3. Verify in PowerShell:
   ```powershell
   node --version
   npm --version
   ```

#### B. Install JDK
1. Download from https://adoptium.net/
2. Install to `C:\Program Files\Java\jdk-11` (or similar)
3. Add to PATH:
   - Search "Environment Variables" in Windows
   - Add `JAVA_HOME`: `C:\Program Files\Java\jdk-11`
   - Add to `Path`: `%JAVA_HOME%\bin`
4. Verify:
   ```powershell
   java -version
   ```

#### C. Install Android Studio
1. Download from https://developer.android.com/studio
2. During installation, make sure to install:
   - Android SDK
   - Android SDK Platform 33
   - Android Virtual Device
3. Open Android Studio → More Actions → SDK Manager
4. Install:
   - Android SDK Platform 33
   - Android SDK Build-Tools 33.0.0
   - Android Emulator
   - Android SDK Platform-Tools

### **Step 2: Configure Environment Variables**

Add these to your Windows Environment Variables:

```
ANDROID_HOME = C:\Users\YourUsername\AppData\Local\Android\Sdk
```

Add to `Path`:
```
%ANDROID_HOME%\platform-tools
%ANDROID_HOME%\emulator
%ANDROID_HOME%\tools
%ANDROID_HOME%\tools\bin
```

**To verify:**
```powershell
adb version
```

---

## 🚀 Build the App

### **Step 1: Extract Project**
Extract the `MusicNavigatorFinal-Complete.tar.gz` to:
```
C:\Users\YourUsername\Documents\Development\app\MusicNavigatorFinal
```

### **Step 2: Install Dependencies**
Open PowerShell in the project folder:
```powershell
cd C:\Users\abrah\Documents\Development\app\MusicNavigatorFinal
npm install
```

This will take 2-5 minutes and install ~600 packages.

### **Step 3: Configure Android SDK Path**
Create `android\local.properties` file:
```properties
sdk.dir=C:\\Users\\YourUsername\\AppData\\Local\\Android\\Sdk
```

**Note:** Use double backslashes `\\` in the path!

**Quick command to create:**
```powershell
echo "sdk.dir=C:\\Users\\$env:USERNAME\\AppData\\Local\\Android\\Sdk" > android\local.properties
```

### **Step 4: Connect Android Device**

#### Option A: Physical Device (Recommended)
1. Enable **Developer Options** on your phone:
   - Go to Settings → About Phone
   - Tap "Build Number" 7 times
2. Enable **USB Debugging**:
   - Settings → Developer Options → USB Debugging
3. Connect via USB cable
4. Allow debugging on the device popup
5. Verify connection:
   ```powershell
   adb devices
   ```
   Should show your device like:
   ```
   List of devices attached
   ABC123XYZ    device
   ```

#### Option B: Android Emulator
1. Open Android Studio
2. Tools → Device Manager
3. Create Virtual Device (if none exists)
4. Start the emulator
5. Verify:
   ```powershell
   adb devices
   ```

### **Step 5: Run the App**
```powershell
npx react-native run-android
```

This will:
1. Start Metro bundler (JavaScript server)
2. Build the Android APK
3. Install on your device/emulator
4. Launch the app

**First build takes 5-10 minutes!** ⏱️

---

## 🐛 Troubleshooting

### ❌ Error: "JAVA_HOME is not set"
**Fix:**
```powershell
# Set temporarily
$env:JAVA_HOME = "C:\Program Files\Java\jdk-11"

# Or add permanently via System Environment Variables
```

### ❌ Error: "SDK location not found"
**Fix:**
Create `android\local.properties`:
```properties
sdk.dir=C:\\Users\\YourUsername\\AppData\\Local\\Android\\Sdk
```

### ❌ Error: "Execution failed for task ':app:installDebug'"
**Fix:**
1. Make sure device is connected:
   ```powershell
   adb devices
   ```
2. If no devices shown, reconnect USB or restart emulator

### ❌ Error: "Daemon process could not be started"
**Fix:**
```powershell
cd android
.\gradlew --stop
.\gradlew clean
cd ..
npx react-native run-android
```

### ❌ Error: Metro bundler port in use
**Fix:**
```powershell
# Kill existing Metro
taskkill /F /IM node.exe

# Restart
npx react-native start --reset-cache
```

### ❌ App builds but crashes immediately
**Fix:**
```powershell
# Clear build cache
cd android
.\gradlew clean
cd ..

# Clear Metro cache
npx react-native start --reset-cache

# Rebuild
npx react-native run-android
```

---

## 🎯 Quick Commands Reference

```powershell
# Check environment
node --version
java -version
adb devices

# Install dependencies
npm install

# Start Metro (JavaScript server)
npx react-native start

# Build and install (in another terminal)
npx react-native run-android

# Build release APK
cd android
.\gradlew assembleRelease
# Output: android\app\build\outputs\apk\release\app-release.apk

# Clean build
cd android
.\gradlew clean
cd ..

# View device logs
adb logcat | Select-String "ReactNative"
```

---

## ✅ Success Checklist

- [ ] Node.js installed and working
- [ ] JDK installed and JAVA_HOME set
- [ ] Android Studio installed
- [ ] Android SDK installed (Platform 33)
- [ ] ANDROID_HOME environment variable set
- [ ] Android device connected OR emulator running
- [ ] `adb devices` shows device
- [ ] Project extracted
- [ ] `npm install` completed successfully
- [ ] `android\local.properties` created
- [ ] `npx react-native run-android` runs successfully
- [ ] App launches on device

---

## 🎉 Expected Result

When successful, you should see:
1. Metro bundler console showing "Loading..."
2. Gradle build progress in terminal
3. App installing on device
4. App launching with login screen
5. Spotify glassmorphism UI

---

## 📱 Testing the App

1. **Login**: Tap "Login with Spotify"
2. **Authorize**: Allow permissions in WebView
3. **Home**: View your playlists
4. **Map**: Navigate to map screen
5. **Location**: Grant location permission
6. **Features**:
   - See your location marker
   - Scroll map globally
   - Test "Center on Me" button
   - View song card at bottom

---

## 💡 Pro Tips

1. **Keep terminals open**: You need TWO terminals:
   - Terminal 1: Metro bundler (`npx react-native start`)
   - Terminal 2: Build commands (`npx react-native run-android`)

2. **Fast Refresh**: Edit code and save - changes appear instantly!

3. **Reload App**: Shake device or press `R` twice in Metro terminal

4. **Debug Menu**: Shake device or press `Ctrl+M` (emulator)

5. **Build Release APK** for distribution:
   ```powershell
   cd android
   .\gradlew assembleRelease
   ```

---

## 🆘 Still Having Issues?

1. **Run React Native Doctor:**
   ```powershell
   npx react-native doctor
   ```

2. **Check official troubleshooting:**
   https://reactnative.dev/docs/environment-setup

3. **Common fix sequence:**
   ```powershell
   # Nuclear option - clean everything
   cd android
   .\gradlew clean
   cd ..
   rm -r node_modules
   npm install
   npx react-native start --reset-cache
   ```

---

**Good luck! 🚀 Your app should be running on your Android device shortly!**
