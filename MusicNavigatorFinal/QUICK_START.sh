#!/bin/bash

# Music Navigator - Quick Start Script
# Run this on your local machine after copying the project

echo "🎵 Music Navigator - Quick Start"
echo "================================"
echo ""

# Check Node.js
echo "📦 Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 16+ first."
    exit 1
fi
echo "✅ Node.js $(node -v)"
echo ""

# Check Java
echo "☕ Checking Java..."
if ! command -v java &> /dev/null; then
    echo "❌ Java not found. Please install JDK 11+ first."
    exit 1
fi
echo "✅ Java $(java -version 2>&1 | head -n 1)"
echo ""

# Install dependencies
echo "📥 Installing dependencies..."
npm install || yarn install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi
echo "✅ Dependencies installed"
echo ""

# Check for Android device
echo "📱 Checking for Android devices..."
adb devices

echo ""
echo "🚀 Setup complete!"
echo ""
echo "Next steps:"
echo "1. Connect your Android device via USB"
echo "2. Enable USB debugging on your device"
echo "3. Run: npx react-native run-android"
echo ""
echo "Or to build an APK:"
echo "cd android && ./gradlew assembleRelease"
echo ""
