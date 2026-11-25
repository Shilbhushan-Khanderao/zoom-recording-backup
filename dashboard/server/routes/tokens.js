/**
 * Tokens Routes
 * Token status and management
 */

const express = require('express');
const router = express.Router();
const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const Logger = require('../utils/logger');

const TOKEN_PATH = path.join(__dirname, '../../../token.json');
const HEALTH_SERVER_PORT = 3456;

/**
 * GET /api/tokens/status
 * Get token expiration status
 */
router.get('/status', async (req, res, next) => {
  try {
    // Try to get status from health server first
    const healthServerStatus = await getFromHealthServer('/token/status');
    
    if (healthServerStatus) {
      // Transform health server response to match expected format
      let status = 'unknown';
      const expiresIn = healthServerStatus.expiresIn;
      
      if (healthServerStatus.expired) {
        status = 'expired';
      } else if (healthServerStatus.valid) {
        if (expiresIn !== null && expiresIn !== undefined) {
          if (expiresIn <= 10) {
            status = 'critical';
          } else if (expiresIn <= 30) {
            status = 'warning';
          } else {
            status = 'healthy';
          }
        } else {
          status = 'healthy';
        }
      } else {
        status = 'error';
      }
      
      return res.json({
        status,
        message: healthServerStatus.message || 'Token status retrieved',
        expiryDate: healthServerStatus.expiryDate || null,
        expiresInMinutes: expiresIn !== undefined ? expiresIn : null,
        hasRefreshToken: healthServerStatus.hasRefreshToken || false,
        source: 'health-server',
        timestamp: new Date().toISOString(),
      });
    }

    // Fall back to reading token file directly
    try {
      const tokenData = await fs.readFile(TOKEN_PATH, 'utf-8');
      const token = JSON.parse(tokenData);
      
      const expiryDate = token.expiry_date ? new Date(token.expiry_date) : null;
      const now = new Date();
      
      let status = 'unknown';
      let message = 'Token status unknown';
      let expiresIn = null;

      if (expiryDate) {
        expiresIn = Math.floor((expiryDate - now) / 60000); // minutes
        
        if (expiresIn <= 0) {
          status = 'expired';
          message = 'Token has expired';
        } else if (expiresIn <= 10) {
          status = 'critical';
          message = `Token expires in ${expiresIn} minutes`;
        } else if (expiresIn <= 30) {
          status = 'warning';
          message = `Token expires in ${expiresIn} minutes`;
        } else {
          status = 'healthy';
          message = `Token valid for ${expiresIn} minutes`;
        }
      }

      res.json({
        status,
        message,
        expiryDate: expiryDate ? expiryDate.toISOString() : null,
        expiresInMinutes: expiresIn,
        hasRefreshToken: !!token.refresh_token,
        source: 'file',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.json({
        status: 'error',
        message: 'Token file not found or unreadable',
        source: 'file',
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    Logger.error('Failed to get token status:', { error: error.message });
    next(error);
  }
});

/**
 * GET /api/tokens/zoom/status
 * Get zoom token expiration status
 */
router.get('/zoom/status', async (req, res, next) => {
  try {
    const zoomTokenPath = path.join(__dirname, '../../../zoom_token.json');
    try {
      const tokenData = await fs.readFile(zoomTokenPath, 'utf-8');
      const token = JSON.parse(tokenData);
      
      const expiryDate = token.expiry_date ? new Date(token.expiry_date) : null;
      const now = new Date();
      
      let status = 'unknown';
      let message = 'Token status unknown';
      let expiresIn = null;

      if (expiryDate) {
        expiresIn = Math.floor((expiryDate - now) / 60000); // minutes
        
        if (expiresIn <= 0) {
          status = 'expired';
          message = 'Token has expired';
        } else if (expiresIn <= 10) {
          status = 'critical';
          message = `Token expires in ${expiresIn} minutes`;
        } else if (expiresIn <= 30) {
          status = 'warning';
          message = `Token expires in ${expiresIn} minutes`;
        } else {
          status = 'healthy';
          message = `Token valid for ${expiresIn} minutes`;
        }
      }

      res.json({
        status,
        message,
        expiryDate: expiryDate ? expiryDate.toISOString() : null,
        expiresInMinutes: expiresIn,
        hasRefreshToken: true, // Zoom uses server-to-server OAuth; service auto-refreshes via client credentials
        source: 'file',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.json({
        status: 'error',
        message: 'Token file not found or unreadable',
        source: 'file',
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    Logger.error('Failed to get zoom token status:', { error: error.message });
    next(error);
  }
});

/**
 * GET /api/tokens/metrics
 * Get token refresh metrics
 */
router.get('/metrics', async (req, res, next) => {
  try {
    const metrics = await getFromHealthServer('/metrics');
    
    if (metrics && metrics.tokenService) {
      return res.json({
        ...metrics.tokenService,
        source: 'health-server',
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      message: 'Token metrics not available',
      source: 'unavailable',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error('Failed to get token metrics:', { error: error.message });
    next(error);
  }
});

/**
 * POST /api/tokens/refresh
 * Trigger manual token refresh
 */
router.post('/refresh', async (req, res, next) => {
  try {
    const { spawn } = require('child_process');
    const tokenManagerPath = path.join(__dirname, '../../../scripts/token-manager.js');
    
    // Run token refresh
    const child = spawn('node', [tokenManagerPath, 'refresh'], {
      cwd: path.join(__dirname, '../../..'),
      stdio: 'pipe',
    });

    let output = '';
    let errorOutput = '';

    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        res.json({
          success: true,
          message: 'Token refresh initiated',
          output: output.trim(),
          timestamp: new Date().toISOString(),
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Token refresh failed',
          error: errorOutput.trim() || output.trim(),
          timestamp: new Date().toISOString(),
        });
      }
    });

    child.on('error', (err) => {
      res.status(500).json({
        success: false,
        message: 'Failed to spawn token refresh',
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    });
  } catch (error) {
    Logger.error('Failed to refresh token:', { error: error.message });
    next(error);
  }
});

/**
 * GET /api/tokens/history
 * Get token refresh history
 */
router.get('/history', async (req, res, next) => {
  try {
    const { all } = require('../utils/dbConnection');
    
    const history = await all(`
      SELECT metric_value, recorded_at
      FROM system_metrics
      WHERE metric_name = 'token_refresh'
      ORDER BY recorded_at DESC
      LIMIT 20
    `);

    res.json({
      history,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error('Failed to get token history:', { error: error.message });
    next(error);
  }
});

// ==========================================================
// HELPER FUNCTIONS
// ==========================================================

function getFromHealthServer(endpoint) {
  return new Promise((resolve) => {
    const req = http.get(
      `http://localhost:${HEALTH_SERVER_PORT}${endpoint}`,
      { timeout: 2000 },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(null);
          }
        });
      }
    );

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

module.exports = router;
