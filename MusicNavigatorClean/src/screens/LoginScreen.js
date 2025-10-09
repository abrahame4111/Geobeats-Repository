import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  StatusBar,
  Dimensions,
} from 'react-native';
import { WebView } from 'react-native-webview';
import LinearGradient from 'react-native-linear-gradient';
import { useAuth } from '../context/AuthContext';
import GlassCard from '../components/GlassCard';
import Icon from 'react-native-vector-icons/MaterialIcons';

const { width, height } = Dimensions.get('window');

const LoginScreen = ({ navigation }) => {
  const { login, API } = useAuth();
  const [showWebView, setShowWebView] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSpotifyLogin = async () => {
    try {
      setLoading(true);
      setShowWebView(true);
    } catch (error) {
      Alert.alert('Error', 'Failed to initiate login');
    } finally {
      setLoading(false);
    }
  };

  const handleWebViewNavigationStateChange = (navState) => {
    const { url } = navState;
    
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
      <LinearGradient
        colors={['#191414', '#0d0d0d']}
        style={styles.webViewContainer}
      >
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
        
        <TouchableOpacity
          style={styles.closeButton}
          onPress={() => setShowWebView(false)}
        >
          <GlassCard style={styles.closeButtonCard} borderRadius={25}>
            <Icon name="close" size={24} color="#fff" />
          </GlassCard>
        </TouchableOpacity>
        
        <WebView
          source={{ uri: `${API}/auth/login` }}
          onNavigationStateChange={handleWebViewNavigationStateChange}
          style={styles.webView}
        />
      </LinearGradient>
    );
  }

  return (
    <LinearGradient
      colors={['#191414', '#0d0d0d', '#000000']}
      style={styles.container}
    >
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      
      {/* Background Pattern */}
      <View style={styles.backgroundPattern}>
        {Array.from({ length: 20 }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.patternDot,
              {
                left: Math.random() * width,
                top: Math.random() * height,
                opacity: Math.random() * 0.3,
              },
            ]}
          />
        ))}
      </View>

      <View style={styles.content}>
        {/* Logo Section */}
        <View style={styles.logoSection}>
          <LinearGradient
            colors={['#1ED760', '#1DB954', '#0E6B2C']}
            style={styles.logoContainer}
          >
            <Icon name="music-note" size={48} color="#fff" />
          </LinearGradient>
          
          <Text style={styles.title}>Music Navigator</Text>
          <Text style={styles.subtitle}>
            Stream your music and share your location{"\n"}
            with friends in real-time
          </Text>
        </View>

        {/* Features */}
        <View style={styles.featuresContainer}>
          {[
            {
              icon: 'library-music',
              title: 'Full Music Control',
              desc: 'Access playlists and control playback'
            },
            {
              icon: 'map',
              title: 'Live Location Map',
              desc: 'See friends with their current songs'
            },
            {
              icon: 'people',
              title: 'Real-Time Sync',
              desc: 'Music and location updates instantly'
            }
          ].map((feature, index) => (
            <GlassCard key={index} style={styles.featureCard}>
              <View style={styles.featureContent}>
                <LinearGradient
                  colors={['#1ED760', '#1DB954']}
                  style={styles.featureIcon}
                >
                  <Icon name={feature.icon} size={24} color="#fff" />
                </LinearGradient>
                <View style={styles.featureText}>
                  <Text style={styles.featureTitle}>{feature.title}</Text>
                  <Text style={styles.featureDesc}>{feature.desc}</Text>
                </View>
              </View>
            </GlassCard>
          ))}
        </View>

        {/* Login Button */}
        <TouchableOpacity
          style={styles.loginButtonContainer}
          onPress={handleSpotifyLogin}
          disabled={loading}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={loading ? ['#666', '#555'] : ['#1ED760', '#1DB954']}
            style={styles.loginButton}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Icon name="music-note" size={20} color="#fff" style={styles.loginIcon} />
            <Text style={styles.loginButtonText}>
              {loading ? 'Connecting...' : 'Login with Spotify'}
            </Text>
          </LinearGradient>
        </TouchableOpacity>

        <Text style={styles.note}>
          Spotify Premium recommended for full playback control
        </Text>
      </View>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  backgroundPattern: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  patternDot: {
    position: 'absolute',
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#1DB954',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: StatusBar.currentHeight + 40,
    justifyContent: 'space-between',
    paddingBottom: 40,
  },
  logoSection: {
    alignItems: 'center',
    marginTop: 40,
  },
  logoContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: '#1DB954',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 12,
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    lineHeight: 24,
    fontWeight: '400',
  },
  featuresContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 20,
  },
  featureCard: {
    marginVertical: 8,
    minHeight: 70,
  },
  featureContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  featureIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  featureText: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  featureDesc: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.6)',
    lineHeight: 18,
  },
  loginButtonContainer: {
    marginTop: 20,
    borderRadius: 28,
    overflow: 'hidden',
    shadowColor: '#1DB954',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  loginButton: {
    paddingVertical: 18,
    paddingHorizontal: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginIcon: {
    marginRight: 12,
  },
  loginButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  note: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
    textAlign: 'center',
    marginTop: 16,
    fontStyle: 'italic',
  },
  webViewContainer: {
    flex: 1,
  },
  closeButton: {
    position: 'absolute',
    top: StatusBar.currentHeight + 20,
    right: 20,
    zIndex: 1,
    width: 50,
    height: 50,
  },
  closeButtonCard: {
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  webView: {
    flex: 1,
    marginTop: StatusBar.currentHeight + 80,
  },
});

export default LoginScreen;