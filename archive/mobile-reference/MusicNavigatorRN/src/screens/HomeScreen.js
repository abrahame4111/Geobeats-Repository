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
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import Icon from 'react-native-vector-icons/MaterialIcons';
import axios from 'axios';

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

  const renderPlaylist = ({ item }) => (
    <TouchableOpacity style={styles.playlistCard}>
      <Image
        source={{
          uri: item.images?.[0]?.url || 'https://via.placeholder.com/200x200/1DB954/ffffff?text=Playlist'
        }}
        style={styles.playlistImage}
      />
      <Text style={styles.playlistName} numberOfLines={2}>
        {item.name}
      </Text>
      <Text style={styles.playlistTracks}>
        {item.tracks?.total} tracks
      </Text>
    </TouchableOpacity>
  );

  const renderCategory = ({ item }) => (
    <TouchableOpacity style={styles.categoryCard}>
      <Image
        source={{
          uri: item.icons?.[0]?.url || 'https://via.placeholder.com/200x200/1DB954/ffffff?text=Category'
        }}
        style={styles.categoryImage}
      />
      <Text style={styles.categoryName}>
        {item.name}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.welcomeText}>Welcome back,</Text>
        <Text style={styles.userName}>{user?.name || 'User'}</Text>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Icon name="logout" size={24} color="#b3b3b3" />
        </TouchableOpacity>
      </View>

      {/* Map Button */}
      <TouchableOpacity style={styles.mapButton} onPress={navigateToMap}>
        <Icon name="map" size={24} color="#fff" />
        <Text style={styles.mapButtonText}>Open Live Map</Text>
      </TouchableOpacity>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Your Playlists */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Playlists</Text>
          <FlatList
            data={playlists}
            renderItem={renderPlaylist}
            keyExtractor={(item) => item.id}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalList}
          />
        </View>

        {/* Browse Categories */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Browse Categories</Text>
          <FlatList
            data={categories}
            renderItem={renderCategory}
            keyExtractor={(item) => item.id}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalList}
          />
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#191414',
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  welcomeText: {
    fontSize: 16,
    color: '#b3b3b3',
  },
  userName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginLeft: 8,
    flex: 1,
  },
  logoutButton: {
    padding: 8,
  },
  mapButton: {
    backgroundColor: '#1DB954',
    marginHorizontal: 20,
    marginBottom: 20,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  content: {
    flex: 1,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  horizontalList: {
    paddingHorizontal: 16,
  },
  playlistCard: {
    width: 160,
    marginHorizontal: 4,
    backgroundColor: '#282828',
    borderRadius: 8,
    padding: 12,
  },
  playlistImage: {
    width: '100%',
    height: 136,
    borderRadius: 4,
    marginBottom: 8,
  },
  playlistName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  playlistTracks: {
    fontSize: 12,
    color: '#b3b3b3',
  },
  categoryCard: {
    width: 160,
    marginHorizontal: 4,
  },
  categoryImage: {
    width: '100%',
    height: 136,
    borderRadius: 8,
    marginBottom: 8,
  },
  categoryName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
  },
});

export default HomeScreen;