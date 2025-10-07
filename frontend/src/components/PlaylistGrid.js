import { Play } from 'lucide-react';

const PlaylistGrid = ({ playlists }) => {
  if (!playlists || playlists.length === 0) {
    return (
      <div style={styles.empty}>
        <p style={styles.emptyText}>No playlists found</p>
      </div>
    );
  }

  const openPlaylist = (url) => {
    if (url) {
      window.open(url, '_blank');
    }
  };

  return (
    <div style={styles.grid} data-testid="playlist-grid">
      {playlists.map((playlist) => (
        <div
          key={playlist.id}
          style={styles.card}
          onClick={() => openPlaylist(playlist.external_urls?.spotify)}
          data-testid="playlist-card"
        >
          <div style={styles.imageContainer}>
            <img
              src={
                playlist.images?.[0]?.url ||
                'https://via.placeholder.com/200?text=No+Image'
              }
              alt={playlist.name}
              style={styles.image}
            />
            <div style={styles.overlay}>
              <button style={styles.playBtn} data-testid="play-playlist-btn">
                <Play size={24} fill="#000000" color="#000000" />
              </button>
            </div>
          </div>
          <div style={styles.info}>
            <h3 style={styles.title}>{playlist.name}</h3>
            <p style={styles.description}>
              {playlist.description || `${playlist.tracks?.total || 0} tracks`}
            </p>
            <p style={styles.owner}>By {playlist.owner?.display_name}</p>
          </div>
        </div>
      ))}
    </div>
  );
};

const styles = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '24px',
    marginBottom: '32px',
  },
  card: {
    background: '#181818',
    borderRadius: '8px',
    padding: '16px',
    cursor: 'pointer',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  },
  imageContainer: {
    position: 'relative',
    width: '100%',
    paddingTop: '100%',
    marginBottom: '16px',
    borderRadius: '8px',
    overflow: 'hidden',
  },
  image: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0,
    transition: 'opacity 0.3s ease',
  },
  playBtn: {
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    background: '#1DB954',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
  },
  info: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  title: {
    fontSize: '16px',
    fontWeight: '700',
    color: '#ffffff',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  description: {
    fontSize: '13px',
    color: '#b3b3b3',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  owner: {
    fontSize: '12px',
    color: '#888888',
  },
  empty: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '64px',
  },
  emptyText: {
    fontSize: '16px',
    color: '#888888',
  },
};

// Add hover effect via CSS-in-JS workaround
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    [data-testid="playlist-card"]:hover {
      background: #282828 !important;
      transform: translateY(-4px) !important;
    }
    [data-testid="playlist-card"]:hover .overlay {
      opacity: 1 !important;
    }
    [data-testid="play-playlist-btn"]:hover {
      transform: scale(1.05) !important;
      background: #1ed760 !important;
    }
  `;
  document.head.appendChild(style);
}

export default PlaylistGrid;
