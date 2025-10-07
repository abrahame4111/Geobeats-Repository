import { useState, useEffect } from 'react';
import axios from 'axios';
import { Play, Music, Grid3x3 } from 'lucide-react';
import PlaylistGrid from '@/components/PlaylistGrid';
import CategoryGrid from '@/components/CategoryGrid';
import Player from '@/components/Player';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const HomePage = ({ accessToken }) => {
  const [playlists, setPlaylists] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('playlists');

  useEffect(() => {
    loadData();
  }, [accessToken]);

  const loadData = async () => {
    try {
      setLoading(true);

      const [playlistsRes, categoriesRes] = await Promise.all([
        axios.get(`${API}/spotify/playlists?access_token=${accessToken}`),
        axios.get(`${API}/spotify/categories?access_token=${accessToken}`),
      ]);

      setPlaylists(playlistsRes.data.items || []);
      setCategories(categoriesRes.data.categories.items || []);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page} data-testid="home-page">
      <div className="container">
        <div style={styles.header} className="fade-in">
          <h1 style={styles.title}>Discover Music</h1>
          <p style={styles.subtitle}>Your playlists and top categories</p>
        </div>

        <div style={styles.tabs}>
          <button
            style={{
              ...styles.tab,
              ...(activeTab === 'playlists' ? styles.tabActive : {}),
            }}
            onClick={() => setActiveTab('playlists')}
            data-testid="playlists-tab"
          >
            <Music size={20} />
            <span>My Playlists</span>
            {playlists.length > 0 && (
              <span style={styles.badge}>{playlists.length}</span>
            )}
          </button>
          <button
            style={{
              ...styles.tab,
              ...(activeTab === 'categories' ? styles.tabActive : {}),
            }}
            onClick={() => setActiveTab('categories')}
            data-testid="categories-tab"
          >
            <Grid3x3 size={20} />
            <span>Browse Categories</span>
            {categories.length > 0 && (
              <span style={styles.badge}>{categories.length}</span>
            )}
          </button>
        </div>

        {loading ? (
          <div style={styles.loadingContainer}>
            <div className="loading-spinner"></div>
            <p style={styles.loadingText}>Loading your music...</p>
          </div>
        ) : (
          <div className="fade-in">
            {activeTab === 'playlists' && (
              <PlaylistGrid playlists={playlists} />
            )}
            {activeTab === 'categories' && (
              <CategoryGrid categories={categories} />
            )}
          </div>
        )}
      </div>

      <Player accessToken={accessToken} />
    </div>
  );
};

const styles = {
  page: {
    minHeight: '100vh',
    paddingTop: '80px',
    paddingBottom: '120px',
    background: '#121212',
  },
  header: {
    marginBottom: '32px',
  },
  title: {
    fontSize: '48px',
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: '8px',
    letterSpacing: '-1px',
  },
  subtitle: {
    fontSize: '16px',
    color: '#b3b3b3',
  },
  tabs: {
    display: 'flex',
    gap: '12px',
    marginBottom: '32px',
    borderBottom: '1px solid #282828',
    paddingBottom: '2px',
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 24px',
    background: 'transparent',
    color: '#b3b3b3',
    fontSize: '14px',
    fontWeight: '600',
    border: 'none',
    borderBottom: '2px solid transparent',
    transition: 'all 0.2s ease',
    cursor: 'pointer',
  },
  tabActive: {
    color: '#1DB954',
    borderBottomColor: '#1DB954',
  },
  badge: {
    background: '#282828',
    color: '#ffffff',
    padding: '2px 8px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: '600',
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '24px',
    paddingTop: '80px',
  },
  loadingText: {
    fontSize: '16px',
    color: '#b3b3b3',
  },
};

export default HomePage;
