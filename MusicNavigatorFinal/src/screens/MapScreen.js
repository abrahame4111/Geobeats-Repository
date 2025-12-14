import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  Modal,
  ScrollView,
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
  const progressAnim = useRef(new Animated.Value(0)).current;
  
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
  const [isPremium, setIsPremium] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  
  // Connection State
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [onlineCount, setOnlineCount] = useState(0);
  const [onlineUsers, setOnlineUsers] = useState([]);
  
  // UI State
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [showUserModal, setShowUserModal] = useState(false);
  const [showPlaybackControls, setShowPlaybackControls] = useState(false);
  
  // Listen Together State
  const [listenSessionId, setListenSessionId] = useState(null);
  const [listenSessionHost, setListenSessionHost] = useState(null);
  const [listenInvite, setListenInvite] = useState(null);

  // ============ INITIALIZATION ============
  
  useEffect(() => {
    initializeApp();
    startPulseAnimation();
    
    return cleanup;
  }, []);

  // Track progress update
  useEffect(() => {
    let interval;
    if (isPlaying && duration > 0) {
      interval = setInterval(() => {
        setProgress(prev => {
          if (prev >= duration) {
            return 0;
          }
          return prev + 1000;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, duration]);

  const initializeApp = async () => {
    const hasPermission = await requestLocationPermission();
    if (hasPermission) {
      startLocationTracking();
      connectWebSocket();
    }
    
    if (accessToken) {
      fetchUserProfile();
      checkPremiumStatus();
      fetchCurrentTrack();
      const interval = setInterval(fetchCurrentTrack, 5000);
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

  // ============ PREMIUM CHECK ============

  const checkPremiumStatus = async () => {
    try {
      const response = await axios.get(`${API}${API_ENDPOINTS.SPOTIFY.PREMIUM_STATUS || '/spotify/premium-status'}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      setIsPremium(response.data.is_premium);
      console.log('🎫 Premium status:', response.data.is_premium ? 'Premium' : 'Free');
    } catch (error) {
      console.error('Failed to check premium status:', error);
      setIsPremium(false);
    }
  };

  // ============ SHARE TOGGLE ============

  const toggleShare = () => {
    const newShareState = !shareEnabled;
    setShareEnabled(newShareState);
    
    if (newShareState) {
      if (myLocation) {
        sendLocationUpdate(myLocation);
      }
      Alert.alert(
        '🎵 Sharing Enabled',
        'Your location and listening activity are now visible to others!',
        [{ text: 'Got it!' }]
      );
    } else {
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
        const newLocation = { latitude, longitude };
        setMyLocation(newLocation);
        centerOnLocation(newLocation);
        
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

    const lats = allLocations.map(l => l.lat || l.latitude);
    const lngs = allLocations.map(l => l.lng || l.longitude);
    
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
          
          switch (data.type) {
            case 'location_update':
              handleLocationUpdate(data);
              break;
            case 'initial_state':
              handleInitialState(data);
              break;
            case 'online_count_update':
              setOnlineCount(data.online_count);
              setOnlineUsers(data.online_users || []);
              break;
            case 'user_disconnect':
              handleUserDisconnect(data);
              break;
            case 'listen_together_invite':
              handleListenInvite(data);
              break;
            case 'listen_together':
              handleListenTogetherEvent(data);
              break;
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
    if (!shareEnabled) return;
    
    if (wsRef.current?.readyState === WebSocket.OPEN && user) {
      // Get all artists as a string
      const artistNames = currentTrack?.artists?.map(a => a.name).join(', ') || null;
      
      const message = JSON.stringify({
        type: 'location_update',
        user_id: user.id,
        user_name: user.name || userProfile?.display_name || 'Unknown',
        latitude: location.latitude,
        longitude: location.longitude,
        current_song: currentTrack?.name || null,
        artist: artistNames,
        album_cover: currentTrack?.album?.images?.[0]?.url || null,
        profile_image: userProfile?.images?.[0]?.url || null,
        track_uri: currentTrack?.uri || null,
        is_premium: isPremium,
        timestamp: Date.now(),
      });
      
      wsRef.current.send(message);
    }
  };

  const handleLocationUpdate = (data) => {
    const { user_id, location, online_count } = data;
    if (user_id !== user?.id) {
      setUserLocations(prev => ({
        ...prev,
        [user_id]: {
          ...location,
          user_id,
          last_seen: Date.now(),
        }
      }));
    }
    if (online_count !== undefined) {
      setOnlineCount(online_count);
    }
  };

  const handleInitialState = (data) => {
    console.log('📍 Initial state received:', data);
    const filteredLocations = {};
    
    if (data.locations) {
      Object.entries(data.locations).forEach(([userId, location]) => {
        if (userId !== user?.id) {
          filteredLocations[userId] = {
            ...location,
            last_seen: Date.now(),
          };
        }
      });
    }
    
    setUserLocations(filteredLocations);
    setOnlineCount(data.online_count || 0);
    setOnlineUsers(data.online_users || []);
  };

  const handleUserDisconnect = (data) => {
    const { user_id } = data;
    if (user_id !== user?.id) {
      setUserLocations(prev => {
        const updated = { ...prev };
        delete updated[user_id];
        return updated;
      });
    }
  };

  const handleListenInvite = (data) => {
    console.log('🎧 Received listen together invite:', data);
    setListenInvite(data);
  };

  const handleListenTogetherEvent = (data) => {
    console.log('🎵 Listen together event:', data.event);
    
    if (data.event === 'playback_sync' && listenSessionId) {
      // Sync playback if we're in a session and not the host
      if (listenSessionHost !== user?.id) {
        syncPlayback(data.data);
      }
    } else if (data.event === 'user_joined' || data.event === 'user_left') {
      // Show notification
      Alert.alert(
        data.event === 'user_joined' ? '🎧 User Joined' : '👋 User Left',
        `Session now has ${data.data.participants?.length || 0} listeners`
      );
    }
  };

  // ============ SPOTIFY PLAYBACK CONTROLS ============

  const fetchUserProfile = async () => {
    try {
      const response = await axios.get(`${API}${API_ENDPOINTS.SPOTIFY.ME}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      if (response.data) {
        setUserProfile(response.data);
      }
    } catch (error) {
      console.error('❌ Profile fetch error:', error.response?.data || error.message);
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
        setIsPlaying(response.data.is_playing);
        setProgress(response.data.progress_ms || 0);
        setDuration(track.duration_ms || 0);
        
        if (shareEnabled && myLocation) {
          sendLocationUpdate(myLocation);
        }
      } else {
        setCurrentTrack(null);
        setIsPlaying(false);
      }
    } catch (error) {
      setCurrentTrack(null);
      setIsPlaying(false);
    }
  };

  const togglePlayback = async () => {
    if (!isPremium) {
      Alert.alert(
        '🎫 Premium Required',
        'Playback controls require Spotify Premium. Upgrade your account to use this feature.',
        [{ text: 'OK' }]
      );
      return;
    }

    try {
      if (isPlaying) {
        await axios.put(`${API}/spotify/pause`, {}, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
      } else {
        await axios.put(`${API}/spotify/play`, {}, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
      }
      setIsPlaying(!isPlaying);
      
      // Sync with listen together session if host
      if (listenSessionId && listenSessionHost === user?.id) {
        syncListenTogether();
      }
    } catch (error) {
      console.error('Playback toggle error:', error);
      Alert.alert('Error', 'Failed to control playback. Make sure Spotify is open on a device.');
    }
  };

  const skipTrack = async (direction) => {
    if (!isPremium) {
      Alert.alert('🎫 Premium Required', 'Skip controls require Spotify Premium.');
      return;
    }

    try {
      if (direction === 'next') {
        await axios.post(`${API}/spotify/next`, {}, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
      } else {
        await axios.post(`${API}/spotify/previous`, {}, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
      }
      
      // Fetch updated track after a short delay
      setTimeout(fetchCurrentTrack, 500);
      
      // Sync with listen together session if host
      if (listenSessionId && listenSessionHost === user?.id) {
        setTimeout(syncListenTogether, 1000);
      }
    } catch (error) {
      console.error('Skip error:', error);
    }
  };

  // ============ LISTEN TOGETHER ============

  const startListenTogether = async () => {
    if (!isPremium) {
      Alert.alert('🎫 Premium Required', 'Listen Together requires Spotify Premium.');
      return;
    }

    if (!currentTrack) {
      Alert.alert('No Track', 'Play a song first to start Listen Together.');
      return;
    }

    try {
      const response = await axios.post(`${API}/listen-together/create`, {}, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      setListenSessionId(response.data.session_id);
      setListenSessionHost(user?.id);
      
      Alert.alert(
        '🎧 Listen Together Started!',
        `Session ID: ${response.data.session_id}\n\nOthers can tap your marker and join your session!`,
        [{ text: 'Got it!' }]
      );
    } catch (error) {
      console.error('Start listen together error:', error);
      Alert.alert('Error', 'Failed to start Listen Together session.');
    }
  };

  const joinListenTogether = async (sessionId, hostId) => {
    if (!isPremium) {
      Alert.alert('🎫 Premium Required', 'Listen Together requires Spotify Premium.');
      return;
    }

    try {
      const response = await axios.post(`${API}/listen-together/join/${sessionId}`, {}, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      setListenSessionId(sessionId);
      setListenSessionHost(hostId);
      setShowUserModal(false);
      
      Alert.alert(
        '🎧 Joined Listen Together!',
        'You\'re now listening with the host. Playback will sync automatically.',
        [{ text: 'Awesome!' }]
      );
    } catch (error) {
      console.error('Join listen together error:', error);
      Alert.alert('Error', 'Failed to join session. It may have ended.');
    }
  };

  const leaveListenTogether = async () => {
    try {
      await axios.post(`${API}/listen-together/leave`, {}, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      setListenSessionId(null);
      setListenSessionHost(null);
      
      Alert.alert('👋 Left Session', 'You\'ve left the Listen Together session.');
    } catch (error) {
      console.error('Leave session error:', error);
    }
  };

  const syncListenTogether = () => {
    if (!listenSessionId || !wsRef.current) return;
    
    const message = JSON.stringify({
      type: 'listen_together_sync',
      track_uri: currentTrack?.uri,
      track_info: {
        name: currentTrack?.name,
        artists: currentTrack?.artists?.map(a => a.name),
        album_cover: currentTrack?.album?.images?.[0]?.url,
      },
      position_ms: progress,
      is_playing: isPlaying,
    });
    
    wsRef.current.send(message);
  };

  const syncPlayback = async (data) => {
    if (!isPremium) return;
    
    try {
      await axios.put(`${API}/spotify/play`, {
        uri: data.track_uri,
        position_ms: data.position_ms
      }, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      if (!data.is_playing) {
        await axios.put(`${API}/spotify/pause`, {}, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
      }
      
      fetchCurrentTrack();
    } catch (error) {
      console.error('Sync playback error:', error);
    }
  };

  const sendListenInvite = (targetUserId) => {
    if (!listenSessionId || !wsRef.current) return;
    
    const message = JSON.stringify({
      type: 'listen_together_invite',
      target_user_id: targetUserId,
      session_id: listenSessionId,
      host_name: user?.name || userProfile?.display_name,
    });
    
    wsRef.current.send(message);
    
    Alert.alert('✉️ Invite Sent', 'Listen Together invite sent!');
    setShowUserModal(false);
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
  };

  // ============ HELPER FUNCTIONS ============

  const formatTime = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getArtistString = (track, location) => {
    if (track?.artists) {
      return track.artists.map(a => a.name).join(', ');
    }
    if (location?.artist) {
      return location.artist;
    }
    return 'Unknown Artist';
  };

  // ============ RENDER COMPONENTS ============

  // Marquee Text Component
  const MarqueeText = ({ text, style }) => {
    const animatedValue = useRef(new Animated.Value(0)).current;
    const [contentWidth, setContentWidth] = useState(0);
    const [containerWidth, setContainerWidth] = useState(0);
    const animationRef = useRef(null);

    useEffect(() => {
      if (animationRef.current) {
        animationRef.current.stop();
      }
      animatedValue.setValue(0);

      const shouldAnimate = contentWidth > containerWidth && containerWidth > 0;
      
      if (shouldAnimate) {
        const distance = contentWidth - containerWidth;
        
        animationRef.current = Animated.loop(
          Animated.sequence([
            Animated.delay(2000),
            Animated.timing(animatedValue, {
              toValue: -distance - 20,
              duration: (distance + 20) * 50,
              useNativeDriver: true,
            }),
            Animated.delay(1000),
            Animated.timing(animatedValue, {
              toValue: 0,
              duration: 500,
              useNativeDriver: true,
            }),
          ])
        );
        
        animationRef.current.start();
      }

      return () => {
        if (animationRef.current) {
          animationRef.current.stop();
        }
      };
    }, [contentWidth, containerWidth]);

    if (!text) return null;

    return (
      <View 
        style={{ flex: 1, overflow: 'hidden' }}
        onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      >
        <Animated.View
          style={{
            flexDirection: 'row',
            transform: [{ translateX: animatedValue }],
          }}
        >
          <Text
            style={[style, { paddingRight: 20 }]}
            onLayout={(e) => setContentWidth(e.nativeEvent.layout.width)}
          >
            {text}
          </Text>
          {contentWidth > containerWidth && (
            <Text style={style}>{text}</Text>
          )}
        </Animated.View>
      </View>
    );
  };

  // Song Card Component with Playback Controls
  const SongCard = ({ track, location, isMe, onPress }) => {
    const songName = track?.name || location?.current_song;
    const artistName = getArtistString(track, location);
    const albumCover = track?.album?.images?.[0]?.url || location?.album_cover;
    
    if (!songName) return null;
    
    return (
      <TouchableOpacity 
        style={styles.songCard}
        onPress={onPress}
        activeOpacity={0.9}
      >
        {/* Album Cover */}
        <View style={styles.albumCoverContainer}>
          {albumCover ? (
            <Image source={{ uri: albumCover }} style={styles.albumCover} />
          ) : (
            <LinearGradient
              colors={['#282828', '#404040']}
              style={styles.albumPlaceholder}
            >
              <Icon name="music-note" size={20} color="#b3b3b3" />
            </LinearGradient>
          )}
        </View>
        
        {/* Song Info */}
        <View style={styles.songInfo}>
          <MarqueeText text={songName} style={styles.songTitle} />
          <View style={{ marginTop: 4 }}>
            <MarqueeText text={artistName} style={styles.artistName} />
          </View>
        </View>
        
        {/* Playing/Listen Together Indicator */}
        <View style={styles.playingIndicator}>
          {listenSessionId && isMe ? (
            <View style={styles.listenBadge}>
              <Icon name="headset" size={14} color="#1DB954" />
            </View>
          ) : (
            <View style={styles.soundWave}>
              <View style={[styles.soundBar, styles.soundBar1]} />
              <View style={[styles.soundBar, styles.soundBar2]} />
              <View style={[styles.soundBar, styles.soundBar3]} />
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderMarker = (location, userId, isMe = false) => {
    const profileImage = isMe ? userProfile?.images?.[0]?.url : location.profile_image;
    const userName = isMe ? (user?.name || 'Me') : (location.user_name || 'User');
    const hasListenSession = isMe ? !!listenSessionId : !!location.listen_session_id;
    
    return (
      <Marker
        key={userId}
        coordinate={{
          latitude: isMe ? location.latitude : (location.lat || location.latitude),
          longitude: isMe ? location.longitude : (location.lng || location.longitude),
        }}
        anchor={{ x: 0.5, y: 1 }}
        onPress={() => {
          if (!isMe) {
            setSelectedUser({ ...location, user_id: userId });
            setShowUserModal(true);
          } else if (currentTrack) {
            setShowPlaybackControls(!showPlaybackControls);
          }
        }}
      >
        <View style={styles.markerContainer}>
          {/* Song Card */}
          {(isMe ? (shareEnabled && currentTrack) : location.current_song) && (
            <SongCard 
              track={isMe ? currentTrack : null}
              location={location}
              isMe={isMe}
              onPress={() => {
                if (!isMe) {
                  setSelectedUser({ ...location, user_id: userId });
                  setShowUserModal(true);
                }
              }}
            />
          )}
          
          {/* Profile Marker */}
          <View style={[
            styles.markerCircle, 
            isMe && styles.myMarkerCircle,
            hasListenSession && styles.listenSessionMarker
          ]}>
            {profileImage ? (
              <Image source={{ uri: profileImage }} style={styles.profileImage} />
            ) : (
              <LinearGradient
                colors={isMe ? ['#4169E1', '#1E90FF'] : ['#1DB954', '#1ed760']}
                style={styles.profilePlaceholder}
              >
                <Icon name="person" size={isMe ? 28 : 24} color="#fff" />
              </LinearGradient>
            )}
          </View>
          
          {/* Username Badge */}
          <View style={[styles.nameBadge, isMe && styles.myNameBadge]}>
            <Text style={styles.nameText} numberOfLines={1}>{userName}</Text>
            {hasListenSession && <Icon name="headset" size={10} color="#1DB954" style={styles.starIcon} />}
            {isMe && !hasListenSession && <Icon name="star" size={10} color="#FFD700" style={styles.starIcon} />}
          </View>
        </View>
      </Marker>
    );
  };

  // ============ USER MODAL ============

  const renderUserModal = () => (
    <Modal
      visible={showUserModal}
      transparent
      animationType="slide"
      onRequestClose={() => setShowUserModal(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <LinearGradient
            colors={['#1a1a1a', '#2d2d2d']}
            style={styles.modalGradient}
          >
            {/* Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalProfileSection}>
                {selectedUser?.profile_image ? (
                  <Image source={{ uri: selectedUser.profile_image }} style={styles.modalProfileImage} />
                ) : (
                  <LinearGradient colors={['#1DB954', '#1ed760']} style={styles.modalProfilePlaceholder}>
                    <Icon name="person" size={30} color="#fff" />
                  </LinearGradient>
                )}
                <View style={styles.modalUserInfo}>
                  <Text style={styles.modalUserName}>{selectedUser?.user_name || 'User'}</Text>
                  {selectedUser?.is_premium && (
                    <View style={styles.premiumBadge}>
                      <Text style={styles.premiumText}>Premium</Text>
                    </View>
                  )}
                </View>
              </View>
              <TouchableOpacity onPress={() => setShowUserModal(false)} style={styles.closeButton}>
                <Icon name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            
            {/* Currently Playing */}
            {selectedUser?.current_song && (
              <View style={styles.modalSongSection}>
                <Text style={styles.modalSectionTitle}>Now Playing</Text>
                <View style={styles.modalSongCard}>
                  {selectedUser.album_cover && (
                    <Image source={{ uri: selectedUser.album_cover }} style={styles.modalAlbumCover} />
                  )}
                  <View style={styles.modalSongInfo}>
                    <Text style={styles.modalSongTitle} numberOfLines={1}>{selectedUser.current_song}</Text>
                    <Text style={styles.modalArtistName} numberOfLines={1}>{selectedUser.artist || 'Unknown Artist'}</Text>
                  </View>
                </View>
              </View>
            )}
            
            {/* Actions */}
            <View style={styles.modalActions}>
              {/* Listen Together Button */}
              {selectedUser?.current_song && selectedUser?.track_uri && (
                <>
                  {selectedUser.listen_session_id ? (
                    <TouchableOpacity 
                      style={styles.actionButton}
                      onPress={() => joinListenTogether(selectedUser.listen_session_id, selectedUser.user_id)}
                    >
                      <LinearGradient colors={['#1DB954', '#1ed760']} style={styles.actionGradient}>
                        <Icon name="headset" size={24} color="#fff" />
                        <Text style={styles.actionText}>Join Listen Together</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  ) : listenSessionId ? (
                    <TouchableOpacity 
                      style={styles.actionButton}
                      onPress={() => sendListenInvite(selectedUser.user_id)}
                    >
                      <LinearGradient colors={['#9b4dca', '#7b2cbf']} style={styles.actionGradient}>
                        <Icon name="send" size={24} color="#fff" />
                        <Text style={styles.actionText}>Invite to Your Session</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity 
                      style={styles.actionButton}
                      onPress={async () => {
                        if (!isPremium) {
                          Alert.alert('🎫 Premium Required', 'Listen Together requires Spotify Premium.');
                          return;
                        }
                        // Play their song
                        try {
                          await axios.put(`${API}/spotify/play`, {
                            uri: selectedUser.track_uri
                          }, {
                            headers: { Authorization: `Bearer ${accessToken}` }
                          });
                          setShowUserModal(false);
                          fetchCurrentTrack();
                          Alert.alert('🎵 Now Playing', `Playing "${selectedUser.current_song}"`);
                        } catch (error) {
                          Alert.alert('Error', 'Failed to play track. Make sure Spotify is open.');
                        }
                      }}
                    >
                      <LinearGradient colors={['#1DB954', '#1ed760']} style={styles.actionGradient}>
                        <Icon name="play-arrow" size={24} color="#fff" />
                        <Text style={styles.actionText}>Play This Song</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  )}
                </>
              )}
              
              {/* Center on User */}
              <TouchableOpacity 
                style={styles.actionButtonSecondary}
                onPress={() => {
                  centerOnLocation({
                    latitude: selectedUser.lat || selectedUser.latitude,
                    longitude: selectedUser.lng || selectedUser.longitude
                  }, 0.01);
                  setShowUserModal(false);
                }}
              >
                <Icon name="my-location" size={20} color="#1DB954" />
                <Text style={styles.actionTextSecondary}>Center on Map</Text>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </View>
      </View>
    </Modal>
  );

  // ============ LISTEN INVITE MODAL ============

  const renderListenInviteModal = () => (
    <Modal
      visible={!!listenInvite}
      transparent
      animationType="fade"
      onRequestClose={() => setListenInvite(null)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.inviteModal}>
          <LinearGradient colors={['#1a1a1a', '#2d2d2d']} style={styles.inviteGradient}>
            <Icon name="headset" size={48} color="#1DB954" style={{ marginBottom: 16 }} />
            <Text style={styles.inviteTitle}>Listen Together Invite</Text>
            <Text style={styles.inviteText}>
              {listenInvite?.host_name || 'Someone'} invited you to listen together!
            </Text>
            
            {listenInvite?.track_info && (
              <View style={styles.inviteTrackInfo}>
                <Text style={styles.inviteTrackName}>{listenInvite.track_info.name}</Text>
                <Text style={styles.inviteArtist}>{listenInvite.track_info.artists?.join(', ')}</Text>
              </View>
            )}
            
            <View style={styles.inviteActions}>
              <TouchableOpacity 
                style={styles.inviteAccept}
                onPress={() => {
                  joinListenTogether(listenInvite.session_id, listenInvite.host_id);
                  setListenInvite(null);
                }}
              >
                <Text style={styles.inviteAcceptText}>Join</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.inviteDecline}
                onPress={() => setListenInvite(null)}
              >
                <Text style={styles.inviteDeclineText}>Decline</Text>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </View>
      </View>
    </Modal>
  );

  // ============ PLAYBACK CONTROLS PANEL ============

  const renderPlaybackControls = () => {
    if (!showPlaybackControls || !currentTrack) return null;
    
    return (
      <View style={styles.playbackPanel}>
        <LinearGradient colors={['rgba(0,0,0,0.95)', 'rgba(20,20,20,0.98)']} style={styles.playbackGradient}>
          {/* Track Info */}
          <View style={styles.playbackTrackInfo}>
            {currentTrack.album?.images?.[0]?.url && (
              <Image source={{ uri: currentTrack.album.images[0].url }} style={styles.playbackAlbum} />
            )}
            <View style={styles.playbackTextInfo}>
              <Text style={styles.playbackTitle} numberOfLines={1}>{currentTrack.name}</Text>
              <Text style={styles.playbackArtist} numberOfLines={1}>
                {currentTrack.artists?.map(a => a.name).join(', ')}
              </Text>
            </View>
          </View>
          
          {/* Progress Bar */}
          <View style={styles.progressContainer}>
            <Text style={styles.progressTime}>{formatTime(progress)}</Text>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${(progress / duration) * 100}%` }]} />
            </View>
            <Text style={styles.progressTime}>{formatTime(duration)}</Text>
          </View>
          
          {/* Controls */}
          <View style={styles.playbackControls}>
            <TouchableOpacity onPress={() => skipTrack('previous')} style={styles.controlBtn}>
              <Icon name="skip-previous" size={32} color={isPremium ? "#fff" : "#666"} />
            </TouchableOpacity>
            
            <TouchableOpacity onPress={togglePlayback} style={styles.playPauseBtn}>
              <LinearGradient colors={['#1DB954', '#1ed760']} style={styles.playPauseGradient}>
                <Icon name={isPlaying ? "pause" : "play-arrow"} size={36} color="#fff" />
              </LinearGradient>
            </TouchableOpacity>
            
            <TouchableOpacity onPress={() => skipTrack('next')} style={styles.controlBtn}>
              <Icon name="skip-next" size={32} color={isPremium ? "#fff" : "#666"} />
            </TouchableOpacity>
          </View>
          
          {/* Listen Together Controls */}
          <View style={styles.listenTogetherControls}>
            {listenSessionId ? (
              <TouchableOpacity style={styles.listenTogetherBtn} onPress={leaveListenTogether}>
                <Icon name="exit-to-app" size={18} color="#ff4444" />
                <Text style={[styles.listenTogetherText, { color: '#ff4444' }]}>Leave Session</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.listenTogetherBtn} onPress={startListenTogether}>
                <Icon name="headset" size={18} color="#1DB954" />
                <Text style={styles.listenTogetherText}>Start Listen Together</Text>
              </TouchableOpacity>
            )}
          </View>
          
          {!isPremium && (
            <Text style={styles.premiumWarning}>🎫 Upgrade to Premium for playback controls</Text>
          )}
          
          {/* Close button */}
          <TouchableOpacity 
            style={styles.closePlaybackBtn}
            onPress={() => setShowPlaybackControls(false)}
          >
            <Icon name="keyboard-arrow-down" size={28} color="#888" />
          </TouchableOpacity>
        </LinearGradient>
      </View>
    );
  };

  // ============ MAIN RENDER ============

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      
      {/* Map */}
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
      >
        {myLocation && renderMarker(myLocation, user?.id, true)}
        {Object.entries(userLocations).map(([userId, location]) => 
          renderMarker(location, userId, false)
        )}
      </MapView>

      {/* Top Bar */}
      <View style={styles.topBarContainer}>
        <LinearGradient
          colors={['rgba(0, 0, 0, 0.85)', 'rgba(0, 0, 0, 0.5)', 'transparent']}
          style={styles.topGradient}
        >
          <View style={styles.topBar}>
            <TouchableOpacity 
              onPress={() => navigation.navigate('Home')} 
              style={styles.topButton}
            >
              <View style={styles.homeButton}>
                <Icon name="home" size={22} color="#1DB954" />
              </View>
            </TouchableOpacity>
            
            <View style={styles.topCenter}>
              <Text style={styles.topTitle}>Live Map</Text>
              <View style={styles.statusRow}>
                <Animated.View 
                  style={[
                    styles.statusDot, 
                    connectionStatus === 'connected' && styles.statusConnected,
                    connectionStatus === 'connected' && { transform: [{ scale: pulseAnim }] }
                  ]} 
                />
                <Text style={styles.statusText}>
                  {onlineCount} online • {shareEnabled ? 'sharing' : 'private'}
                </Text>
              </View>
            </View>
            
            <TouchableOpacity onPress={toggleShare} style={styles.topButton}>
              <View style={[styles.shareButton, shareEnabled && { borderColor: 'rgba(29, 185, 84, 0.5)' }]}>
                <Icon 
                  name={shareEnabled ? "visibility" : "visibility-off"} 
                  size={22} 
                  color={shareEnabled ? "#1DB954" : "#888"} 
                />
              </View>
            </TouchableOpacity>
            
            <TouchableOpacity onPress={() => setShowThemeMenu(!showThemeMenu)} style={styles.topButton}>
              <View style={styles.themeButton}>
                <Text style={styles.themeEmoji}>{THEMES.find(t => t.id === mapTheme)?.icon || '🗺️'}</Text>
              </View>
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </View>

      {/* Theme Menu */}
      {showThemeMenu && (
        <View style={styles.themeMenu}>
          <LinearGradient colors={['rgba(20, 20, 20, 0.98)', 'rgba(30, 30, 30, 0.95)']} style={styles.themeGradient}>
            <Text style={styles.themeMenuTitle}>Map Themes</Text>
            {THEMES.map((theme) => (
              <TouchableOpacity
                key={theme.id}
                onPress={() => changeTheme(theme.id)}
                style={[styles.themeOption, mapTheme === theme.id && styles.themeOptionActive]}
              >
                <Text style={styles.themeEmoji}>{theme.icon}</Text>
                <Text style={[styles.themeLabel, mapTheme === theme.id && styles.themeLabelActive]}>
                  {theme.name}
                </Text>
                {mapTheme === theme.id && <Icon name="check-circle" size={18} color="#1DB954" />}
              </TouchableOpacity>
            ))}
          </LinearGradient>
        </View>
      )}

      {/* Floating Controls */}
      <View style={styles.floatingControls}>
        <TouchableOpacity onPress={centerOnMe} style={styles.controlButton}>
          <View style={styles.controlGradient}>
            {loadingLocation ? (
              <ActivityIndicator size="small" color="#1DB954" />
            ) : (
              <Icon name="my-location" size={24} color={myLocation ? "#1DB954" : "#888"} />
            )}
          </View>
        </TouchableOpacity>

        <TouchableOpacity onPress={showAllUsers} style={styles.controlButton}>
          <View style={styles.controlGradient}>
            <Icon name="people" size={24} color="#1DB954" />
          </View>
        </TouchableOpacity>

        <TouchableOpacity 
          onPress={() => {
            fetchUserProfile();
            fetchCurrentTrack();
          }} 
          style={styles.controlButton}
        >
          <View style={styles.controlGradient}>
            <Icon name="refresh" size={24} color="#9b4dca" />
          </View>
        </TouchableOpacity>
      </View>

      {/* Mini Player Bar */}
      {currentTrack && !showPlaybackControls && (
        <TouchableOpacity 
          style={styles.miniPlayer}
          onPress={() => setShowPlaybackControls(true)}
          activeOpacity={0.9}
        >
          <LinearGradient colors={['#1a1a1a', '#2d2d2d']} style={styles.miniPlayerGradient}>
            {currentTrack.album?.images?.[0]?.url && (
              <Image source={{ uri: currentTrack.album.images[0].url }} style={styles.miniAlbum} />
            )}
            <View style={styles.miniInfo}>
              <Text style={styles.miniTitle} numberOfLines={1}>{currentTrack.name}</Text>
              <Text style={styles.miniArtist} numberOfLines={1}>
                {currentTrack.artists?.map(a => a.name).join(', ')}
              </Text>
            </View>
            <TouchableOpacity onPress={togglePlayback} style={styles.miniPlayBtn}>
              <Icon name={isPlaying ? "pause" : "play-arrow"} size={28} color="#1DB954" />
            </TouchableOpacity>
            {listenSessionId && (
              <View style={styles.miniListenBadge}>
                <Icon name="headset" size={14} color="#1DB954" />
              </View>
            )}
          </LinearGradient>
        </TouchableOpacity>
      )}

      {/* Playback Controls Panel */}
      {renderPlaybackControls()}

      {/* User Modal */}
      {renderUserModal()}

      {/* Listen Invite Modal */}
      {renderListenInviteModal()}
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
  
  // Top Bar
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
    backgroundColor: 'rgba(30, 30, 35, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(29, 185, 84, 0.4)',
  },
  shareButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 30, 35, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  themeButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(30, 30, 35, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
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
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    backgroundColor: 'rgba(20, 20, 25, 0.7)',
    paddingHorizontal: 12,
    paddingVertical: 5,
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
  },
  statusText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '700',
  },
  
  // Theme Menu
  themeMenu: {
    position: 'absolute',
    top: StatusBar.currentHeight + 70,
    right: 16,
    width: 180,
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 8,
  },
  themeGradient: {
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  themeMenuTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 10,
    marginLeft: 4,
  },
  themeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  themeOptionActive: {
    backgroundColor: 'rgba(29, 185, 84, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(29, 185, 84, 0.3)',
  },
  themeLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.9)',
    marginLeft: 12,
  },
  themeLabelActive: {
    color: '#1DB954',
    fontWeight: '700',
  },
  
  // Floating Controls
  floatingControls: {
    position: 'absolute',
    right: 16,
    bottom: 180,
    gap: 14,
  },
  controlButton: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 10,
  },
  controlGradient: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 30, 35, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  
  // Markers
  markerContainer: {
    alignItems: 'center',
    width: 260,
  },
  songCard: {
    marginBottom: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(24, 24, 24, 0.98)',
    width: 260,
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 12,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  albumCoverContainer: {
    width: 48,
    height: 48,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#282828',
  },
  albumCover: {
    width: '100%',
    height: '100%',
  },
  albumPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  songInfo: {
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
  },
  songTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  artistName: {
    fontSize: 12,
    fontWeight: '400',
    color: '#b3b3b3',
  },
  playingIndicator: {
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  soundWave: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 12,
    gap: 2,
  },
  soundBar: {
    width: 2,
    backgroundColor: '#1DB954',
    borderRadius: 1,
  },
  soundBar1: { height: 4 },
  soundBar2: { height: 8 },
  soundBar3: { height: 6 },
  listenBadge: {
    backgroundColor: 'rgba(29, 185, 84, 0.2)',
    borderRadius: 10,
    padding: 3,
  },
  markerCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(40, 40, 45, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    overflow: 'hidden',
  },
  myMarkerCircle: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 4,
    borderColor: 'rgba(100, 150, 255, 0.8)',
  },
  listenSessionMarker: {
    borderColor: '#1DB954',
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
    borderRadius: 14,
    backgroundColor: 'rgba(30, 30, 35, 0.8)',
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: 120,
  },
  myNameBadge: {
    backgroundColor: 'rgba(80, 120, 220, 0.75)',
  },
  nameText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  starIcon: {
    marginLeft: 4,
  },
  
  // Mini Player
  miniPlayer: {
    position: 'absolute',
    bottom: 90,
    left: 16,
    right: 80,
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 10,
  },
  miniPlayerGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  miniAlbum: {
    width: 44,
    height: 44,
    borderRadius: 6,
  },
  miniInfo: {
    flex: 1,
    marginLeft: 10,
  },
  miniTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  miniArtist: {
    fontSize: 11,
    color: '#b3b3b3',
    marginTop: 2,
  },
  miniPlayBtn: {
    padding: 8,
  },
  miniListenBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(29, 185, 84, 0.3)',
    borderRadius: 8,
    padding: 4,
  },
  
  // Playback Panel
  playbackPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  playbackGradient: {
    padding: 20,
    paddingBottom: 40,
  },
  playbackTrackInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  playbackAlbum: {
    width: 64,
    height: 64,
    borderRadius: 8,
  },
  playbackTextInfo: {
    flex: 1,
    marginLeft: 16,
  },
  playbackTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  playbackArtist: {
    fontSize: 14,
    color: '#b3b3b3',
    marginTop: 4,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  progressTime: {
    fontSize: 11,
    color: '#888',
    width: 40,
  },
  progressBar: {
    flex: 1,
    height: 4,
    backgroundColor: '#404040',
    borderRadius: 2,
    marginHorizontal: 10,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#1DB954',
    borderRadius: 2,
  },
  playbackControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 32,
    marginBottom: 20,
  },
  controlBtn: {
    padding: 8,
  },
  playPauseBtn: {
    borderRadius: 32,
    overflow: 'hidden',
  },
  playPauseGradient: {
    width: 64,
    height: 64,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 32,
  },
  listenTogetherControls: {
    alignItems: 'center',
    marginTop: 8,
  },
  listenTogetherBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(29, 185, 84, 0.1)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(29, 185, 84, 0.3)',
  },
  listenTogetherText: {
    color: '#1DB954',
    marginLeft: 8,
    fontWeight: '600',
  },
  premiumWarning: {
    textAlign: 'center',
    color: '#ff9800',
    fontSize: 12,
    marginTop: 12,
  },
  closePlaybackBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    padding: 8,
  },
  
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  modalGradient: {
    padding: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalProfileSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  modalProfileImage: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  modalProfilePlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalUserInfo: {
    marginLeft: 16,
  },
  modalUserName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
  },
  premiumBadge: {
    backgroundColor: '#FFD700',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 4,
  },
  premiumText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#000',
  },
  closeButton: {
    padding: 8,
  },
  modalSongSection: {
    marginBottom: 24,
  },
  modalSectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  modalSongCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: 12,
    borderRadius: 12,
  },
  modalAlbumCover: {
    width: 56,
    height: 56,
    borderRadius: 8,
  },
  modalSongInfo: {
    flex: 1,
    marginLeft: 12,
  },
  modalSongTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  modalArtistName: {
    fontSize: 14,
    color: '#b3b3b3',
    marginTop: 4,
  },
  modalActions: {
    gap: 12,
  },
  actionButton: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  actionGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    gap: 10,
  },
  actionText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  actionButtonSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(29, 185, 84, 0.3)',
    gap: 10,
  },
  actionTextSecondary: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1DB954',
  },
  
  // Listen Invite Modal
  inviteModal: {
    marginHorizontal: 24,
    marginBottom: height * 0.3,
    borderRadius: 20,
    overflow: 'hidden',
  },
  inviteGradient: {
    padding: 24,
    alignItems: 'center',
  },
  inviteTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  inviteText: {
    fontSize: 14,
    color: '#b3b3b3',
    textAlign: 'center',
    marginBottom: 20,
  },
  inviteTrackInfo: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: 16,
    borderRadius: 12,
    width: '100%',
    marginBottom: 24,
  },
  inviteTrackName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
  },
  inviteArtist: {
    fontSize: 14,
    color: '#b3b3b3',
    textAlign: 'center',
    marginTop: 4,
  },
  inviteActions: {
    flexDirection: 'row',
    gap: 12,
  },
  inviteAccept: {
    flex: 1,
    backgroundColor: '#1DB954',
    paddingVertical: 14,
    borderRadius: 24,
  },
  inviteAcceptText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  inviteDecline: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingVertical: 14,
    borderRadius: 24,
  },
  inviteDeclineText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
});

export default MapScreen;
