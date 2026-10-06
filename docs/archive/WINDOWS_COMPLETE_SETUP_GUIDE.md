# 🚀 Complete Windows Setup Guide for MusicNavigatorFinal

## Overview
This guide will walk you through setting up your Windows machine from scratch to build and run the MusicNavigatorFinal React Native Android app.

---

## 📁 STEP 1: Download Project Files

### Files You Need to Download:
1. **`MusicNavigatorFinal_CLEAN.tar.gz`** (2.2MB) - The React Native app source code
2. **`backend_server.tar.gz`** (17KB) - The FastAPI backend server

### How to Download:
In your Emergent chat, look for the **"Download"** button or right-click on the files listed above and select download.

---

## 💻 STEP 2: Install Required Software

### 2.1 Install Node.js (Required)
1. Go to: https://nodejs.org/
2. Download the **LTS version** (e.g., 20.x.x)
3. Run the installer with default settings
4. Verify installation by opening **Command Prompt** and running:
   ```cmd
   node --version
   npm --version
   ```

### 2.2 Install Java Development Kit (JDK 17)
1. Go to: https://adoptium.net/
2. Select **Temurin 17** (LTS)
3. Download the **Windows x64 MSI** installer
4. Run the installer - **IMPORTANT**: Check ✅ "Set JAVA_HOME variable"
5. Verify installation:
   ```cmd
   java -version
   ```
   Should show: `openjdk version "17.x.x"`

### 2.3 Install Android Studio
1. Go to: https://developer.android.com/studio
2. Download **Android Studio** for Windows
3. Run the installer with these options:
   - ✅ Android Studio
   - ✅ Android Virtual Device (AVD)
4. **IMPORTANT**: During first launch, it will download SDK components. Wait for this to complete.

---

## ⚙️ STEP 3: Configure Android Studio

### 3.1 Open SDK Manager
1. Launch Android Studio
2. Click **"More Actions"** (or **Configure**) → **"SDK Manager"**

### 3.2 Install SDK Components
In the **SDK Platforms** tab:
- ✅ Android 14.0 (API 34)
- ✅ Android 13.0 (API 33)

In the **SDK Tools** tab:
- ✅ Android SDK Build-Tools 34
- ✅ Android SDK Command-line Tools (latest)
- ✅ Android Emulator
- ✅ Android SDK Platform-Tools
- ✅ Google Play services
- ✅ Google Play Licensing Library

Click **"Apply"** and wait for downloads to complete.

### 3.3 Note Your SDK Path
The SDK is typically installed at:
```
C:\Users\<YourUsername>\AppData\Local\Android\Sdk
```
**Copy this path - you'll need it for environment variables!**

---

## 🔧 STEP 4: Set Environment Variables

### 4.1 Open Environment Variables
1. Press `Windows + R`, type `sysdm.cpl`, press Enter
2. Click **"Advanced"** tab → **"Environment Variables"**

### 4.2 Add New System Variables
Click **"New"** under System Variables and add:

| Variable Name | Value |
|--------------|-------|
| `ANDROID_HOME` | `C:\Users\<YourUsername>\AppData\Local\Android\Sdk` |
| `JAVA_HOME` | `C:\Program Files\Eclipse Adoptium\jdk-17.x.x-hotspot` |

*(Replace `<YourUsername>` with your actual Windows username and `17.x.x` with your installed JDK version)*

### 4.3 Update PATH Variable
1. Find **"Path"** in System Variables, click **"Edit"**
2. Click **"New"** and add these entries:
   ```
   %ANDROID_HOME%\platform-tools
   %ANDROID_HOME%\tools
   %ANDROID_HOME%\tools\bin
   %ANDROID_HOME%\emulator
   ```

### 4.4 Verify Environment Setup
**Close all Command Prompt windows and open a new one**, then run:
```cmd
echo %ANDROID_HOME%
echo %JAVA_HOME%
adb --version
```
All should return valid paths/versions.

---

## 📱 STEP 5: Setup Android Device for Testing

### Option A: Physical Android Device (Recommended)
1. On your Android phone:
   - Go to **Settings** → **About Phone**
   - Tap **"Build Number"** 7 times to enable Developer Mode
   - Go back to **Settings** → **Developer Options**
   - Enable ✅ **USB Debugging**
2. Connect phone to PC via USB cable
3. Accept the "Allow USB debugging" prompt on your phone
4. Verify connection:
   ```cmd
   adb devices
   ```
   Should show your device with "device" status

### Option B: Android Emulator
1. Open Android Studio
2. Click **"More Actions"** → **"Virtual Device Manager"**
3. Click **"Create Device"**
4. Choose **Pixel 6** or similar
5. Select **Android 14** system image, click **Download** if needed
6. Finish creation and **Start** the emulator

---

## 📂 STEP 6: Extract and Setup Project

### 6.1 Create Project Folder
```cmd
mkdir C:\Projects
cd C:\Projects
```

### 6.2 Extract Downloaded Files
If you have 7-Zip installed:
```cmd
7z x MusicNavigatorFinal_CLEAN.tar.gz
7z x MusicNavigatorFinal_CLEAN.tar
```

Or use **Windows built-in** (right-click → Extract All), then use 7-Zip for the .tar file.

Alternatively, install Git Bash and use:
```bash
tar -xzvf MusicNavigatorFinal_CLEAN.tar.gz
```

### 6.3 Project Structure After Extraction
```
C:\Projects\
  └── MusicNavigatorFinal\
      ├── android\
      ├── src\
      ├── package.json
      └── ... (other files)
```

---

## 📦 STEP 7: Install Dependencies

### 7.1 Navigate to Project
```cmd
cd C:\Projects\MusicNavigatorFinal
```

### 7.2 Install Node Modules
```cmd
npm install
```
This may take 5-10 minutes. Wait for it to complete.

If you encounter errors, try:
```cmd
npm cache clean --force
npm install
```

---

## 🔑 STEP 8: Configure API Keys

### 8.1 Google Maps API Key
You need a Google Maps API key for the map to work:

1. Go to: https://console.cloud.google.com/
2. Create a new project or select existing
3. Enable **"Maps SDK for Android"**
4. Go to **"Credentials"** → **"Create Credentials"** → **"API Key"**
5. Copy your API key

### 8.2 Add API Key to Project
Open the file:
```
C:\Projects\MusicNavigatorFinal\android\app\src\main\AndroidManifest.xml
```

Find this line and replace `YOUR_API_KEY`:
```xml
<meta-data
    android:name="com.google.android.geo.API_KEY"
    android:value="YOUR_ACTUAL_GOOGLE_MAPS_API_KEY"/>
```

### 8.3 Configure Backend URL
Open `src\config\config.js` and update the `API_URL` to point to your backend server.

---

## 🏗️ STEP 9: Build and Run the App

### 9.1 Start Metro Bundler (Terminal 1)
```cmd
cd C:\Projects\MusicNavigatorFinal
npx react-native start
```
Keep this terminal open. Wait until you see "Metro waiting on..."

### 9.2 Run on Android (Terminal 2)
Open a **new Command Prompt** window:
```cmd
cd C:\Projects\MusicNavigatorFinal
npx react-native run-android
```

This will:
1. Build the Android app (first build takes 5-15 minutes)
2. Install the APK on your connected device/emulator
3. Launch the app

---

## 📱 STEP 10: Generate Standalone APK

Once the app runs successfully, you can build a standalone APK:

### 10.1 Navigate to Android Folder
```cmd
cd C:\Projects\MusicNavigatorFinal\android
```

### 10.2 Build Debug APK
```cmd
.\gradlew assembleDebug
```

### 10.3 Find Your APK
The APK will be at:
```
C:\Projects\MusicNavigatorFinal\android\app\build\outputs\apk\debug\app-debug.apk
```

### 10.4 Transfer to Phone
- Copy `app-debug.apk` to your phone
- Open the file on your phone to install
- You may need to enable "Install from unknown sources"

---

## 🔄 STEP 11: Setup Backend Server (Optional - For Full Features)

### 11.1 Install Python
1. Download Python 3.11+ from: https://www.python.org/downloads/
2. During installation: ✅ "Add Python to PATH"

### 11.2 Extract and Run Backend
```cmd
cd C:\Projects
tar -xzvf backend_server.tar.gz
cd backend
pip install -r requirements.txt
python -m uvicorn server:app --host 0.0.0.0 --port 8001
```

### 11.3 Configure Spotify API (in backend/.env)
```
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=your_redirect_uri
```

---

## ❗ Troubleshooting

### "ANDROID_HOME is not set"
- Double-check environment variables (Step 4)
- Restart Command Prompt after setting variables

### "SDK location not found"
Create a file `C:\Projects\MusicNavigatorFinal\android\local.properties`:
```
sdk.dir=C:\\Users\\<YourUsername>\\AppData\\Local\\Android\\Sdk
```
(Use double backslashes `\\`)

### "Unable to load script" / Metro not connecting
- Ensure Metro bundler is running (Step 9.1)
- For physical device: run `adb reverse tcp:8081 tcp:8081`

### Build fails with Gradle errors
```cmd
cd android
.\gradlew clean
cd ..
npx react-native run-android
```

### "INSTALL_FAILED_UPDATE_INCOMPATIBLE"
```cmd
adb uninstall com.musicnavigatorfinal
npx react-native run-android
```

---

## ✅ Success Checklist

- [ ] Node.js installed and verified
- [ ] JDK 17 installed with JAVA_HOME set
- [ ] Android Studio installed with SDK components
- [ ] Environment variables configured
- [ ] Android device connected or emulator running
- [ ] Project extracted and npm install completed
- [ ] Google Maps API key configured
- [ ] Metro bundler running
- [ ] App launched successfully on device

---

## 📞 Need Help?

If you encounter issues:
1. Copy the **exact error message**
2. Note which step you're on
3. Share the error with me and I'll help you resolve it!

Good luck! 🎉
