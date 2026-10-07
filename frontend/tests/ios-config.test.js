const assert = require('node:assert/strict');
const test = require('node:test');
const { withSceneLifecycle } = require('../plugins/ios-scene-lifecycle');
const { validateBackendUrl } = require('../scripts/check-cloud-env');

const freshDelegate = `import Expo
public class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?
  var reactNativeFactory: RCTReactNativeFactory?
  func launch() {
#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif
  }
  // Linking API
}
`;

test('fresh prebuild starts React Native using the application delegate, not a second factory owner', () => {
  const result = withSceneLifecycle(freshDelegate);
  assert.match(result, /class AppDelegate: ExpoAppDelegate \{/);
  assert.match(result, /class SceneDelegate: UIResponder, UIWindowSceneDelegate/);
  assert.match(result, /UIApplication.shared.delegate as\? AppDelegate/);
  assert.match(result, /let factory = appDelegate.reactNativeFactory/);
  assert.equal(result.match(/startReactNative\(/g).length, 1);
  assert.doesNotMatch(result, /UIScreen.main.bounds/);
});

test('repeated prebuilds do not duplicate the scene or its React Native instance', () => {
  const result = withSceneLifecycle(freshDelegate);
  assert.equal(withSceneLifecycle(result), result);
});

test('an existing v1 native project is migrated without deleting unrelated settings', () => {
  const legacy = freshDelegate
    .replace('ExpoAppDelegate {', 'ExpoAppDelegate, UIWindowSceneDelegate {')
    .replace(/#if os\(iOS\)[\s\S]*?#endif\n/, '')
    .replace('  // Linking API', `  // Xcode 27 requires a UIKit scene lifecycle.
  func scene() { guard let reactNativeFactory else { return } }
  // Linking API`);
  const result = withSceneLifecycle(legacy);
  assert.doesNotMatch(result, /ExpoAppDelegate, UIWindowSceneDelegate/);
  assert.doesNotMatch(result, /guard let reactNativeFactory/);
  assert.match(result, /configuration.delegateClass = SceneDelegate.self/);
});

test('unrecognized native templates fail visibly instead of silently breaking startup', () => {
  assert.throws(() => withSceneLifecycle('class AppDelegate {}'), /Linking API/);
  assert.throws(() => withSceneLifecycle('class AppDelegate {\n  // Linking API\n}'), /launch block/);
});

test('cloud builds accept a public HTTPS origin', () => {
  assert.equal(validateBackendUrl('https://geobeats.example.com/'), 'https://geobeats.example.com');
});

test('cloud builds reject missing URLs, local servers, paths and embedded credentials', () => {
  for (const value of [undefined, '', 'not-a-url', 'http://example.com',
    'https://localhost', 'https://127.0.0.1', 'https://192.168.1.5',
    'https://172.16.0.1', 'https://10.0.0.1', 'https://[::1]',
    'https://[::ffff:127.0.0.1]', 'https://user:pass@example.com',
    'https://example.com/api', 'https://example.com?token=test']) {
    assert.throws(() => validateBackendUrl(value));
  }
});
