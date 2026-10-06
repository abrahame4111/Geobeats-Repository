// Map Style Presets for Music Navigator

// Current Dark Theme (Night Mode)
export const darkTheme = [
  { elementType: 'geometry', stylers: [{ color: '#242f3e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#242f3e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#746855' }] },
  {
    featureType: 'administrative.locality',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#d59563' }],
  },
  {
    featureType: 'poi',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#d59563' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ color: '#263c3f' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#6b9a76' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#38414e' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#212a37' }],
  },
  {
    featureType: 'road',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#9ca5b3' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#746855' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#1f2835' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#f3d19c' }],
  },
  {
    featureType: 'transit',
    elementType: 'geometry',
    stylers: [{ color: '#2f3948' }],
  },
  {
    featureType: 'transit.station',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#d59563' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#17263c' }],
  },
  {
    featureType: 'water',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#515c6d' }],
  },
  {
    featureType: 'water',
    elementType: 'labels.text.stroke',
    stylers: [{ color: '#17263c' }],
  },
];

// Ultra Dark Theme (Spotify Style - Darker)
export const spotifyTheme = [
  { elementType: 'geometry', stylers: [{ color: '#121212' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#121212' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#1DB954' }] },
  {
    featureType: 'administrative',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#1DB954' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#1a1a1a' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#282828' }],
  },
  {
    featureType: 'road',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#b3b3b3' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#282828' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#1DB954' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#000000' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ color: '#0a3d2c' }],
  },
];

// Minimal Light Theme
export const lightTheme = [
  { elementType: 'geometry', stylers: [{ color: '#f5f5f5' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#616161' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f5f5f5' }] },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#ffffff' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#e0e0e0' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#dadada' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#c9e7ff' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ color: '#e5f5e0' }],
  },
];

// Retro/Vintage Theme
export const retroTheme = [
  { elementType: 'geometry', stylers: [{ color: '#ebe3cd' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#523735' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f5f1e6' }] },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#f5f1e6' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#f8c967' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#c9c9c9' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ color: '#c5dac1' }],
  },
];

// Neon Night Theme
export const neonTheme = [
  { elementType: 'geometry', stylers: [{ color: '#0d0221' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#ff006e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0d0221' }] },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#1a1334' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#8338ec' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#3a0ca3' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#fb5607' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#0a0118' }],
  },
];

// Ocean Blue Theme
export const oceanTheme = [
  { elementType: 'geometry', stylers: [{ color: '#0a1929' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#4fc3f7' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0a1929' }] },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#1a2332' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#0277bd' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#006064' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ color: '#1b3a2f' }],
  },
];

// Purple Haze Theme
export const purpleTheme = [
  { elementType: 'geometry', stylers: [{ color: '#1a0a2e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#bb86fc' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a0a2e' }] },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#2d1b4e' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#6b2fbc' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#0f0326' }],
  },
];

// Export all themes
export const MAP_THEMES = {
  dark: darkTheme,
  spotify: spotifyTheme,
  light: lightTheme,
  retro: retroTheme,
  neon: neonTheme,
  ocean: oceanTheme,
  purple: purpleTheme,
};

export const THEME_NAMES = {
  dark: 'Dark Mode',
  spotify: 'Spotify Ultra Dark',
  light: 'Light Mode',
  retro: 'Retro Vintage',
  neon: 'Neon Night',
  ocean: 'Ocean Blue',
  purple: 'Purple Haze',
};

// Default theme
export const DEFAULT_THEME = 'spotify';
