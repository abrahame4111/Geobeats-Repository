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
  Image,
  Animated,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import Geolocation from '@react-native-community/geolocation';
import LinearGradient from 'react-native-linear-gradient';
import { useAuth } from '../context/AuthContext';
import Icon from 'react-native-vector-icons/MaterialIcons';
import axios from 'axios';
import { CONFIG, API_ENDPOINTS } from '../config/config';

const { width, height } = Dimensions.get('window');

const MapScreen = ({ navigation }) => {
  const { user, accessToken, API, BACKEND_URL } = useAuth();
  
  // Refs
  const mapRef = useRef(null);
  const wsRef = useRef(null);
  const locationWatchId = useRef(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  
  // Map State
  const [region, setRegion] = useState({
    latitude: 20.0,
    longitude: 0.0,
    latitudeDelta: 100,
    longitudeDelta: 100,
  });
  const [mapType, setMapType] = useState('standard');
  
  // Location State
  const [myLocation, setMyLocation] = useState(null);
  const [userLocations, setUserLocations] = useState({});
  const [locationPermission, setLocationPermission] = useState(false);
  const [loadingLocation, setLoadingLocation] = useState(false);
  
  // Spotify State
  const [currentTrack, setCurrentTrack] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  
  // Connection State
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [onlineCount, setOnlineCount] = useState(0);
  
  // UI State
  const [showMapTypeMenu, setShowMapTypeMenu] = useState(false);

  // ============ INITIALIZATION ============
  
  useEffect(() => {
    initializeApp();
    startPulseAnimation();
    
    return cleanup;
  }, []);

  const initializeApp = async () => {
    const hasPermission = await requestLocationPermission();
    if (hasPermission) {
      startLocationTracking();
      connectWebSocket();
    }
    
    if (accessToken) {
      fetchUserProfile();
      fetchCurrentTrack();
      const interval = setInterval(fetchCurrentTrack, 10000);
      return () => clearInterval(interval);
    }
  };

  const cleanup = () => {
    if (wsRef.current) wsRef.current.close();
    if (locationWatchId.current) Geolocation.clearWatch(locationWatchId.current);
  };

  const startPulseAnimation = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.2,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();
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
          title: 'Location Access Required',
          message: 'Music Navigator needs your location to show you and your friends on the map',
          buttonPositive: 'Allow',
          buttonNegative: 'Deny',
        }
      );

      const hasPermission = granted === PermissionsAndroid.RESULTS.GRANTED;
      setLocationPermission(hasPermission);
      
      if (!hasPermission) {
        Alert.alert(
          'Permission Required',
          'Location permission is needed to use the live map feature',
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
    
    Geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        console.log('📍 Initial location:', latitude, longitude);
        
        const newLocation = { latitude, longitude };
        setMyLocation(newLocation);
        centerOnLocation(newLocation);
        sendLocationUpdate(newLocation);
        setLoadingLocation(false);
      },
      (error) => {
        console.error('Location error:', error);
        setLoadingLocation(false);
        showLocationError(error.code);
      },
      {
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 10000,
      }
    );

    locationWatchId.current = Geolocation.watchPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const newLocation = { latitude, longitude };
        setMyLocation(newLocation);
        sendLocationUpdate(newLocation);
      },
      (error) => console.error('Watch error:', error),
      {
        enableHighAccuracy: true,
        distanceFilter: 50,
        interval: 10000,
        fastestInterval: 5000,
      }
    );
  };

  const showLocationError = (errorCode) => {
    const messages = {
      1: 'Please enable location permissions in your device settings.',
      2: 'Location services are unavailable. Please enable GPS.',
      3: 'Location request timed out. Make sure GPS is enabled and you have a clear view of the sky.',
    };
    
    Alert.alert(
      'Location Error',
      messages[errorCode] || 'Unable to get your location. Please check your settings.',
      [
        { text: 'Cancel' },
        { text: 'Retry', onPress: startLocationTracking }
      ]
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
      Alert.alert('Location Unavailable', 'Trying to get your location...', [
        { text: 'OK', onPress: startLocationTracking }
      ]);
    }
  };

  const showAllUsers = () => {
    const allLocations = [...Object.values(userLocations)];
    if (myLocation) allLocations.push(myLocation);

    if (allLocations.length === 0) {
      Alert.alert('No Locations', 'No user locations available yet');
      return;
    }

    if (allLocations.length === 1) {
      centerOnLocation(allLocations[0]);
      return;
    }

    const lats = allLocations.map(l => l.latitude);
    const lngs = allLocations.map(l => l.longitude);
    
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    
    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;
    const latDelta = (maxLat - minLat) * 1.5;
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
    if (!user?.id) return;

    try {
      const wsUrl = BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://');
      const fullWsUrl = `${wsUrl}${API_ENDPOINTS.WEBSOCKET}/${user.id}`;
      
      console.log('🔌 Connecting WebSocket:', fullWsUrl);
      
      wsRef.current = new WebSocket(fullWsUrl);

      wsRef.current.onopen = () => {
        console.log('✅ WebSocket connected');
        setConnectionStatus('connected');
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
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
        
        setTimeout(() => {
          if (user?.id) {
            console.log('🔄 Reconnecting...');
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
        artist: currentTrack?.artists?.[0]?.name || null,
        profile_image: userProfile?.images?.[0]?.url || null,
        timestamp: Date.now(),
      });
      
      wsRef.current.send(message);
      console.log('📤 Location sent with song:', currentTrack?.name || 'No song');
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
          last_seen: Date.now(),
        }
      }));
      setOnlineCount(Object.keys(userLocations).length + 1);
    }
  };

  const handleInitialLocations = (data) => {
    console.log('📍 Initial locations received:', Object.keys(data.locations).length);
    const filteredLocations = {};
    
    Object.entries(data.locations).forEach(([userId, location]) => {
      if (userId !== user?.id) {
        filteredLocations[userId] = {
          ...location,
          last_seen: Date.now(),
        };
      }
    });
    
    setUserLocations(filteredLocations);
    setOnlineCount(Object.keys(filteredLocations).length);
  };

  // ============ SPOTIFY INTEGRATION ============

  const fetchUserProfile = async () => {
    try {
      const response = await axios.get(`${API}${API_ENDPOINTS.SPOTIFY.ME}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      if (response.data) {
        setUserProfile(response.data);
        console.log('✅ Spotify profile loaded:', response.data.display_name);
      }
    } catch (error) {
      if (__DEV__) console.log('Profile fetch failed');
    }
  };

  const fetchCurrentTrack = async () => {
    try {
      const response = await axios.get(`${API}${API_ENDPOINTS.SPOTIFY.CURRENTLY_PLAYING}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      if (response.data && response.data.item) {
        const track = response.data.item;
        setCurrentTrack(track);
        console.log('🎵 Now playing:', track.name);
        
        if (myLocation) {
          sendLocationUpdate(myLocation);
        }
      } else {
        setCurrentTrack(null);
      }
    } catch (error) {
      if (__DEV__) console.log('No song playing');
    }
  };

  // ============ MAP CONTROLS ============

  const MAP_TYPES = [
    { value: 'standard', label: 'Standard', icon: 'map' },
    { value: 'satellite', label: 'Satellite', icon: 'satellite' },
    { value: 'hybrid', label: 'Hybrid', icon: 'layers' },
    { value: 'terrain', label: 'Terrain', icon: 'terrain' },
  ];

  const changeMapType = (type) => {
    setMapType(type);
    setShowMapTypeMenu(false);
    console.log('🗺️ Map type:', type);
  };

  // ============ RENDER MARKER ============

  const renderMarker = (location, userId, isMe = false) => {
    const profileImage = isMe ? userProfile?.images?.[0]?.url : location.profile_image;
    const songName = isMe ? currentTrack?.name : location.current_song;
    const artist = isMe ? currentTrack?.artists?.[0]?.name : location.artist;
    const userName = isMe ? (user?.name || 'Me') : location.user_name;
    
    return (
      <Marker
        key={userId}
        coordinate={{
          latitude: location.latitude,
          longitude: location.longitude,
        }}
        anchor={{ x: 0.5, y: 1 }}
      >
        <View style={styles.markerContainer}>
          {/* Song Bubble */}
          {songName && (
            <Animated.View 
              style={[
                styles.songBubble,
                isMe && { transform: [{ scale: pulseAnim }] }
              ]}
            >
              <LinearGradient
                colors={['#1DB954', '#1ed760']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.songGradient}
              >
                <Icon name="music-note" size={12} color="#fff" />
                <View style={styles.songTextContainer}>
                  <Text style={styles.songText} numberOfLines={1}>{songName}</Text>
                  {artist && <Text style={styles.artistText} numberOfLines={1}>{artist}</Text>}
                </View>
              </LinearGradient>
            </Animated.View>
          )}
          
          {/* Profile Marker */}
          <View style={[styles.markerCircle, isMe && styles.myMarkerCircle]}>
            <View style={styles.markerInner}>
              {profileImage ? (
                <Image 
                  source={{ uri: profileImage }}
                  style={styles.profileImage}
                />
              ) : (
                <LinearGradient
                  colors={isMe ? ['#4169E1', '#1E90FF'] : ['#1DB954', '#1ed760']}
                  style={styles.profilePlaceholder}
                >
                  <Icon 
                    name={isMe ? "person" : "person-outline"} 
                    size={isMe ? 28 : 24} 
                    color="#fff" 
                  />
                </LinearGradient>
              )}
            </View>
          </View>
          
          {/* Username Badge */}
          <View style={[styles.nameBadge, isMe && styles.myNameBadge]}>
            <Text style={styles.nameText} numberOfLines={1}>{userName}</Text>
            {isMe && <Icon name="star" size={10} color="#FFD700" style={styles.starIcon} />}
          </View>
        </View>
      </Marker>
    );
  };

  // ============ MAIN RENDER ============

  return (
    <View style={styles.container}>
      <StatusBar 
        barStyle="light-content" 
        backgroundColor="transparent" 
        translucent 
      />
      
      {/* Map */}
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        mapType={mapType}
        style={styles.map}
        initialRegion={region}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={true}
        showsScale={true}
        scrollEnabled={true}
        zoomEnabled={true}
        rotateEnabled={true}
        pitchEnabled={true}
      >
        {/* My Location */}
        {myLocation && renderMarker(
          { ...myLocation, user_name: user?.name || 'Me' }, 
          user?.id, 
          true
        )}
        
        {/* Other Users */}
        {Object.entries(userLocations).map(([userId, location]) => 
          renderMarker(location, userId, false)
        )}
      </MapView>

      {/* Modern Top Bar */}
      <View style={styles.topBarContainer}>
        <LinearGradient
          colors={['rgba(0, 0, 0, 0.8)', 'rgba(0, 0, 0, 0.4)', 'transparent']}
          style={styles.topGradient}
        >
          <View style={styles.topBar}>
            {/* Left Section */}
            <View style={styles.topLeft}>
              <TouchableOpacity 
                onPress={() => navigation.navigate('Home')} 
                style={styles.topButton}
                activeOpacity={0.7}
              >
                <LinearGradient
                  colors={['#1DB954', '#1ed760']}
                  style={styles.homeButton}
                >
                  <Icon name="home" size={22} color="#fff" />
                </LinearGradient>
              </TouchableOpacity>
              
              <TouchableOpacity 
                onPress={() => navigation.goBack()} 
                style={styles.topButton}
                activeOpacity={0.7}
              >
                <View style={styles.backButton}>
                  <Icon name="arrow-back" size={22} color="#fff" />
                </View>
              </TouchableOpacity>
            </View>
            
            {/* Center Section */}
            <View style={styles.topCenter}>
              <Text style={styles.topTitle}>Live Map</Text>
              <View style={styles.statusRow}>
                <Animated.View 
                  style={[
                    styles.statusDot, 
                    connectionStatus === 'connected' && styles.statusConnected,
                    connectionStatus === 'connected' && { 
                      transform: [{ scale: pulseAnim }] 
                    }
                  ]} 
                />
                <Text style={styles.statusText}>
                  {onlineCount} {onlineCount === 1 ? 'friend' : 'friends'} • {connectionStatus}
                </Text>
              </View>
            </View>
            
            {/* Right Section */}
            <TouchableOpacity 
              onPress={() => setShowMapTypeMenu(!showMapTypeMenu)} 
              style={styles.topButton}
              activeOpacity={0.7}
            >
              <View style={styles.layersButton}>
                <Icon name="layers" size={22} color="#1DB954" />
              </View>
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </View>

      {/* Map Type Menu */}
      {showMapTypeMenu && (
        <View style={styles.mapTypeMenu}>
          <LinearGradient
            colors={['rgba(20, 20, 20, 0.98)', 'rgba(30, 30, 30, 0.95)']}
            style={styles.mapTypeGradient}
          >
            <Text style={styles.mapTypeTitle}>Map Style</Text>
            {MAP_TYPES.map((type) => (
              <TouchableOpacity
                key={type.value}
                onPress={() => changeMapType(type.value)}
                style={[
                  styles.mapTypeOption,
                  mapType === type.value && styles.mapTypeOptionActive
                ]}
                activeOpacity={0.7}
              >
                <Icon 
                  name={type.icon} 
                  size={20} 
                  color={mapType === type.value ? '#1DB954' : '#fff'} 
                />
                <Text style={[
                  styles.mapTypeLabel,
                  mapType === type.value && styles.mapTypeLabelActive
                ]}>
                  {type.label}
                </Text>
                {mapType === type.value && (
                  <Icon name="check-circle" size={18} color="#1DB954" />
                )}
              </TouchableOpacity>
            ))}
          </LinearGradient>
        </View>
      )}

      {/* Floating Controls */}
      <View style={styles.floatingControls}>
        {/* Center on Me */}
        <TouchableOpacity 
          onPress={centerOnMe} 
          style={styles.controlButton}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={myLocation ? ['#1DB954', '#1ed760'] : ['#333', '#444']}
            style={styles.controlGradient}
          >
            {loadingLocation ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Icon 
                name="my-location" 
                size={24} 
                color="#fff" 
              />
            )}
          </LinearGradient>
        </TouchableOpacity>

        {/* Show All Users */}
        <TouchableOpacity 
          onPress={showAllUsers} 
          style={styles.controlButton}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={['#1DB954', '#1ed760']}
            style={styles.controlGradient}
          >
            <Icon name="people" size={24} color="#fff" />
          </LinearGradient>
        </TouchableOpacity>

        {/* Permission Warning */}
        {!locationPermission && (
          <TouchableOpacity 
            onPress={requestLocationPermission} 
            style={styles.controlButton}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={['#ff4444', '#cc0000']}
              style={styles.controlGradient}
            >
              <Icon name="location-off" size={24} color="#fff" />
            </LinearGradient>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

// ============ STYLES ============

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  map: {
    flex: 1,
  },
  
  // ========== TOP BAR ==========
  topBarContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  topGradient: {
    paddingTop: StatusBar.currentHeight + 10,
    paddingBottom: 20,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  topLeft: {
    flexDirection: 'row',
    gap: 10,
  },
  topButton: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  homeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  layersButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  topCenter: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 12,
  },
  topTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.5,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
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
    shadowColor: '#1DB954',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  statusText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: '600',
  },
  
  // ========== MAP TYPE MENU ==========
  mapTypeMenu: {
    position: 'absolute',
    top: StatusBar.currentHeight + 70,
    right: 16,
    width: 180,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  mapTypeGradient: {
    padding: 8,
  },
  mapTypeTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    marginLeft: 12,
  },
  mapTypeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    marginBottom: 4,
  },
  mapTypeOptionActive: {
    backgroundColor: 'rgba(29, 185, 84, 0.2)',
  },
  mapTypeLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    marginLeft: 12,
  },
  mapTypeLabelActive: {
    color: '#1DB954',
  },
  
  // ========== FLOATING CONTROLS ==========
  floatingControls: {
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
  controlGradient: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  // ========== MARKERS ==========
  markerContainer: {
    alignItems: 'center',
    width: 140,
  },
  songBubble: {
    marginBottom: 8,
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
    maxWidth: 140,
  },
  songGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    gap: 6,
  },
  songTextContainer: {
    flex: 1,
  },
  songText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  artistText: {
    fontSize: 9,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.8)',
    marginTop: 1,
  },
  markerCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 8,
  },
  myMarkerCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 3,
    borderColor: '#4169E1',
  },
  markerInner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
  },
  profileImage: {
    width: '100%',
    height: '100%',
  },
  profilePlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  nameBadge: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: 100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  myNameBadge: {
    backgroundColor: 'rgba(65, 105, 225, 0.9)',
  },
  nameText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  starIcon: {
    marginLeft: 4,
  },
});

export default MapScreen;
