import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { Music, Map, Radio, Users } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const LoginPage = ({ onLogin }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Handle OAuth callback - now handled via direct redirect with parameters
    const urlParams = new URLSearchParams(location.search);
    const accessToken = urlParams.get('access_token');
    const refreshToken = urlParams.get('refresh_token');
    const userId = urlParams.get('user_id');
    const userName = urlParams.get('user_name');
    const userEmail = urlParams.get('user_email');

    if (accessToken && refreshToken && userId) {
      // Auth successful - create user object and login
      const user = {
        id: userId,
        name: userName || userId,
        email: userEmail || ""
      };
      
      onLogin(accessToken, refreshToken, user);
      navigate('/home');
    } else {
      // Check for OAuth code (fallback for old flow)
      const code = urlParams.get('code');
      if (code) {
        handleAuthCallback(code);
      }
    }
  }, [location]);

  const handleAuthCallback = async (code) => {
    setLoading(true);
    setError(null);

    try {
      const response = await axios.get(`${API}/auth/callback?code=${code}`);
      const { access_token, refresh_token, user } = response.data;

      onLogin(access_token, refresh_token, user);
      navigate('/home');
    } catch (err) {
      console.error('Auth callback error:', err);
      setError('Authentication failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await axios.get(`${API}/auth/login`);
      window.location.href = response.data.auth_url;
    } catch (err) {
      console.error('Login error:', err);
      setError('Failed to initiate login. Please try again.');
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="login-page" style={styles.page}>
        <div style={styles.loadingContainer}>
          <div className="loading-spinner"></div>
          <p style={styles.loadingText}>Connecting to Spotify...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page fade-in" style={styles.page}>
      <div style={styles.content}>
        <div style={styles.header}>
          <div style={styles.iconContainer}>
            <Music size={48} color="#1DB954" />
          </div>
          <h1 style={styles.title}>Music Navigator</h1>
          <p style={styles.subtitle}>
            Stream your music and share your location with friends in real-time
          </p>
        </div>

        <div style={styles.features}>
          <div style={styles.feature}>
            <Music size={32} color="#1DB954" />
            <h3 style={styles.featureTitle}>Full Music Control</h3>
            <p style={styles.featureText}>
              Access your playlists, browse categories, and control playback
            </p>
          </div>
          <div style={styles.feature}>
            <Map size={32} color="#1DB954" />
            <h3 style={styles.featureTitle}>Live Location Map</h3>
            <p style={styles.featureText}>
              See friends on the map with their current songs playing
            </p>
          </div>
          <div style={styles.feature}>
            <Users size={32} color="#1DB954" />
            <h3 style={styles.featureTitle}>Real-Time Updates</h3>
            <p style={styles.featureText}>
              Location and music sync automatically across all users
            </p>
          </div>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <button
          className="btn-spotify"
          onClick={handleLogin}
          disabled={loading}
          data-testid="spotify-login-btn"
        >
          <div style={styles.btnContent}>
            <Music size={20} />
            <span>Login with Spotify</span>
          </div>
        </button>

        <p style={styles.note}>
          Note: Spotify Premium is required for full playback control
        </p>
      </div>
    </div>
  );
};

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #121212 0%, #1a1a1a 100%)',
    padding: '24px',
  },
  content: {
    maxWidth: '900px',
    width: '100%',
    textAlign: 'center',
  },
  header: {
    marginBottom: '48px',
  },
  iconContainer: {
    marginBottom: '24px',
  },
  title: {
    fontSize: '56px',
    fontWeight: '800',
    background: 'linear-gradient(135deg, #1DB954 0%, #1ed760 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    marginBottom: '16px',
    letterSpacing: '-1px',
  },
  subtitle: {
    fontSize: '20px',
    color: '#b3b3b3',
    maxWidth: '600px',
    margin: '0 auto',
    lineHeight: '1.6',
  },
  features: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '24px',
    marginBottom: '48px',
  },
  feature: {
    background: '#181818',
    padding: '32px 24px',
    borderRadius: '12px',
    border: '1px solid #282828',
  },
  featureTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#ffffff',
    margin: '16px 0 8px',
  },
  featureText: {
    fontSize: '14px',
    color: '#b3b3b3',
    lineHeight: '1.5',
  },
  btnContent: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
  },
  note: {
    marginTop: '24px',
    fontSize: '13px',
    color: '#888888',
  },
  error: {
    background: '#ff4444',
    color: '#ffffff',
    padding: '12px 24px',
    borderRadius: '8px',
    marginBottom: '24px',
    fontSize: '14px',
    fontWeight: '500',
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '24px',
  },
  loadingText: {
    fontSize: '18px',
    color: '#b3b3b3',
  },
};

export default LoginPage;
