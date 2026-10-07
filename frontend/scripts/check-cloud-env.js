const net = require('node:net');

function validateBackendUrl(value) {
  if (!value) {
    throw new Error('Set EXPO_PUBLIC_BACKEND_URL in the EAS environment selected by this build profile.');
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('EXPO_PUBLIC_BACKEND_URL must be an absolute HTTPS URL.');
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const ipv4 = net.isIP(host) === 4 ? host.split('.').map(Number) : null;
  const local = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
    (ipv4 && (ipv4[0] === 0 || ipv4[0] === 10 || ipv4[0] === 127 ||
      (ipv4[0] === 169 && ipv4[1] === 254) ||
      (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31) ||
      (ipv4[0] === 192 && ipv4[1] === 168))) ||
    (net.isIP(host) === 6 && (host === '::1' || host === '::' || /^(fc|fd|fe80:|::ffff:)/.test(host)));
  if (url.protocol !== 'https:' || local) {
    throw new Error('Cloud previews need a publicly reachable HTTPS backend, not localhost or a private LAN address.');
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use only the backend HTTPS origin (no /api path, credentials, query, or fragment).');
  }
  return url.origin;
}

if (require.main === module) {
  try {
    validateBackendUrl(process.env.EXPO_PUBLIC_BACKEND_URL);
    console.log('Cloud backend URL configuration is valid.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { validateBackendUrl };
