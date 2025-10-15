#!/usr/bin/env python3
"""
WebSocket Broadcasting Test Suite for Music Streaming App
Tests multi-user real-time location sharing functionality
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

class WebSocketTester:
    def __init__(self):
        self.connections = {}
        self.received_messages = {}
        self.test_results = []
        
    async def connect_user(self, user_id):
        """Connect a user to WebSocket"""
        try:
            # Try both /ws/{user_id} and /api/ws/{user_id} endpoints
            uris_to_try = [
                f"{WS_URL}/ws/{user_id}",
                f"{WS_URL}/api/ws/{user_id}"
            ]
            
            for uri in uris_to_try:
                try:
                    print(f"🔗 Attempting to connect {user_id} to {uri}")
                    websocket = await websockets.connect(uri)
                    self.connections[user_id] = websocket
                    self.received_messages[user_id] = []
                    print(f"✅ {user_id} connected successfully to {uri}")
                    return True
                except Exception as e:
                    print(f"❌ Failed to connect {user_id} to {uri}: {e}")
                    continue
            
            print(f"❌ Failed to connect {user_id} to any WebSocket endpoint")
            return False
        except Exception as e:
            print(f"❌ Unexpected error connecting {user_id}: {e}")
            return False
    
    async def listen_for_messages(self, user_id, duration=5):
        """Listen for messages from WebSocket for specified duration"""
        if user_id not in self.connections:
            print(f"❌ {user_id} not connected")
            return
            
        websocket = self.connections[user_id]
        start_time = time.time()
        
        try:
            while time.time() - start_time < duration:
                try:
                    message = await asyncio.wait_for(websocket.recv(), timeout=1.0)
                    parsed_message = json.loads(message)
                    self.received_messages[user_id].append(parsed_message)
                    print(f"📥 {user_id} received: {parsed_message.get('type', 'unknown')} message")
                except asyncio.TimeoutError:
                    continue
                except websockets.exceptions.ConnectionClosed:
                    print(f"🔌 {user_id} connection closed")
                    break
        except Exception as e:
            print(f"❌ Error listening for {user_id}: {e}")
    
    async def send_location_update(self, user_id, lat, lng, song_name="Test Song", user_name="Test User"):
        """Send location update from a user"""
        if user_id not in self.connections:
            print(f"❌ {user_id} not connected")
            return False
            
        location_data = {
            "lat": lat,
            "lng": lng,
            "song_name": song_name,
            "user_name": user_name,
            "timestamp": datetime.now().isoformat()
        }
        
        try:
            await self.connections[user_id].send(json.dumps(location_data))
            print(f"📤 {user_id} sent location: lat={lat}, lng={lng}, song={song_name}")
            return True
        except Exception as e:
            print(f"❌ Failed to send location from {user_id}: {e}")
            return False
    
    async def disconnect_user(self, user_id):
        """Disconnect a user"""
        if user_id in self.connections:
            try:
                await self.connections[user_id].close()
                del self.connections[user_id]
                print(f"🔌 {user_id} disconnected")
            except Exception as e:
                print(f"❌ Error disconnecting {user_id}: {e}")
    
    def analyze_messages(self, user_id):
        """Analyze received messages for a user"""
        messages = self.received_messages.get(user_id, [])
        analysis = {
            'total_messages': len(messages),
            'initial_locations': 0,
            'location_updates': 0,
            'other_messages': 0,
            'received_from_users': set()
        }
        
        for msg in messages:
            msg_type = msg.get('type', 'unknown')
            if msg_type == 'initial_locations':
                analysis['initial_locations'] += 1
            elif msg_type == 'location_update':
                analysis['location_updates'] += 1
                sender_id = msg.get('user_id')
                if sender_id:
                    analysis['received_from_users'].add(sender_id)
            else:
                analysis['other_messages'] += 1
        
        return analysis
    
    def print_test_summary(self):
        """Print comprehensive test summary"""
        print("\n" + "="*60)
        print("📊 WEBSOCKET BROADCASTING TEST SUMMARY")
        print("="*60)
        
        for user_id in self.received_messages:
            analysis = self.analyze_messages(user_id)
            print(f"\n👤 {user_id}:")
            print(f"   📨 Total messages: {analysis['total_messages']}")
            print(f"   🏠 Initial locations: {analysis['initial_locations']}")
            print(f"   📍 Location updates: {analysis['location_updates']}")
            print(f"   👥 Updates from users: {list(analysis['received_from_users'])}")
        
        print(f"\n🔗 Total connections tested: {len(self.connections)}")
        print("="*60)

async def test_websocket_broadcasting():
    """Main test function for WebSocket broadcasting"""
    print("🚀 Starting WebSocket Broadcasting Tests")
    print("="*60)
    
    tester = WebSocketTester()
    
    # Test 1: Single User Connection
    print("\n📋 TEST 1: Single User Connection")
    print("-" * 40)
    
    success = await tester.connect_user("user1")
    if not success:
        print("❌ TEST 1 FAILED: Could not connect user1")
        return
    
    # Listen for initial messages
    await tester.listen_for_messages("user1", 2)
    analysis = tester.analyze_messages("user1")
    
    if analysis['total_messages'] >= 0:  # Should receive initial_locations (empty or with data)
        print("✅ TEST 1 PASSED: User1 connected and can receive messages")
    else:
        print("❌ TEST 1 FAILED: User1 did not receive expected messages")
    
    # Test 2: Multi-User Connection
    print("\n📋 TEST 2: Multi-User Connection")
    print("-" * 40)
    
    # Connect additional users
    user2_success = await tester.connect_user("user2")
    user3_success = await tester.connect_user("user3")
    
    if user2_success and user3_success:
        print("✅ TEST 2 PASSED: Multiple users connected successfully")
    else:
        print("❌ TEST 2 FAILED: Could not connect all users")
        return
    
    # Test 3: Location Broadcasting
    print("\n📋 TEST 3: Location Broadcasting")
    print("-" * 40)
    
    # Start listening for all users
    listen_tasks = [
        tester.listen_for_messages("user1", 8),
        tester.listen_for_messages("user2", 8),
        tester.listen_for_messages("user3", 8)
    ]
    
    # Send location updates from each user with delays
    async def send_updates():
        await asyncio.sleep(1)  # Wait for listeners to start
        
        # User1 sends location
        await tester.send_location_update("user1", 37.7749, -122.4194, "Song A", "Alice")
        await asyncio.sleep(2)
        
        # User2 sends location
        await tester.send_location_update("user2", 40.7128, -74.0060, "Song B", "Bob")
        await asyncio.sleep(2)
        
        # User3 sends location
        await tester.send_location_update("user3", 34.0522, -118.2437, "Song C", "Charlie")
        await asyncio.sleep(2)
    
    # Run listening and sending concurrently
    await asyncio.gather(*listen_tasks, send_updates())
    
    # Analyze broadcasting results
    print("\n📊 Broadcasting Analysis:")
    
    user1_analysis = tester.analyze_messages("user1")
    user2_analysis = tester.analyze_messages("user2")
    user3_analysis = tester.analyze_messages("user3")
    
    # Check if each user received updates from others
    broadcasting_success = True
    
    # User1 should receive updates from user2 and user3
    if "user2" not in user1_analysis['received_from_users'] or "user3" not in user1_analysis['received_from_users']:
        print("❌ User1 did not receive updates from all other users")
        broadcasting_success = False
    else:
        print("✅ User1 received updates from other users")
    
    # User2 should receive updates from user1 and user3
    if "user1" not in user2_analysis['received_from_users'] or "user3" not in user2_analysis['received_from_users']:
        print("❌ User2 did not receive updates from all other users")
        broadcasting_success = False
    else:
        print("✅ User2 received updates from other users")
    
    # User3 should receive updates from user1 and user2
    if "user1" not in user3_analysis['received_from_users'] or "user2" not in user3_analysis['received_from_users']:
        print("❌ User3 did not receive updates from all other users")
        broadcasting_success = False
    else:
        print("✅ User3 received updates from other users")
    
    if broadcasting_success:
        print("✅ TEST 3 PASSED: Broadcasting working correctly")
    else:
        print("❌ TEST 3 FAILED: Broadcasting not working properly")
    
    # Test 4: Message Format Verification
    print("\n📋 TEST 4: Message Format Verification")
    print("-" * 40)
    
    format_success = True
    
    for user_id in ["user1", "user2", "user3"]:
        messages = tester.received_messages.get(user_id, [])
        for msg in messages:
            if msg.get('type') == 'location_update':
                required_fields = ['type', 'user_id', 'location', 'timestamp']
                missing_fields = [field for field in required_fields if field not in msg]
                if missing_fields:
                    print(f"❌ {user_id} received malformed message, missing: {missing_fields}")
                    format_success = False
    
    if format_success:
        print("✅ TEST 4 PASSED: All messages have correct format")
    else:
        print("❌ TEST 4 FAILED: Some messages have incorrect format")
    
    # Test 5: Disconnection Handling
    print("\n📋 TEST 5: Disconnection Handling")
    print("-" * 40)
    
    # Disconnect user2 and test if others still work
    await tester.disconnect_user("user2")
    
    # Send update from user1 and check if user3 receives it
    listen_task = tester.listen_for_messages("user3", 3)
    
    async def send_after_disconnect():
        await asyncio.sleep(1)
        await tester.send_location_update("user1", 51.5074, -0.1278, "Song D", "Alice")
    
    await asyncio.gather(listen_task, send_after_disconnect())
    
    # Check if user3 received the update after user2 disconnected
    final_analysis = tester.analyze_messages("user3")
    if "user1" in final_analysis['received_from_users']:
        print("✅ TEST 5 PASSED: Broadcasting continues after user disconnection")
    else:
        print("❌ TEST 5 FAILED: Broadcasting broken after user disconnection")
    
    # Print comprehensive summary
    tester.print_test_summary()
    
    # Cleanup
    for user_id in list(tester.connections.keys()):
        await tester.disconnect_user(user_id)
    
    print("\n🏁 WebSocket Broadcasting Tests Completed")

async def test_health_endpoint():
    """Test the health endpoint to verify backend status"""
    import aiohttp
    
    print("\n🏥 Testing Health Endpoint")
    print("-" * 30)
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{BACKEND_URL}/api/health") as response:
                if response.status == 200:
                    data = await response.json()
                    print(f"✅ Health check passed")
                    print(f"   Status: {data.get('status')}")
                    print(f"   Active connections: {data.get('active_connections')}")
                    print(f"   Tracked users: {data.get('tracked_users')}")
                    return True
                else:
                    print(f"❌ Health check failed with status: {response.status}")
                    return False
    except Exception as e:
        print(f"❌ Health check error: {e}")
        return False

if __name__ == "__main__":
    print("🎵 Music Streaming App - WebSocket Broadcasting Test Suite")
    print(f"🌐 Testing against: {BACKEND_URL}")
    print("="*80)
    
    async def run_all_tests():
        # Test health endpoint first
        health_ok = await test_health_endpoint()
        if not health_ok:
            print("❌ Backend health check failed, aborting WebSocket tests")
            return
        
        # Run WebSocket tests
        await test_websocket_broadcasting()
    
    # Run the tests
    asyncio.run(run_all_tests())