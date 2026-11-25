/**
 * Health Check HTTP Server
 * Provides monitoring endpoints for service health and metrics
 */

const http = require('http');
const Logger = require('../src/logger');

class HealthCheckServer {
  constructor(port = 3456, tokenRefreshService = null) {
    this.port = port;
    this.tokenRefreshService = tokenRefreshService;
    this.server = null;
    this.startTime = Date.now();
  }

  /**
   * Start the health check server
   */
  start() {
    this.server = http.createServer((req, res) => {
      // Enable CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/json');

      const { url, method } = req;

      // Health check endpoint
      if (url === '/health' && method === 'GET') {
        this.handleHealthCheck(req, res);
      }
      // Metrics endpoint
      else if (url === '/metrics' && method === 'GET') {
        this.handleMetrics(req, res);
      }
      // Token status endpoint
      else if (url === '/token/status' && method === 'GET') {
        this.handleTokenStatus(req, res);
      }
      // 404 for all other routes
      else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Not Found',
          availableEndpoints: ['/health', '/metrics', '/token/status']
        }));
      }
    });

    const host = process.env.HEALTH_HOST || '127.0.0.1';
    this.server.listen(this.port, host, () => {
      Logger.info(`Health check server listening on ${host}:${this.port}`);
      Logger.info(`Available endpoints: /health, /metrics, /token/status`);
    });

    this.server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        Logger.warn(`Port ${this.port} is already in use, health check server not started`);
      } else {
        Logger.error('Health check server error:', { error: error.message });
      }
    });
  }

  /**
   * Basic health check endpoint
   */
  handleHealthCheck(req, res) {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    const health = {
      status: 'healthy',
      uptime: uptime,
      timestamp: new Date().toISOString(),
      service: 'zoom-backup-system'
    };

    res.writeHead(200);
    res.end(JSON.stringify(health, null, 2));
  }

  /**
   * Service metrics endpoint
   */
  async handleMetrics(req, res) {
    try {
      const metrics = {
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        timestamp: new Date().toISOString(),
        tokenService: null
      };

      // Get token service metrics if available
      if (this.tokenRefreshService) {
        metrics.tokenService = this.tokenRefreshService.getMetrics();
      }

      res.writeHead(200);
      res.end(JSON.stringify(metrics, null, 2));
    } catch (error) {
      Logger.error('Error fetching metrics:', { error: error.message });
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Failed to fetch metrics' }));
    }
  }

  /**
   * Token status endpoint
   */
  async handleTokenStatus(req, res) {
    try {
      if (!this.tokenRefreshService) {
        res.writeHead(503);
        res.end(JSON.stringify({
          error: 'Token service not available',
          status: 'unavailable'
        }));
        return;
      }

      const status = await this.tokenRefreshService.getTokenStatus();
      
      res.writeHead(200);
      res.end(JSON.stringify(status, null, 2));
    } catch (error) {
      Logger.error('Error fetching token status:', { error: error.message });
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Failed to fetch token status' }));
    }
  }

  /**
   * Stop the health check server
   */
  stop() {
    if (this.server) {
      this.server.close(() => {
        Logger.info('Health check server stopped');
      });
    }
  }
}

module.exports = HealthCheckServer;
