import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Image,
  FlatList,
  Alert,
  StatusBar,
  Dimensions,
  Modal,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useAuth } from '../context/AuthContext';
import GlassCard from '../components/GlassCard';
import Icon from 'react-native-vector-icons/MaterialIcons';
import axios from 'axios';
import { API_ENDPOINTS } from '../config/config';

const { width, height } = Dimensions.get('window');

const HomeScreen = ({ navigation }) => {
  const { user, accessToken, logout, API } = useAuth();
  const [playlists, setPlaylists] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isPremium, setIsPremium] = useState(false);
  const [currentlyPlaying, setCurrentlyPlaying] = useState(null);
  
  // Playlist Modal State
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [playlistTracks, setPlaylistTracks] = useState([]);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  
  // Category Modal State
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [categoryPlaylists, setCategoryPlaylists] = useState([]);
  const [loadingCategory, setLoadingCategory] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  
  // Search State
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);

  useEffect(() => {
    loadData();
    checkPremiumStatus();
    fetchCurrentlyPlaying();
    
    // Refresh currently playing every 5 seconds
    const interval = setInterval(fetchCurrentlyPlaying, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      await Promise.all([
        loadPlaylists(),
        loadCategories(),
      ]);
    } catch (error) {
      console.error('Error loading data:', error);
      Alert.alert('Error', 'Failed to load Spotify data');
    } finally {
      setLoading(false);
    }
  };

  const checkPremiumStatus = async () => {
    try {
      const response = await axios.get(`${API}/spotify/premium-status`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      setIsPremium(response.data.is_premium);
    } catch (error) {
      console.error('Failed to check premium status:', error);
    }
  };

  const fetchCurrentlyPlaying = async () => {
    try {
      const response = await axios.get(`${API}${API_ENDPOINTS.SPOTIFY.CURRENTLY_PLAYING}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      console.log('🎵 Currently playing response:', response.data);
      
      if (response.data && response.data.item) {
        setCurrentlyPlaying(response.data);
      } else if (response.data && response.data.is_playing === false) {
        setCurrentlyPlaying(null);
      }
    } catch (error) {
      console.log('Currently playing fetch error:', error.message);
    }
  };

  const loadPlaylists = async () => {
    try {
      const response = await axios.get(
        `${API}${API_ENDPOINTS.SPOTIFY.PLAYLISTS}?access_token=${accessToken}`
      );
      setPlaylists(response.data.items || []);
    } catch (error) {
      console.error('Error loading playlists:', error);
    }
  };

  const loadCategories = async () => {
    try {
      const response = await axios.get(
        `${API}${API_ENDPOINTS.SPOTIFY.CATEGORIES}?access_token=${accessToken}`
      );
      setCategories(response.data.categories?.items || []);
    } catch (error) {
      console.error('Error loading categories:', error);
    }
  };

  // Search functions
  const searchSpotify = async () => {
    if (!searchQuery.trim()) return;
    
    setSearchLoading(true);
    try {
      const response = await axios.get(
        `${API}/spotify/search?q=${encodeURIComponent(searchQuery)}&access_token=${accessToken}`
      );
      
      setSearchResults(response.data.tracks?.items || []);
    } catch (error) {
      console.error('Search error:', error);
      Alert.alert('Error', 'Failed to search. Please try again.');
    } finally {
      setSearchLoading(false);
    }
  };

  // Category functions
  const openCategory = async (category) => {
    setSelectedCategory(category);
    setShowCategoryModal(true);
    setLoadingCategory(true);
    
    try {
      const response = await axios.get(
        `${API}/spotify/category/${category.id}/playlists?access_token=${accessToken}`
      );
      setCategoryPlaylists(response.data.playlists?.items || []);
    } catch (error) {
      console.error('Error loading category playlists:', error);
      Alert.alert('Error', 'Failed to load category playlists');
    } finally {
      setLoadingCategory(false);
    }
  };

  const openPlaylist = async (playlist) => {
    setSelectedPlaylist(playlist);
    setShowPlaylistModal(true);
    setShowCategoryModal(false);
    setLoadingTracks(true);
    
    try {
      const response = await axios.get(
        `${API}/spotify/playlist/${playlist.id}/tracks?access_token=${accessToken}`
      );
      setPlaylistTracks(response.data.items || []);
    } catch (error) {
      console.error('Error loading playlist tracks:', error);
      try {
        const tracksUrl = playlist.tracks?.href;
        if (tracksUrl) {
          const response = await axios.get(`${API}/spotify/proxy?url=${encodeURIComponent(tracksUrl)}&access_token=${accessToken}`);
          setPlaylistTracks(response.data.items || []);
        }
      } catch (e) {
        Alert.alert('Error', 'Failed to load playlist tracks');
      }
    } finally {
      setLoadingTracks(false);
    }
  };

  const playTrack = async (trackUri, trackName) => {
    if (!isPremium) {
      Alert.alert(
        '🎫 Premium Required',
        'Playing songs requires Spotify Premium. You can still browse and see what\'s playing on other devices.',
        [{ text: 'OK' }]
      );
      return;
    }

    try {
      console.log('🎵 Playing track:', trackUri);
      
      const response = await axios.put(
        `${API}/spotify/play?uri=${encodeURIComponent(trackUri)}`,
        null,
        {
          headers: { Authorization: `Bearer ${accessToken}` }
        }
      );
      
      console.log('🎵 Play response:', response.data);
      
      if (response.data.success) {
        Alert.alert('🎵 Now Playing', trackName);
        setShowSearchModal(false);
        setTimeout(fetchCurrentlyPlaying, 1000);
      } else {
        Alert.alert(
          'Playback Error',
          response.data.error || 'Failed to play track. Make sure Spotify is open on a device.',
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      console.error('Play error:', error.response?.data || error.message);
      Alert.alert(
        'Error', 
        error.response?.data?.error || 'Failed to play track. Make sure Spotify is open on your phone or computer.'
      );
    }
  };

  const playPlaylist = async (playlistUri) => {
    if (!isPremium) {
      Alert.alert(
        '🎫 Premium Required',
        'Playing playlists requires Spotify Premium.',
        [{ text: 'OK' }]
      );
      return;
    }

    try {
      console.log('🎵 Playing playlist:', playlistUri);
      
      const response = await axios.put(
        `${API}/spotify/play/context?context_uri=${encodeURIComponent(playlistUri)}`,
        null,
        {
          headers: { Authorization: `Bearer ${accessToken}` }
        }
      );
      
      console.log('🎵 Play playlist response:', response.data);
      
      if (response.data.success) {
        Alert.alert('🎵 Playing Playlist', selectedPlaylist?.name || 'Playlist');
        setShowPlaylistModal(false);
        setTimeout(fetchCurrentlyPlaying, 1000);
      } else {
        Alert.alert(
          'Playback Error',
          response.data.error || 'Failed to play playlist. Make sure Spotify is open.',
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      console.error('Play playlist error:', error.response?.data || error.message);
      Alert.alert(
        'Error', 
        error.response?.data?.error || 'Failed to play playlist. Make sure Spotify is open on your phone or computer.'
      );
    }
  };

  const togglePlayback = async () => {
    if (!isPremium) {
      Alert.alert('🎫 Premium Required', 'Playback controls require Spotify Premium.');
      return;
    }

    try {
      if (currentlyPlaying?.is_playing) {
        await axios.put(`${API}/spotify/pause`, null, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
      } else {
        await axios.put(`${API}/spotify/play`, null, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
      }
      fetchCurrentlyPlaying();
    } catch (error) {
      console.error('Toggle playback error:', error);
    }
  };

  const skipTrack = async (direction) => {
    if (!isPremium) return;

    try {
      if (direction === 'next') {
        await axios.post(`${API}/spotify/next`, null, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
      } else {
        await axios.post(`${API}/spotify/previous`, null, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
      }
      setTimeout(fetchCurrentlyPlaying, 500);
    } catch (error) {
      console.error('Skip error:', error);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Logout', onPress: logout },
      ]
    );
  };

  const navigateToMap = () => {
    navigation.navigate('Map');
  };

  const renderPlaylist = ({ item, index }) => (
    <GlassCard style={[styles.playlistCard, { marginLeft: index === 0 ? 16 : 8 }]}>
      <TouchableOpacity 
        style={styles.playlistContent}
        onPress={() => openPlaylist(item)}
        activeOpacity={0.7}
      >
        <View style={styles.playlistImageContainer}>
          <Image
            source={{
              uri: item.images?.[0]?.url || 'https://via.placeholder.com/200x200/1DB954/ffffff?text=Playlist'
            }}
            style={styles.playlistImage}
          />
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.8)']}
            style={styles.playlistImageOverlay}
          />
          <View style={styles.playOverlay}>
            <LinearGradient colors={['#1DB954', '#1ed760']} style={styles.playButtonSmall}>
              <Icon name="play-arrow" size={24} color="#fff" />
            </LinearGradient>
          </View>
        </View>
        <View style={styles.playlistInfo}>
          <Text style={styles.playlistName} numberOfLines={2}>
            {item.name}
          </Text>
          <Text style={styles.playlistTracks}>
            {item.tracks?.total} tracks
          </Text>
        </View>
      </TouchableOpacity>
    </GlassCard>
  );

  const renderCategory = ({ item, index }) => (
    <TouchableOpacity 
      style={[styles.categoryCard, { marginLeft: index === 0 ? 16 : 8 }]}
      onPress={() => openCategory(item)}
      activeOpacity={0.7}
    >
      <Image
        source={{
          uri: item.icons?.[0]?.url || 'https://via.placeholder.com/200x200/1DB954/ffffff?text=Category'
        }}
        style={styles.categoryImage}
      />
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.9)']}
        style={styles.categoryImageOverlay}
      />
      <Text style={styles.categoryName}>
        {item.name}
      </Text>
    </TouchableOpacity>
  );

  const renderTrackItem = ({ item, index }) => {
    const track = item.track || item;
    if (!track || !track.name) return null;
    
    return (
      <TouchableOpacity 
        style={styles.trackItem}
        onPress={() => playTrack(track.uri, track.name)}
        activeOpacity={0.7}
      >
        <Text style={styles.trackNumber}>{index + 1}</Text>
        {track.album?.images?.[0]?.url && (
          <Image source={{ uri: track.album.images[0].url }} style={styles.trackAlbum} />
        )}
        <View style={styles.trackInfo}>
          <Text style={styles.trackName} numberOfLines={1}>{track.name}</Text>
          <Text style={styles.trackArtist} numberOfLines={1}>
            {track.artists?.map(a => a.name).join(', ')}
          </Text>
        </View>
        <TouchableOpacity 
          style={styles.trackPlayBtn}
          onPress={() => playTrack(track.uri, track.name)}
        >
          <Icon name="play-circle-outline" size={28} color="#1DB954" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const renderSearchResult = ({ item, index }) => (
    <TouchableOpacity 
      style={styles.searchResultItem}
      onPress={() => playTrack(item.uri, item.name)}
      activeOpacity={0.7}
    >
      {item.album?.images?.[0]?.url && (
        <Image source={{ uri: item.album.images[0].url }} style={styles.searchAlbum} />
      )}
      <View style={styles.searchInfo}>
        <Text style={styles.searchTrackName} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.searchArtist} numberOfLines={1}>
          {item.artists?.map(a => a.name).join(', ')}
        </Text>
      </View>
      <TouchableOpacity 
        style={styles.searchPlayBtn}
        onPress={() => playTrack(item.uri, item.name)}
      >
        <Icon name="play-circle-filled" size={36} color="#1DB954" />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  // Search Modal
  const renderSearchModal = () => (
    <Modal
      visible={showSearchModal}
      animationType="slide"
      transparent={false}
      onRequestClose={() => setShowSearchModal(false)}
    >
      <LinearGradient colors={['#191414', '#0d0d0d', '#000000']} style={styles.modalContainer}>
        <StatusBar barStyle="light-content" />
        
        {/* Header */}
        <View style={styles.searchHeader}>
          <TouchableOpacity 
            style={styles.searchBackBtn}
            onPress={() => setShowSearchModal(false)}
          >
            <Icon name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.searchTitle}>Search</Text>
          <View style={{ width: 40 }} />
        </View>
        
        {/* Search Input */}
        <View style={styles.searchInputContainer}>
          <Icon name="search" size={24} color="#888" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search for songs, artists..."
            placeholderTextColor="#888"
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={searchSpotify}
            returnKeyType="search"
            autoFocus
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Icon name="close" size={24} color="#888" />
            </TouchableOpacity>
          )}
        </View>
        
        {/* Search Button */}
        <TouchableOpacity 
          style={styles.searchButton}
          onPress={searchSpotify}
        >
          <LinearGradient colors={['#1DB954', '#1ed760']} style={styles.searchButtonGradient}>
            <Text style={styles.searchButtonText}>Search</Text>
          </LinearGradient>
        </TouchableOpacity>
        
        {/* Results */}
        {searchLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#1DB954" />
            <Text style={styles.loadingText}>Searching...</Text>
          </View>
        ) : (
          <FlatList
            data={searchResults}
            renderItem={renderSearchResult}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.searchResultsList}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              searchQuery.length > 0 ? (
                <View style={styles.emptyContainer}>
                  <Icon name="search-off" size={48} color="#666" />
                  <Text style={styles.emptyText}>No results found</Text>
                </View>
              ) : (
                <View style={styles.emptyContainer}>
                  <Icon name="music-note" size={48} color="#666" />
                  <Text style={styles.emptyText}>Search for your favorite songs</Text>
                </View>
              )
            }
          />
        )}
        
        {!isPremium && (
          <View style={styles.premiumBanner}>
            <Icon name="lock" size={18} color="#FFD700" />
            <Text style={styles.premiumBannerText}>
              Upgrade to Premium to play songs
            </Text>
          </View>
        )}
      </LinearGradient>
    </Modal>
  );

  // Category Modal
  const renderCategoryModal = () => (
    <Modal
      visible={showCategoryModal}
      animationType="slide"
      transparent={false}
      onRequestClose={() => setShowCategoryModal(false)}
    >
      <LinearGradient colors={['#191414', '#0d0d0d', '#000000']} style={styles.modalContainer}>
        <StatusBar barStyle="light-content" />
        
        {/* Header */}
        <View style={styles.modalHeader}>
          <TouchableOpacity 
            style={styles.modalBackBtn}
            onPress={() => setShowCategoryModal(false)}
          >
            <Icon name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.modalTitle} numberOfLines={1}>
            {selectedCategory?.name}
          </Text>
          <View style={{ width: 40 }} />
        </View>
        
        {/* Category Playlists */}
        {loadingCategory ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#1DB954" />
            <Text style={styles.loadingText}>Loading playlists...</Text>
          </View>
        ) : (
          <FlatList
            data={categoryPlaylists}
            renderItem={({ item }) => (
              <TouchableOpacity 
                style={styles.categoryPlaylistItem}
                onPress={() => openPlaylist(item)}
                activeOpacity={0.7}
              >
                {item.images?.[0]?.url && (
                  <Image source={{ uri: item.images[0].url }} style={styles.categoryPlaylistImage} />
                )}
                <View style={styles.categoryPlaylistInfo}>
                  <Text style={styles.categoryPlaylistName} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.categoryPlaylistDesc} numberOfLines={2}>
                    {item.description || `${item.tracks?.total || 0} tracks`}
                  </Text>
                </View>
                <Icon name="chevron-right" size={24} color="#666" />
              </TouchableOpacity>
            )}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.categoryPlaylistsList}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Icon name="playlist-play" size={48} color="#666" />
                <Text style={styles.emptyText}>No playlists found</Text>
              </View>
            }
          />
        )}
      </LinearGradient>
    </Modal>
  );

  // Playlist Modal
  const renderPlaylistModal = () => (
    <Modal
      visible={showPlaylistModal}
      animationType="slide"
      transparent={false}
      onRequestClose={() => setShowPlaylistModal(false)}
    >
      <LinearGradient colors={['#191414', '#0d0d0d', '#000000']} style={styles.modalContainer}>
        <StatusBar barStyle="light-content" />
        
        {/* Header */}
        <View style={styles.modalHeader}>
          <TouchableOpacity 
            style={styles.modalBackBtn}
            onPress={() => setShowPlaylistModal(false)}
          >
            <Icon name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.modalTitle} numberOfLines={1}>
            {selectedPlaylist?.name}
          </Text>
          <View style={{ width: 40 }} />
        </View>
        
        {/* Playlist Info */}
        <View style={styles.playlistHeader}>
          {selectedPlaylist?.images?.[0]?.url && (
            <Image 
              source={{ uri: selectedPlaylist.images[0].url }} 
              style={styles.playlistCover}
            />
          )}
          <Text style={styles.playlistDescription} numberOfLines={2}>
            {selectedPlaylist?.description || `${selectedPlaylist?.tracks?.total} tracks`}
          </Text>
          
          {/* Play All Button */}
          <TouchableOpacity 
            style={styles.playAllBtn}
            onPress={() => playPlaylist(selectedPlaylist?.uri)}
          >
            <LinearGradient colors={['#1DB954', '#1ed760']} style={styles.playAllGradient}>
              <Icon name="play-arrow" size={28} color="#fff" />
              <Text style={styles.playAllText}>Play All</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
        
        {/* Tracks List */}
        {loadingTracks ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#1DB954" />
            <Text style={styles.loadingText}>Loading tracks...</Text>
          </View>
        ) : (
          <FlatList
            data={playlistTracks}
            renderItem={renderTrackItem}
            keyExtractor={(item, index) => item.track?.id || index.toString()}
            contentContainerStyle={styles.tracksList}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Icon name="music-off" size={48} color="#666" />
                <Text style={styles.emptyText}>No tracks found</Text>
                <Text style={styles.emptySubtext}>This playlist might be empty or private</Text>
              </View>
            }
          />
        )}
        
        {!isPremium && (
          <View style={styles.premiumBanner}>
            <Icon name="lock" size={18} color="#FFD700" />
            <Text style={styles.premiumBannerText}>
              Upgrade to Premium to play songs
            </Text>
          </View>
        )}
      </LinearGradient>
    </Modal>
  );

  return (
    <LinearGradient
      colors={['#191414', '#0d0d0d', '#000000']}
      style={styles.container}
    >
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.userInfo}>
            <LinearGradient
              colors={['#1ED760', '#1DB954']}
              style={styles.avatar}
            >
              <Icon name="person" size={26} color="#fff" />
            </LinearGradient>
            <View style={styles.userText}>
              <Text style={styles.welcomeText}>Welcome back,</Text>
              <Text style={styles.userName}>{user?.name || 'User'}</Text>
              {isPremium && (
                <View style={styles.premiumBadge}>
                  <Text style={styles.premiumBadgeText}>Premium</Text>
                </View>
              )}
            </View>
          </View>
          
          {/* Search Button instead of Logout */}
          <TouchableOpacity style={styles.searchIconButton} onPress={() => setShowSearchModal(true)}>
            <View style={styles.searchIconContainer}>
              <Icon name="search" size={24} color="#1DB954" />
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* Currently Playing Mini Player */}
      {currentlyPlaying?.item ? (
        <View style={styles.miniPlayerContainer}>
          <LinearGradient
            colors={['rgba(40,40,40,0.95)', 'rgba(30,30,30,0.9)']}
            style={styles.miniPlayerGradient}
          >
            <TouchableOpacity 
              style={styles.miniPlayerContent}
              onPress={navigateToMap}
              activeOpacity={0.9}
            >
              {currentlyPlaying.item.album?.images?.[0]?.url && (
                <Image 
                  source={{ uri: currentlyPlaying.item.album.images[0].url }} 
                  style={styles.miniAlbum}
                />
              )}
              <View style={styles.miniInfo}>
                <Text style={styles.miniTitle} numberOfLines={1}>
                  {currentlyPlaying.item.name}
                </Text>
                <Text style={styles.miniArtist} numberOfLines={1}>
                  {currentlyPlaying.item.artists?.map(a => a.name).join(', ')}
                </Text>
              </View>
              
              <View style={styles.miniControls}>
                <TouchableOpacity onPress={() => skipTrack('previous')} style={styles.miniBtn}>
                  <Icon name="skip-previous" size={24} color={isPremium ? "#fff" : "#666"} />
                </TouchableOpacity>
                <TouchableOpacity onPress={togglePlayback} style={styles.miniPlayBtn}>
                  <Icon 
                    name={currentlyPlaying.is_playing ? "pause" : "play-arrow"} 
                    size={28} 
                    color="#1DB954" 
                  />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => skipTrack('next')} style={styles.miniBtn}>
                  <Icon name="skip-next" size={24} color={isPremium ? "#fff" : "#666"} />
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </LinearGradient>
        </View>
      ) : (
        <View style={styles.miniPlayerContainer}>
          <LinearGradient
            colors={['rgba(40,40,40,0.95)', 'rgba(30,30,30,0.9)']}
            style={styles.miniPlayerGradient}
          >
            <View style={styles.miniPlayerContent}>
              <View style={styles.miniAlbumPlaceholder}>
                <Icon name="music-note" size={24} color="#666" />
              </View>
              <View style={styles.miniInfo}>
                <Text style={styles.miniTitle} numberOfLines={1}>
                  No music playing
                </Text>
                <Text style={styles.miniArtist} numberOfLines={1}>
                  Play a song on Spotify to see it here
                </Text>
              </View>
              <TouchableOpacity onPress={fetchCurrentlyPlaying} style={styles.miniPlayBtn}>
                <Icon name="refresh" size={24} color="#1DB954" />
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </View>
      )}

      {/* Map Button */}
      <View style={styles.mapButtonContainer}>
        <TouchableOpacity
          style={styles.mapButton}
          onPress={navigateToMap}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={['#1ED760', '#1DB954']}
            style={styles.mapButtonGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Icon name="map" size={26} color="#fff" />
            <Text style={styles.mapButtonText}>Open Global Music Map</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Your Playlists */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Playlists</Text>
          <Text style={styles.sectionSubtitle}>Tap to view tracks</Text>
          {loading ? (
            <View style={styles.loadingContainer}>
              <GlassCard style={styles.loadingCard}>
                <ActivityIndicator color="#1DB954" />
                <Text style={styles.loadingText}>Loading your music...</Text>
              </GlassCard>
            </View>
          ) : (
            <FlatList
              data={playlists}
              renderItem={renderPlaylist}
              keyExtractor={(item) => item.id}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
            />
          )}
        </View>

        {/* Browse Categories */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Browse Categories</Text>
          <Text style={styles.sectionSubtitle}>Explore by genre</Text>
          {loading ? (
            <View style={styles.loadingContainer}>
              <GlassCard style={styles.loadingCard}>
                <ActivityIndicator color="#1DB954" />
                <Text style={styles.loadingText}>Loading categories...</Text>
              </GlassCard>
            </View>
          ) : (
            <FlatList
              data={categories}
              renderItem={renderCategory}
              keyExtractor={(item) => item.id}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
            />
          )}
        </View>

        {/* Stats Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Music Stats</Text>
          <View style={styles.statsContainer}>
            <GlassCard style={styles.statCard}>
              <View style={styles.statContent}>
                <LinearGradient
                  colors={['#1ED760', '#1DB954']}
                  style={styles.statIcon}
                >
                  <Icon name="library-music" size={24} color="#fff" />
                </LinearGradient>
                <Text style={styles.statNumber}>{playlists.length}</Text>
                <Text style={styles.statLabel}>Playlists</Text>
              </View>
            </GlassCard>
            
            <GlassCard style={styles.statCard}>
              <View style={styles.statContent}>
                <LinearGradient
                  colors={['#FF6B6B', '#FF5252']}
                  style={styles.statIcon}
                >
                  <Icon name="category" size={24} color="#fff" />
                </LinearGradient>
                <Text style={styles.statNumber}>{categories.length}</Text>
                <Text style={styles.statLabel}>Categories</Text>
              </View>
            </GlassCard>
          </View>
        </View>
        
        {/* Logout Button */}
        <TouchableOpacity style={styles.logoutSection} onPress={handleLogout}>
          <Icon name="logout" size={20} color="#888" />
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Modals */}
      {renderSearchModal()}
      {renderCategoryModal()}
      {renderPlaylistModal()}
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingTop: StatusBar.currentHeight + 20,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  userText: {
    flex: 1,
  },
  welcomeText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    fontWeight: '400',
  },
  userName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#ffffff',
    marginTop: 2,
  },
  premiumBadge: {
    backgroundColor: '#FFD700',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  premiumBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#000',
  },
  searchIconButton: {
    marginLeft: 12,
  },
  searchIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(29, 185, 84, 0.3)',
  },
  
  // Mini Player
  miniPlayerContainer: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  miniPlayerGradient: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  miniPlayerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
  },
  miniAlbum: {
    width: 48,
    height: 48,
    borderRadius: 6,
  },
  miniAlbumPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  miniInfo: {
    flex: 1,
    marginLeft: 12,
  },
  miniTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  miniArtist: {
    fontSize: 12,
    color: '#b3b3b3',
    marginTop: 2,
  },
  miniControls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  miniBtn: {
    padding: 6,
  },
  miniPlayBtn: {
    padding: 6,
  },
  
  // Map Button
  mapButtonContainer: {
    paddingHorizontal: 16,
    marginBottom: 20,
    marginTop: 4,
  },
  mapButton: {
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#1DB954',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 15,
    elevation: 10,
  },
  mapButtonGradient: {
    paddingVertical: 18,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    marginLeft: 10,
    letterSpacing: 0.6,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 50,
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#ffffff',
    paddingHorizontal: 16,
    marginBottom: 4,
    letterSpacing: 0.6,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  loadingContainer: {
    paddingHorizontal: 16,
    alignItems: 'center',
    paddingVertical: 20,
  },
  loadingCard: {
    minHeight: 60,
    justifyContent: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  loadingText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 14,
    marginLeft: 12,
  },
  horizontalList: {
    paddingRight: 16,
  },
  
  // Playlist Card
  playlistCard: {
    width: 170,
    height: 220,
    marginRight: 8,
  },
  playlistContent: {
    flex: 1,
  },
  playlistImageContainer: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 12,
  },
  playlistImage: {
    width: '100%',
    height: '100%',
  },
  playlistImageOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 70,
  },
  playOverlay: {
    position: 'absolute',
    bottom: 8,
    right: 8,
  },
  playButtonSmall: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  playlistInfo: {
    paddingHorizontal: 4,
  },
  playlistName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 4,
    lineHeight: 19,
  },
  playlistTracks: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.65)',
    fontWeight: '500',
  },
  
  // Category Card
  categoryCard: {
    width: 170,
    height: 130,
    marginRight: 8,
    borderRadius: 14,
    overflow: 'hidden',
  },
  categoryImage: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  categoryImageOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '100%',
  },
  categoryName: {
    position: 'absolute',
    bottom: 14,
    left: 14,
    right: 14,
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
    textShadowColor: 'rgba(0, 0, 0, 0.9)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  
  // Stats
  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    justifyContent: 'space-between',
  },
  statCard: {
    flex: 1,
    marginHorizontal: 6,
    minHeight: 120,
  },
  statContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  statIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  statNumber: {
    fontSize: 32,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 6,
  },
  statLabel: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.7)',
    fontWeight: '600',
  },
  
  // Logout
  logoutSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    marginBottom: 30,
  },
  logoutText: {
    color: '#888',
    fontSize: 14,
    marginLeft: 8,
  },
  
  // Modal Styles
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: StatusBar.currentHeight + 10,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  modalBackBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
  },
  playlistHeader: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 20,
  },
  playlistCover: {
    width: 180,
    height: 180,
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
  },
  playlistDescription: {
    fontSize: 14,
    color: '#b3b3b3',
    textAlign: 'center',
    marginBottom: 20,
  },
  playAllBtn: {
    borderRadius: 24,
    overflow: 'hidden',
  },
  playAllGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 14,
  },
  playAllText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    marginLeft: 8,
  },
  tracksList: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  trackItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  trackNumber: {
    width: 30,
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  trackAlbum: {
    width: 48,
    height: 48,
    borderRadius: 4,
    marginRight: 12,
  },
  trackInfo: {
    flex: 1,
  },
  trackName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  trackArtist: {
    fontSize: 13,
    color: '#b3b3b3',
    marginTop: 2,
  },
  trackPlayBtn: {
    padding: 8,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#666',
    marginTop: 8,
  },
  premiumBanner: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.9)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  premiumBannerText: {
    color: '#FFD700',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  
  // Search Modal
  searchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: StatusBar.currentHeight + 10,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  searchBackBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginHorizontal: 16,
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  searchIcon: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    height: 50,
    color: '#fff',
    fontSize: 16,
  },
  searchButton: {
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 20,
    borderRadius: 24,
    overflow: 'hidden',
  },
  searchButtonGradient: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  searchButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  searchResultsList: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  searchAlbum: {
    width: 56,
    height: 56,
    borderRadius: 4,
  },
  searchInfo: {
    flex: 1,
    marginLeft: 14,
  },
  searchTrackName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  searchArtist: {
    fontSize: 14,
    color: '#b3b3b3',
    marginTop: 4,
  },
  searchPlayBtn: {
    padding: 8,
  },
  
  // Category Modal
  categoryPlaylistsList: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  categoryPlaylistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  categoryPlaylistImage: {
    width: 64,
    height: 64,
    borderRadius: 8,
  },
  categoryPlaylistInfo: {
    flex: 1,
    marginLeft: 14,
  },
  categoryPlaylistName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  categoryPlaylistDesc: {
    fontSize: 13,
    color: '#888',
    marginTop: 4,
  },
});

export default HomeScreen;
