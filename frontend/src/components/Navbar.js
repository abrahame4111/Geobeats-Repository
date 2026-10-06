import { Link, useLocation } from 'react-router-dom';
import { Home, Map, Music, LogOut } from 'lucide-react';

const Navbar = ({ user, onLogout }) => {
  const location = useLocation();

  const isActive = (path) => location.pathname === path;

  return (
    <nav style={styles.nav}>
      <div className="container" style={styles.content}>
        <div style={styles.logo}>
          <Music size={28} color="#1DB954" />
          <span style={styles.logoText}>Music Navigator</span>
        </div>

        <div style={styles.links}>
          <Link
            to="/home"
            style={{
              ...styles.link,
              ...(isActive('/home') ? styles.linkActive : {}),
            }}
            data-testid="nav-home"
          >
            <Home size={20} />
            <span>Home</span>
          </Link>
          <Link
            to="/map"
            style={{
              ...styles.link,
              ...(isActive('/map') ? styles.linkActive : {}),
            }}
            data-testid="nav-map"
          >
            <Map size={20} />
            <span>Map</span>
          </Link>
        </div>

        <div style={styles.user}>
          <div style={styles.userInfo}>
            <span style={styles.userName}>{user?.name || 'User'}</span>
          </div>
          <button
            style={styles.logoutBtn}
            onClick={onLogout}
            data-testid="logout-btn"
            title="Logout"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </nav>
  );
};

const styles = {
  nav: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    background: 'rgba(18, 18, 18, 0.98)',
    backdropFilter: 'blur(10px)',
    borderBottom: '1px solid #282828',
    zIndex: 1000,
    height: '60px',
  },
  content: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: '60px',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  logoText: {
    fontSize: '20px',
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: '-0.5px',
  },
  links: {
    display: 'flex',
    gap: '8px',
  },
  link: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 20px',
    color: '#b3b3b3',
    textDecoration: 'none',
    fontSize: '14px',
    fontWeight: '600',
    borderRadius: '8px',
    transition: 'all 0.2s ease',
  },
  linkActive: {
    color: '#1DB954',
    background: 'rgba(29, 185, 84, 0.1)',
  },
  user: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  userInfo: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
  },
  userName: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#ffffff',
  },
  logoutBtn: {
    background: '#282828',
    color: '#ffffff',
    border: 'none',
    padding: '10px',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};

export default Navbar;
