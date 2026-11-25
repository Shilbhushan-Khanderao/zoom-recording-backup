const crypto = require('crypto');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest();

// Constant-time compare; hashing first makes both buffers equal length
const safeEqual = (a, b) => crypto.timingSafeEqual(sha256(a), sha256(b));

/**
 * HTTP Basic Auth using DASHBOARD_USER / DASHBOARD_PASSWORD.
 * Credentials are read per request so the env is resolved after dotenv loads.
 */
const basicAuth = (req, res, next) => {
  const expectedUser = process.env.DASHBOARD_USER || 'admin';
  const expectedPassword = process.env.DASHBOARD_PASSWORD;

  const [scheme, encoded] = (req.headers.authorization || '').split(' ');
  if (expectedPassword && scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    const user = sep === -1 ? decoded : decoded.slice(0, sep);
    const password = sep === -1 ? '' : decoded.slice(sep + 1);
    // Evaluate both comparisons so timing does not reveal which one failed
    const userOk = safeEqual(user, expectedUser);
    const passwordOk = safeEqual(password, expectedPassword);
    if (userOk && passwordOk) return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="Zoom Backup Dashboard"');
  res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
};

module.exports = basicAuth;
