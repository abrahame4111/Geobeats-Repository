// UIKit creates a scene delegate separately from UIApplication.shared.delegate.
// Keep the React Native factory on the application delegate and attach its view
// to the window owned by the scene. In particular, never instantiate AppDelegate
// as the scene delegate: that second instance has no initialized factory.
const MARKER = '// GeoBeats scene lifecycle v2';

const SCENE_CONFIGURATION = `  public func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    let configuration = UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
    configuration.delegateClass = SceneDelegate.self
    return configuration
  }

`;

const SCENE_DELEGATE = `
${MARKER}
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  private var appDelegate: AppDelegate? {
    UIApplication.shared.delegate as? AppDelegate
  }

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate,
          let factory = appDelegate.reactNativeFactory else {
      assertionFailure("GeoBeats: React Native factory was not initialized by the application delegate")
      return
    }

    // Preserve a single React Native instance when reconnecting the scene.
    if let existingWindow = appDelegate.window {
      window = existingWindow
      existingWindow.windowScene = windowScene
      existingWindow.makeKeyAndVisible()
      self.scene(scene, openURLContexts: connectionOptions.urlContexts)
      for activity in connectionOptions.userActivities {
        self.scene(scene, continue: activity)
      }
      return
    }

    var launchOptions: [UIApplication.LaunchOptionsKey: Any] = [:]
    if let context = connectionOptions.urlContexts.first {
      launchOptions[.url] = context.url
      launchOptions[.sourceApplication] = context.options.sourceApplication
      launchOptions[.annotation] = context.options.annotation
    }
    if let activity = connectionOptions.userActivities.first {
      launchOptions[.userActivityDictionary] = [
        "UIApplicationLaunchOptionsUserActivityTypeKey": activity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": activity
      ]
    }

    // Seed Expo Linking's initial URL as well as React Native's launch options.
    self.scene(scene, openURLContexts: connectionOptions.urlContexts)
    for activity in connectionOptions.userActivities {
      self.scene(scene, continue: activity)
    }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: launchOptions)
    window.makeKeyAndVisible()
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      var options: [UIApplication.OpenURLOptionsKey: Any] = [
        .openInPlace: context.options.openInPlace
      ]
      options[.sourceApplication] = context.options.sourceApplication
      options[.annotation] = context.options.annotation
      _ = appDelegate?.application(UIApplication.shared, open: context.url, options: options)
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = appDelegate?.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }

  func sceneDidBecomeActive(_ scene: UIScene) {
    appDelegate?.applicationDidBecomeActive(UIApplication.shared)
  }

  func sceneWillResignActive(_ scene: UIScene) {
    appDelegate?.applicationWillResignActive(UIApplication.shared)
  }

  func sceneWillEnterForeground(_ scene: UIScene) {
    appDelegate?.applicationWillEnterForeground(UIApplication.shared)
  }

  func sceneDidEnterBackground(_ scene: UIScene) {
    appDelegate?.applicationDidEnterBackground(UIApplication.shared)
  }
}
`;

function withSceneLifecycle(source) {
  if (source.includes(MARKER)) return source;

  const launchWindow = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif
`;
  const legacyStart = source.indexOf('  // Xcode 27 requires a UIKit scene lifecycle.');
  const linkingStart = source.indexOf('  // Linking API');
  if (linkingStart === -1) {
    throw new Error("Could not find Expo's Linking API marker in AppDelegate.swift.");
  }
  if (legacyStart !== -1 && legacyStart < linkingStart) {
    // Migrate already-generated projects without deleting signing settings.
    source = source.slice(0, legacyStart) + source.slice(linkingStart);
    source = source.replace('ExpoAppDelegate, UIWindowSceneDelegate', 'ExpoAppDelegate');
  } else if (source.includes(launchWindow)) {
    source = source.replace(launchWindow, '');
  } else {
    throw new Error("Could not find Expo's generated React Native launch block.");
  }

  return source.replace('  // Linking API', `${SCENE_CONFIGURATION}  // Linking API`) + SCENE_DELEGATE;
}

module.exports = { withSceneLifecycle };
