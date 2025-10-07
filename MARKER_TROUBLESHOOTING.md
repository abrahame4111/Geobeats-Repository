# 🐛 Map Marker Troubleshooting Guide

If your profile picture marker is not showing up on the map, follow these steps:

## ✅ Quick Checklist

### 1. Check You're Logged In
- Make sure you've logged in with Spotify
- Look for your name/email in the top right corner
- If not logged in, click "Login with Spotify"

### 2. Enable Location Sharing
- Click the green **"Share Location"** button
- Browser will ask for location permission - click **"Allow"**
- Button should change to **"Stop Sharing"** (green)
- You should see "1 Active" in the stats

### 3. Check Browser Console
Press `F12` or right-click → "Inspect" → "Console" tab

Look for these messages:
```
✅ Good messages:
- "Got location: 37.xxxx, -122.xxxx"
- "Sharing location data: {...}"
- "Location data sent via WebSocket"
- "WebSocket connected"

❌ Error messages:
- "Geolocation error" - Location permission denied
- "WebSocket not ready" - Connection issue
- "Failed to load Maps API key" - Google Maps setup issue
```

### 4. Verify Location Permissions

**Chrome/Edge:**
- Click the lock icon 🔒 in address bar
- Check "Location" is set to "Allow"

**Firefox:**
- Click the info icon ℹ️ in address bar
- Check "Access Your Location" is "Allowed"

**Safari:**
- Safari → Preferences → Websites → Location
- Find your site and set to "Allow"

### 5. Check Map is Loaded
- You should see the dark-themed Google Map
- Map should show streets and labels
- If you see "API key required" overlay, Google Maps key is missing

## 🔧 Common Issues & Fixes

### Issue: "Location permission denied"
**Solution:**
1. Browser settings → Privacy → Location
2. Add your site to allowed list
3. Refresh the page
4. Click "Share Location" again

### Issue: "WebSocket not connecting"
**Solution:**
1. Check backend is running: 
   ```bash
   sudo supervisorctl status backend
   ```
2. Restart if needed:
   ```bash
   sudo supervisorctl restart backend
   ```
3. Refresh the page

### Issue: "Map not loading"
**Solution:**
1. Check you've added Google Maps API key to `/app/backend/.env`
2. Make sure these APIs are enabled in Google Cloud:
   - Maps JavaScript API
   - Geolocation API
   - Geocoding API
3. Restart backend after adding key

### Issue: "Marker appears but no profile picture"
**Solution:**
1. Check your Spotify profile has a profile picture
2. Go to Spotify → Settings → Edit Profile
3. Upload a profile picture if missing
4. Log out and log back in to the app

### Issue: "Active count shows 0 even when sharing"
**Solution:**
1. Open browser console (F12)
2. Look for WebSocket errors
3. Check backend logs:
   ```bash
   tail -n 50 /var/log/supervisor/backend.err.log
   ```
4. Make sure your Spotify credentials are correct in `.env`

## 🧪 Testing Steps

### Step 1: Test Location Permission
```javascript
// Paste this in browser console:
navigator.geolocation.getCurrentPosition(
  (pos) => console.log('✅ Location works:', pos.coords),
  (err) => console.log('❌ Location error:', err)
);
```

### Step 2: Test WebSocket Connection
Check console for:
- "WebSocket connected" = ✅ Good
- "WebSocket error" = ❌ Problem

### Step 3: Test Marker Creation
After clicking "Share Location":
1. Wait 5-10 seconds
2. Check "Active" count increases
3. Look for circular marker on map
4. Zoom out if marker is outside visible area

## 🗺️ Expected Behavior

When everything works correctly:

1. **Login** → You see Home page with playlists
2. **Click Map** → Dark Google Map loads
3. **Click "Share Location"** → Browser asks permission
4. **Click "Allow"** → Button turns green "Stop Sharing"
5. **Wait 5 seconds** → Your profile picture appears as circular marker
6. **If playing music** → Song name appears near marker
7. **Click marker** → Info popup shows your profile and current song

## 📍 What Your Marker Should Look Like

```
     [🎵 Song Name]  ← If music is playing
           │
        ┌──▼──┐
        │ 😊  │      ← Your Spotify profile picture
        │     │      ← Green border (3px)
        └─────┘      ← Drop shadow
```

## 🔍 Debug Mode

To see detailed logs, open console and type:
```javascript
localStorage.setItem('debug', 'true');
location.reload();
```

This will show all location updates and marker creation events.

## 📞 Still Not Working?

If you've tried everything:

1. **Clear browser cache**:
   - Chrome: Ctrl+Shift+Delete → Clear cache
   - Firefox: Ctrl+Shift+Delete → Clear cache
   - Safari: Safari → Clear History

2. **Try incognito/private window**:
   - Rules out extension conflicts
   - Fresh permissions state

3. **Check API keys are correct**:
   - Spotify Client ID & Secret in `.env`
   - Google Maps API key in `.env`
   - No extra spaces or quotes issues

4. **Restart everything**:
   ```bash
   sudo supervisorctl restart all
   ```

5. **Check browser console** for specific error messages
   - Screenshot the error
   - Check if it mentions permissions, network, or API issues

## ✅ Success Indicators

You know it's working when:
- ✅ "1 Active" or more shows in stats bar
- ✅ Green-bordered circular marker on map
- ✅ Clicking marker shows your info
- ✅ "Stop Sharing" button is green
- ✅ Console shows "Location data sent"

---

**Still having issues? Check the browser console (F12) for specific error messages!**
