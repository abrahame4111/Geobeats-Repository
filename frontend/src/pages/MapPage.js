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
      const marker = markers[userId].marker;
      marker.setPosition(position);
      
      // Update info window content
      markers[userId].infoWindow.setContent(createInfoWindowContent(userId, location));
    } else {
      // Create custom marker with profile picture
      const profileImage = location.profile_image || 'https://via.placeholder.com/80';
      
      // Create a custom HTML marker
      const markerDiv = document.createElement('div');
      markerDiv.style.cssText = `
        position: relative;
        width: 60px;
        height: 60px;
        cursor: pointer;
        transform: translate(-50%, -50%);
      `;

      // Profile picture container with border
      const imageContainer = document.createElement('div');
      imageContainer.style.cssText = `
        width: 60px;
        height: 60px;
        border-radius: 50%;
        border: 3px solid ${isCurrentUser ? '#1DB954' : '#4A90E2'};
        overflow: hidden;
        background: #fff;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        transition: transform 0.2s ease;
      `;
      
      const img = document.createElement('img');
      img.src = profileImage;
      img.style.cssText = `
        width: 100%;
        height: 100%;
        object-fit: cover;
      `;
      
      imageContainer.appendChild(img);
      markerDiv.appendChild(imageContainer);

      // Add song info bubble if playing music
      if (location.current_track) {
        const songBubble = document.createElement('div');
        songBubble.style.cssText = `
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(0, 0, 0, 0.9);
          color: white;
          padding: 8px 12px;
          border-radius: 16px;
          font-size: 11px;
          font-weight: 600;
          white-space: nowrap;
          margin-bottom: 8px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          max-width: 200px;
          overflow: hidden;
          text-overflow: ellipsis;
        `;
        
        const musicIcon = document.createElement('span');
        musicIcon.textContent = '🎵 ';
        songBubble.appendChild(musicIcon);
        
        const songText = document.createElement('span');
        songText.textContent = location.current_track.name || 'Playing music';
        songBubble.appendChild(songText);
        
        markerDiv.appendChild(songBubble);
      }

      // Hover effect
      imageContainer.addEventListener('mouseenter', () => {
        imageContainer.style.transform = 'scale(1.1)';
      });
      imageContainer.addEventListener('mouseleave', () => {
        imageContainer.style.transform = 'scale(1)';
      });

      // Create custom overlay
      class CustomMarker extends window.google.maps.OverlayView {
        constructor(position, content) {
          super();
          this.position = position;
          this.content = content;
        }

        onAdd() {
          this.div = this.content;
          const panes = this.getPanes();
          panes.overlayMouseTarget.appendChild(this.div);
        }

        draw() {
          const overlayProjection = this.getProjection();
          const pos = overlayProjection.fromLatLngToDivPixel(this.position);
          this.div.style.left = pos.x + 'px';
          this.div.style.top = pos.y + 'px';
          this.div.style.position = 'absolute';
        }

        onRemove() {
          if (this.div && this.div.parentNode) {
            this.div.parentNode.removeChild(this.div);
          }
        }

        setPosition(newPosition) {
          this.position = newPosition;
          this.draw();
        }
      }

      const customMarker = new CustomMarker(position, markerDiv);
      customMarker.setMap(map);

      const infoWindow = new window.google.maps.InfoWindow({
        content: createInfoWindowContent(userId, location),
      });

      markerDiv.addEventListener('click', () => {
        // Close all other info windows
        Object.values(markers).forEach(m => m.infoWindow.close());
        infoWindow.setPosition(position);
        infoWindow.open(map);
      });

      setMarkers((prev) => ({
        ...prev,
        [userId]: {
          marker: customMarker,
          infoWindow: infoWindow,
          element: markerDiv,
        },
      }));
    }
  };

  const createInfoWindowContent = (userId, location) => {
    const isCurrentUser = userId === user.id;
    const track = location.current_track;

    return `
      <div style="padding: 12px; min-width: 200px; background: #181818; border-radius: 8px;">
        <h3 style="color: ${isCurrentUser ? '#1DB954' : '#ffffff'}; margin: 0 0 8px; font-size: 14px; font-weight: 600;">
          ${isCurrentUser ? 'You' : `User ${userId}`}
        </h3>
        ${track ? `
          <div style="display: flex; gap: 8px; align-items: center;">
            ${track.album?.images?.[2]?.url ? `
              <img src="${track.album.images[2].url}" alt="Album" style="width: 48px; height: 48px; border-radius: 4px;" />
            ` : ''}
            <div>
              <p style="margin: 0; color: #ffffff; font-size: 13px; font-weight: 600;">${track.name || 'Unknown Track'}</p>
              <p style="margin: 4px 0 0; color: #b3b3b3; font-size: 12px;">${track.artists?.[0]?.name || 'Unknown Artist'}</p>
            </div>
          </div>
        ` : `
          <p style="margin: 0; color: #b3b3b3; font-size: 12px;">No music playing</p>
        `}
        <p style="margin: 8px 0 0; color: #888888; font-size: 11px;">
          ${new Date(location.last_updated).toLocaleTimeString()}
        </p>
      </div>
    `;
  };

  const removeMarker = (userId) => {
    if (markers[userId]) {
      markers[userId].marker.setMap(null);
      markers[userId].infoWindow.close();
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
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          // Get currently playing track
          const trackResponse = await axios.get(
            `${API}/spotify/currently-playing?access_token=${accessToken}`
          );

          const locationData = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            current_track: trackResponse.data.item || null,
            profile_image: profileImage,
            user_name: user?.name || user?.id || 'User',
            timestamp: new Date().toISOString(),
          };

          setCurrentTrack(trackResponse.data.item);

          if (websocket && websocket.readyState === WebSocket.OPEN) {
            websocket.send(JSON.stringify(locationData));
          }
        } catch (error) {
          console.error('Failed to share location:', error);
        }
      },
      (error) => {
        console.error('Geolocation error:', error);
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
