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
import { API_ENDPOINTS } from '../config/config';

const { width, height } = Dimensions.get('window');

const LoginScreen = ({ navigation }) => {
  const { login, API } = useAuth();
  const [showWebView, setShowWebView] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSpotifyLogin = async () => {
    try {
      setLoading(true);
      const loginUrl = `${API}${API_ENDPOINTS.AUTH.LOGIN}`;
      console.log('Opening Spotify login URL:', loginUrl);
      setShowWebView(true);
    } catch (error) {
      Alert.alert('Error', 'Failed to initiate login');
    } finally {
      setLoading(false);
    }
  };

  const handleWebViewNavigationStateChange = (navState) => {
    const { url } = navState;
    console.log('Navigation URL:', url);
    
    // Check for callback with tokens (supports both ? and # formats)
    if (url.includes('access_token=')) {
      try {
        // Extract query string from URL (handle both ? and #)
        let queryString = '';
        if (url.includes('#callback?')) {
          queryString = url.split('#callback?')[1];
        } else if (url.includes('?')) {
          queryString = url.split('?')[1];
        }
        
        if (queryString) {
          // Parse query string manually (URLSearchParams not available in RN)
          const params = {};
          queryString.split('&').forEach(param => {
            const [key, value] = param.split('=');
            params[decodeURIComponent(key)] = decodeURIComponent(value || '');
          });
          
          const accessToken = params['access_token'];
          const refreshToken = params['refresh_token'];
          const userId = params['user_id'];
          const userName = params['user_name'];
          const userEmail = params['user_email'];

          console.log('Extracted tokens:', { accessToken: accessToken ? 'present' : 'missing', userId });

          if (accessToken && refreshToken && userId) {
            const user = {
              id: userId,
              name: userName || userId,
              email: userEmail || '',
            };
            
            console.log('Login successful, saving credentials');
            login(accessToken, refreshToken, user);
            setShowWebView(false);
            // Navigation will happen automatically when isAuthenticated becomes true
          }
        }
      } catch (error) {
        console.error('Error parsing auth callback:', error);
        Alert.alert('Error', 'Failed to process login');
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
          source={{ uri: `${API}${API_ENDPOINTS.AUTH.LOGIN}` }}
          onNavigationStateChange={handleWebViewNavigationStateChange}
          onError={(syntheticEvent) => {
            const { nativeEvent } = syntheticEvent;
            console.error('WebView error:', nativeEvent);
            Alert.alert('Error', `Failed to load: ${nativeEvent.description}`);
          }}
          onHttpError={(syntheticEvent) => {
            const { nativeEvent } = syntheticEvent;
            console.error('WebView HTTP error:', nativeEvent);
          }}
          style={styles.webView}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          startInLoadingState={true}
          mixedContentMode="always"
          thirdPartyCookiesEnabled={true}
          sharedCookiesEnabled={true}
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
        {Array.from({ length: 30 }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.patternDot,
              {
                left: Math.random() * width,
                top: Math.random() * height,
                opacity: Math.random() * 0.4 + 0.1,
                transform: [{ scale: Math.random() * 0.8 + 0.5 }]
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
            <Icon name="music-note" size={52} color="#fff" />
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
              title: 'Global Location Map',
              desc: 'See friends anywhere in the world'
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
                  <Icon name={feature.icon} size={26} color="#fff" />
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
            <Icon name="music-note" size={22} color="#fff" style={styles.loginIcon} />
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
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#1DB954',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: StatusBar.currentHeight + 50,
    justifyContent: 'space-between',
    paddingBottom: 50,
  },
  logoSection: {
    alignItems: 'center',
    marginTop: 30,
  },
  logoContainer: {
    width: 110,
    height: 110,
    borderRadius: 55,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 28,
    shadowColor: '#1DB954',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 12,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 14,
    letterSpacing: 1.2,
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.75)',
    textAlign: 'center',
    lineHeight: 24,
    fontWeight: '400',
  },
  featuresContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 30,
  },
  featureCard: {
    marginVertical: 10,
    minHeight: 75,
  },
  featureContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  featureIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 18,
  },
  featureText: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 5,
  },
  featureDesc: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.65)',
    lineHeight: 19,
  },
  loginButtonContainer: {
    marginTop: 25,
    borderRadius: 30,
    overflow: 'hidden',
    shadowColor: '#1DB954',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 15,
    elevation: 10,
  },
  loginButton: {
    paddingVertical: 20,
    paddingHorizontal: 36,
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
    letterSpacing: 0.6,
  },
  note: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
    textAlign: 'center',
    marginTop: 18,
    fontStyle: 'italic',
  },
  webViewContainer: {
    flex: 1,
  },
  closeButton: {
    position: 'absolute',
    top: StatusBar.currentHeight + 25,
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
    marginTop: StatusBar.currentHeight + 85,
  },
});

export default LoginScreen;