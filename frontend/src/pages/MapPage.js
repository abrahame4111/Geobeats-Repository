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
  const [activeInfoWindow, setActiveInfoWindow] = useState(null);

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

  // Add map click listener to close info windows
  useEffect(() => {
    if (map) {
      const listener = window.google.maps.event.addListener(map, 'click', () => {
        if (activeInfoWindow) {
          activeInfoWindow.close();
          setActiveInfoWindow(null);
        }
      });

      return () => {
        window.google.maps.event.removeListener(listener);
      };
    }
  }, [map, activeInfoWindow]);

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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Close all info windows
      if (activeInfoWindow) {
        activeInfoWindow.close();
      }
      
      // Remove all markers and overlays
      Object.values(markers).forEach(markerData => {
        if (markerData.marker) {
          markerData.marker.setMap(null);
        }
        if (markerData.infoWindow) {
          markerData.infoWindow.close();
        }
        if (markerData.musicLabel) {
          markerData.musicLabel.setMap(null);
        }
      });
    };
  }, [markers, activeInfoWindow]);

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

  // Helper function to create music label overlay
  const createMusicLabel = (songName, borderColor) => {
    const labelDiv = document.createElement('div');
    labelDiv.style.cssText = `
      position: absolute;
      background: rgba(0, 0, 0, 0.9);
      color: white;
      padding: 6px 12px;
      border-radius: 16px;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
      pointer-events: none;
      transform: translate(-50%, -100%);
      margin-top: -40px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      border: 1px solid ${borderColor};
      display: flex;
      align-items: center;
      gap: 6px;
      max-width: 250px;
      overflow: hidden;
    `;
    
    labelDiv.innerHTML = `
      <span style="font-size: 14px;">🎵</span>
      <span style="overflow: hidden; text-overflow: ellipsis;">${songName}</span>
    `;
    
    return labelDiv;
  };

  // Helper to create MusicLabel class (only when google maps is loaded)
  const createMusicLabelClass = () => {
    if (!window.google || !window.google.maps) return null;
    
    class MusicLabel extends window.google.maps.OverlayView {
      constructor(position, element) {
        super();
        this.position = position;
        this.element = element;
      }

      onAdd() {
        const panes = this.getPanes();
        panes.floatPane.appendChild(this.element);
      }

      draw() {
        const projection = this.getProjection();
        const point = projection.fromLatLngToDivPixel(this.position);
        if (point) {
          this.element.style.left = point.x + 'px';
          this.element.style.top = point.y + 'px';
        }
      }

      onRemove() {
        if (this.element && this.element.parentNode) {
          this.element.parentNode.removeChild(this.element);
        }
      }

      setPosition(newPosition) {
        this.position = newPosition;
        this.draw();
      }
    }
    
    return MusicLabel;
  };

  const updateMarker = (userId, location) => {
    console.log('updateMarker called for:', userId, 'isCurrentUser:', userId === user.id);
    console.log('Location data:', location);
    console.log('Map exists:', !!map);
    
    if (!map) {
      console.error('Map not ready, cannot create marker');
      return;
    }

    const position = { lat: location.lat, lng: location.lng };
    const isCurrentUser = userId === user.id;
    const markerColor = isCurrentUser ? '#1DB954' : '#4A90E2';

    if (markers[userId]) {
      console.log('Updating existing marker for:', userId);
      
      // Smooth marker transition
      markers[userId].marker.setPosition(position);
      
      // Update info window content (but don't reopen it)
      markers[userId].infoWindow.setContent(createInfoWindowContent(userId, location));
      
      // Update or remove music label overlay
      if (markers[userId].musicLabel) {
        markers[userId].musicLabel.setMap(null);
      }
      
      if (location.current_track && window.google && window.google.maps) {
        const MusicLabel = createMusicLabelClass();
        if (MusicLabel) {
          const labelDiv = createMusicLabel(location.current_track.name, markerColor);
          const musicLabel = new MusicLabel(position, labelDiv);
          musicLabel.setMap(map);
          markers[userId].musicLabel = musicLabel;
        }
      }
    } else {
      console.log('Creating NEW marker for:', userId);
      
      const profileImage = location.profile_image || 'https://via.placeholder.com/80?text=User';
      
      // Create circular marker icon with profile picture and border
      const createMarkerIcon = (imageUrl, borderColor) => {
        return new Promise((resolve) => {
          const canvas = document.createElement('canvas');
          canvas.width = 70;
          canvas.height = 70;
          const ctx = canvas.getContext('2d');
          
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            // Draw white background circle
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(35, 35, 34, 0, Math.PI * 2);
            ctx.fill();
            
            // Draw colored border
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(35, 35, 32, 0, Math.PI * 2);
            ctx.stroke();
            
            // Clip to circle and draw image
            ctx.save();
            ctx.beginPath();
            ctx.arc(35, 35, 28, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(img, 7, 7, 56, 56);
            ctx.restore();
            
            resolve(canvas.toDataURL());
          };
          img.onerror = () => {
            // Fallback to simple colored circle
            ctx.fillStyle = borderColor;
            ctx.beginPath();
            ctx.arc(35, 35, 30, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.fillStyle = '#ffffff';
            ctx.font = '30px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(isCurrentUser ? '😊' : '👤', 35, 35);
            
            resolve(canvas.toDataURL());
          };
          img.src = imageUrl;
        });
      };

      // Create marker with canvas-drawn icon
      createMarkerIcon(profileImage, markerColor).then(iconUrl => {
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
          zIndex: isCurrentUser ? 1000 : 100,
        });

        console.log('Marker created with profile image:', profileImage);

        // Create music label overlay if playing
        let musicLabel = null;
        if (location.current_track && window.google && window.google.maps) {
          const MusicLabel = createMusicLabelClass();
          if (MusicLabel) {
            const labelDiv = createMusicLabel(location.current_track.name, markerColor);
            musicLabel = new MusicLabel(position, labelDiv);
            musicLabel.setMap(map);
          }
        }

        // Create info window
        const infoWindow = new window.google.maps.InfoWindow({
          content: createInfoWindowContent(userId, location),
          pixelOffset: new window.google.maps.Size(0, -40),
          disableAutoPan: false,
        });

        // Handle marker click
        marker.addListener('click', () => {
          console.log('Marker clicked:', userId);
          
          // Close any active info window
          if (activeInfoWindow) {
            activeInfoWindow.close();
          }
          
          // Open this info window and set as active
          infoWindow.open(map, marker);
          setActiveInfoWindow(infoWindow);
        });

        // Store marker data
        setMarkers((prev) => {
          const newMarkers = {
            ...prev,
            [userId]: {
              marker: marker,
              infoWindow: infoWindow,
              musicLabel: musicLabel,
            },
          };
          console.log('Markers state updated, total markers:', Object.keys(newMarkers).length);
          return newMarkers;
        });
        
        console.log('✅ Marker successfully created and added to map');
      });
    }
  };

  const createInfoWindowContent = (userId, location) => {
    const track = location.current_track;

    return `
      <div style="padding: 12px; min-width: 220px; max-width: 280px; background: #181818; border-radius: 10px;">
        ${track ? `
          <div style="display: flex; gap: 10px; align-items: center;">
            ${track.album?.images?.[2]?.url ? `
              <img src="${track.album.images[2].url}" alt="Album" style="width: 50px; height: 50px; border-radius: 6px; flex-shrink: 0;" />
            ` : ''}
            <div style="flex: 1; min-width: 0;">
              <p style="margin: 0 0 4px 0; color: #ffffff; font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${track.name || 'Unknown Track'}</p>
              <p style="margin: 0; color: #b3b3b3; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${track.artists?.[0]?.name || 'Unknown Artist'}</p>
            </div>
          </div>
        ` : `
          <div style="text-align: center; padding: 8px;">
            <p style="margin: 0; color: #888888; font-size: 12px;">Not playing music</p>
          </div>
        `}
      </div>
    `;
  };

  const removeMarker = (userId) => {
    if (markers[userId]) {
      // Remove marker from map
      if (markers[userId].marker) {
        markers[userId].marker.setMap(null);
      }
      
      // Close and remove info window
      if (markers[userId].infoWindow) {
        markers[userId].infoWindow.close();
        
        // If this is the active info window, clear it
        if (activeInfoWindow === markers[userId].infoWindow) {
          setActiveInfoWindow(null);
        }
      }
      
      // Remove music label overlay
      if (markers[userId].musicLabel) {
        markers[userId].musicLabel.setMap(null);
      }
      
      // Update markers state
      setMarkers((prev) => {
        const newMarkers = { ...prev };
        delete newMarkers[userId];
        return newMarkers;
      });
      
      console.log(`✅ Marker removed for user: ${userId}`);
    }

    // Update user locations state
    setUserLocations((prev) => {
      const newLocations = { ...prev };
      delete newLocations[userId];
      return newLocations;
    });
  };

  // Track location and current song
  useEffect(() => {
    if (!locationEnabled || !websocket) return;

    // Share location immediately when enabled
    shareLocationAndSong();

    // Then continue sharing every 5 seconds
    const interval = setInterval(() => {
      shareLocationAndSong();
    }, 5000);

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

          // Center map on user's location
          if (map) {
            map.setCenter({ lat: locationData.lat, lng: locationData.lng });
            map.setZoom(15);
          }

          // Create marker immediately for current user
          locationData.last_updated = new Date().toISOString();
          console.log('Creating marker for current user...');
          updateMarker(user.id, locationData);

          // Update userLocations state to reflect active user count
          setUserLocations((prev) => ({
            ...prev,
            [user.id]: locationData,
          }));

          // Also send via WebSocket for other users
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
        
        if (error.code === 1) {
          // Permission denied - try to help the user
          console.log('Location permission denied. Trying to help user enable it...');
          alert(
            'Location access is blocked.\n\n' +
            'To enable:\n' +
            '1. Click the lock icon 🔒 or info icon (i) in the address bar\n' +
            '2. Find "Location" and set it to "Allow"\n' +
            '3. Refresh the page\n' +
            '4. Try "Share Location" again'
          );
        } else if (error.code === 2) {
          console.log('Location unavailable');
          alert('Location unavailable. Please check your device GPS settings.');
        } else if (error.code === 3) {
          console.log('Location timeout');
          alert('Location request timed out. Please try again.');
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      }
    );
  };

  const toggleLocationSharing = () => {
    console.log('Toggle button clicked. Current state:', locationEnabled);
    
    if (!locationEnabled) {
      // Try to enable location sharing
      if (!navigator.geolocation) {
        console.error('Geolocation not supported');
        alert('Geolocation is not supported by your browser. Please try a different browser.');
        return;
      }
      
      console.log('WebSocket ready?', websocket?.readyState === WebSocket.OPEN);
      console.log('Map ready?', !!map);
      
      setLocationEnabled(true);
      console.log('✅ Location sharing ENABLED');
    } else {
      setLocationEnabled(false);
      console.log('❌ Location sharing DISABLED');
      
      // Remove current user from active locations
      removeMarker(user.id);
      setUserLocations((prev) => {
        const newLocations = { ...prev };
        delete newLocations[user.id];
        return newLocations;
      });
      
      // Notify other users via WebSocket
      if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify({
          lat: 0,
          lng: 0,
          disconnected: true,
        }));
        console.log('Sent disconnect notification');
      }
    }
  };

  return (
    <div style={styles.page} data-testid="map-page">
      <style>{`
        .gm-style-iw-d {
          overflow: auto !important;
        }
        .gm-style-iw {
          padding: 0 !important;
        }
        .gm-style-iw button {
          display: none !important;
        }
        
        /* Make marker images circular with border */
        img[src*="scdn.co"], img[src*="placeholder"] {
          border-radius: 50% !important;
          border: 3px solid #1DB954 !important;
        }
      `}</style>
      <div style={styles.controls}>
        <div style={styles.controlsContent}>
          <div style={styles.stats}>
            <div style={styles.stat}>
              <Users size={20} color="#1DB954" />
              <span>{Object.keys(userLocations).length} Active</span>
            </div>
          </div>
          <button
            className={locationEnabled ? 'btn-spotify' : 'btn-secondary'}
            onClick={toggleLocationSharing}
            data-testid="share-location-btn"
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
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
