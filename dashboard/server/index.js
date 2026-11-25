/**
 * Dashboard API Server - Entry Point
 * Industry-grade monitoring dashboard for Zoom Drive Backup
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const app = require('./app');
const Logger = require('./utils/logger');
const { initDatabase, closeDatabase } = require('./utils/dbConnection');
const googleAuthService = require('../../services/googleAuthService');
const ZoomTokenRefreshService = require('../../services/zoomTokenRefreshService');

const PORT = process.env.DASHBOARD_PORT || 5000;
const HOST = process.env.DASHBOARD_HOST || '0.0.0.0';

if (!process.env.DASHBOARD_PASSWORD) {
  Logger.error('DASHBOARD_PASSWORD is not set - refusing to start an unauthenticated dashboard');
  process.exit(1);
}

// Initialize token refresh services
// Google auth service is a singleton
const zoomTokenRefreshService = new ZoomTokenRefreshService();

// Initialize database and start server
async function start() {
  try {
    // Initialize database connection
    await initDatabase();
    Logger.info('Database connection established');

    // The mail-bot owns periodic token refresh; running a second refresh loop here
    // raced on the same token files. Load credentials only, for the auth routes.
    if (!(await googleAuthService.initialize())) {
      Logger.warn('⚠️  Google credentials not loaded - re-authorize in Settings');
    }
    await zoomTokenRefreshService.initialize();

    // Create HTTP server
    const { DASHBOARD_TLS_CERT, DASHBOARD_TLS_KEY } = process.env;
    const useTls = DASHBOARD_TLS_CERT && DASHBOARD_TLS_KEY;
    const fs = require('fs');
    let server = (useTls
      ? require('https').createServer({ cert: fs.readFileSync(DASHBOARD_TLS_CERT), key: fs.readFileSync(DASHBOARD_TLS_KEY) }, app)
      : require('http').createServer(app)
    ).listen(PORT, HOST, () => {
      const scheme = useTls ? 'https' : 'http';
      Logger.info(`Dashboard API server running on ${HOST}:${PORT} (${scheme.toUpperCase()})`);
      Logger.info(`Health check: ${scheme}://localhost:${PORT}/api/health`);
      Logger.info(`Dashboard: ${scheme}://localhost:${PORT}`);
    });

    // Graceful shutdown handling
    const gracefulShutdown = (signal) => {
      Logger.info(`Received ${signal}, shutting down gracefully...`);
      
      server.close(async () => {
        Logger.info('HTTP server closed');
        
        // Stop token refresh services
        googleAuthService.stop();
        zoomTokenRefreshService.stop();
        Logger.info('Token refresh services stopped');
        
        await closeDatabase();
        Logger.info('Database connection closed');
        
        process.exit(0);
      });

      // Force close after 10 seconds
      setTimeout(() => {
        Logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      Logger.error('Uncaught Exception:', { error: error.message, stack: error.stack });
      gracefulShutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      Logger.error('Unhandled Rejection:', { reason: String(reason) });
    });

  } catch (error) {
    Logger.error('Failed to start server:', { error: error.message });
    process.exit(1);
  }
}

start();
