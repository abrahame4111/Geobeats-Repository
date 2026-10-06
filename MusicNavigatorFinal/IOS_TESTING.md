# Testing on an iPhone

This project is a bare React Native app. It does not run in Expo Go. Run it from Xcode or with the React Native CLI instead.

## One-time setup

1. Install the full version of Xcode from the Mac App Store, open it once, and accept its licence. CocoaPods cannot build iPhone dependencies with Command Line Tools alone. Make full Xcode the active developer directory:

   ```sh
   sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
   sudo xcodebuild -runFirstLaunch
   ```

2. Install CocoaPods if it is not already installed: `brew install cocoapods`.
3. From this directory, install JavaScript and iOS dependencies:

   ```sh
   npm ci
   cd ios && pod install && cd ..
   ```

   The Podfile automatically switches React Native 0.72.6 from its retired Boost mirror to Boost's official archive, so no manual cache or checksum change is needed.

4. Open `ios/MusicNavigatorFinal.xcworkspace` in Xcode.
5. In **Signing & Capabilities**, choose your Apple development team and assign a unique bundle identifier such as `com.yourname.musicnavigator`.
6. Connect and trust the iPhone, select it as the run destination, then press Run.

## Backend configuration

The mobile app needs a live backend before Spotify, shared location, and Listen Together can work.

1. In the repository root, copy `backend/.env.example` to `backend/.env`.
2. Set a local MongoDB URL, Spotify Client ID/Secret, a restricted Google Maps key, and `SPOTIFY_REDIRECT_URI`.
3. Register that exact redirect URI in the Spotify Developer Dashboard. For a physical iPhone, use an HTTPS tunnel or deployment, for example `https://your-backend.example/api/auth/callback`; `localhost` and a Mac-only loopback address will not work from the phone.
4. Set `BACKEND_URL` in `src/config/config.js` to the same backend origin, without the `/api` suffix. Do not commit credentials in this file.

The Spotify Client Secret belongs only in `backend/.env`, never in this React Native app.

## Important limitations

- iOS uses Apple Maps. Android continues to use Google Maps; this is selected in `MapScreen.js`.
- The app asks for location access only while it is in use; select **Allow While Using App** when prompted.
- A physical iPhone needs an HTTPS-reachable backend; it cannot use your Mac's `127.0.0.1` address.

## Simulator

After Pods are installed, run:

```sh
npx react-native run-ios
```

The Simulator is useful for checking the UI, but a real iPhone is the appropriate test device for GPS and the Spotify login WebView.
