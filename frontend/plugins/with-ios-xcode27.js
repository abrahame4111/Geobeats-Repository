/**
 * Xcode 27 no longer supports simulator targets below iOS 15.  A few
 * transitive CocoaPods still declare older targets, even though GeoBeats
 * itself targets iOS 15.1.  Keep those pod targets aligned during `expo
 * prebuild` so a fresh iOS project builds on current Xcode releases.
 */
const { withAppDelegate, withInfoPlist, withPodfile } = require('@expo/config-plugins');

const MARKER = '# GeoBeats: keep CocoaPods compatible with Xcode 27';
const POD_INSTALL_HOOK = `
    ${MARKER}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_config|
        build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'
      end
    end
`;

module.exports = function withIosXcode27(config) {
  config = withInfoPlist(config, (config) => {
    // Apps built with Xcode 27 must use UIKit's scene lifecycle.  Expo's
    // current generated AppDelegate is application-lifecycle-only, so declare
    // its scene configuration here and adapt the generated delegate below.
    config.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).AppDelegate',
          },
        ],
      },
    };
    return config;
  });

  config = withAppDelegate(config, (config) => {
    const source = config.modResults.contents;
    if (source.includes('UIWindowSceneDelegate')) {
      return config;
    }

    const launchWindow = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif
`;
    const sceneLifecycle = `  // Xcode 27 requires a UIKit scene lifecycle. Keep React Native's
  // window creation in the scene that owns it.
  public func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
  }

  public func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
#if os(iOS) || os(tvOS)
    guard let windowScene = scene as? UIWindowScene, let reactNativeFactory else {
      return
    }
    let window = UIWindow(windowScene: windowScene)
    self.window = window
    reactNativeFactory.startReactNative(withModuleName: "main", in: window, launchOptions: nil)
#endif
  }

`;

    if (!source.includes(launchWindow)) {
      throw new Error('Could not find Expo\'s generated React Native launch block.');
    }

    config.modResults.contents = source
      .replace('public class AppDelegate: ExpoAppDelegate {', 'public class AppDelegate: ExpoAppDelegate, UIWindowSceneDelegate {')
      .replace('  var window: UIWindow?', '  public var window: UIWindow?')
      .replace(launchWindow, '')
      .replace('  // Linking API', `${sceneLifecycle}  // Linking API`);
    return config;
  });

  return withPodfile(config, (config) => {
    const podfile = config.modResults.contents;

    if (podfile.includes(MARKER)) {
      return config;
    }

    const postInstallEnd = podfile.lastIndexOf('  end\nend');
    if (postInstallEnd === -1) {
      throw new Error('Could not find the CocoaPods post_install hook.');
    }

    config.modResults.contents =
      podfile.slice(0, postInstallEnd) + POD_INSTALL_HOOK + podfile.slice(postInstallEnd);
    return config;
  });
};
