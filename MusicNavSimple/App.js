import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Alert,
  ScrollView,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { WebView } from 'react-native-webview';
import Icon from 'react-native-vector-icons/MaterialIcons';

const App = () => {
  const [showWebView, setShowWebView] = useState(false);
  const [user, setUser] = useState(null);

  const handleLogin = () => {
    setShowWebView(true);
  };

  const handleWebViewNavigation = (navState) => {
    const { url } = navState;
    console.log('Navigation URL:', url);
    
    if (url.includes('access_token=')) {
      const urlParams = new URLSearchParams(url.split('?')[1]);
      const accessToken = urlParams.get('access_token');
      const userName = urlParams.get('user_name');
      
      if (accessToken) {
        setUser({ name: userName || 'User', token: accessToken });
        setShowWebView(false);
        Alert.alert('Success', 'Logged in successfully!');
      }
    }
  };

  const handleLogout = () => {
    setUser(null);
    Alert.alert('Logged out', 'You have been logged out successfully.');
  };

  if (showWebView) {
    return (
      <View style={styles.webViewContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#191414" />
        
        <View style={styles.webViewHeader}>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => setShowWebView(false)}
          >
            <Icon name="close" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.webViewTitle}>Login with Spotify</Text>
        </View>
        
        <WebView
          source={{ uri: 'https://location-share-beta.preview.emergentagent.com/api/auth/login' }}
          onNavigationStateChange={handleWebViewNavigation}
          style={styles.webView}
          javaScriptEnabled={true}
          domStorageEnabled={true}
        />
      </View>
    );
  }

  return (
    <LinearGradient
      colors={['#191414', '#0d0d0d', '#000000']}
      style={styles.container}
    >
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <LinearGradient
            colors={['#1ED760', '#1DB954']}
            style={styles.logoContainer}
          >
            <Icon name="music-note" size={48} color="#fff" />
          </LinearGradient>
          
          <Text style={styles.title}>🎵 Music Navigator</Text>
          <Text style={styles.subtitle}>
            Stream music and share location with friends worldwide
          </Text>
        </View>

        {/* User Status */}
        {user ? (
          <View style={styles.userSection}>
            <View style={styles.userCard}>
              <LinearGradient
                colors={['rgba(29, 185, 84, 0.2)', 'rgba(29, 185, 84, 0.1)']}
                style={styles.userCardGradient}
              >
                <Icon name="person" size={32} color="#1DB954" />
                <Text style={styles.welcomeText}>Welcome, {user.name}!</Text>
                <Text style={styles.statusText}>✅ Connected to Spotify</Text>
              </LinearGradient>
            </View>
            
            <TouchableOpacity
              style={styles.logoutButton}
              onPress={handleLogout}
            >
              <LinearGradient
                colors={['#FF6B6B', '#FF5252']}
                style={styles.buttonGradient}
              >
                <Icon name="logout" size={20} color="#fff" />
                <Text style={styles.buttonText}>Logout</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.loginSection}>
            {/* Features */}
            <View style={styles.featuresContainer}>
              {[
                {
                  icon: 'library-music',
                  title: 'Music Control',
                  desc: 'Access your Spotify playlists'
                },
                {
                  icon: 'map',
                  title: 'Global Map',
                  desc: 'See friends anywhere in the world'
                },
                {
                  icon: 'people',
                  title: 'Real-Time Sync',
                  desc: 'Live music and location updates'
                }
              ].map((feature, index) => (
                <View key={index} style={styles.featureCard}>
                  <LinearGradient
                    colors={['rgba(255, 255, 255, 0.1)', 'rgba(255, 255, 255, 0.05)']}
                    style={styles.featureCardGradient}
                  >
                    <Icon name={feature.icon} size={24} color="#1DB954" />
                    <View style={styles.featureText}>
                      <Text style={styles.featureTitle}>{feature.title}</Text>
                      <Text style={styles.featureDesc}>{feature.desc}</Text>
                    </View>
                  </LinearGradient>
                </View>
              ))}
            </View>

            {/* Login Button */}
            <TouchableOpacity
              style={styles.loginButtonContainer}
              onPress={handleLogin}
            >
              <LinearGradient
                colors={['#1ED760', '#1DB954']}
                style={styles.buttonGradient}
              >
                <Icon name="music-note" size={20} color="#fff" />
                <Text style={styles.buttonText}>Login with Spotify</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}

        {/* App Status */}
        <View style={styles.statusSection}>
          <View style={styles.statusCard}>
            <LinearGradient
              colors={['rgba(255, 255, 255, 0.1)', 'rgba(255, 255, 255, 0.05)']}
              style={styles.statusCardGradient}
            >
              <Icon name="check-circle" size={20} color="#1DB954" />
              <Text style={styles.statusCardText}>App Running Successfully</Text>
            </LinearGradient>
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
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: StatusBar.currentHeight + 40,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    lineHeight: 22,
  },
  userSection: {
    marginBottom: 30,
  },
  userCard: {
    borderRadius: 16,
    marginBottom: 20,
    overflow: 'hidden',
  },
  userCardGradient: {
    padding: 20,
    alignItems: 'center',
  },
  welcomeText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
    marginTop: 10,
    marginBottom: 5,
  },
  statusText: {
    fontSize: 14,
    color: '#1DB954',
  },
  loginSection: {
    flex: 1,
  },
  featuresContainer: {
    marginBottom: 30,
  },
  featureCard: {
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
  },
  featureCardGradient: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  featureText: {
    marginLeft: 16,
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
  },
  loginButtonContainer: {
    borderRadius: 25,
    overflow: 'hidden',
    marginBottom: 20,
  },
  logoutButton: {
    borderRadius: 25,
    overflow: 'hidden',
  },
  buttonGradient: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  statusSection: {
    marginTop: 20,
  },
  statusCard: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  statusCardGradient: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusCardText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 8,
  },
  webViewContainer: {
    flex: 1,
    backgroundColor: '#191414',
  },
  webViewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: StatusBar.currentHeight + 16,
    paddingBottom: 16,
    backgroundColor: '#191414',
  },
  closeButton: {
    padding: 8,
  },
  webViewTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
    textAlign: 'center',
    marginRight: 40,
  },
  webView: {
    flex: 1,
  },
});

export default App;