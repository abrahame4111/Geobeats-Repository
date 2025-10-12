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
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useAuth } from '../context/AuthContext';
import GlassCard from '../components/GlassCard';
import Icon from 'react-native-vector-icons/MaterialIcons';
import axios from 'axios';
import { API_ENDPOINTS } from '../config/config';

const { width } = Dimensions.get('window');

const HomeScreen = ({ navigation }) => {
  const { user, accessToken, logout, API } = useAuth();
  const [playlists, setPlaylists] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
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
      <TouchableOpacity style={styles.playlistContent}>
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
    <GlassCard style={[styles.categoryCard, { marginLeft: index === 0 ? 16 : 8 }]}>
      <TouchableOpacity style={styles.categoryContent}>
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
    </GlassCard>
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
            </View>
          </View>
          
          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
            <GlassCard style={styles.logoutButtonCard}>
              <Icon name="logout" size={22} color="#fff" />
            </GlassCard>
          </TouchableOpacity>
        </View>
      </View>

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
          {loading ? (
            <View style={styles.loadingContainer}>
              <GlassCard style={styles.loadingCard}>
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
          {loading ? (
            <View style={styles.loadingContainer}>
              <GlassCard style={styles.loadingCard}>
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
      </ScrollView>
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
    paddingBottom: 20,
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
  logoutButton: {
    width: 48,
    height: 48,
  },
  logoutButtonCard: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mapButtonContainer: {
    paddingHorizontal: 16,
    marginBottom: 24,
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
    marginBottom: 36,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#ffffff',
    paddingHorizontal: 16,
    marginBottom: 18,
    letterSpacing: 0.6,
  },
  loadingContainer: {
    paddingHorizontal: 16,
  },
  loadingCard: {
    minHeight: 60,
    justifyContent: 'center',
  },
  loadingText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 14,
    textAlign: 'center',
  },
  horizontalList: {
    paddingRight: 16,
  },
  playlistCard: {
    width: 170,
    height: 210,
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
  categoryCard: {
    width: 170,
    height: 130,
    marginRight: 8,
  },
  categoryContent: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
    justifyContent: 'flex-end',
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
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
    padding: 14,
    textShadowColor: 'rgba(0, 0, 0, 0.9)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
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
});

export default HomeScreen;