# 🔌 WebSocket Troubleshooting Guide

## Common WebSocket Issues & Fixes

### Issue: Friend Gets WebSocket Error

**Symptoms:**
- Friend can login but marker doesn't appear
- Console shows "WebSocket error"
- Active count stays at 0
- No location sharing works

**Common Causes:**

### 1. User Not Logged In Properly

**Check:**
```javascript
// Friend should see in console:
✅ "Connecting WebSocket for user: [their-spotify-id]"
✅ "WebSocket connected successfully for: [their-id]"
```

**If friend sees:**
```
❌ "WebSocket error"
❌ User ID is undefined or null
```

**Fix:**
1. Make sure friend completed Spotify login
2. Check they were redirected back to the app
3. Verify they see their name in top right navbar
4. Try logging out and back in

### 2. WebSocket Connection Blocked

**Check Browser Console:**
```javascript
// Should see:
✅ "WebSocket connected successfully"

// If you see:
❌ "WebSocket error"
❌ "Connection refused"
❌ "Connection timeout"
```

**Possible Causes:**
- Browser extension blocking WebSocket
- Corporate firewall
- VPN interfering
- Ad blocker

**Fix:**
1. Disable browser extensions temporarily
2. Try in incognito mode
3. Disable VPN
4. Try different browser

### 3. Backend Not Running

**Check:**
```bash
sudo supervisorctl status backend
```

**Should show:**
```
backend    RUNNING   pid 13416, uptime 0:00:18
```

**If not running:**
```bash
sudo supervisorctl restart backend
```

### 4. HTTPS/WSS Protocol Issue

**Check WebSocket URL in console:**
```
Should be: wss://music-navigator.preview.emergentagent.com/ws/[user-id]
NOT:       ws://music-navigator.preview.emergentagent.com/ws/[user-id]
```

**The 's' in 'wss' is critical for HTTPS sites!**

### 5. User ID Not Generated

**What was fixed:**
- Now generates fallback user ID if Spotify ID missing
- Stores temp ID in localStorage
- Uses consistent ID across reconnections

**Friend's console should show:**
```javascript
Connecting WebSocket for user: [some-id]
```

## 🧪 Testing Steps for Your Friend

### Step 1: Check Login Status
1. Open the app
2. See your name in top right? ✅
3. If not, click "Login with Spotify" again

### Step 2: Open Browser Console (F12)
1. Press F12
2. Go to "Console" tab
3. Look for messages

### Step 3: Go to Map Page
1. Click "Map" in navigation
2. Watch console for messages

### Step 4: Share Location
1. Click "Share Location"
2. Allow location when prompted
3. Watch console for:
```
✅ Toggle button clicked
✅ Location sharing ENABLED
✅ Connecting WebSocket for user: [id]
✅ WebSocket connected successfully
✅ Got location: [coordinates]
✅ Creating marker for current user
```

### Step 5: Check for Errors
If you see any ❌ errors, note the exact message.

## 🔍 Debugging Commands

### For You (App Owner):

**Check backend logs:**
```bash
tail -n 100 /var/log/supervisor/backend.err.log
```

**Check active WebSocket connections:**
```bash
curl http://localhost:8001/api/health
```

Should show:
```json
{
  "status": "healthy",
  "active_connections": 2,  // If both you and friend are connected
  "tracked_users": 2
}
```

### For Your Friend:

**Check WebSocket in browser DevTools:**
1. F12 → Network tab
2. Filter: WS (WebSocket)
3. Look for connection to `/ws/[user-id]`
4. Status should be: 101 Switching Protocols ✅

**If status is:**
- 404: User ID problem
- 403: Permission/CORS issue
- 500: Backend error
- Failed: Network/firewall issue

## 💡 Quick Fixes

### Fix 1: Clear Storage & Retry
```javascript
// In console:
localStorage.clear();
location.reload();
// Then login again
```

### Fix 2: Force Reconnect
```javascript
// In console:
location.href = location.href + '?refresh=' + Date.now();
```

### Fix 3: Use Incognito
- No extensions
- Clean state
- Rules out caching issues

### Fix 4: Different Browser
- Try Chrome if using Firefox
- Try Firefox if using Chrome
- Mobile browser might work better

## 🎯 Expected Behavior

### When Everything Works:

**Friend's Console:**
```
1. Connecting WebSocket for user: spotify:user:abc123
2. ✅ WebSocket connected successfully for: spotify:user:abc123
3. Got location: 37.7749, -122.4194
4. Sharing location data: {lat, lng, profile_image...}
5. Creating marker for current user: spotify:user:abc123
6. ✅ Marker successfully created and added to map
7. Location data sent via WebSocket
```

**Your Console (when friend shares location):**
```
WebSocket message received: {
  type: "location_update",
  user_id: "spotify:user:abc123",
  location: {...}
}
Updating marker for: spotify:user:abc123
```

**Map shows:**
```
👥 2 Active  ← Both you and friend
✅ Your green marker
✅ Friend's blue marker
```

## 🚨 Common Error Messages

### Error: "WebSocket connection to 'ws://...' failed"
**Fix:** Check if backend is running

### Error: "User denied Geolocation"
**Fix:** Allow location in browser settings

### Error: "Cannot read properties of undefined"
**Fix:** Make sure logged in properly

### Error: "Connection closed abnormally"
**Fix:** Backend restarted, page will auto-reconnect

### Error: "Network error"
**Fix:** Check internet connection, try VPN off

## 📞 Information to Collect for Debugging

If friend still has issues, ask them to send:

1. **Browser and version**
   - Chrome 120? Firefox 115? Safari 17?

2. **Operating system**
   - Windows 11? macOS? Linux? Mobile?

3. **Console errors (screenshot)**
   - Full error message
   - Stack trace if any

4. **Network tab screenshot**
   - Filter to WS
   - Show WebSocket connection status

5. **Steps they took**
   - Logged in successfully?
   - Saw their playlists?
   - Went to Map page?
   - Clicked Share Location?

## ✅ Success Indicators

Friend will know it's working when:
- ✅ Console shows "WebSocket connected"
- ✅ "1 Active" changes to "2 Active"
- ✅ They see their profile marker
- ✅ You see their marker
- ✅ Can click each other's markers
- ✅ See each other's songs

## 🎉 Multi-User Testing Checklist

- [ ] Both logged in with Spotify
- [ ] Both see their own playlists on Home
- [ ] Both can access Map page
- [ ] Both clicked "Share Location"
- [ ] Both allowed location permission
- [ ] Both see "WebSocket connected" in console
- [ ] Active count shows "2 Active"
- [ ] Both markers visible on map
- [ ] Can click markers to see song info
- [ ] Songs update when changing tracks

---

**Still not working? Check:**
1. Backend logs: `tail -f /var/log/supervisor/backend.err.log`
2. Health check: `curl http://localhost:8001/api/health`
3. Try restarting: `sudo supervisorctl restart all`
