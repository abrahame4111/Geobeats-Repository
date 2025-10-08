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
} from 'react-native';
// import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import Geolocation from 'react-native-geolocation-service';
import { useAuth } from '../context/AuthContext';
import Icon from 'react-native-vector-icons/MaterialIcons';
import axios from 'axios';

const { width, height } = Dimensions.get('window');

const MapScreen = ({ navigation }) => {
  const { user, accessToken, API, BACKEND_URL } = useAuth();
  const mapRef = useRef(null);
  const wsRef = useRef(null);
  
  const [region, setRegion] = useState({
    latitude: 37.78825,
    longitude: -122.4324,
    latitudeDelta: 0.0922,
    longitudeDelta: 0.0421,
  });
  
  const [userLocations, setUserLocations] = useState({});
  const [locationEnabled, setLocationEnabled] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');

  useEffect(() => {
    requestLocationPermission();
    connectWebSocket();
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const requestLocationPermission = async () => {
    try {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title: 'Location Access Required',
            message: 'This app needs to access your location to show you on the map',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          }
        );
        
        if (granted === PermissionsAndroid.RESULTS.GRANTED) {
          console.log('Location permission granted');
          getCurrentLocation();
        } else {
          console.log('Location permission denied');
          Alert.alert(
            'Location Permission Required',
            'Please enable location permission in settings to use this feature',
            [{ text: 'OK' }]
          );
        }
      } else {
        getCurrentLocation();
      }
    } catch (error) {
      console.error('Error requesting location permission:', error);
    }
  };

  const getCurrentLocation = () => {
    Geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        console.log('Got location:', latitude, longitude);
        
        const newRegion = {
          latitude,
          longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        };
        
        setRegion(newRegion);
        setLocationEnabled(true);
        
        if (mapRef.current) {
          mapRef.current.animateToRegion(newRegion, 1000);
        }
        
        // Start location sharing
        startLocationSharing();
      },
      (error) => {
        console.error('Geolocation error:', error);
        Alert.alert(
          'Location Error',
          'Unable to get your current location. Please check your GPS settings.',
          [{ text: 'OK' }]
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 10000,
      }
    );
  };

  const connectWebSocket = () => {
    if (!user?.id) return;
    
    const wsUrl = BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://');
    const fullWsUrl = `${wsUrl}/api/ws/${user.id}`;
    
    console.log('Connecting to WebSocket:', fullWsUrl);
    
    const ws = new WebSocket(fullWsUrl);
    
    ws.onopen = () => {
      console.log('✅ WebSocket connected');
      setConnectionStatus('Connected');
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('WebSocket message received:', data);
        handleLocationUpdate(data);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };
    
    ws.onerror = (error) => {
      console.error('❌ WebSocket error:', error);
      setConnectionStatus('Error');
    };
    
    ws.onclose = (event) => {
      console.log('WebSocket disconnected. Code:', event.code);
      setConnectionStatus('Disconnected');
      
      // Reconnect after 3 seconds if not intentional
      if (event.code !== 1000) {
        setTimeout(() => {
          console.log('Attempting to reconnect...');
          connectWebSocket();
        }, 3000);
      }
    };
    
    wsRef.current = ws;
  };

  const handleLocationUpdate = (data) => {
    if (data.type === 'initial_locations') {
      console.log('Received initial locations:', Object.keys(data.locations).length);
      setUserLocations(data.locations);
    } else if (data.type === 'location_update') {
      if (data.location.disconnected) {
        setUserLocations(prev => {
          const updated = { ...prev };
          delete updated[data.user_id];
          return updated;
        });
      } else {
        setUserLocations(prev => ({
          ...prev,
          [data.user_id]: data.location,
        }));
      }
    }
  };

  const startLocationSharing = () => {
    const shareLocation = () => {
      Geolocation.getCurrentPosition(
        async (position) => {
          try {
            const { latitude, longitude } = position.coords;
            
            // Get current track
            let track = null;
            try {
              const trackResponse = await axios.get(
                `${API}/spotify/currently-playing?access_token=${accessToken}`
              );
              track = trackResponse.data;
            } catch (error) {
              console.log('No track currently playing');
            }
            
            // Get profile image
            let profileImage = null;
            try {
              const profileResponse = await axios.get(
                `${API}/spotify/me?access_token=${accessToken}`
              );
              profileImage = profileResponse.data.images?.[0]?.url;
            } catch (error) {
              console.log('Could not get profile image');
            }
            
            const locationData = {
              lat: latitude,
              lng: longitude,
              current_track: track,
              profile_image: profileImage || 'https://via.placeholder.com/80?text=User',
              user_name: user?.name || 'User',
              user_id: user?.id,
              timestamp: new Date().toISOString(),
            };
            
            console.log('Sharing location data:', locationData);
            setCurrentTrack(track);
            
            // Send via WebSocket
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify(locationData));
            }
          } catch (error) {
            console.error('Error sharing location:', error);
          }
        },
        (error) => {
          console.error('Location sharing error:', error);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 5000,
        }
      );
    };
    
    // Share location immediately and then every 5 seconds
    shareLocation();
    const intervalId = setInterval(shareLocation, 5000);
    
    return () => clearInterval(intervalId);
  };

  const toggleLocationSharing = () => {
    if (locationEnabled) {
      setLocationEnabled(false);
    } else {
      requestLocationPermission();
    }
  };

  const renderMarkers = () => {
    return Object.entries(userLocations).map(([userId, location]) => {
      if (!location.lat || !location.lng) return null;
      
      const isCurrentUser = userId === user?.id;
      
      return (
        <Marker
          key={userId}
          coordinate={{
            latitude: location.lat,
            longitude: location.lng,
          }}
          title={location.user_name || userId}
          description={location.current_track?.name || 'No music playing'}
        >
          <View style={[
            styles.markerContainer,
            isCurrentUser ? styles.currentUserMarker : styles.otherUserMarker
          ]}>
            <Icon 
              name="person" 
              size={20} 
              color={isCurrentUser ? '#1DB954' : '#fff'} 
            />
          </View>
          
          {location.current_track && (
            <View style={styles.songLabel}>
              <Text style={styles.songText} numberOfLines={1}>
                {location.current_track.name}
              </Text>
            </View>
          )}
        </Marker>
      );
    });
  };

  return (
    <View style={styles.container}>
      {/* Status Bar */}
      <View style={styles.statusBar}>
        <Text style={styles.statusText}>
          Connection: {connectionStatus} | Users: {Object.keys(userLocations).length}
        </Text>
      </View>

      {/* Map Placeholder */}
      <View style={styles.mapPlaceholder}>
        <Text style={styles.placeholderText}>Map View Coming Soon</Text>
        <Text style={styles.placeholderSubText}>
          Location sharing and WebSocket connection working below
        </Text>
        
        {/* Show user locations as list for now */}
        {Object.entries(userLocations).map(([userId, location]) => (
          <View key={userId} style={styles.userLocationItem}>
            <Text style={styles.userLocationText}>
              {location.user_name || userId}: {location.lat?.toFixed(4)}, {location.lng?.toFixed(4)}
            </Text>
            {location.current_track && (
              <Text style={styles.userTrackText}>
                🎵 {location.current_track.name}
              </Text>
            )}
          </View>
        ))}
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={[
            styles.controlButton,
            locationEnabled ? styles.enabledButton : styles.disabledButton
          ]}
          onPress={toggleLocationSharing}
        >
          <Icon
            name={locationEnabled ? 'location-on' : 'location-off'}
            size={24}
            color="#fff"
          />
          <Text style={styles.controlButtonText}>
            {locationEnabled ? 'Sharing Location' : 'Share Location'}
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.controlButton}
          onPress={getCurrentLocation}
        >
          <Icon name="my-location" size={24} color="#fff" />
          <Text style={styles.controlButtonText}>Center on Me</Text>
        </TouchableOpacity>
      </View>

      {/* Current Track Display */}
      {currentTrack && (
        <View style={styles.currentTrack}>
          <Icon name="music-note" size={20} color="#1DB954" />
          <Text style={styles.trackText} numberOfLines={1}>
            Now Playing: {currentTrack.name}
          </Text>
        </View>
      )}
    </View>
  );
};

const mapStyle = [
  {
    elementType: 'geometry',
    stylers: [
      {
        color: '#242f3e',
      },
    ],
  },
  {
    elementType: 'labels.text.fill',
    stylers: [
      {
        color: '#746855',
      },
    ],
  },
  {
    elementType: 'labels.text.stroke',
    stylers: [
      {
        color: '#242f3e',
      },
    ],
  },
];

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#191414',
  },
  statusBar: {
    backgroundColor: '#1DB954',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    textAlign: 'center',
  },
  map: {
    flex: 1,
  },
  markerContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
  },
  currentUserMarker: {
    backgroundColor: '#1DB954',
    borderColor: '#fff',
  },
  otherUserMarker: {
    backgroundColor: '#ff6b6b',
    borderColor: '#fff',
  },
  songLabel: {
    position: 'absolute',
    top: -30,
    left: -50,
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    minWidth: 100,
  },
  songText: {
    color: '#fff',
    fontSize: 10,
    textAlign: 'center',
  },
  controls: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
  },
  controlButton: {
    backgroundColor: '#282828',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  enabledButton: {
    backgroundColor: '#1DB954',
  },
  disabledButton: {
    backgroundColor: '#b3b3b3',
  },
  controlButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  currentTrack: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  trackText: {
    color: '#fff',
    fontSize: 14,
    marginLeft: 8,
    flex: 1,
  },
});

export default MapScreen;