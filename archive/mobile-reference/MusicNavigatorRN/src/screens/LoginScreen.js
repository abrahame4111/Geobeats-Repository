import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Linking,
  StatusBar,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useAuth } from '../context/AuthContext';
import Icon from 'react-native-vector-icons/MaterialIcons';

const LoginScreen = ({ navigation }) => {
  const { login, API } = useAuth();
  const [showWebView, setShowWebView] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSpotifyLogin = async () => {
    try {
      setLoading(true);
      const authUrl = `${API}/auth/login`;
      setShowWebView(true);
    } catch (error) {
      Alert.alert('Error', 'Failed to initiate login');
    } finally {
      setLoading(false);
    }
  };

  const handleWebViewNavigationStateChange = (navState) => {
    const { url } = navState;
    
    // Check if we're back to the main app with auth parameters
    if (url.includes('access_token=')) {
      const urlParams = new URLSearchParams(url.split('?')[1]);
      const accessToken = urlParams.get('access_token');
      const refreshToken = urlParams.get('refresh_token');
      const userId = urlParams.get('user_id');
      const userName = urlParams.get('user_name');
      const userEmail = urlParams.get('user_email');

      if (accessToken && refreshToken && userId) {
        const user = {
          id: userId,
          name: userName || userId,
          email: userEmail || '',
        };
        
        login(accessToken, refreshToken, user);
        setShowWebView(false);
        navigation.replace('Home');
      }
    }
  };

  if (showWebView) {
    return (
      <View style={styles.webViewContainer}>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={() => setShowWebView(false)}>
          <Icon name="close" size={24} color="#fff" />
        </TouchableOpacity>
        <WebView
          source={{ uri: `${API}/auth/login` }}
          onNavigationStateChange={handleWebViewNavigationStateChange}
          style={styles.webView}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#191414" />
      
      <View style={styles.header}>
        <Icon name="music-note" size={64} color="#1DB954" />
        <Text style={styles.title}>Music Navigator</Text>
        <Text style={styles.subtitle}>
          Stream your music and share your location with friends in real-time
        </Text>
      </View>

      <View style={styles.features}>
        <View style={styles.feature}>
          <Icon name="library-music" size={32} color="#1DB954" />
          <Text style={styles.featureTitle}>Full Music Control</Text>
          <Text style={styles.featureText}>
            Access your playlists, browse categories, and control playback
          </Text>
        </View>
        
        <View style={styles.feature}>
          <Icon name="map" size={32} color="#1DB954" />
          <Text style={styles.featureTitle}>Live Location Map</Text>
          <Text style={styles.featureText}>
            See friends on the map with their current songs playing
          </Text>
        </View>
        
        <View style={styles.feature}>
          <Icon name="people" size={32} color="#1DB954" />
          <Text style={styles.featureTitle}>Real-Time Updates</Text>
          <Text style={styles.featureText}>
            Location and music sync automatically across all users
          </Text>
        </View>
      </View>

      <TouchableOpacity
        style={styles.loginButton}
        onPress={handleSpotifyLogin}
        disabled={loading}>
        <Icon name="music-note" size={24} color="#fff" />
        <Text style={styles.loginButtonText}>
          {loading ? 'Connecting...' : 'Login with Spotify'}
        </Text>
      </TouchableOpacity>

      <Text style={styles.note}>
        Note: Spotify Premium is required for full playback control
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#191414',
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#1DB954',
    marginTop: 16,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#b3b3b3',
    textAlign: 'center',
    lineHeight: 22,
  },
  features: {
    marginBottom: 40,
  },
  feature: {
    alignItems: 'center',
    marginBottom: 24,
    paddingHorizontal: 20,
  },
  featureTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginTop: 8,
    marginBottom: 4,
  },
  featureText: {
    fontSize: 14,
    color: '#b3b3b3',
    textAlign: 'center',
    lineHeight: 18,
  },
  loginButton: {
    backgroundColor: '#1DB954',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 25,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  loginButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  note: {
    fontSize: 12,
    color: '#b3b3b3',
    textAlign: 'center',
  },
  webViewContainer: {
    flex: 1,
    backgroundColor: '#191414',
  },
  closeButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 8,
    borderRadius: 20,
  },
  webView: {
    flex: 1,
    marginTop: 80,
  },
});

export default LoginScreen;