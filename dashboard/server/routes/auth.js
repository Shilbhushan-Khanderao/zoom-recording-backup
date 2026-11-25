const express = require('express');
const router = express.Router();
const Logger = require('../utils/logger');
const googleAuthService = require('../../../services/googleAuthService');
const ConfigManager = require('../../../src/configManager');
const TokenManager = require('../../../utils/tokenManager');
const appPaths = require('../../../utils/appPaths');

/**
 * GET /api/auth/status
 * Get the current authentication status for Google Drive and Zoom
 */
router.get('/status', async (req, res, next) => {
  try {
    const configManager = new ConfigManager();
    const config = await configManager.loadConfig();

    let googleAuthValid = false;
    let zoomAuthValid = false;

    const now = new Date();

    // Check Google Token
    try {
      const googleTokenPath = appPaths.getTokenPath();
      const googleToken = await TokenManager.readTokenAsync(googleTokenPath);
      if (googleToken && googleToken.access_token && googleToken.expiry_date) {
        const expiryDate = new Date(googleToken.expiry_date);
        if (expiryDate > now) {
          googleAuthValid = true;
        }
      }
    } catch (e) {
      googleAuthValid = false;
    }

    // Check Zoom Token
    try {
      const zoomTokenPath = appPaths.getZoomTokenPath();
      const zoomToken = await TokenManager.readTokenAsync(zoomTokenPath);
      if (zoomToken && zoomToken.access_token && zoomToken.expiry_date) {
        const expiryDate = new Date(zoomToken.expiry_date);
        if (expiryDate > now) {
          zoomAuthValid = true;
        }
      }
    } catch (e) {
      zoomAuthValid = false;
    }

    res.json({
      google: { authenticated: googleAuthValid },
      zoom: { authenticated: zoomAuthValid },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    Logger.error('Failed to get auth status:', { error: error.message });
    res.status(500).json({ error: 'Failed to get auth status' });
  }
});

/**
 * GET /api/auth/google/url
 * Get the OAuth URL for Google Drive
 */
router.get('/google/url', async (req, res, next) => {
  try {
    const configManager = new ConfigManager();
    const config = await configManager.loadConfig();

    if (!config.googleCredentialsPath) {
      return res.status(400).json({ error: 'Google credentials path not configured' });
    }

    // Suppress errors if token doesn't exist yet
    try { await googleAuthService.initialize(); } catch (e) {}

    const authUrl = await googleAuthService.getAuthUrl();

    res.json({ url: authUrl });
  } catch (error) {
    Logger.error('Failed to generate Google auth URL:', { error: error.message });
    res.status(500).json({ error: 'Failed to generate auth URL' });
  }
});

/**
 * POST /api/auth/google/callback
 * Handle the OAuth code submission
 */
router.post('/google/callback', async (req, res, next) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Authorization code is required' });
    }

    const configManager = new ConfigManager();
    const config = await configManager.loadConfig();

    try { await googleAuthService.initialize(); } catch (e) {}

    await googleAuthService.setAuthCode(code);

    res.json({ success: true, message: 'Google authentication successful' });
  } catch (error) {
    Logger.error('Failed to handle Google OAuth callback:', { error: error.message });
    res.status(500).json({ error: 'Authentication failed', details: error.message });
  }
});

module.exports = router;
