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

// Custom Map Styles
const MAP_STYLES = {
  standard: [],
  neon: [
    { elementType: 'geometry', stylers: [{ color: '#0a0a0a' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#0a0a0a' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#00ffff' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1a1a2e' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#00ffff' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f3443' }] },
    { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#16213e' }] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#0e4749' }] },
  ],
  blue: [
    { elementType: 'geometry', stylers: [{ color: '#1a237e' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#1a237e' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#9fa8da' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#283593' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d47a1' }] },
    { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#1e2a5e' }] },
  ],
  green: [
    { elementType: 'geometry', stylers: [{ color: '#1b5e20' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#1b5e20' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#a5d6a7' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2e7d32' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#004d40' }] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1b5e20' }] },
  ],
  vintage: [
    { elementType: 'geometry', stylers: [{ color: '#ebe3cd' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#523735' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#f5f1e6' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#f5f1e6' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#bbb5a6' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c9c9c9' }] },
    { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#dfd2ae' }] },
  ],
  dark: [
    { elementType: 'geometry', stylers: [{ color: '#212121' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#212121' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#757575' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#383838' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#000000' }] },
  ],
};

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
  const [mapTheme, setMapTheme] = useState('neon');
  
  // Location State
  const [myLocation, setMyLocation] = useState(null);
  const [userLocations, setUserLocations] = useState({});
  const [locationPermission, setLocationPermission] = useState(false);
  const [loadingLocation, setLoadingLocation] = useState(false);
  
  // Sharing State - DEFAULT OFF
  const [shareEnabled, setShareEnabled] = useState(false);
  
  // Spotify State
  const [currentTrack, setCurrentTrack] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  
  // Connection State
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [onlineCount, setOnlineCount] = useState(0);
  
  // UI State
  const [showThemeMenu, setShowThemeMenu] = useState(false);

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
          toValue: 1.15,
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

  // ============ SHARE TOGGLE ============

  const toggleShare = () => {
    const newShareState = !shareEnabled;
    setShareEnabled(newShareState);
    
    if (newShareState) {
      // Just enabled - send location immediately
      if (myLocation) {
        sendLocationUpdate(myLocation);
      }
      Alert.alert(
        '🎵 Sharing Enabled',
        'Your location and listening activity are now visible to friends!',
        [{ text: 'Got it!' }]
      );
    } else {
      // Disabled - send a disconnect message
      sendDisconnectMessage();
      Alert.alert(
        '🔒 Sharing Disabled',
        'Your location is now private. Only you can see yourself on the map.',
        [{ text: 'OK' }]
      );
    }
  };

  const sendDisconnectMessage = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN && user) {
      const message = JSON.stringify({
        type: 'user_disconnect',
        user_id: user.id,
      });
      wsRef.current.send(message);
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
          title: 'Location Access Required',
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
    
    Geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        console.log('📍 Initial location:', latitude, longitude);
        
        const newLocation = { latitude, longitude };
        setMyLocation(newLocation);
        centerOnLocation(newLocation);
        
        // Only send if sharing is enabled
        if (shareEnabled) {
          sendLocationUpdate(newLocation);
        }
        
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
        
        // Only send if sharing is enabled
        if (shareEnabled) {
          sendLocationUpdate(newLocation);
        }
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
      3: 'Location request timed out. Make sure GPS is enabled.',
    };
    
    Alert.alert(
      'Location Error',
      messages[errorCode] || 'Unable to get your location.',
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
          } else if (data.type === 'user_disconnect') {
            handleUserDisconnect(data);
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
    // Only send if sharing is enabled
    if (!shareEnabled) {
      console.log('🔒 Sharing disabled, not sending location');
      return;
    }
    
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
      console.log('📤 Location + song sent:', currentTrack?.name || 'No song');
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

  const handleUserDisconnect = (data) => {
    const { user_id } = data;
    if (user_id !== user?.id) {
      setUserLocations(prev => {
        const updated = { ...prev };
        delete updated[user_id];
        return updated;
      });
      setOnlineCount(prev => Math.max(0, prev - 1));
    }
  };

  // ============ SPOTIFY INTEGRATION ============

  const fetchUserProfile = async () => {
    try {
      console.log('🔍 Fetching Spotify profile from:', `${API}${API_ENDPOINTS.SPOTIFY.ME}`);
      const response = await axios.get(`${API}${API_ENDPOINTS.SPOTIFY.ME}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      if (response.data) {
        setUserProfile(response.data);
        console.log('✅ Spotify profile loaded:', response.data.display_name);
        console.log('📸 Profile image URL:', response.data.images?.[0]?.url || 'No image');
      }
    } catch (error) {
      console.error('❌ Profile fetch error:', error.response?.data || error.message);
      Alert.alert(
        'Spotify Profile Error',
        'Unable to load your Spotify profile. Please check your connection and try again.',
        [{ text: 'OK' }]
      );
    }
  };

  const fetchCurrentTrack = async () => {
    try {
      console.log('🔍 Fetching current track from:', `${API}${API_ENDPOINTS.SPOTIFY.CURRENTLY_PLAYING}`);
      const response = await axios.get(`${API}${API_ENDPOINTS.SPOTIFY.CURRENTLY_PLAYING}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      console.log('📊 Spotify response status:', response.status);
      console.log('📊 Spotify response data:', JSON.stringify(response.data).substring(0, 200));
      
      if (response.data && response.data.item) {
        const track = response.data.item;
        setCurrentTrack(track);
        console.log('🎵 Now playing:', track.name, 'by', track.artists?.[0]?.name);
        
        // If sharing is enabled and we have location, send update
        if (shareEnabled && myLocation) {
          sendLocationUpdate(myLocation);
        }
      } else {
        console.log('⚠️ No track data in response');
        setCurrentTrack(null);
      }
    } catch (error) {
      console.log('⚠️ Current track error:', error.response?.status, error.response?.data || error.message);
      // Don't show alert for "no song playing" errors
      setCurrentTrack(null);
    }
  };

  // ============ MAP THEME CONTROL ============

  const THEMES = [
    { id: 'neon', name: 'Neon', icon: '✨', colors: ['#00ffff', '#ff00ff'] },
    { id: 'blue', name: 'Blue', icon: '💙', colors: ['#1a237e', '#0d47a1'] },
    { id: 'green', name: 'Green', icon: '💚', colors: ['#1b5e20', '#2e7d32'] },
    { id: 'vintage', name: 'Vintage', icon: '📜', colors: ['#ebe3cd', '#bbb5a6'] },
    { id: 'dark', name: 'Dark', icon: '🌑', colors: ['#212121', '#000000'] },
    { id: 'standard', name: 'Standard', icon: '🗺️', colors: ['#ffffff', '#e0e0e0'] },
  ];

  const changeTheme = (themeId) => {
    setMapTheme(themeId);
    setShowThemeMenu(false);
    console.log('🎨 Theme changed to:', themeId);
  };

  // ============ RENDER MARKER ============

  const renderMarker = (location, userId, isMe = false) => {
    const profileImage = isMe ? userProfile?.images?.[0]?.url : location.profile_image;
    const songName = isMe ? (shareEnabled ? currentTrack?.name : null) : location.current_song;
    const artist = isMe ? (shareEnabled ? currentTrack?.artists?.[0]?.name : null) : location.artist;
    const userName = isMe ? (user?.name || 'Me') : location.user_name;
    
    // Debug logging for my marker
    if (isMe) {
      console.log('🎨 Rendering my marker:');
      console.log('  - Profile image:', profileImage ? 'Available' : 'Missing');
      console.log('  - Share enabled:', shareEnabled);
      console.log('  - Song name:', songName || 'None');
      console.log('  - Artist:', artist || 'None');
    }
    
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
          {/* Song Bubble - Only if sharing or if it's not me */}
          {songName && (
            <Animated.View 
              style={[
                styles.songBubble,
                isMe && { transform: [{ scale: pulseAnim }] }
              ]}
            >
              <View style={styles.songGradient}>
                <Icon name="music-note" size={16} color="#1DB954" />
                <View style={styles.songTextContainer}>
                  <Text style={styles.songText}>{songName}</Text>
                  {artist && <Text style={styles.artistText}>{artist}</Text>}
                </View>
              </View>
            </Animated.View>
          )}
          
          {/* Profile Marker with Spotify Photo */}
          <View style={[styles.markerCircle, isMe && styles.myMarkerCircle]}>
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
                  name="person" 
                  size={isMe ? 28 : 24} 
                  color="#fff" 
                />
              </LinearGradient>
            )}
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
      
      {/* Map with Custom Style */}
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        customMapStyle={MAP_STYLES[mapTheme]}
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
        {/* My Location - Always visible to me */}
        {myLocation && renderMarker(
          { ...myLocation, user_name: user?.name || 'Me' }, 
          user?.id, 
          true
        )}
        
        {/* Other Users - Only visible if they're sharing */}
        {Object.entries(userLocations).map(([userId, location]) => 
          renderMarker(location, userId, false)
        )}
      </MapView>

      {/* Modern Top Bar */}
      <View style={styles.topBarContainer}>
        <LinearGradient
          colors={['rgba(0, 0, 0, 0.85)', 'rgba(0, 0, 0, 0.5)', 'transparent']}
          style={styles.topGradient}
        >
          <View style={styles.topBar}>
            {/* Home Button */}
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
                  {onlineCount} online • {shareEnabled ? 'sharing' : 'private'}
                </Text>
              </View>
            </View>
            
            {/* Share Status Button */}
            <TouchableOpacity 
              onPress={toggleShare} 
              style={styles.topButton}
              activeOpacity={0.7}
            >
              <LinearGradient
                colors={shareEnabled ? ['#1DB954', '#1ed760'] : ['#444', '#666']}
                style={styles.shareButton}
              >
                <Icon 
                  name={shareEnabled ? "visibility" : "visibility-off"} 
                  size={22} 
                  color="#fff" 
                />
              </LinearGradient>
            </TouchableOpacity>
            
            {/* Theme Button */}
            <TouchableOpacity 
              onPress={() => setShowThemeMenu(!showThemeMenu)} 
              style={styles.topButton}
              activeOpacity={0.7}
            >
              <View style={styles.themeButton}>
                <Text style={styles.themeEmoji}>
                  {THEMES.find(t => t.id === mapTheme)?.icon || '🗺️'}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </View>

      {/* Theme Menu */}
      {showThemeMenu && (
        <View style={styles.themeMenu}>
          <LinearGradient
            colors={['rgba(20, 20, 20, 0.98)', 'rgba(30, 30, 30, 0.95)']}
            style={styles.themeGradient}
          >
            <Text style={styles.themeMenuTitle}>Map Themes</Text>
            {THEMES.map((theme) => (
              <TouchableOpacity
                key={theme.id}
                onPress={() => changeTheme(theme.id)}
                style={[
                  styles.themeOption,
                  mapTheme === theme.id && styles.themeOptionActive
                ]}
                activeOpacity={0.7}
              >
                <Text style={styles.themeEmoji}>{theme.icon}</Text>
                <Text style={[
                  styles.themeLabel,
                  mapTheme === theme.id && styles.themeLabelActive
                ]}>
                  {theme.name}
                </Text>
                {mapTheme === theme.id && (
                  <Icon name="check-circle" size={18} color="#1DB954" />
                )}
              </TouchableOpacity>
            ))}
          </LinearGradient>
        </View>
      )}

      {/* Floating Controls */}
      <View style={styles.floatingControls}>
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
              <Icon name="my-location" size={24} color="#fff" />
            )}
          </LinearGradient>
        </TouchableOpacity>

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

        {/* Refresh Spotify Data */}
        <TouchableOpacity 
          onPress={() => {
            fetchUserProfile();
            fetchCurrentTrack();
          }} 
          style={styles.controlButton}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={['#9b4dca', '#7b2cbf']}
            style={styles.controlGradient}
          >
            <Icon name="refresh" size={24} color="#fff" />
          </LinearGradient>
        </TouchableOpacity>

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
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#1DB954',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
  },
  shareButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  themeButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  themeEmoji: {
    fontSize: 20,
  },
  topCenter: {
    flex: 1,
    alignItems: 'center',
  },
  topTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 1,
    textShadowColor: 'rgba(0, 0, 0, 0.7)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#666',
    marginRight: 7,
  },
  statusConnected: {
    backgroundColor: '#1DB954',
    shadowColor: '#1DB954',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 6,
  },
  statusText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '700',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  
  // ========== THEME MENU ==========
  themeMenu: {
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
  themeGradient: {
    padding: 8,
  },
  themeMenuTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    marginLeft: 12,
  },
  themeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    marginBottom: 4,
  },
  themeOptionActive: {
    backgroundColor: 'rgba(29, 185, 84, 0.2)',
  },
  themeLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    marginLeft: 12,
  },
  themeLabelActive: {
    color: '#1DB954',
  },
  
  // ========== FLOATING CONTROLS ==========
  floatingControls: {
    position: 'absolute',
    right: 16,
    bottom: 100,
    gap: 14,
  },
  controlButton: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 10,
  },
  controlGradient: {
    width: 62,
    height: 62,
    borderRadius: 31,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  
  // ========== MARKERS ==========
  markerContainer: {
    alignItems: 'center',
    width: 220,
  },
  songBubble: {
    marginBottom: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(20, 20, 25, 0.85)',
    backdropFilter: 'blur(20px)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 10,
    maxWidth: 220,
    minWidth: 140,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  songGradient: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 10,
    backgroundColor: 'transparent',
  },
  songTextContainer: {
    flex: 1,
  },
  songText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
    lineHeight: 18,
  },
  artistText: {
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.7)',
    marginTop: 3,
    lineHeight: 15,
  },
  markerCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 12,
    borderWidth: 4,
    borderColor: '#fff',
    overflow: 'hidden',
  },
  myMarkerCircle: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 5,
    borderColor: '#4169E1',
    shadowColor: '#4169E1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 10,
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
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: 120,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 5,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  myNameBadge: {
    backgroundColor: 'rgba(65, 105, 225, 0.95)',
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  nameText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#fff',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  starIcon: {
    marginLeft: 4,
  },
});

export default MapScreen;
