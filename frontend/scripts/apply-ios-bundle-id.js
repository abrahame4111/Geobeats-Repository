#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const bundleId = (process.env.IOS_BUNDLE_ID || process.env.IOSBUNDLEID || "").trim();

if (!bundleId) {
  console.log("IOS_BUNDLE_ID not set; using bundle identifier from app.json.");
  process.exit(0);
}

if (!/^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z0-9.-]+$/.test(bundleId)) {
  console.error("Invalid IOS_BUNDLE_ID format.");
  process.exit(1);
}

const appJsonPath = path.join(__dirname, "..", "app.json");
const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
appJson.expo = appJson.expo || {};
appJson.expo.ios = appJson.expo.ios || {};

const previous = appJson.expo.ios.bundleIdentifier || "(unset)";
appJson.expo.ios.bundleIdentifier = bundleId;

fs.writeFileSync(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`);
console.log(`iOS bundle identifier set for this build: ${previous} -> ${bundleId}`);
