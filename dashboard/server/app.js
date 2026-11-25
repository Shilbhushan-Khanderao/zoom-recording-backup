/**
 * Express Application Setup
 * Industry-grade configuration with security and monitoring middleware
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const Logger = require('./utils/logger');
const basicAuth = require('./middlewares/basicAuth');

// Import routes
const dashboardRoutes = require('./routes/dashboard');
const backupsRoutes = require('./routes/backups');
const systemRoutes = require('./routes/system');
const logsRoutes = require('./routes/logs');
const alertsRoutes = require('./routes/alerts');
const tokensRoutes = require('./routes/tokens');
const eventsRoutes = require('./routes/events');
const zoomRoutes = require('./routes/zoom');
const authRoutes = require('./routes/auth');

const app = express();

// ==========================================================
// SECURITY MIDDLEWARE
// ==========================================================

// Helmet for security headers (with CSP configured for React)
// Disabled HSTS and upgrade-insecure-requests for local HTTP development
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "http://*", "https://*", "ws://*", "wss://*"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
      // Don't force HTTPS upgrade for local development
      upgradeInsecureRequests: null,
    },
  },
  // Disable HSTS for local HTTP access
  strictTransportSecurity: false,
  // Disable Origin-Agent-Cluster for local development
  originAgentCluster: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: false,
}));

// CORS configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.ALLOWED_ORIGINS?.split(',') || false // same-origin only unless configured
    : (origin, callback) => {
        // Allow all origins in development
        callback(null, true);
      },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// ==========================================================
// PERFORMANCE MIDDLEWARE
// ==========================================================

// Compression
app.use(compression());

// JSON body parser
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ==========================================================
// RATE LIMITING
// ==========================================================

// General API rate limit
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: {
    error: 'Too many requests',
    message: 'Please try again later',
    retryAfter: 60
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter limit for backup triggers
const backupTriggerLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5, // 5 backup triggers per 5 minutes
  message: {
    error: 'Rate limit exceeded',
    message: 'Too many backup requests. Please wait before triggering another backup.',
    retryAfter: 300
  },
});

// ==========================================================
// REQUEST LOGGING
// ==========================================================

app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logLevel = res.statusCode >= 400 ? 'warn' : 'debug';
    
    // Skip health check spam in logs
    if (req.path === '/api/health' && res.statusCode === 200) {
      return;
    }

    Logger[logLevel](`${req.method} ${req.path}`, {
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
    });
  });
  
  next();
});

// ==========================================================
// API ROUTES
// ==========================================================

// Apply rate limiting to API routes
app.use('/api', apiLimiter);

// Health check (no rate limit)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: require('./package.json').version,
  });
});

// Everything below (API + SPA) requires Basic Auth
app.use(basicAuth);

// Stricter rate limit for backup triggers - must run before the backups router
app.use('/api/backups/trigger', backupTriggerLimiter);

// API routes
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/backups', backupsRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/tokens', tokensRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/zoom', zoomRoutes);
app.use('/api/auth', authRoutes);

// ==========================================================
// STATIC FILE SERVING
// ==========================================================

// Serve React build (in both development and production)
const clientBuildPath = path.join(__dirname, '../client/dist');
app.use(express.static(clientBuildPath));

// SPA fallback - serve index.html for all non-API routes
app.get('*', async (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  
  // Check if the build exists asynchronously
  const indexPath = path.join(clientBuildPath, 'index.html');
  const fs = require('fs').promises;
  
  try {
    await fs.access(indexPath);
    res.sendFile(indexPath);
  } catch (error) {
    next();
  }
});

// ==========================================================
// ERROR HANDLING
// ==========================================================

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Endpoint ${req.method} ${req.path} does not exist`,
    availableEndpoints: [
      '/api/health',
      '/api/dashboard/overview',
      '/api/backups',
      '/api/system/health',
      '/api/logs/recent',
      '/api/alerts',
      '/api/tokens/status',
      '/api/events'
    ]
  });
});

// Global error handler
app.use((err, req, res, next) => {
  Logger.error('Unhandled error:', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  // Don't expose internal errors in production
  const isDev = process.env.NODE_ENV !== 'production';
  
  res.status(err.status || 500).json({
    error: err.name || 'Internal Server Error',
    message: isDev ? err.message : 'An unexpected error occurred',
    ...(isDev && { stack: err.stack }),
  });
});

module.exports = app;
