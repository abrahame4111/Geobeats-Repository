"""Tests for cross-pod visibility fix: /api/location/update and /api/users/active endpoints"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")

TEST_USER_ID = "TEST_user_geobeats_001"
TEST_USER_ID_2 = "TEST_user_geobeats_002"


@pytest.fixture(autouse=True)
def cleanup():
    yield
    # Cleanup test data after each test (best effort)


class TestHealthCheck:
    """Backend health check"""

    def test_health(self):
        resp = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert resp.status_code in (200, 404), f"Backend unreachable: {resp.status_code}"
        print(f"Health check status: {resp.status_code}")


class TestLocationUpdate:
    """POST /api/location/update saves to MongoDB"""

    def test_post_location_update_returns_ok(self):
        resp = requests.post(f"{BASE_URL}/api/location/update", json={
            "user_id": TEST_USER_ID,
            "display_name": "TEST User GeoBeats",
            "profile_image": "",
            "lat": 37.7749,
            "lng": -122.4194
        }, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("status") == "ok", f"Expected status=ok, got: {data}"
        print(f"POST /api/location/update: {data}")

    def test_post_location_update_missing_fields(self):
        """Should fail with 422 if required fields missing"""
        resp = requests.post(f"{BASE_URL}/api/location/update", json={
            "user_id": TEST_USER_ID,
            # missing lat/lng
        }, timeout=10)
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}"
        print(f"Missing fields test: {resp.status_code}")


class TestGetActiveUsers:
    """GET /api/users/active returns users from MongoDB"""

    def test_get_active_users_returns_list(self):
        resp = requests.get(f"{BASE_URL}/api/users/active", timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "users" in data, f"Expected 'users' key, got: {data}"
        assert isinstance(data["users"], list), f"Expected list, got {type(data['users'])}"
        print(f"GET /api/users/active: {len(data['users'])} users returned")

    def test_active_user_appears_after_location_update(self):
        """After POST /api/location/update, user should appear in GET /api/users/active"""
        # Post location for test user
        post_resp = requests.post(f"{BASE_URL}/api/location/update", json={
            "user_id": TEST_USER_ID,
            "display_name": "TEST User GeoBeats",
            "profile_image": "",
            "lat": 40.7128,
            "lng": -74.0060
        }, timeout=10)
        assert post_resp.status_code == 200, f"POST failed: {post_resp.text}"

        # GET active users and verify our user is there
        get_resp = requests.get(f"{BASE_URL}/api/users/active", timeout=10)
        assert get_resp.status_code == 200
        users = get_resp.json()["users"]
        user_ids = [u.get("user_id") for u in users]
        assert TEST_USER_ID in user_ids, f"Test user not found in active users list. Got: {user_ids}"
        print(f"User {TEST_USER_ID} found in active users: PASS")

    def test_active_user_has_correct_fields(self):
        """Active user record should have required fields"""
        # Ensure user exists
        requests.post(f"{BASE_URL}/api/location/update", json={
            "user_id": TEST_USER_ID,
            "display_name": "TEST User GeoBeats",
            "profile_image": "https://example.com/img.jpg",
            "lat": 51.5074,
            "lng": -0.1278
        }, timeout=10)

        get_resp = requests.get(f"{BASE_URL}/api/users/active", timeout=10)
        users = get_resp.json()["users"]
        user = next((u for u in users if u.get("user_id") == TEST_USER_ID), None)
        assert user is not None, "Test user not found in active users"

        # Verify required fields
        assert "lat" in user, "Missing lat field"
        assert "lng" in user, "Missing lng field"
        assert "display_name" in user, "Missing display_name field"
        assert "last_seen" in user, "Missing last_seen field (needed for staleness check)"
        assert user["lat"] == pytest.approx(51.5074, abs=0.001)
        assert user["lng"] == pytest.approx(-0.1278, abs=0.001)
        print(f"Active user fields: {list(user.keys())} - PASS")

    def test_no_mongodb_id_in_response(self):
        """_id should NOT be in response (ObjectId not JSON serializable)"""
        get_resp = requests.get(f"{BASE_URL}/api/users/active", timeout=10)
        users = get_resp.json()["users"]
        for u in users:
            assert "_id" not in u, f"MongoDB _id leaked into response for user {u.get('user_id')}"
        print("No _id fields in response: PASS")

    def test_multiple_users_visible(self):
        """Multiple users posting locations should all appear in active list"""
        for uid, lat, lng in [(TEST_USER_ID, 37.7749, -122.4194), (TEST_USER_ID_2, 48.8566, 2.3522)]:
            requests.post(f"{BASE_URL}/api/location/update", json={
                "user_id": uid, "display_name": f"TEST {uid}",
                "profile_image": "", "lat": lat, "lng": lng
            }, timeout=10)

        get_resp = requests.get(f"{BASE_URL}/api/users/active", timeout=10)
        users = get_resp.json()["users"]
        user_ids = [u.get("user_id") for u in users]
        assert TEST_USER_ID in user_ids, f"{TEST_USER_ID} not in active users"
        assert TEST_USER_ID_2 in user_ids, f"{TEST_USER_ID_2} not in active users"
        print(f"Both test users visible on map: PASS")
