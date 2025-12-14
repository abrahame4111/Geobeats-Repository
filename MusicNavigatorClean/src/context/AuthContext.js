import React, { createContext, useState, useContext, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

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

  const BACKEND_URL = 'https://mapify-social.preview.emergentagent.com';
  const API = `${BACKEND_URL}/api`;

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const token = await AsyncStorage.getItem('spotify_access_token');
      const refresh = await AsyncStorage.getItem('spotify_refresh_token');
      const userData = await AsyncStorage.getItem('spotify_user');

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
      await AsyncStorage.setItem('spotify_access_token', token);
      await AsyncStorage.setItem('spotify_refresh_token', refresh);
      await AsyncStorage.setItem('spotify_user', JSON.stringify(userData));
      
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
      await AsyncStorage.multiRemove([
        'spotify_access_token',
        'spotify_refresh_token',
        'spotify_user',
      ]);
      
      setAccessToken(null);
      setRefreshToken(null);
      setUser(null);
      setIsAuthenticated(false);
    } catch (error) {
      console.error('Error during logout:', error);
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
    API,
    BACKEND_URL,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};