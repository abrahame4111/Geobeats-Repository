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
import Geolocation from 'react-native-geolocation-service';
import LinearGradient from 'react-native-linear-gradient';
import { useAuth } from '../context/AuthContext';
import GlassCard from '../components/GlassCard';
import SongCard from '../components/SongCard';
import Icon from 'react-native-vector-icons/MaterialIcons';
import axios from 'axios';

const { width, height } = Dimensions.get('window');

const MapScreen = ({ navigation }) => {
  const { user, accessToken, API, BACKEND_URL } = useAuth();
  const wsRef = useRef(null);
  
  const [userLocations, setUserLocations] = useState({});
  const [locationEnabled, setLocationEnabled] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [showSongCard, setShowSongCard] = useState(false);

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
        setLocationEnabled(true);
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
            
            let track = null;
            try {
              const trackResponse = await axios.get(
                `${API}/spotify/currently-playing?access_token=${accessToken}`
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

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'Connected': return '#1DB954';
      case 'Error': return '#FF4444';
      default: return '#FFA500';
    }
  };

  return (
    <LinearGradient
      colors={['#191414', '#0d0d0d', '#000000']}
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
          <Text style={styles.headerTitleText}>Live Map</Text>
        </View>
        
        <View style={styles.headerButton} />
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
              <Text style={styles.statusText}>{Object.keys(userLocations).length} Users</Text>
            </View>
          </View>
        </GlassCard>
      </View>

      {/* Map Area */}
      <View style={styles.mapContainer}>
        <GlassCard style={styles.mapCard}>
          <View style={styles.mapPlaceholder}>
            <Icon name="map" size={48} color="rgba(29, 185, 84, 0.5)" />
            <Text style={styles.mapPlaceholderTitle}>Real-Time Location Sharing</Text>
            <Text style={styles.mapPlaceholderSubtitle}>
              WebSocket connection active{"\n"}
              Location data synchronized
            </Text>
            
            {/* User List */}
            <View style={styles.usersList}>
              {Object.entries(userLocations).map(([userId, location]) => {
                const isCurrentUser = userId === user?.id;
                return (
                  <GlassCard key={userId} style={styles.userCard}>
                    <View style={styles.userContent}>
                      <View style={[
                        styles.userAvatar,
                        { backgroundColor: isCurrentUser ? '#1DB954' : '#FF6B6B' }
                      ]}>
                        <Icon name="person" size={16} color="#fff" />
                      </View>
                      <View style={styles.userInfo}>
                        <Text style={styles.userName}>
                          {location.user_name || userId} {isCurrentUser ? '(You)' : ''}
                        </Text>
                        <Text style={styles.userLocation}>
                          {location.lat?.toFixed(4)}, {location.lng?.toFixed(4)}
                        </Text>
                        {location.current_track && (
                          <Text style={styles.userTrack}>
                            🎵 {location.current_track.name}
                          </Text>
                        )}
                      </View>
                    </View>
                  </GlassCard>
                );
              })}
            </View>
          </View>
        </GlassCard>
      </View>

      {/* Controls */}
      <View style={styles.controls}>
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
              size={20}
              color="#fff"
            />
            <Text style={styles.controlButtonText}>
              {locationEnabled ? 'Sharing Location' : 'Share Location'}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
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
    minHeight: 60,
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
    fontSize: 14,
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
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  mapCard: {
    flex: 1,
  },
  mapPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  mapPlaceholderTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1DB954',
    marginTop: 16,
    marginBottom: 8,
  },
  mapPlaceholderSubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  usersList: {
    width: '100%',
    maxHeight: 200,
  },
  userCard: {
    marginVertical: 4,
    minHeight: 60,
  },
  userContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 2,
  },
  userLocation: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.6)',
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  userTrack: {
    fontSize: 11,
    color: '#1DB954',
  },
  controls: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  controlButton: {
    borderRadius: 25,
    overflow: 'hidden',
  },
  controlButtonGradient: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
});

export default MapScreen;