#!/usr/bin/env python3
"""
Test initial_locations functionality specifically
"""

import asyncio
import websockets
import json
import time
from datetime import datetime
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv('/app/frontend/.env')
BACKEND_URL = os.getenv('REACT_APP_BACKEND_URL', 'https://musicmap-build.preview.emergentagent.com')
WS_URL = BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://')

async def test_initial_locations():
    """Test that new connections receive initial_locations message"""
    print("🧪 Testing Initial Locations Functionality")
    print("="*50)
    
    # Step 1: Connect first user and send location
    print("\n📋 Step 1: Connect user1 and send location")
    user1_ws = await websockets.connect(f"{WS_URL}/api/ws/user1")
    
    location_data = {
        "lat": 37.7749,
        "lng": -122.4194,
        "song_name": "Initial Song",
        "user_name": "First User"
    }
    
    await user1_ws.send(json.dumps(location_data))
    print("✅ User1 connected and sent location")
    
    # Wait a moment for the location to be stored
    await asyncio.sleep(1)
    
    # Step 2: Connect second user and check for initial_locations
    print("\n📋 Step 2: Connect user2 and check for initial_locations")
    user2_ws = await websockets.connect(f"{WS_URL}/api/ws/user2")
    
    # Listen for initial message
    try:
        initial_message = await asyncio.wait_for(user2_ws.recv(), timeout=5.0)
        parsed_message = json.loads(initial_message)
        
        print(f"📥 User2 received message: {parsed_message}")
        
        if parsed_message.get('type') == 'initial_locations':
            locations = parsed_message.get('locations', {})
            if 'user1' in locations:
                print("✅ SUCCESS: User2 received initial_locations with user1's data")
                print(f"   User1 location: lat={locations['user1'].get('lat')}, lng={locations['user1'].get('lng')}")
            else:
                print("❌ FAILED: initial_locations message missing user1's data")
        else:
            print(f"❌ FAILED: Expected initial_locations, got {parsed_message.get('type')}")
            
    except asyncio.TimeoutError:
        print("❌ FAILED: No initial message received within timeout")
    
    # Step 3: Connect third user to test multiple existing locations
    print("\n📋 Step 3: Send location from user2, then connect user3")
    
    # User2 sends location
    user2_location = {
        "lat": 40.7128,
        "lng": -74.0060,
        "song_name": "Second Song",
        "user_name": "Second User"
    }
    await user2_ws.send(json.dumps(user2_location))
    await asyncio.sleep(1)
    
    # Connect user3
    user3_ws = await websockets.connect(f"{WS_URL}/api/ws/user3")
    
    try:
        initial_message = await asyncio.wait_for(user3_ws.recv(), timeout=5.0)
        parsed_message = json.loads(initial_message)
        
        if parsed_message.get('type') == 'initial_locations':
            locations = parsed_message.get('locations', {})
            user_count = len(locations)
            print(f"✅ User3 received initial_locations with {user_count} existing users")
            
            if 'user1' in locations and 'user2' in locations:
                print("✅ SUCCESS: All existing user locations included")
            else:
                print("❌ FAILED: Some user locations missing from initial_locations")
        else:
            print(f"❌ FAILED: Expected initial_locations, got {parsed_message.get('type')}")
            
    except asyncio.TimeoutError:
        print("❌ FAILED: No initial message received for user3")
    
    # Cleanup
    await user1_ws.close()
    await user2_ws.close()
    await user3_ws.close()
    
    print("\n🏁 Initial Locations Test Completed")

if __name__ == "__main__":
    asyncio.run(test_initial_locations())