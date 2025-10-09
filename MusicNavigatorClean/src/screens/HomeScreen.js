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
        `${API}/spotify/playlists?access_token=${accessToken}`
      );
      setPlaylists(response.data.items || []);
    } catch (error) {
      console.error('Error loading playlists:', error);
    }
  };

  const loadCategories = async () => {
    try {
      const response = await axios.get(
        `${API}/spotify/categories?access_token=${accessToken}`
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
            colors={['transparent', 'rgba(0,0,0,0.7)']}
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
          colors={['transparent', 'rgba(0,0,0,0.8)']}
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
              <Icon name="person" size={24} color="#fff" />
            </LinearGradient>
            <View style={styles.userText}>
              <Text style={styles.welcomeText}>Welcome back,</Text>
              <Text style={styles.userName}>{user?.name || 'User'}</Text>
            </View>
          </View>
          
          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
            <GlassCard style={styles.logoutButtonCard}>
              <Icon name="logout" size={20} color="#fff" />
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
            <Icon name="map" size={24} color="#fff" />
            <Text style={styles.mapButtonText}>Open Live Map</Text>
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
              <Text style={styles.loadingText}>Loading playlists...</Text>
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
              <Text style={styles.loadingText}>Loading categories...</Text>
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
          <Text style={styles.sectionTitle}>Your Music</Text>
          <View style={styles.statsContainer}>
            <GlassCard style={styles.statCard}>
              <View style={styles.statContent}>
                <Icon name="library-music" size={28} color="#1DB954" />
                <Text style={styles.statNumber}>{playlists.length}</Text>
                <Text style={styles.statLabel}>Playlists</Text>
              </View>
            </GlassCard>
            
            <GlassCard style={styles.statCard}>
              <View style={styles.statContent}>
                <Icon name="category" size={28} color="#1DB954" />
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
    paddingTop: StatusBar.currentHeight + 16,
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
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
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
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
    marginTop: 2,
  },
  logoutButton: {
    width: 44,
    height: 44,
  },
  logoutButtonCard: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mapButtonContainer: {
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  mapButton: {
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#1DB954',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  mapButtonGradient: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginLeft: 8,
    letterSpacing: 0.5,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#ffffff',
    paddingHorizontal: 16,
    marginBottom: 16,
    letterSpacing: 0.5,
  },
  loadingContainer: {
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  loadingText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 14,
    textAlign: 'center',
  },
  horizontalList: {
    paddingRight: 16,
  },
  playlistCard: {
    width: 160,
    height: 200,
    marginRight: 8,
  },
  playlistContent: {
    flex: 1,
  },
  playlistImageContainer: {
    flex: 1,
    borderRadius: 12,
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
    height: 60,
  },
  playlistInfo: {
    paddingHorizontal: 4,
  },
  playlistName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
    lineHeight: 18,
  },
  playlistTracks: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '400',
  },
  categoryCard: {
    width: 160,
    height: 120,
    marginRight: 8,
  },
  categoryContent: {
    flex: 1,
    borderRadius: 12,
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
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
    padding: 12,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    justifyContent: 'space-between',
  },
  statCard: {
    flex: 1,
    marginHorizontal: 4,
    minHeight: 100,
  },
  statContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  statNumber: {
    fontSize: 28,
    fontWeight: '800',
    color: '#ffffff',
    marginTop: 8,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '500',
  },
});

export default HomeScreen;"