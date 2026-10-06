const CategoryGrid = ({ categories }) => {
  if (!categories || categories.length === 0) {
    return (
      <div style={styles.empty}>
        <p style={styles.emptyText}>No categories found</p>
      </div>
    );
  }

  const openCategory = (url) => {
    if (url) {
      window.open(url, '_blank');
    }
  };

  return (
    <div style={styles.grid} data-testid="category-grid">
      {categories.map((category) => (
        <div
          key={category.id}
          style={styles.card}
          onClick={() => openCategory(`https://open.spotify.com/genre/${category.id}`)}
          data-testid="category-card"
        >
          <div style={styles.imageContainer}>
            <img
              src={
                category.icons?.[0]?.url ||
                'https://via.placeholder.com/200?text=Category'
              }
              alt={category.name}
              style={styles.image}
            />
            <div style={styles.overlay}>
              <h3 style={styles.overlayTitle}>{category.name}</h3>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

const styles = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: '20px',
    marginBottom: '32px',
  },
  card: {
    position: 'relative',
    paddingTop: '100%',
    borderRadius: '12px',
    overflow: 'hidden',
    cursor: 'pointer',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  },
  imageContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  image: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    background: 'linear-gradient(transparent, rgba(0, 0, 0, 0.8))',
    padding: '24px 16px 16px',
  },
  overlayTitle: {
    fontSize: '18px',
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
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

if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    [data-testid="category-card"]:hover {
      transform: scale(1.05) !important;
    }
  `;
  document.head.appendChild(style);
}

export default CategoryGrid;
