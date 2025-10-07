import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Music, MapPin, Users, Radio } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const WS_URL = BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://');

const MapPage = ({ accessToken, user }) => {
  const mapRef = useRef(null);
  const [map, setMap] = useState(null);
  const [markers, setMarkers] = useState({});
  const [websocket, setWebsocket] = useState(null);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [userLocations, setUserLocations] = useState({});
  const [locationEnabled, setLocationEnabled] = useState(false);
  const [mapsKey, setMapsKey] = useState(null);
  const [profileImage, setProfileImage] = useState(null);

  // Load Google Maps API key and user profile
  useEffect(() => {
    loadMapsKey();
    loadUserProfile();
  }, []);

  const loadMapsKey = async () => {
    try {
      const response = await axios.get(`${API}/maps/key`);
      setMapsKey(response.data.api_key);
    } catch (error) {
      console.error('Failed to load Maps API key:', error);
    }
  };

  const loadUserProfile = async () => {
    try {
      const response = await axios.get(`${API}/spotify/me?access_token=${accessToken}`);
      const imageUrl = response.data.images?.[0]?.url || 'https://via.placeholder.com/80?text=User';
      setProfileImage(imageUrl);
    } catch (error) {
      console.error('Failed to load user profile:', error);
      setProfileImage('https://via.placeholder.com/80?text=User');
    }
  };

  // Initialize Google Maps
  useEffect(() => {
    if (mapsKey && mapRef.current && !map) {
      initMap();
    }
  }, [mapsKey, mapRef.current]);

  const initMap = () => {
    if (!window.google) {
      // Load Google Maps script
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${mapsKey}`;
      script.async = true;
      script.defer = true;
      script.onload = createMap;
      document.head.appendChild(script);
    } else {
      createMap();
    }
  };

  const createMap = () => {
    const mapInstance = new window.google.maps.Map(mapRef.current, {
      center: { lat: 37.7749, lng: -122.4194 },
      zoom: 12,
      styles: [
        { elementType: 'geometry', stylers: [{ color: '#242f3e' }] },
        { elementType: 'labels.text.stroke', stylers: [{ color: '#242f3e' }] },
        { elementType: 'labels.text.fill', stylers: [{ color: '#746855' }] },
        {
          featureType: 'administrative.locality',
          elementType: 'labels.text.fill',
          stylers: [{ color: '#d59563' }],
        },
        {
          featureType: 'poi',
          elementType: 'labels.text.fill',
          stylers: [{ color: '#d59563' }],
        },
        {
          featureType: 'poi.park',
          elementType: 'geometry',
          stylers: [{ color: '#263c3f' }],
        },
        {
          featureType: 'poi.park',
          elementType: 'labels.text.fill',
          stylers: [{ color: '#6b9a76' }],
        },
        {
          featureType: 'road',
          elementType: 'geometry',
          stylers: [{ color: '#38414e' }],
        },
        {
          featureType: 'road',
          elementType: 'geometry.stroke',
          stylers: [{ color: '#212a37' }],
        },
        {
          featureType: 'road',
          elementType: 'labels.text.fill',
          stylers: [{ color: '#9ca5b3' }],
        },
        {
          featureType: 'road.highway',
          elementType: 'geometry',
          stylers: [{ color: '#746855' }],
        },
        {
          featureType: 'road.highway',
          elementType: 'geometry.stroke',
          stylers: [{ color: '#1f2835' }],
        },
        {
          featureType: 'road.highway',
          elementType: 'labels.text.fill',
          stylers: [{ color: '#f3d19c' }],
        },
        {
          featureType: 'transit',
          elementType: 'geometry',
          stylers: [{ color: '#2f3948' }],
        },
        {
          featureType: 'transit.station',
          elementType: 'labels.text.fill',
          stylers: [{ color: '#d59563' }],
        },
        {
          featureType: 'water',
          elementType: 'geometry',
          stylers: [{ color: '#17263c' }],
        },
        {
          featureType: 'water',
          elementType: 'labels.text.fill',
          stylers: [{ color: '#515c6d' }],
        },
        {
          featureType: 'water',
          elementType: 'labels.text.stroke',
          stylers: [{ color: '#17263c' }],
        },
      ],
    });

    setMap(mapInstance);

    // Try to get user's current location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const userLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };
          mapInstance.setCenter(userLocation);
        },
        (error) => {
          console.error('Geolocation error:', error);
        }
      );
    }
  };

  // Connect to WebSocket
  useEffect(() => {
    if (user && !websocket) {
      connectWebSocket();
    }

    return () => {
      if (websocket) {
        websocket.close();
      }
    };
  }, [user]);

  const connectWebSocket = () => {
    const ws = new WebSocket(`${WS_URL}/ws/${user.id}`);

    ws.onopen = () => {
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      handleLocationUpdate(data);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      // Reconnect after 3 seconds
      setTimeout(connectWebSocket, 3000);
    };

    setWebsocket(ws);
  };

  const handleLocationUpdate = (data) => {
    if (data.type === 'initial_locations') {
      setUserLocations(data.locations);
      Object.entries(data.locations).forEach(([userId, location]) => {
        if (!location.disconnected) {
          updateMarker(userId, location);
        }
      });
    } else if (data.type === 'location_update') {
      if (data.location.disconnected) {
        removeMarker(data.user_id);
      } else {
        setUserLocations((prev) => ({
          ...prev,
          [data.user_id]: data.location,
        }));
        updateMarker(data.user_id, data.location);
      }
    }
  };

  const updateMarker = (userId, location) => {
    if (!map) return;

    const position = { lat: location.lat, lng: location.lng };
    const isCurrentUser = userId === user.id;

    if (markers[userId]) {
      // Smooth marker transition
      markers[userId].marker.setPosition(position);
      
      // Update info window content
      markers[userId].infoWindow.setContent(createInfoWindowContent(userId, location));
      
      // Update label if song changed
      if (location.current_track) {
        markers[userId].marker.setLabel({
          text: `🎵 ${location.current_track.name}`,
          color: '#ffffff',
          fontSize: '11px',
          fontWeight: 'bold',
          className: 'song-label'
        });
      } else {
        markers[userId].marker.setLabel(null);
      }
    } else {
      // Create marker with profile picture icon
      const profileImage = location.profile_image || 'https://via.placeholder.com/60?text=User';
      
      // Create custom icon SVG with profile picture
      const iconSvg = `
        <svg width="70" height="70" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <clipPath id="clip-${userId}">
              <circle cx="35" cy="35" r="28"/>
            </clipPath>
          </defs>
          <circle cx="35" cy="35" r="30" fill="${isCurrentUser ? '#1DB954' : '#4A90E2'}"/>
          <image href="${profileImage}" x="7" y="7" width="56" height="56" clip-path="url(#clip-${userId})"/>
        </svg>
      `;
      
      const iconUrl = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(iconSvg);

      const marker = new window.google.maps.Marker({
        position,
        map,
        icon: {
          url: iconUrl,
          scaledSize: new window.google.maps.Size(70, 70),
          anchor: new window.google.maps.Point(35, 35),
        },
        title: location.user_name || userId,
        optimized: false,
      });

      // Add label for currently playing song
      if (location.current_track) {
        marker.setLabel({
          text: `🎵 ${location.current_track.name}`,
          color: '#ffffff',
          fontSize: '11px',
          fontWeight: 'bold',
        });
      }

      const infoWindow = new window.google.maps.InfoWindow({
        content: createInfoWindowContent(userId, location),
      });

      marker.addListener('click', () => {
        // Close all other info windows
        Object.values(markers).forEach(m => m.infoWindow && m.infoWindow.close());
        infoWindow.open(map, marker);
      });

      setMarkers((prev) => ({
        ...prev,
        [userId]: {
          marker: marker,
          infoWindow: infoWindow,
        },
      }));
    }
  };

  const createInfoWindowContent = (userId, location) => {
    const isCurrentUser = userId === user.id;
    const track = location.current_track;
    const userName = isCurrentUser ? 'You' : (location.user_name || `User ${userId}`);

    return `
      <div style="padding: 12px; min-width: 200px; background: #181818; border-radius: 8px;">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
          <img src="${location.profile_image || 'https://via.placeholder.com/40'}" 
               style="width: 40px; height: 40px; border-radius: 50%; border: 2px solid ${isCurrentUser ? '#1DB954' : '#4A90E2'};" 
               alt="Profile" />
          <h3 style="color: ${isCurrentUser ? '#1DB954' : '#ffffff'}; margin: 0; font-size: 14px; font-weight: 600;">
            ${userName}
          </h3>
        </div>
        ${track ? `
          <div style="display: flex; gap: 8px; align-items: center; padding-top: 8px; border-top: 1px solid #282828;">
            ${track.album?.images?.[2]?.url ? `
              <img src="${track.album.images[2].url}" alt="Album" style="width: 48px; height: 48px; border-radius: 4px;" />
            ` : ''}
            <div style="flex: 1; min-width: 0;">
              <p style="margin: 0; color: #ffffff; font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${track.name || 'Unknown Track'}</p>
              <p style="margin: 4px 0 0; color: #b3b3b3; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${track.artists?.[0]?.name || 'Unknown Artist'}</p>
            </div>
          </div>
        ` : `
          <p style="margin: 8px 0 0; color: #b3b3b3; font-size: 12px; padding-top: 8px; border-top: 1px solid #282828;">No music playing</p>
        `}
        <p style="margin: 8px 0 0; color: #888888; font-size: 11px;">
          Updated ${new Date(location.last_updated).toLocaleTimeString()}
        </p>
      </div>
    `;
  };

  const removeMarker = (userId) => {
    if (markers[userId]) {
      if (markers[userId].marker) {
        markers[userId].marker.setMap(null);
      }
      if (markers[userId].infoWindow) {
        markers[userId].infoWindow.close();
      }
      setMarkers((prev) => {
        const newMarkers = { ...prev };
        delete newMarkers[userId];
        return newMarkers;
      });
    }

    setUserLocations((prev) => {
      const newLocations = { ...prev };
      delete newLocations[userId];
      return newLocations;
    });
  };

  // Track location and current song
  useEffect(() => {
    if (!locationEnabled || !websocket) return;

    const interval = setInterval(() => {
      shareLocationAndSong();
    }, 5000); // Update every 5 seconds

    return () => clearInterval(interval);
  }, [locationEnabled, websocket, accessToken]);

  const shareLocationAndSong = async () => {
    if (!navigator.geolocation) {
      console.error('Geolocation not available');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          console.log('Got location:', position.coords.latitude, position.coords.longitude);
          
          // Get currently playing track
          const trackResponse = await axios.get(
            `${API}/spotify/currently-playing?access_token=${accessToken}`
          );

          const locationData = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            current_track: trackResponse.data.item || null,
            profile_image: profileImage || 'https://via.placeholder.com/60?text=User',
            user_name: user?.name || user?.id || 'User',
            timestamp: new Date().toISOString(),
          };

          console.log('Sharing location data:', locationData);
          setCurrentTrack(trackResponse.data.item);

          if (websocket && websocket.readyState === WebSocket.OPEN) {
            websocket.send(JSON.stringify(locationData));
            console.log('Location data sent via WebSocket');
          } else {
            console.error('WebSocket not ready:', websocket?.readyState);
          }
        } catch (error) {
          console.error('Failed to share location:', error);
        }
      },
      (error) => {
        console.error('Geolocation error:', error);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  };

  const toggleLocationSharing = () => {
    setLocationEnabled(!locationEnabled);
  };

  return (
    <div style={styles.page} data-testid="map-page">
      <div style={styles.controls}>
        <div style={styles.controlsContent}>
          <div style={styles.stats}>
            <div style={styles.stat}>
              <Users size={20} color="#1DB954" />
              <span>{Object.keys(userLocations).length} Active</span>
            </div>
            {currentTrack && (
              <div style={styles.nowPlaying}>
                <Radio size={18} color="#1DB954" />
                <span>
                  {currentTrack.name} - {currentTrack.artists?.[0]?.name}
                </span>
              </div>
            )}
          </div>
          <button
            className={locationEnabled ? 'btn-spotify' : 'btn-secondary'}
            onClick={toggleLocationSharing}
            data-testid="share-location-btn"
          >
            <MapPin size={18} />
            <span>{locationEnabled ? 'Stop Sharing' : 'Share Location'}</span>
          </button>
        </div>
      </div>

      <div ref={mapRef} style={styles.map} data-testid="google-map" />

      {!mapsKey && (
        <div style={styles.overlay}>
          <div style={styles.overlayContent}>
            <MapPin size={48} color="#888888" />
            <h3 style={styles.overlayTitle}>Google Maps API Key Required</h3>
            <p style={styles.overlayText}>
              Please add your Google Maps API key to the backend .env file
            </p>
            <code style={styles.code}>GOOGLE_MAPS_API_KEY=your_key_here</code>
          </div>
        </div>
      )}
    </div>
  );
};

const styles = {
  page: {
    height: '100vh',
    paddingTop: '60px',
    position: 'relative',
  },
  controls: {
    position: 'absolute',
    top: '80px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 10,
    width: '90%',
    maxWidth: '1200px',
  },
  controlsContent: {
    background: 'rgba(24, 24, 24, 0.95)',
    backdropFilter: 'blur(10px)',
    padding: '16px 24px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    gap: '16px',
    flexWrap: 'wrap',
  },
  stats: {
    display: 'flex',
    gap: '24px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  stat: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: '600',
  },
  nowPlaying: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: '#b3b3b3',
    fontSize: '13px',
    maxWidth: '400px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  map: {
    width: '100%',
    height: '100%',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(18, 18, 18, 0.95)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  overlayContent: {
    textAlign: 'center',
    maxWidth: '500px',
    padding: '32px',
  },
  overlayTitle: {
    fontSize: '24px',
    fontWeight: '700',
    color: '#ffffff',
    marginTop: '16px',
    marginBottom: '12px',
  },
  overlayText: {
    fontSize: '16px',
    color: '#b3b3b3',
    marginBottom: '24px',
    lineHeight: '1.6',
  },
  code: {
    display: 'block',
    background: '#282828',
    color: '#1DB954',
    padding: '12px 16px',
    borderRadius: '6px',
    fontSize: '14px',
    fontFamily: 'monospace',
  },
};

export default MapPage;
