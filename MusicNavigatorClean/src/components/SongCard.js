import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
  Image,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import GlassCard from './GlassCard';
import Icon from 'react-native-vector-icons/MaterialIcons';

const { width } = Dimensions.get('window');

const SongCard = ({ track, isPlaying = false, onClose }) => {
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const animatedProgress = new Animated.Value(0);

  useEffect(() => {
    if (track) {
      setDuration(track.duration_ms || 180000); // Default 3 minutes if no duration
      setCurrentTime(track.progress_ms || 0);
      const progressPercent = track.progress_ms ? (track.progress_ms / track.duration_ms) * 100 : 0;
      setProgress(progressPercent);
      
      Animated.timing(animatedProgress, {
        toValue: progressPercent,
        duration: 500,
        useNativeDriver: false,
      }).start();
    }
  }, [track]);

  const formatTime = (ms) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  if (!track) return null;

  const albumImage = track.album?.images?.[0]?.url;
  const trackName = track.name || 'Unknown Track';
  const artistName = track.artists?.[0]?.name || 'Unknown Artist';
  const albumName = track.album?.name || 'Unknown Album';

  return (
    <View style={styles.container}>
      <GlassCard
        style={styles.card}
        gradient={['rgba(29, 185, 84, 0.15)', 'rgba(0, 0, 0, 0.4)']}
        borderRadius={24}
      >
        {/* Close Button */}
        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
          <LinearGradient
            colors={['rgba(0,0,0,0.5)', 'rgba(0,0,0,0.8)']}
            style={styles.closeButtonGradient}
          >
            <Icon name="close" size={20} color="#fff" />
          </LinearGradient>
        </TouchableOpacity>

        {/* Album Art */}
        <View style={styles.albumContainer}>
          <View style={styles.albumArtWrapper}>
            <LinearGradient
              colors={['rgba(29, 185, 84, 0.3)', 'rgba(29, 185, 84, 0.1)']}
              style={styles.albumArtBorder}
            >
              <Image
                source={{
                  uri: albumImage || 'https://via.placeholder.com/300x300/1DB954/ffffff?text=Music'
                }}
                style={styles.albumArt}
              />
            </LinearGradient>
          </View>
        </View>

        {/* Track Info */}
        <View style={styles.trackInfo}>
          <Text style={styles.trackName} numberOfLines={2}>
            {trackName}
          </Text>
          <Text style={styles.artistName} numberOfLines={1}>
            {artistName}
          </Text>
          <Text style={styles.albumName} numberOfLines={1}>
            {albumName}
          </Text>
        </View>

        {/* Progress Section */}
        <View style={styles.progressSection}>
          {/* Time Labels */}
          <View style={styles.timeContainer}>
            <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
            <Text style={styles.timeText}>{formatTime(duration)}</Text>
          </View>

          {/* Progress Bar */}
          <View style={styles.progressContainer}>
            <View style={styles.progressTrack}>
              <LinearGradient
                colors={['rgba(255, 255, 255, 0.2)', 'rgba(255, 255, 255, 0.1)']}
                style={styles.progressTrackGradient}
              />
            </View>
            
            <Animated.View
              style={[
                styles.progressBar,
                {
                  width: animatedProgress.interpolate({
                    inputRange: [0, 100],
                    outputRange: ['0%', '100%'],
                    extrapolate: 'clamp',
                  }),
                },
              ]}
            >
              <LinearGradient
                colors={['#1ED760', '#1DB954']}
                style={styles.progressBarGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              />
            </Animated.View>
            
            <Animated.View
              style={[
                styles.progressThumb,
                {
                  left: animatedProgress.interpolate({
                    inputRange: [0, 100],
                    outputRange: [0, width - 120], // Adjust based on card width
                    extrapolate: 'clamp',
                  }),
                },
              ]}
            >
              <LinearGradient
                colors={['#1ED760', '#1DB954']}
                style={styles.progressThumbGradient}
              >
                <View style={styles.progressThumbInner} />
              </LinearGradient>
            </Animated.View>
          </View>
        </View>

        {/* Playback Status */}
        <View style={styles.statusContainer}>
          <Icon 
            name={isPlaying ? "play-arrow" : "pause"} 
            size={16} 
            color="#1DB954" 
          />
          <Text style={styles.statusText}>
            {isPlaying ? 'Now Playing' : 'Paused'}
          </Text>
        </View>
      </GlassCard>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 20,
    left: 16,
    right: 16,
    zIndex: 1000,
  },
  card: {
    minHeight: 200,
  },
  closeButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    overflow: 'hidden',
  },
  closeButtonGradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  albumContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  albumArtWrapper: {
    width: 80,
    height: 80,
    borderRadius: 12,
    overflow: 'hidden',
  },
  albumArtBorder: {
    flex: 1,
    padding: 2,
  },
  albumArt: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
  },
  trackInfo: {
    alignItems: 'center',
    marginBottom: 20,
  },
  trackName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  artistName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1DB954',
    textAlign: 'center',
    marginBottom: 2,
  },
  albumName: {
    fontSize: 12,
    fontWeight: '400',
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
  },
  progressSection: {
    marginBottom: 12,
  },
  timeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  timeText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '500',
  },
  progressContainer: {
    height: 6,
    position: 'relative',
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressTrackGradient: {
    flex: 1,
  },
  progressBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarGradient: {
    flex: 1,
  },
  progressThumb: {
    position: 'absolute',
    top: -3,
    width: 12,
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
  },
  progressThumbGradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressThumbInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ffffff',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.8)',
    marginLeft: 6,
    fontWeight: '500',
  },
});

export default SongCard;