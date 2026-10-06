import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import '@/App.css';
import LoginPage from '@/pages/LoginPage';
import HomePage from '@/pages/HomePage';
import MapPage from '@/pages/MapPage';
import Navbar from '@/components/Navbar';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [accessToken, setAccessToken] = useState(null);
  const [refreshToken, setRefreshToken] = useState(null);
  const [user, setUser] = useState(null);

  useEffect(() => {
    // Check if user is already authenticated
    const token = localStorage.getItem('spotify_access_token');
    const refresh = localStorage.getItem('spotify_refresh_token');
    const userData = localStorage.getItem('spotify_user');

    if (token && refresh) {
      setAccessToken(token);
      setRefreshToken(refresh);
      setIsAuthenticated(true);
      if (userData) {
        setUser(JSON.parse(userData));
      }
    }
  }, []);

  const handleLogin = (token, refresh, userData) => {
    localStorage.setItem('spotify_access_token', token);
    localStorage.setItem('spotify_refresh_token', refresh);
    localStorage.setItem('spotify_user', JSON.stringify(userData));
    setAccessToken(token);
    setRefreshToken(refresh);
    setUser(userData);
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    localStorage.removeItem('spotify_access_token');
    localStorage.removeItem('spotify_refresh_token');
    localStorage.removeItem('spotify_user');
    setAccessToken(null);
    setRefreshToken(null);
    setUser(null);
    setIsAuthenticated(false);
  };

  return (
    <div className="App">
      <BrowserRouter>
        {isAuthenticated && <Navbar user={user} onLogout={handleLogout} />}
        <Routes>
          <Route
            path="/"
            element={
              isAuthenticated ? (
                <Navigate to="/home" replace />
              ) : (
                <LoginPage onLogin={handleLogin} />
              )
            }
          />
          <Route
            path="/auth/callback"
            element={<LoginPage onLogin={handleLogin} />}
          />
          <Route
            path="/home"
            element={
              isAuthenticated ? (
                <HomePage accessToken={accessToken} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/map"
            element={
              isAuthenticated ? (
                <MapPage accessToken={accessToken} user={user} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;
