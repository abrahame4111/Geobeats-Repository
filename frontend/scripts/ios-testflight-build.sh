#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${FRONTEND_DIR}"

PROFILE="${1:-production}"
WHAT_TO_TEST="${WHAT_TO_TEST:-GeoBeats iOS TestFlight verification build. Focus: Spotify login, map loading, and multi-user visibility.}"
MESSAGE="${MESSAGE:-iOS TestFlight build $(date -u +"%Y-%m-%dT%H:%M:%SZ")}"

EAS_CMD=(npx --yes eas-cli@latest)

echo "GeoBeats iOS TestFlight build"
echo "profile=${PROFILE}"
echo "mode=low-output,no-wait,auto-submit"
echo

node scripts/apply-ios-bundle-id.js

echo
echo "1/3 validating iOS config"
npm run test:ios-config --if-present

echo
echo "2/3 validating TypeScript"
npx tsc --noEmit --pretty false

echo
echo "3/3 starting EAS build and TestFlight upload"
"${EAS_CMD[@]}" build \
  --platform ios \
  --profile "${PROFILE}" \
  --auto-submit \
  --non-interactive \
  --no-wait \
  --build-logger-level warn \
  --message "${MESSAGE}" \
  --what-to-test "${WHAT_TO_TEST}"

echo
echo "Build queued. Check concise status with:"
echo "  npm run ios:testflight:status"
