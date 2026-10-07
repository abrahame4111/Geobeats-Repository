#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${FRONTEND_DIR}"

EAS_CMD=(npx --yes eas-cli@latest)
BUILD_JSON="$(mktemp -t geobeats-eas-builds.XXXXXX.json)"
SUBMIT_JSON="$(mktemp -t geobeats-eas-submits.XXXXXX.json)"
trap 'rm -f "${BUILD_JSON}" "${SUBMIT_JSON}"' EXIT

"${EAS_CMD[@]}" build:list \
  --platform ios \
  --build-profile production \
  --limit 3 \
  --json > "${BUILD_JSON}"

"${EAS_CMD[@]}" submit:list \
  --platform ios \
  --limit 3 \
  --json > "${SUBMIT_JSON}"

node - "${BUILD_JSON}" "${SUBMIT_JSON}" <<'NODE'
const fs = require("fs");

const [buildPath, submitPath] = process.argv.slice(2);
const builds = JSON.parse(fs.readFileSync(buildPath, "utf8"));
const submissions = JSON.parse(fs.readFileSync(submitPath, "utf8"));

function value(item, keys) {
  for (const key of keys) {
    const parts = key.split(".");
    let cursor = item;
    for (const part of parts) cursor = cursor?.[part];
    if (cursor !== undefined && cursor !== null && cursor !== "") return cursor;
  }
  return "-";
}

function row(label, item, fields) {
  console.log(label);
  if (!item) {
    console.log("  none found");
    return;
  }
  for (const [name, keys] of fields) {
    console.log(`  ${name}: ${value(item, keys)}`);
  }
}

row("Latest iOS production build", builds[0], [
  ["id", ["id"]],
  ["status", ["status"]],
  ["appVersion", ["appVersion"]],
  ["buildNumber", ["appBuildVersion"]],
  ["bundleId", ["appIdentifier"]],
  ["commit", ["gitCommitHash"]],
  ["message", ["gitCommitMessage"]],
  ["createdAt", ["createdAt"]],
  ["completedAt", ["completedAt"]],
]);

console.log("");

row("Latest iOS submission", submissions[0], [
  ["id", ["id"]],
  ["status", ["status"]],
  ["buildId", ["submittedBuild.id", "build.id"]],
  ["buildNumber", ["submittedBuild.appBuildVersion", "build.appBuildVersion"]],
  ["createdAt", ["createdAt"]],
  ["completedAt", ["completedAt"]],
]);

console.log("");
console.log("If build is FINISHED but submission is IN_QUEUE or IN_PROGRESS, wait and rerun this command.");
console.log("When Apple processing finishes, install the newest build in TestFlight and test Spotify login.");
NODE
