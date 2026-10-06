import React from 'react';
import {
  View,
  StyleSheet,
  Platform,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

const GlassCard = ({ 
  children, 
  style = {}, 
  gradient = ['rgba(255,255,255,0.15)', 'rgba(255,255,255,0.05)'],
  borderRadius = 20,
  blur = 10 
}) => {
  return (
    <View style={[styles.container, { borderRadius }, style]}>
      <LinearGradient
        colors={gradient}
        style={[styles.gradient, { borderRadius }]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={[styles.border, { borderRadius }]} />
        <View style={styles.content}>
          {children}
        </View>
      </LinearGradient>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'transparent',
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(0, 0, 0, 0.4)',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.8,
        shadowRadius: 12,
      },
      android: {
        elevation: 12,
        shadowColor: 'rgba(0, 0, 0, 0.4)',
      },
    }),
  },
  gradient: {
    flex: 1,
    position: 'relative',
  },
  border: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  content: {
    flex: 1,
    padding: 20,
  },
});

export default GlassCard;