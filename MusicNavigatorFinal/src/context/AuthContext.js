import React, { createContext, useState, useContext, useEffect } from 'react';
import { CONFIG, API_ENDPOINTS } from '../config/config';
import { SimpleStorage } from '../utils/SimpleStorage';
import axios from 'axios';
import CookieManager from '@react-native-cookies/cookies';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [refreshToken, setRefreshToken] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  const API = `${CONFIG.BACKEND_URL}/api`;

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const token = await SimpleStorage.getItem('spotify_access_token');
      const refresh = await SimpleStorage.getItem('spotify_refresh_token');
      const userData = await SimpleStorage.getItem('spotify_user');

      if (token && refresh && userData) {
        setAccessToken(token);
        setRefreshToken(refresh);
        setUser(JSON.parse(userData));
        setIsAuthenticated(true);
      }
    } catch (error) {
      console.error('Error checking auth status:', error);
    } finally {
      setLoading(false);
    }
  };

  const login = async (token, refresh, userData) => {
    try {
      await SimpleStorage.setItem('spotify_access_token', token);
      await SimpleStorage.setItem('spotify_refresh_token', refresh);
      await SimpleStorage.setItem('spotify_user', JSON.stringify(userData));
      
      setAccessToken(token);
      setRefreshToken(refresh);
      setUser(userData);
      setIsAuthenticated(true);
    } catch (error) {
      console.error('Error saving auth data:', error);
    }
  };

  const logout = async () => {
    try {
      console.log('🚪 Logging out...');
      
      // Clear all stored auth data
      await SimpleStorage.multiRemove([
        'spotify_access_token',
        'spotify_refresh_token',
        'spotify_user',
      ]);
      
      // Clear all cookies (this clears Spotify session cookies)
      try {
        await CookieManager.clearAll();
        console.log('🍪 Cookies cleared');
      } catch (cookieError) {
        console.log('Cookie clear error (non-critical):', cookieError);
      }
      
      // Clear any additional storage
      try {
        await SimpleStorage.clear();
        console.log('💾 Storage cleared');
      } catch (storageError) {
        console.log('Storage clear error (non-critical):', storageError);
      }
      
      // Reset state
      setAccessToken(null);
      setRefreshToken(null);
      setUser(null);
      setIsAuthenticated(false);
      
      console.log('✅ Logout complete');
    } catch (error) {
      console.error('Error during logout:', error);
      // Still reset state even if clearing fails
      setAccessToken(null);
      setRefreshToken(null);
      setUser(null);
      setIsAuthenticated(false);
    }
  };

  const refreshAccessToken = async () => {
    try {
      if (!refreshToken) throw new Error('No refresh token');
      
      const response = await axios.post(`${API}${API_ENDPOINTS.AUTH.REFRESH}`, {
        refresh_token: refreshToken,
      });
      
      const { access_token } = response.data;
      await SimpleStorage.setItem('spotify_access_token', access_token);
      setAccessToken(access_token);
      
      return access_token;
    } catch (error) {
      console.error('Error refreshing token:', error);
      await logout();
      return null;
    }
  };

  const value = {
    user,
    accessToken,
    refreshToken,
    isAuthenticated,
    loading,
    login,
    logout,
    refreshAccessToken,
    API,
    BACKEND_URL: CONFIG.BACKEND_URL,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};