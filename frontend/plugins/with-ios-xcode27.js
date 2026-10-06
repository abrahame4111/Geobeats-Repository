/**
 * Xcode 27 no longer supports simulator targets below iOS 15.  A few
 * transitive CocoaPods still declare older targets, even though GeoBeats
 * itself targets iOS 15.1.  Keep those pod targets aligned during `expo
 * prebuild` so a fresh iOS project builds on current Xcode releases.
 */
const { withPodfile } = require('@expo/config-plugins');

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
