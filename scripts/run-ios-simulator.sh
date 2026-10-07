#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="${REPO_DIR}/frontend"

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "Xcode is required. Install it from the App Store, then open it once."
  exit 1
fi

if ! xcrun simctl list devices available | grep -q "iPhone"; then
  echo "No iPhone Simulator runtime is installed."
  echo "Open Xcode > Settings > Components and install an iOS Simulator."
  exit 1
fi

cd "${FRONTEND_DIR}"

echo "Installing frontend dependencies..."
npm ci --no-audit --no-fund

echo "Opening the iOS Simulator and starting GeoBeats..."
open -a Simulator
npx expo start --ios --clear
