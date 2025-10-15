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
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import Geolocation from 'react-native-geolocation-service';
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
  
  const [region, setRegion] = useState({
    latitude: 20.0, // World view center
    longitude: 0.0,
    latitudeDelta: 180.0, // Show entire world
    longitudeDelta: 360.0,
  });
  
  const [userLocations, setUserLocations] = useState({});
  const [locationEnabled, setLocationEnabled] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [showSongCard, setShowSongCard] = useState(false);
  const [userLocation, setUserLocation] = useState(null);

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
            message: 'Music Navigator needs location access to show you and your friends on the map',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          }
        );
        
        if (granted === PermissionsAndroid.RESULTS.GRANTED) {
          console.log('Location permission granted');
          getCurrentLocation();
        } else {
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
        console.log('Got user location:', latitude, longitude);
        
        const newUserLocation = { latitude, longitude };
        setUserLocation(newUserLocation);
        setLocationEnabled(true);
        
        // Start location sharing
        startLocationSharing();
      },
      (error) => {
        console.error('Geolocation error:', error);
        Alert.alert(
          'Location Error',
          `Unable to get your current location: ${error.message}. Please check your GPS settings.`,
          [{ text: 'OK' }]
        );
      },
      {
        enableHighAccuracy: true,
        timeout: CONFIG.LOCATION_TIMEOUT,
        maximumAge: 10000,
        forceRequestLocation: true,
        showLocationDialog: true,
      }
    );
  };

  const connectWebSocket = () => {
    if (!user?.id) return;
    
    const wsUrl = BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://');
    const fullWsUrl = `${wsUrl}${API_ENDPOINTS.WEBSOCKET}/${user.id}`;
    
    console.log('Connecting to WebSocket:', fullWsUrl);
    
    const ws = new WebSocket(fullWsUrl);
    
    ws.onopen = () => {
      console.log('✅ WebSocket connected');
      setConnectionStatus('Connected');
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('WebSocket message received:', data.type);
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
      
      if (event.code !== 1000) {
        setTimeout(() => {
          console.log('Attempting to reconnect...');
          connectWebSocket();
        }, CONFIG.WS_RECONNECT_INTERVAL);
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
            
            let track = null;
            try {
              const trackResponse = await axios.get(
                `${API}${API_ENDPOINTS.SPOTIFY.CURRENTLY_PLAYING}?access_token=${accessToken}`
              );
              track = trackResponse.data;
              setCurrentTrack(track);
              if (track && !showSongCard) {
                setShowSongCard(true);
              }
            } catch (error) {
              console.log('No track currently playing');
            }
            
            let profileImage = null;
            try {
              const profileResponse = await axios.get(
                `${API}${API_ENDPOINTS.SPOTIFY.ME}?access_token=${accessToken}`
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
            
            console.log('Sharing location data');
            
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
    
    shareLocation();
    const intervalId = setInterval(shareLocation, CONFIG.LOCATION_UPDATE_INTERVAL);
    
    return () => clearInterval(intervalId);
  };

  const toggleLocationSharing = () => {
    if (locationEnabled) {
      setLocationEnabled(false);
    } else {
      requestLocationPermission();
    }
  };

  const centerOnUser = () => {
    if (userLocation && mapRef.current) {
      const newRegion = {
        ...userLocation,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
      mapRef.current.animateToRegion(newRegion, 1000);
    }
  };

  const showAllUsers = () => {
    const locations = Object.values(userLocations);
    if (locations.length > 0 && mapRef.current) {
      const coordinates = locations.map(loc => ({
        latitude: loc.lat,
        longitude: loc.lng
      }));
      
      mapRef.current.fitToCoordinates(coordinates, {
        edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
        animated: true,
      });
    }
  };

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'Connected': return '#1DB954';
      case 'Error': return '#FF4444';
      default: return '#FFA500';
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
              size={18} 
              color={"#fff"} 
            />
          </View>
          
          {location.current_track && (
            <View style={styles.songBubble}>
              <Text style={styles.songBubbleText} numberOfLines={1}>
                🎵 {location.current_track.name}
              </Text>
            </View>
          )}
        </Marker>
      );
    });
  };

  return (
    <LinearGradient
      colors={['#191414', '#0d0d0d']}
      style={styles.container}
    >
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <GlassCard style={styles.headerButton}>
            <Icon name="arrow-back" size={24} color="#fff" />
          </GlassCard>
        </TouchableOpacity>
        
        <View style={styles.headerTitle}>
          <Text style={styles.headerTitleText}>Global Music Map</Text>
        </View>
        
        <TouchableOpacity onPress={showAllUsers} style={styles.headerButton}>
          <GlassCard style={styles.headerButton}>
            <Icon name="zoom-out-map" size={20} color="#1DB954" />
          </GlassCard>
        </TouchableOpacity>
      </View>

      {/* Status Card */}
      <View style={styles.statusContainer}>
        <GlassCard style={styles.statusCard}>
          <View style={styles.statusContent}>
            <View style={styles.statusItem}>
              <View style={[styles.statusDot, { backgroundColor: getConnectionStatusColor() }]} />
              <Text style={styles.statusText}>{connectionStatus}</Text>
            </View>
            <View style={styles.statusDivider} />
            <View style={styles.statusItem}>
              <Icon name="people" size={16} color="#1DB954" />
              <Text style={styles.statusText}>{Object.keys(userLocations).length} Users Online</Text>
            </View>
          </View>
        </GlassCard>
      </View>

      {/* Map */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={styles.map}
          initialRegion={region}
          showsUserLocation={false}
          showsMyLocationButton={false}
          zoomEnabled={true}
          scrollEnabled={true}
          pitchEnabled={true}
          rotateEnabled={true}
          loadingEnabled={true}
          customMapStyle={mapStyle}
          onRegionChangeComplete={setRegion}
        >
          {renderMarkers()}
        </MapView>
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <View style={styles.controlRow}>
          <TouchableOpacity
            style={styles.controlButton}
            onPress={toggleLocationSharing}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={locationEnabled ? ['#1ED760', '#1DB954'] : ['#666', '#555']}
              style={styles.controlButtonGradient}
            >
              <Icon
                name={locationEnabled ? 'location-on' : 'location-off'}
                size={18}
                color="#fff"
              />
              <Text style={styles.controlButtonText}>
                {locationEnabled ? 'Sharing' : 'Share Location'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.controlButton, styles.centerButton]}
            onPress={centerOnUser}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={['#333', '#555']}
              style={styles.controlButtonGradient}
            >
              <Icon name="my-location" size={18} color="#1DB954" />
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>

      {/* Song Card */}
      {showSongCard && currentTrack && (
        <SongCard
          track={currentTrack}
          isPlaying={true}
          onClose={() => setShowSongCard(false)}
        />
      )}
    </LinearGradient>
  );
};

// Dark map style for better UI
const mapStyle = [
  {
    elementType: 'geometry',
    stylers: [{ color: '#212121' }],
  },
  {
    elementType: 'labels.icon',
    stylers: [{ visibility: 'off' }],
  },
  {
    elementType: 'labels.text.fill',
    stylers: [{ color: '#757575' }],
  },
  {
    elementType: 'labels.text.stroke',
    stylers: [{ color: '#212121' }],
  },
  {
    featureType: 'administrative',
    elementType: 'geometry',
    stylers: [{ color: '#757575' }],
  },
  {
    featureType: 'administrative.country',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#9e9e9e' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#000000' }],
  },
  {
    featureType: 'water',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#3d3d3d' }],
  },
];

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: StatusBar.currentHeight + 16,
    paddingBottom: 16,
  },
  backButton: {
    width: 44,
    height: 44,
  },
  headerButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitleText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  statusContainer: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  statusCard: {
    minHeight: 50,
  },
  statusContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  statusItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusText: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '500',
  },
  statusDivider: {
    width: 1,
    height: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  mapContainer: {
    flex: 1,
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 20,
    overflow: 'hidden',
  },
  map: {
    flex: 1,
  },
  markerContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#fff',
  },
  currentUserMarker: {
    backgroundColor: '#1DB954',
  },
  otherUserMarker: {
    backgroundColor: '#FF6B6B',
  },
  songBubble: {
    position: 'absolute',
    top: -35,
    left: -60,
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    minWidth: 120,
    maxWidth: 200,
  },
  songBubbleText: {
    color: '#1DB954',
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },
  controls: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  controlButton: {
    flex: 1,
    borderRadius: 22,
    overflow: 'hidden',
    marginRight: 8,
  },
  centerButton: {
    flex: 0,
    width: 44,
    marginRight: 0,
  },
  controlButtonGradient: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
  },
});

export default MapScreen;