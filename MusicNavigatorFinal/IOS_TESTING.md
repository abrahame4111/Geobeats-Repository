# Testing on an iPhone

This project is a bare React Native app. It does not run in Expo Go. Run it from Xcode or with the React Native CLI instead.

## One-time setup

1. Install the full version of Xcode from the Mac App Store, open it once, and accept its licence.
2. Install CocoaPods if it is not already installed: `sudo gem install cocoapods`.
3. From this directory, install JavaScript and iOS dependencies:

   ```sh
   npm install
   cd ios && pod install && cd ..
   ```

4. Open `ios/MusicNavigatorFinal.xcworkspace` in Xcode.
5. In **Signing & Capabilities**, choose your Apple development team and assign a unique bundle identifier such as `com.yourname.musicnavigator`.
6. Connect and trust the iPhone, select it as the run destination, then press Run.

## Important limitations

- iOS uses Apple Maps. Android continues to use Google Maps; this is selected in `MapScreen.js`.
- The app asks for location access only while it is in use; select **Allow While Using App** when prompted.
- The current backend URL is an Emergent preview deployment. It must serve `/api/auth/login` for Spotify login and live sharing to work. If it has expired, update `src/config/config.js` to a running HTTPS backend and make the Spotify redirect URI match that backend.
- A local backend reached from an iPhone must be accessible on the same network, and Spotify OAuth requires a redirect URI registered in the Spotify developer dashboard.

## Simulator

After Pods are installed, run:

```sh
npx react-native run-ios
```

The Simulator is useful for checking the UI, but a real iPhone is the appropriate test device for GPS and the Spotify login WebView.
