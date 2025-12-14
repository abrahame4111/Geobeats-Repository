# 🔧 Setup Instructions for Music Navigator

This guide will walk you through setting up the Music Navigator app with your own Spotify and Google Maps API credentials.

## 📋 What You'll Need

1. **Spotify Developer Account** (free)
2. **Google Cloud Account** (free tier available)
3. **Text editor** to edit the `.env` file

---

## 🎵 Part 1: Spotify API Setup

### Step 1: Create a Spotify Developer Account

1. Go to [https://developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
2. Log in with your Spotify account (or create one if you don't have one)
3. Accept the Terms of Service if prompted

### Step 2: Create a New App

1. Click the **"Create app"** button
2. Fill in the form:
   ```
   App name: Music Navigator
   App description: Real-time music streaming with location tracking
   Website: https://mapify-social.preview.emergentagent.com
   Redirect URI: https://mapify-social.preview.emergentagent.com/auth/callback
   ```
3. Check the box: **"I understand and agree with Spotify's Developer Terms of Service and Design Guidelines"**
4. Click **"Save"**

### Step 3: Get Your Credentials

1. You'll be redirected to your app's dashboard
2. Click on **"Settings"** in the top right
3. You'll see:
   - **Client ID**: Copy this value
   - **Client Secret**: Click "View client secret" and copy this value

### Step 4: Save Your Spotify Credentials

Keep these values handy - you'll add them to the `.env` file in Part 3.

---

## 🗺️ Part 2: Google Maps API Setup

### Step 1: Create a Google Cloud Project

1. Go to [https://console.cloud.google.com/](https://console.cloud.google.com/)
2. Sign in with your Google account
3. Click on the project dropdown (top left) and click **"New Project"**
4. Enter project name: `Music Navigator` and click **"Create"**
5. Wait for the project to be created (you'll see a notification)

### Step 2: Enable Required APIs

1. Make sure your new project is selected in the project dropdown
2. Go to **"APIs & Services"** → **"Library"** (use the menu on the left)
3. Enable the following three APIs (search for each and click "Enable"):
   - **Maps JavaScript API**
   - **Geolocation API**
   - **Geocoding API**

### Step 3: Create an API Key

1. Go to **"APIs & Services"** → **"Credentials"**
2. Click **"Create Credentials"** → **"API Key"**
3. Your API key will be created and shown in a popup
4. **IMPORTANT**: Click **"Restrict Key"** (don't close the popup yet)

### Step 4: Restrict Your API Key (Important for Security!)

1. Under **"API restrictions"**:
   - Select **"Restrict key"**
   - Check these three APIs:
     - Maps JavaScript API
     - Geolocation API
     - Geocoding API
   
2. Under **"Application restrictions"**:
   - Select **"HTTP referrers (web sites)"**
   - Click **"Add an item"**
   - Enter: `https://mapify-social.preview.emergentagent.com/*`
   - Click **"Done"**

3. Click **"Save"** at the bottom

### Step 5: Copy Your API Key

1. Go back to **"Credentials"** page
2. Find your API key in the list and copy it
3. Keep this value handy - you'll add it to the `.env` file in Part 3

---

## ⚙️ Part 3: Configure the Application

### Step 1: Locate the .env File

The configuration file is located at:
```
/app/backend/.env
```

### Step 2: Edit the .env File

Open the file and you'll see placeholder values like this:

```env
MONGO_URL="mongodb://localhost:27017"
DB_NAME="music_navigator"
CORS_ORIGINS="*"

# Spotify API Configuration (Replace with your credentials)
SPOTIFY_CLIENT_ID="YOUR_SPOTIFY_CLIENT_ID_HERE"
SPOTIFY_CLIENT_SECRET="YOUR_SPOTIFY_CLIENT_SECRET_HERE"
SPOTIFY_REDIRECT_URI="https://mapify-social.preview.emergentagent.com/auth/callback"

# Google Maps API Configuration (Replace with your API key)
GOOGLE_MAPS_API_KEY="YOUR_GOOGLE_MAPS_API_KEY_HERE"
```

### Step 3: Replace the Placeholder Values

Replace the placeholders with your actual credentials:

```env
# Spotify API Configuration
SPOTIFY_CLIENT_ID="abc123xyz456..."  # Your Client ID from Spotify
SPOTIFY_CLIENT_SECRET="def789uvw012..."  # Your Client Secret from Spotify
SPOTIFY_REDIRECT_URI="https://mapify-social.preview.emergentagent.com/auth/callback"

# Google Maps API Configuration
GOOGLE_MAPS_API_KEY="AIzaSy..."  # Your API key from Google Cloud
```

**IMPORTANT**: 
- Keep the quotes around the values
- Don't share these values with anyone
- The REDIRECT_URI should stay exactly as shown

### Step 4: Save the File

Save the `/app/backend/.env` file with your changes.

### Step 5: Restart the Backend

Run this command to restart the backend with your new credentials:

```bash
sudo supervisorctl restart backend
```

Wait about 5 seconds for the backend to restart.

---

## ✅ Part 4: Test Your Setup

### Step 1: Open the Application

Go to: [https://mapify-social.preview.emergentagent.com/](https://mapify-social.preview.emergentagent.com/)

### Step 2: Test Login

1. Click **"Login with Spotify"**
2. You should be redirected to Spotify's authorization page
3. Click **"Agree"** to authorize the app
4. You should be redirected back to the Music Navigator home page

### Step 3: Test Home Page

- You should see your Spotify playlists
- You should see Spotify categories
- Try clicking on a playlist

### Step 4: Test Map Page

1. Click **"Map"** in the navigation bar
2. The Google Map should load with a dark theme
3. Click **"Share Location"** 
4. Allow location access when prompted
5. You should see a green marker at your location

### Step 5: Test Music Player

1. Start playing music in your Spotify app (desktop or mobile)
2. The player at the bottom should show your current track
3. Try the play/pause and skip buttons

---

## 🎉 You're All Set!

Your Music Navigator app is now fully configured and ready to use!

## 🐛 Troubleshooting

### "Invalid Client" Error
- Double-check your Spotify Client ID and Secret
- Make sure there are no extra spaces
- Verify the Redirect URI in Spotify matches exactly

### Map Shows "API Key Required"
- Check that you entered the Google Maps API key correctly
- Verify the three required APIs are enabled in Google Cloud Console
- Make sure the API key restrictions allow your domain

### "No playlists found"
- Make sure you've authorized the app with Spotify
- Check that you have playlists in your Spotify account
- Try logging out and logging back in

### Backend Not Starting
- Check the backend logs: `tail -n 50 /var/log/supervisor/backend.err.log`
- Make sure the .env file syntax is correct (quotes, no extra spaces)
- Try restarting all services: `sudo supervisorctl restart all`

---

## 📞 Need Help?

If you encounter any issues:

1. Check the backend logs: `tail -n 100 /var/log/supervisor/backend.err.log`
2. Check the frontend logs in your browser console (F12)
3. Verify all API credentials are correct
4. Make sure all required APIs are enabled in Google Cloud

---

## 🔐 Security Tips

1. **Never commit your .env file** to version control
2. **Keep your API keys secret** - don't share them
3. **Enable API key restrictions** in Google Cloud Console
4. **Monitor your API usage** in both Spotify and Google Cloud dashboards
5. **Rotate your keys regularly** for production use

---

**Happy Listening! 🎵🗺️**
