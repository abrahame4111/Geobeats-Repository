import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  PermissionsAndroid,
  Platform,
  Dimensions,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import Geolocation from '@react-native-community/geolocation';
import LinearGradient from 'react-native-linear-gradient';
import { useAuth } from '../context/AuthContext';
import GlassCard from '../components/GlassCard';
import SongCard from '../components/SongCard';
import Icon from 'react-native-vector-icons/MaterialIcons';
import axios from 'axios';
import { CONFIG, API_ENDPOINTS } from '../config/config';

const { width, height } = Dimensions.get('window');

const MapScreen = ({ navigation }) => {
  const { user, accessToken, API, BACKEND_URL } = useAuth();
  const mapRef = useRef(null);
  const wsRef = useRef(null);
  const locationWatchId = useRef(null);
  
  // State
  const [region, setRegion] = useState({
    latitude: 20.0,
    longitude: 0.0,
    latitudeDelta: 100,
    longitudeDelta: 100,
  });
  
  const [userLocations, setUserLocations] = useState({});
  const [myLocation, setMyLocation] = useState(null);
  const [locationPermission, setLocationPermission] = useState(false);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [showSongCard, setShowSongCard] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);

  // Initialize
  useEffect(() => {
    initializeMap();
    
    return () => {
      cleanup();
    };
  }, []);

  const cleanup = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    if (locationWatchId.current) {
      Geolocation.clearWatch(locationWatchId.current);
    }
  };

  const initializeMap = async () => {
    const hasPermission = await requestLocationPermission();
    if (hasPermission) {
      startLocationTracking();
      connectWebSocket();
    }
  };

  // ============ LOCATION HANDLING ============

  const requestLocationPermission = async () => {
    if (Platform.OS === 'ios') {
      Geolocation.requestAuthorization('whenInUse');
      setLocationPermission(true);
      return true;
    }

    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Location Permission',
          message: 'Music Navigator needs your location to show you on the map',
          buttonPositive: 'Allow',
          buttonNegative: 'Deny',
        }
      );

      const hasPermission = granted === PermissionsAndroid.RESULTS.GRANTED;
      setLocationPermission(hasPermission);
      
      if (!hasPermission) {
        Alert.alert(
          'Permission Required',
          'Location permission is needed to use the map feature',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Try Again', onPress: requestLocationPermission }
          ]
        );
      }
      
      return hasPermission;
    } catch (error) {
      console.error('Permission error:', error);
      return false;
    }
  };

  const startLocationTracking = () => {
    setLoadingLocation(true);
    
    // Get initial position
    Geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        console.log('📍 Got initial location:', latitude, longitude);
        
        const newLocation = { latitude, longitude };
        setMyLocation(newLocation);
        
        // Center map on user
        centerOnLocation(newLocation);
        
        // Send to WebSocket
        sendLocationUpdate(newLocation);
        
        setLoadingLocation(false);
      },
      (error) => {
        console.error('Location error:', error);
        setLoadingLocation(false);
        
        // Show user-friendly error
        let errorMessage = 'Unable to get your location. ';
        switch (error.code) {
          case 1:
            errorMessage += 'Please enable location permissions in settings.';
            break;
          case 2:
            errorMessage += 'Location services unavailable.';
            break;
          case 3:
            errorMessage += 'Request timed out. Make sure GPS is enabled.';
            break;
          default:
            errorMessage += 'Please check your location settings.';
        }
        
        Alert.alert('Location Error', errorMessage, [
          { text: 'Cancel' },
          { text: 'Retry', onPress: startLocationTracking }
        ]);
      },
      {
        enableHighAccuracy: false, // Use network location first (faster)
        timeout: 15000,
        maximumAge: 10000,
      }
    );

    // Watch position for continuous updates
    locationWatchId.current = Geolocation.watchPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        console.log('📍 Location update:', latitude, longitude);
        
        const newLocation = { latitude, longitude };
        setMyLocation(newLocation);
        sendLocationUpdate(newLocation);
      },
      (error) => {
        console.error('Watch position error:', error);
      },
      {
        enableHighAccuracy: true,
        distanceFilter: 50, // Update every 50 meters
        interval: 10000, // Check every 10 seconds
        fastestInterval: 5000,
      }
    );
  };

  const centerOnLocation = (location, zoom = 0.05) => {
    if (mapRef.current && location) {
      mapRef.current.animateToRegion({
        latitude: location.latitude,
        longitude: location.longitude,
        latitudeDelta: zoom,
        longitudeDelta: zoom,
      }, 1000);
    }
  };

  const centerOnMe = () => {
    if (myLocation) {
      centerOnLocation(myLocation, 0.01);
    } else {
      Alert.alert('Location Not Available', 'Trying to get your location...', [
        { text: 'OK', onPress: startLocationTracking }
      ]);
    }
  };

  const showAllUsers = () => {
    const allLocations = [...Object.values(userLocations)];
    if (myLocation) {
      allLocations.push(myLocation);
    }

    if (allLocations.length === 0) {
      Alert.alert('No Locations', 'No user locations available yet');
      return;
    }

    if (allLocations.length === 1) {
      centerOnLocation(allLocations[0]);
      return;
    }

    // Calculate bounding box
    const lats = allLocations.map(l => l.latitude);
    const lngs = allLocations.map(l => l.longitude);
    
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    
    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;
    const latDelta = (maxLat - minLat) * 1.5; // Add padding
    const lngDelta = (maxLng - minLng) * 1.5;

    mapRef.current?.animateToRegion({
      latitude: centerLat,
      longitude: centerLng,
      latitudeDelta: Math.max(latDelta, 0.01),
      longitudeDelta: Math.max(lngDelta, 0.01),
    }, 1000);
  };

  // ============ WEBSOCKET HANDLING ============

  const connectWebSocket = () => {
    if (!user?.id) {
      console.log('No user ID, skipping WebSocket');
      return;
    }

    try {
      const wsUrl = BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://');
      const fullWsUrl = `${wsUrl}${API_ENDPOINTS.WEBSOCKET}/${user.id}`;
      
      console.log('🔌 Connecting to WebSocket:', fullWsUrl);
      
      wsRef.current = new WebSocket(fullWsUrl);

      wsRef.current.onopen = () => {
        console.log('✅ WebSocket connected');
        setConnectionStatus('connected');
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('📨 WebSocket message:', data.type);
          
          if (data.type === 'location_update') {
            handleLocationUpdate(data);
          } else if (data.type === 'initial_locations') {
            handleInitialLocations(data);
          }
        } catch (error) {
          console.error('WebSocket message error:', error);
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        setConnectionStatus('error');
      };

      wsRef.current.onclose = () => {
        console.log('🔌 WebSocket closed');
        setConnectionStatus('disconnected');
        
        // Attempt reconnection after 5 seconds
        setTimeout(() => {
          if (user?.id) {
            console.log('🔄 Attempting to reconnect...');
            connectWebSocket();
          }
        }, 5000);
      };
    } catch (error) {
      console.error('WebSocket connection error:', error);
      setConnectionStatus('error');
    }
  };

  const sendLocationUpdate = (location) => {
    if (wsRef.current?.readyState === WebSocket.OPEN && user) {
      const message = JSON.stringify({
        type: 'location_update',
        user_id: user.id,
        user_name: user.name || 'Unknown',
        latitude: location.latitude,
        longitude: location.longitude,
        current_song: currentTrack?.name || null,
      });
      
      wsRef.current.send(message);
      console.log('📤 Sent location update');
    }
  };

  const handleLocationUpdate = (data) => {
    const { user_id, location } = data;
    if (user_id !== user?.id) {
      setUserLocations(prev => ({
        ...prev,
        [user_id]: {
          ...location,
          user_id,
        }
      }));
    }
  };

  const handleInitialLocations = (data) => {
    console.log('📍 Received initial locations:', Object.keys(data.locations).length);
    const filteredLocations = {};
    
    Object.entries(data.locations).forEach(([userId, location]) => {
      if (userId !== user?.id) {
        filteredLocations[userId] = location;
      }
    });
    
    setUserLocations(filteredLocations);
  };

  // ============ SPOTIFY INTEGRATION ============

  useEffect(() => {
    if (accessToken) {
      fetchCurrentTrack();
      const interval = setInterval(fetchCurrentTrack, 10000);
      return () => clearInterval(interval);
    }
  }, [accessToken]);

  const fetchCurrentTrack = async () => {
    try {
      const response = await axios.get(`${API}${API_ENDPOINTS.SPOTIFY.CURRENTLY_PLAYING}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      if (response.data && response.data.item) {
        setCurrentTrack(response.data.item);
      }
    } catch (error) {
      // Silently fail - Spotify endpoint might not be available or no song playing
      // Only log in development mode
      if (__DEV__) {
        console.log('Spotify track fetch failed (this is OK if no song is playing)');
      }
    }
  };

  // ============ RENDER ============

  const renderMarker = (location, userId, isMe = false) => {
    return (
      <Marker
        key={userId}
        coordinate={{
          latitude: location.latitude,
          longitude: location.longitude,
        }}
        onPress={() => {
          setSelectedUser(isMe ? null : location);
          setShowSongCard(true);
        }}
      >
        <View style={styles.markerContainer}>
          <View style={[styles.marker, isMe && styles.myMarker]}>
            <Icon 
              name={isMe ? "my-location" : "person-pin-circle"} 
              size={isMe ? 24 : 20} 
              color="#fff" 
            />
          </View>
          {location.user_name && (
            <View style={styles.markerLabel}>
              <Text style={styles.markerText} numberOfLines={1}>
                {location.user_name}
              </Text>
            </View>
          )}
        </View>
      </Marker>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      
      {/* Map */}
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={region}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={true}
        scrollEnabled={true}
        zoomEnabled={true}
        rotateEnabled={true}
        pitchEnabled={true}
      >
        {/* Render my location */}
        {myLocation && renderMarker({ ...myLocation, user_name: user?.name || 'Me' }, user?.id, true)}
        
        {/* Render other users */}
        {Object.entries(userLocations).map(([userId, location]) => 
          renderMarker(location, userId, false)
        )}
      </MapView>

      {/* Top Bar */}
      <LinearGradient
        colors={['rgba(25, 20, 20, 0.95)', 'rgba(25, 20, 20, 0.7)', 'transparent']}
        style={styles.topBar}
      >
        <GlassCard style={styles.topCard}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Icon name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          
          <View style={styles.topInfo}>
            <Text style={styles.topTitle}>Live Map</Text>
            <View style={styles.statusContainer}>
              <View style={[styles.statusDot, connectionStatus === 'connected' && styles.statusConnected]} />
              <Text style={styles.statusText}>
                {Object.keys(userLocations).length} friends online
              </Text>
            </View>
          </View>
        </GlassCard>
      </LinearGradient>

      {/* Control Buttons */}
      <View style={styles.controls}>
        <TouchableOpacity onPress={centerOnMe} style={styles.controlButton}>
          <GlassCard style={styles.controlCard}>
            {loadingLocation ? (
              <ActivityIndicator size="small" color="#1DB954" />
            ) : (
              <Icon name="my-location" size={24} color={myLocation ? "#1DB954" : "#888"} />
            )}
          </GlassCard>
        </TouchableOpacity>

        <TouchableOpacity onPress={showAllUsers} style={styles.controlButton}>
          <GlassCard style={styles.controlCard}>
            <Icon name="people" size={24} color="#1DB954" />
          </GlassCard>
        </TouchableOpacity>

        {!locationPermission && (
          <TouchableOpacity onPress={requestLocationPermission} style={styles.controlButton}>
            <GlassCard style={styles.controlCard}>
              <Icon name="location-off" size={24} color="#ff4444" />
            </GlassCard>
          </TouchableOpacity>
        )}
      </View>

      {/* Song Card */}
      {showSongCard && currentTrack && (
        <View style={styles.songCardContainer}>
          <SongCard
            track={currentTrack}
            onClose={() => setShowSongCard(false)}
          />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  map: {
    flex: 1,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: StatusBar.currentHeight + 10,
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  topCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  backButton: {
    padding: 8,
    marginRight: 12,
  },
  topInfo: {
    flex: 1,
  },
  topTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#666',
    marginRight: 6,
  },
  statusConnected: {
    backgroundColor: '#1DB954',
  },
  statusText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  controls: {
    position: 'absolute',
    right: 16,
    bottom: 100,
    gap: 12,
  },
  controlButton: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  controlCard: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  markerContainer: {
    alignItems: 'center',
  },
  marker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1DB954',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  myMarker: {
    backgroundColor: '#4169E1',
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  markerLabel: {
    marginTop: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    maxWidth: 100,
  },
  markerText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },
  songCardContainer: {
    position: 'absolute',
    bottom: 20,
    left: 16,
    right: 16,
  },
});

export default MapScreen;
