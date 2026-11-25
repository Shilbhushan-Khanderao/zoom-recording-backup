/**
 * Zoom Token Refresh Service
 * Proactively refreshes Zoom API tokens before expiration
 * Prevents backup failures due to expired Zoom credentials
 * 
 * Industry-grade implementation with:
 * - Proactive refresh scheduling
 * - Race condition prevention
 * - Persistent token storage
 * - Automatic recovery mechanisms
 * - Comprehensive error handling
 * - Metrics tracking
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const Logger = require('../src/logger');
const ConfigManager = require('../src/configManager');
const appPaths = require('../utils/appPaths');
const notificationService = require('./notificationService');

class ZoomTokenRefreshService {
  constructor(config = {}) {
    // Configuration paths
    this.tokenStoragePath = appPaths.getZoomTokenPath();
    this.backupTokenPath = appPaths.getZoomBackupTokenPath();
    
    // Refresh configuration
    this.refreshBufferMinutes = config.refreshBufferMinutes || 25; // must exceed the 20-min check interval (1hr tokens)
    this.checkIntervalMinutes = config.checkIntervalMinutes || 20; // Check every 20 minutes
    this.checkInterval = this.checkIntervalMinutes * 60 * 1000;
    this.maxConsecutiveFailures = config.maxConsecutiveFailures || 3;
    this.refreshTimeout = config.refreshTimeout || 15000; // 15 seconds
    
    // State management
    this._refreshInProgress = false;
    this.consecutiveFailures = 0;
    this.refreshInterval = null;
    
    // Current token cache
    this.currentToken = null;
    this.tokenExpiry = null;
    
    // Metrics
    this.metrics = {
      refreshCount: 0,
      successCount: 0,
      failureCount: 0,
      lastRefreshTime: null,
      lastRefreshDuration: null,
      tokenObtainedAt: null,
      tokenExpiresAt: null
    };
  }

  /**
   * Initialize the service
   * Loads existing token if available
   */
  async initialize() {
    try {
      Logger.info('Initializing Zoom Token Refresh Service...');
      
      // Try to load existing token
      const existingToken = await this.loadToken();
      if (existingToken) {
        this.currentToken = existingToken.access_token;
        this.tokenExpiry = existingToken.expiry_date;
        
        const expiresIn = Math.floor((this.tokenExpiry - Date.now()) / 60000);
        Logger.info(`Zoom Token Refresh Service initialized. Token expires in ${expiresIn} minutes.`);
        return true;
      } else {
        Logger.warn('No existing Zoom token found. Will obtain new token on first request.');
        return true; // Still initialize successfully - token will be obtained on first use
      }
    } catch (error) {
      Logger.error('Failed to initialize Zoom Token Refresh Service:', {
        error: error.message,
        stack: error.stack
      });
      return false;
    }
  }

  /**
   * Start automatic token refresh service
   */
  start() {
    Logger.info(`Zoom Token Refresh Service started. Checking every ${this.checkIntervalMinutes} minutes.`);
    
    // Perform initial check
    this.checkAndRefreshToken().catch(err => {
      Logger.error('Initial Zoom token check failed:', err.message);
    });

    // Schedule periodic checks
    this.refreshInterval = setInterval(async () => {
      try {
        await this.checkAndRefreshToken();
      } catch (error) {
        Logger.error('Periodic Zoom token check failed:', {
          error: error.message,
          consecutiveFailures: this.consecutiveFailures
        });
        
        // Circuit breaker: Stop service after max failures
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
          Logger.error(`Max consecutive Zoom token refresh failures (${this.maxConsecutiveFailures}) reached. Stopping service.`);
          this.stop();
        }
      }
    }, this.checkInterval);
  }

  /**
   * Stop the automatic token refresh service
   */
  stop() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
      Logger.info('Zoom Token Refresh Service stopped');
    }
  }

  /**
   * Check if token needs refresh
   * @returns {Promise<boolean>}
   */
  async checkAndRefreshToken() {
    // Prevent concurrent refreshes
    if (this._refreshInProgress) {
      Logger.debug('Zoom token refresh already in progress, skipping');
      return false;
    }

    this._refreshInProgress = true;
    try {
      // Check if we have a valid cached token
      if (this.currentToken && this.tokenExpiry) {
        const needsRefresh = this.shouldRefreshToken();
        
        if (!needsRefresh) {
          const minutesUntilExpiry = Math.floor((this.tokenExpiry - Date.now()) / 60000);
          Logger.debug(`Zoom token valid. Expires in ${minutesUntilExpiry} minutes`);
          return false;
        }
      }

      // Token is missing or needs refresh
      Logger.info('Zoom token expiring soon, refreshing...');
      const success = await this.refreshToken();
      return success;
    } catch (error) {
      Logger.error('Error checking Zoom token status:', error.message);
      return false;
    } finally {
      this._refreshInProgress = false;
    }
  }

  /**
   * Determine if token should be refreshed
   * @returns {boolean}
   */
  shouldRefreshToken() {
    if (!this.tokenExpiry) {
      return true;
    }

    const now = Date.now();
    const bufferTime = this.refreshBufferMinutes * 60 * 1000;
    
    // Refresh if token expires within buffer time
    return (this.tokenExpiry - now) < bufferTime;
  }

  /**
   * Refresh Zoom token by obtaining a new one
   * @returns {Promise<boolean>}
   */
  async refreshToken() {
    const start = Date.now();
    this.metrics.refreshCount++;

    try {
      // Create backup before refresh
      await this.backupToken();

      Logger.info('Refreshing Zoom API token...');
      
      // Get new token with timeout
      const newToken = await this.obtainNewToken();
      if (!newToken) {
        throw new Error('Failed to obtain new Zoom token');
      }

      // Calculate expiry: most Zoom tokens are 1 hour, but use provided expiry if available
      const expiresIn = newToken.expires_in || 3600; // Default 1 hour
      const newExpiry = Date.now() + (expiresIn * 1000);

      // Update in-memory cache
      this.currentToken = newToken.access_token;
      this.tokenExpiry = newExpiry;

      // Persist token
      await this.saveToken(newToken.access_token, newExpiry);

      const duration = Date.now() - start;
      Logger.info(`✅ Zoom API token refreshed successfully in ${duration}ms`);
      
      // Update metrics
      this.metrics.successCount++;
      this.metrics.lastRefreshTime = Date.now();
      this.metrics.lastRefreshDuration = duration;
      this.metrics.tokenObtainedAt = Date.now();
      this.metrics.tokenExpiresAt = newExpiry;
      this.consecutiveFailures = 0;

      // Update backup with new token
      await this.backupToken();
      
      return true;
    } catch (error) {
      const duration = Date.now() - start;
      this.metrics.failureCount++;
      this.metrics.lastRefreshDuration = duration;
      
      this.consecutiveFailures++;
      
      Logger.error('❌ Failed to refresh Zoom token:', null, {
        errorMessage: error?.message || String(error),
        duration_ms: duration,
        consecutiveFailures: this.consecutiveFailures
      });

      if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
        await notificationService.notifyTokenRefreshFailure('Zoom API', error?.message || String(error));
      }

      return false;
    }
  }

  /**
   * Obtain a new Zoom API token using credentials
   * @returns {Promise<Object|null>} - Token object or null on failure
   */
  async obtainNewToken() {
    try {
      const configManager = new ConfigManager();
      const config = await configManager.loadConfig();

      const { zoomClientId, zoomClientSecret, zoomAccountId } = config;

      // Validate credentials
      if (!zoomClientId || !zoomClientSecret || !zoomAccountId) {
        throw new Error('Missing Zoom credentials in config');
      }

      const encoded = Buffer.from(`${zoomClientId}:${zoomClientSecret}`).toString('base64');

      const response = await axios.post('https://zoom.us/oauth/token', null, {
        headers: {
          Authorization: `Basic ${encoded}`,
          'Content-Type': 'application/json',
        },
        params: {
          grant_type: 'account_credentials',
          account_id: zoomAccountId,
        },
        timeout: this.refreshTimeout,
        validateStatus: (status) => status < 500,
      });

      if (response.status !== 200) {
        Logger.error('Zoom API returned error:', {
          status: response.status,
          data: response.data
        });
        return null;
      }

      if (!response.data.access_token) {
        Logger.error('Zoom API response missing access_token');
        return null;
      }

      return response.data;
    } catch (error) {
      Logger.error('Error obtaining new Zoom token:', {
        errorMessage: error?.message || String(error),
        errorCode: error?.code || 'UNKNOWN'
      });
      return null;
    }
  }

  /**
   * Save token to persistent storage
   * @param {string} token - Access token
   * @param {number} expiryDate - Expiration timestamp
   */
  async saveToken(token, expiryDate) {
    try {
      const tokenData = {
        access_token: token,
        expiry_date: expiryDate,
        saved_at: Date.now()
      };

      // Use unique temp path to prevent race conditions across PM2 workers
      const tempPath = `${this.tokenStoragePath}.${process.pid}-${Date.now()}.tmp`;
      
      try {
        // Create directory if it doesn't exist
        await fs.mkdir(path.dirname(this.tokenStoragePath), { recursive: true });
        
        // Write to temp file first
        await fs.writeFile(tempPath, JSON.stringify(tokenData, null, 2), { mode: 0o600 });
        
        // Atomic rename
        await fs.rename(tempPath, this.tokenStoragePath);
        
        // Set correct permissions
        await fs.chmod(this.tokenStoragePath, 0o600);
        
        Logger.debug('Zoom token saved successfully');
      } catch (error) {
        // Cleanup temp file
        try { await fs.unlink(tempPath); } catch {}
        
        if (error.code === 'EACCES') {
          Logger.error('Permission denied saving Zoom token:', {
            errorCode: error.code,
            path: this.tokenStoragePath
          });
        } else {
          Logger.error('Error saving Zoom token:', {
            errorCode: error.code,
            errorMessage: error.message
          });
        }
        throw error;
      }
    } catch (error) {
      Logger.error('Failed to save Zoom token:', error.message);
    }
  }

  /**
   * Load token from persistent storage
   * @returns {Promise<Object|null>}
   */
  async loadToken() {
    try {
      const exists = await this.fileExists(this.tokenStoragePath);
      if (!exists) {
        Logger.debug('No saved Zoom token found');
        return null;
      }

      // TokenManager reads plain or APP_SECRET-encrypted files (scripts/encrypt-tokens.js)
      const token = await require('../utils/tokenManager').readTokenAsync(this.tokenStoragePath);

      // Validate token structure
      if (!token.access_token || !token.expiry_date) {
        Logger.warn('Invalid saved Zoom token structure');
        return null;
      }

      return token;
    } catch (error) {
      Logger.debug(`Error loading saved Zoom token: ${error.message}`);
      return null;
    }
  }

  /**
   * Create backup of current token
   */
  async backupToken() {
    if (!this.currentToken) return;

    try {
      const tokenData = {
        access_token: this.currentToken,
        expiry_date: this.tokenExpiry,
        backed_up_at: Date.now()
      };

      await fs.mkdir(path.dirname(this.backupTokenPath), { recursive: true });
      const tmp = `${this.backupTokenPath}.${process.pid}-${Date.now()}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(tokenData, null, 2), { mode: 0o600 });
      await fs.rename(tmp, this.backupTokenPath); // atomic: never leave a half-written backup
      Logger.debug('Zoom token backed up');
    } catch (error) {
      Logger.debug(`Failed to backup Zoom token: ${error.message}`);
    }
  }

  /**
   * Get current token status
   * @returns {Object}
   */
  getTokenStatus() {
    if (!this.currentToken) {
      return {
        status: 'no_token',
        message: 'No Zoom token available'
      };
    }

    if (this.tokenExpiry && Date.now() >= this.tokenExpiry) {
      return {
        status: 'expired',
        message: 'Zoom token has expired',
        expiryTime: new Date(this.tokenExpiry).toISOString()
      };
    }

    if (this.shouldRefreshToken()) {
      const minutesUntilExpiry = Math.floor((this.tokenExpiry - Date.now()) / 60000);
      return {
        status: 'expiring_soon',
        message: `Zoom token will expire in ${minutesUntilExpiry} minutes`,
        minutesUntilExpiry,
        expiryTime: new Date(this.tokenExpiry).toISOString()
      };
    }

    const minutesUntilExpiry = Math.floor((this.tokenExpiry - Date.now()) / 60000);
    return {
      status: 'valid',
      message: `Zoom token is valid for ${minutesUntilExpiry} more minutes`,
      minutesUntilExpiry,
      expiryTime: new Date(this.tokenExpiry).toISOString()
    };
  }

  /**
   * Get service metrics
   */
  getMetrics() {
    return {
      refreshCount: this.metrics.refreshCount,
      successCount: this.metrics.successCount,
      failureCount: this.metrics.failureCount,
      consecutiveFailures: this.consecutiveFailures,
      lastRefreshTime: this.metrics.lastRefreshTime ? new Date(this.metrics.lastRefreshTime).toISOString() : null,
      lastRefreshDuration: this.metrics.lastRefreshDuration,
      tokenObtainedAt: this.metrics.tokenObtainedAt ? new Date(this.metrics.tokenObtainedAt).toISOString() : null,
      tokenExpiresAt: this.metrics.tokenExpiresAt ? new Date(this.metrics.tokenExpiresAt).toISOString() : null
    };
  }

  /**
   * Check if file exists
   */
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = ZoomTokenRefreshService;
