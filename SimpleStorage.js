// Simple replacement for AsyncStorage for testing
const storage = {};

const SimpleStorage = {
  async getItem(key) {
    return storage[key] || null;
  },
  
  async setItem(key, value) {
    storage[key] = value;
    return Promise.resolve();
  },
  
  async removeItem(key) {
    delete storage[key];
    return Promise.resolve();
  },
  
  async multiRemove(keys) {
    keys.forEach(key => delete storage[key]);
    return Promise.resolve();
  }
};

export default SimpleStorage;