import { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Music,
  Volume2,
} from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Player = ({ accessToken }) => {
  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (accessToken) {
      const interval = setInterval(() => {
        fetchCurrentTrack();
      }, 3000);

      fetchCurrentTrack();

      return () => clearInterval(interval);
    }
  }, [accessToken]);

  const fetchCurrentTrack = async () => {
    try {
      const response = await axios.get(
        `${API}/spotify/currently-playing?access_token=${accessToken}`
      );

      if (response.data.is_playing !== false) {
        setCurrentTrack(response.data.item);
        setIsPlaying(response.data.is_playing);

        if (response.data.progress_ms && response.data.item?.duration_ms) {
          const progressPercent =
            (response.data.progress_ms / response.data.item.duration_ms) * 100;
          setProgress(progressPercent);
        }
      } else {
        setCurrentTrack(null);
        setIsPlaying(false);
      }
    } catch (error) {
      console.error('Failed to fetch current track:', error);
    }
  };

  const handlePlayPause = async () => {
    try {
      if (isPlaying) {
        await axios.post(`${API}/spotify/pause?access_token=${accessToken}`);
      } else {
        await axios.post(`${API}/spotify/play?access_token=${accessToken}`);
      }
      setIsPlaying(!isPlaying);
    } catch (error) {
      console.error('Failed to toggle playback:', error);
    }
  };

  const handleNext = async () => {
    try {
      await axios.post(`${API}/spotify/next?access_token=${accessToken}`);
      setTimeout(fetchCurrentTrack, 500);
    } catch (error) {
      console.error('Failed to skip to next:', error);
    }
  };

  const handlePrevious = async () => {
    try {
      await axios.post(`${API}/spotify/previous?access_token=${accessToken}`);
      setTimeout(fetchCurrentTrack, 500);
    } catch (error) {
      console.error('Failed to skip to previous:', error);
    }
  };

  if (!currentTrack) {
    return (
      <div style={styles.player} data-testid="music-player">
        <div style={styles.noTrack}>
          <Music size={24} color="#888888" />
          <span style={styles.noTrackText}>No track playing</span>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.player} data-testid="music-player">
      <div style={styles.progressBar}>
        <div style={{ ...styles.progress, width: `${progress}%` }} />
      </div>

      <div style={styles.content}>
        <div style={styles.trackInfo}>
          {currentTrack.album?.images?.[2]?.url && (
            <img
              src={currentTrack.album.images[2].url}
              alt="Album"
              style={styles.albumArt}
            />
          )}
          <div style={styles.trackDetails}>
            <p style={styles.trackName}>{currentTrack.name}</p>
            <p style={styles.artistName}>
              {currentTrack.artists?.map((a) => a.name).join(', ')}
            </p>
          </div>
        </div>

        <div style={styles.controls}>
          <button
            style={styles.controlBtn}
            onClick={handlePrevious}
            data-testid="previous-btn"
          >
            <SkipBack size={20} />
          </button>
          <button
            style={styles.playBtn}
            onClick={handlePlayPause}
            data-testid="play-pause-btn"
          >
            {isPlaying ? <Pause size={24} /> : <Play size={24} />}
          </button>
          <button
            style={styles.controlBtn}
            onClick={handleNext}
            data-testid="next-btn"
          >
            <SkipForward size={20} />
          </button>
        </div>

        <div style={styles.volumeContainer}>
          <Volume2 size={20} color="#b3b3b3" />
        </div>
      </div>
    </div>
  );
};

const styles = {
  player: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    background: '#181818',
    borderTop: '1px solid #282828',
    zIndex: 1000,
  },
  progressBar: {
    width: '100%',
    height: '4px',
    background: '#404040',
    position: 'relative',
  },
  progress: {
    height: '100%',
    background: '#1DB954',
    transition: 'width 0.3s ease',
  },
  content: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 24px',
    gap: '16px',
  },
  trackInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flex: 1,
    minWidth: 0,
  },
  albumArt: {
    width: '56px',
    height: '56px',
    borderRadius: '4px',
    objectFit: 'cover',
  },
  trackDetails: {
    minWidth: 0,
    flex: 1,
  },
  trackName: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: '4px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  artistName: {
    fontSize: '12px',
    color: '#b3b3b3',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  controlBtn: {
    background: 'transparent',
    border: 'none',
    color: '#b3b3b3',
    cursor: 'pointer',
    padding: '8px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
  },
  playBtn: {
    background: '#ffffff',
    border: 'none',
    color: '#000000',
    cursor: 'pointer',
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
  },
  volumeContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minWidth: '150px',
    justifyContent: 'flex-end',
  },
  noTrack: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    padding: '16px',
  },
  noTrackText: {
    fontSize: '14px',
    color: '#888888',
  },
};

export default Player;
