const fs = require('fs').promises;
const path = require('path');
const { google } = require('googleapis');
const TokenManager = require('../utils/tokenManager');
const Logger = require('../src/logger');
const appPaths = require('../utils/appPaths');
const notificationService = require('./notificationService');

/**
 * Token Refresh Service
 * Proactively refreshes Google OAuth tokens before they expire
 * to prevent backup failures due to expired credentials
 * 
 * Industry-grade implementation with:
 * - Race condition prevention
 * - Async file operations
 * - Circuit breaker pattern
 * - Atomic file writes
 * - Comprehensive error handling
 * - Metrics tracking
 * - Centralized path management
 */
class GoogleAuthService {
  constructor(config = {}) {
    // Use centralized path manager (INDUSTRY STANDARD: No hardcoded process.cwd())
    this.tokenPath = appPaths.getTokenPath();
    this.credentialsPath = appPaths.getOAuthCredentialsPath();
    this.backupTokenPath = appPaths.getBackupTokenPath();
    this.refreshInterval = null;
    this.auth = null;
    
    // Configuration
    // Must exceed the 30-min check interval, or a 60-min token can lapse between checks
    this.refreshBufferMinutes = config.refreshBufferMinutes || 35;
    this.checkInterval = (config.checkIntervalMinutes || 30) * 60 * 1000;
    this.maxConsecutiveFailures = config.maxConsecutiveFailures || 5;
    this.refreshTimeout = config.refreshTimeout || 30000; // 30 seconds
    
    // State management
    this._refreshInProgress = false; // Prevent concurrent refreshes
    this.consecutiveFailures = 0;
    
    // Metrics
    this.metrics = {
      refreshCount: 0,
      successCount: 0,
      failureCount: 0,
      lastRefreshTime: null,
      lastRefreshDuration: null
    };
  }

  /**
   * Initialize the service
   */
  async initialize() {
    try {
      // Load OAuth credentials
      if (!await this.fileExists(this.credentialsPath)) {
        Logger.warn('OAuth credentials file not found. Token refresh service disabled.');
        return false;
      }

      const credentialsData = await fs.readFile(this.credentialsPath, 'utf8');

      let credentials;
      try {
        credentials = JSON.parse(credentialsData);
      } catch (parseError) {
        Logger.error('Failed to parse OAuth credentials file - file may be corrupted:', parseError.message);
        return false;
      }

      const { client_secret, client_id, redirect_uris } =
        credentials.installed || credentials.web;

      if (!client_id || !client_secret) {
        Logger.error('Invalid OAuth credentials. Token refresh service disabled.');
        return false;
      }

      this.auth = new google.auth.OAuth2(
        client_id,
        client_secret,
        redirect_uris ? redirect_uris[0] : 'urn:ietf:wg:oauth:2.0:oob'
      );

      // Automatically save tokens when Google library refreshes them in the background
      this.auth.on('tokens', async (tokens) => {
        try {
          if (await this.fileExists(this.tokenPath)) {
            let currentToken = {};
            try {
              currentToken = await TokenManager.readTokenAsync(this.tokenPath);
            } catch (e) {}
            
            const newToken = {
              ...currentToken,
              ...tokens
            };
            
            await this.writeTokenAtomic(newToken);
            Logger.debug("✅ OAuth tokens automatically merged and saved from event");
          }
        } catch (error) {
          Logger.error("Failed to automatically save OAuth tokens:", error.message);
        }
      });

      // Load existing token
      if (!await this.fileExists(this.tokenPath)) {
        Logger.warn('No token file found. Please authorize the application first.');
        return false;
      }

      let token;
      try {
        token = await TokenManager.readTokenAsync(this.tokenPath);
      } catch (parseError) {
        Logger.error('Failed to parse token file - file may be corrupted:', parseError.message);
        return false;
      }

      // Validate token structure
      if (!this.isValidToken(token)) {
        Logger.error('Invalid token structure');
        return false;
      }
      
      this.auth.setCredentials(token);

      // Log token expiry info
      const expiresIn = Math.floor((token.expiry_date - Date.now()) / 60000);
      Logger.info(`Token Refresh Service initialized successfully. Token expires in ${expiresIn} minutes.`);
      
      return true;
    } catch (error) {
      Logger.error('Failed to initialize Token Refresh Service:', {
        error: error.message,
        stack: error.stack
      });
      return false;
    }
  }

  /**
   * Start the automatic token refresh service
   */
  start() {
    if (!this.auth) {
      Logger.error('Token Refresh Service not initialized. Call initialize() first.');
      return;
    }

    // Perform initial check with error handling
    this.checkAndRefreshToken().catch(err => {
      Logger.error('Initial token check failed:', err.message);
    });

    // Schedule periodic checks with comprehensive error handling
    this.refreshInterval = setInterval(async () => {
      try {
        await this.checkAndRefreshToken();
      } catch (error) {
        Logger.error('Periodic token check failed:', {
          error: error.message,
          consecutiveFailures: this.consecutiveFailures
        });
        
        // Circuit breaker: Stop service after max failures
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
          Logger.error(`Max consecutive failures (${this.maxConsecutiveFailures}) reached. Stopping Token Refresh Service.`);
          this.stop();
          // Optionally: Send alert notification here
        }
      }
    }, this.checkInterval);

    Logger.info(`Token Refresh Service started. Checking every ${this.checkInterval / 60000} minutes.`);
  }

  /**
   * Stop the automatic token refresh service
   */
  stop() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
      Logger.info('Token Refresh Service stopped');
    }
  }

  /**
   * Check token expiry and refresh if needed
   * Includes race condition prevention
   */
  async checkAndRefreshToken() {
    // Prevent concurrent refreshes (CRITICAL FIX)
    if (this._refreshInProgress) {
      Logger.debug('Token refresh already in progress, skipping');
      return false;
    }

    this._refreshInProgress = true;
    try {
      const tokenData = await this.loadToken();
      if (!tokenData) {
        Logger.warn('No token found to refresh');
        return false;
      }

      const needsRefresh = this.shouldRefreshToken(tokenData);
      
      if (needsRefresh) {
        Logger.info('Token expiring soon, refreshing...');
        const success = await this.refreshToken();
        return success;
      } else {
        // Calculate time until next refresh needed
        const expiryTime = tokenData.expiry_date;
        const now = Date.now();
        const timeUntilExpiry = expiryTime - now;
        const minutesUntilExpiry = Math.floor(timeUntilExpiry / 60000);
        
        Logger.debug(`Token valid. Expires in ${minutesUntilExpiry} minutes`);
        return false;
      }
    } catch (error) {
      Logger.error('Error checking token status:', error.message);
      return false;
    } finally {
      this._refreshInProgress = false; // Always release lock
    }
  }

  /**
   * Load token from file (async) with fallback to backup
   */
  async loadToken() {
    try {
      if (!await this.fileExists(this.tokenPath)) {
        Logger.warn('Token file not found, attempting to load from backup');
        return await this.loadBackupToken();
      }
      
      try {
        const token = await TokenManager.readTokenAsync(this.tokenPath);
        if (this.isValidToken(token)) {
          return token;
        } else {
          Logger.warn('Token file contains invalid token structure, attempting backup');
          return await this.loadBackupToken();
        }
      } catch (parseError) {
        Logger.error('Corrupted token file - attempting to restore from backup:', null, {
          errorMessage: parseError.message,
          errorCode: parseError.code || 'PARSE_ERROR'
        });
        return await this.loadBackupToken();
      }
    } catch (error) {
      Logger.error('Failed to load token:', null, {
        errorMessage: error?.message || String(error),
        errorCode: error?.code || 'READ_ERROR'
      });
      return await this.loadBackupToken();
    }
  }

  /**
   * Load token from backup file
   */
  async loadBackupToken() {
    try {
      if (!await this.fileExists(this.backupTokenPath)) {
        return null;
      }
      
      const token = await TokenManager.readTokenAsync(this.backupTokenPath);
      
      if (this.isValidToken(token)) {
        Logger.info('Loaded token from backup file');
        return token;
      }
      return null;
    } catch (error) {
      Logger.debug('Backup token unavailable or corrupt');
      return null;
    }
  }

  /**
   * Validate token structure and expiry date
   * @param {Object} token - Token object
   * @returns {boolean} - True if token is valid
   */
  isValidToken(token) {
    if (!token || typeof token !== 'object') {
      Logger.warn('Token is null or not an object');
      return false;
    }
    
    if (!token.access_token || !token.refresh_token) {
      Logger.warn('Token missing access_token or refresh_token');
      return false;
    }
    
    if (!token.expiry_date) {
      Logger.warn('Token missing expiry_date');
      return false;
    }
    
    // Validate expiry_date is a valid number
    const expiryTime = Number(token.expiry_date);
    if (!Number.isFinite(expiryTime) || expiryTime <= 0) {
      Logger.warn('Invalid token expiry_date format');
      return false;
    }
    
    return true;
  }

  /**
   * Check if token needs refresh
   * @param {Object} token - Token object with expiry_date
   * @returns {boolean} - True if token should be refreshed
   */
  shouldRefreshToken(token) {
    if (!token || !token.expiry_date) {
      Logger.warn('Token missing expiry_date, assuming needs refresh');
      return true;
    }

    // Validate expiry_date
    const expiryTime = Number(token.expiry_date);
    if (!Number.isFinite(expiryTime) || expiryTime <= 0) {
      Logger.warn('Invalid token expiry_date, assuming needs refresh');
      return true;
    }

    const now = Date.now();
    const bufferTime = this.refreshBufferMinutes * 60 * 1000;
    
    // Refresh if token expires within buffer time
    return (expiryTime - now) < bufferTime;
  }

  /**
   * Refresh the OAuth token with timeout and metrics
   */
  async refreshToken() {
    const start = Date.now();
    this.metrics.refreshCount++;

    try {
      // Create backup before refresh
      await this.backupToken();

      Logger.info('Refreshing OAuth token...');
      
      // Add timeout to prevent hanging (CRITICAL FIX)
      const refreshPromise = this.auth.refreshAccessToken();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Token refresh timeout')), this.refreshTimeout)
      );

      const { credentials } = await Promise.race([refreshPromise, timeoutPromise]);
      this.auth.setCredentials(credentials);
      
      let currentToken = {};
      try {
        currentToken = await TokenManager.readTokenAsync(this.tokenPath);
      } catch (e) {}
      
      const newToken = {
        ...currentToken,
        ...credentials
      };
      
      // Save new token atomically (CRITICAL FIX)
      await this.writeTokenAtomic(newToken);
      
      const duration = Date.now() - start;
      Logger.info(`✅ OAuth token refreshed successfully in ${duration}ms`);
      
      // Update metrics and state
      this.metrics.successCount++;
      this.metrics.lastRefreshTime = Date.now();
      this.metrics.lastRefreshDuration = duration;
      this.consecutiveFailures = 0; // Reset on success
      
      // Update backup with working token
      await this.backupToken();
      
      return true;
    } catch (error) {
      const duration = Date.now() - start;
      this.metrics.failureCount++;
      this.metrics.lastRefreshDuration = duration;
      
      // Properly serialize error details for production debugging
      const errorDetails = {
        errorMessage: error?.message || String(error),
        errorCode: error?.code || 'UNKNOWN',
        errorName: error?.name || 'Error',
        duration_ms: duration,
        consecutiveFailures: this.consecutiveFailures + 1
      };
      
      // Add stack trace in debug mode
      if (process.env.DEBUG_TOKEN_REFRESH) {
        errorDetails.stack = error?.stack;
      }
      
      Logger.error('❌ Failed to refresh OAuth token:', null, errorDetails);
      this.consecutiveFailures++;
      
      // Dispatch alert on invalid_grant or max failures
      if (
        this.consecutiveFailures >= this.maxConsecutiveFailures || 
        errorDetails.errorMessage.includes('invalid_grant')
      ) {
        await notificationService.notifyTokenRefreshFailure('Google Drive', errorDetails.errorMessage);
      }
      
      // Attempt to restore from backup
      try {
        const restored = await this.restoreFromBackup();
        if (restored) {
          Logger.warn('Restored token from backup. Re-authorization may be needed soon.');
          return true;
        } else {
          Logger.error('Token refresh failed and no backup available. Re-authorization required.');
        }
      } catch (restoreErr) {
        Logger.error('Error during token restore attempt:', null, {
          errorMessage: restoreErr?.message || String(restoreErr),
          errorCode: restoreErr?.code || 'UNKNOWN'
        });
      }
      
      return false;
    }
  }

  /**
   * Write token atomically to prevent corruption (CRITICAL FIX)
   * Includes permission error handling and fallback
   * @param {Object} credentials - Token credentials
   */
  async writeTokenAtomic(credentials) {
    // Use unique temp path to prevent race conditions across PM2 workers and async handlers
    const randomStr = Math.random().toString(36).substring(2, 8);
    const tempPath = `${this.tokenPath}.${process.pid}-${Date.now()}-${randomStr}.tmp`;
    try {
      // Write to temp file first with restricted permissions
      await TokenManager.writeTokenAsync(tempPath, credentials, { mode: 0o600 });
      // Atomic rename
      await fs.rename(tempPath, this.tokenPath);
      // Ensure final file has correct permissions
      await fs.chmod(this.tokenPath, 0o600);
      Logger.debug('Token written successfully to: ' + this.tokenPath);
    } catch (error) {
      // Cleanup temp file on error
      try {
        await fs.unlink(tempPath);
      } catch {}
      
      // Log detailed permission errors for production debugging
      if (error.code === 'EACCES' || error.code === 'EPERM') {
        Logger.error('Permission denied writing token file:', null, {
          errorCode: error.code,
          errorMessage: error.message,
          tokenPath: this.tokenPath,
          suggestion: 'Check file permissions and parent directory access'
        });
      } else if (error.code === 'ENOENT') {
        Logger.error('Token path does not exist or parent directory missing:', null, {
          errorCode: error.code,
          tokenPath: this.tokenPath
        });
      } else {
        Logger.error('Failed to write token atomically:', null, {
          errorCode: error.code,
          errorMessage: error.message
        });
      }
      throw error;
    }
  }



  /**
   * Create backup of current token (async)
   */
  async backupToken() {
    try {
      if (await this.fileExists(this.tokenPath)) {
        const token = await TokenManager.readTokenAsync(this.tokenPath);
        await TokenManager.writeTokenAsync(this.backupTokenPath, token, { mode: 0o600 });
        Logger.debug('Token backup created');
      }
    } catch (error) {
      // Log with error code for better debugging
      const errorCode = error?.code || 'UNKNOWN';
      if (errorCode === 'EACCES') {
        Logger.warn('Cannot backup token - permission denied on backup path', { 
          backupPath: this.backupTokenPath,
          errorCode: errorCode 
        });
      } else {
        Logger.warn('Could not backup token:', {
          errorMessage: error?.message || String(error),
          errorCode: errorCode
        });
      }
    }
  }

  /**
   * Restore token from backup (async) with comprehensive error handling
   */
  async restoreFromBackup() {
    try {
      if (await this.fileExists(this.backupTokenPath)) {
        let parsedBackup;
        try {
          parsedBackup = await TokenManager.readTokenAsync(this.backupTokenPath);
        } catch (parseError) {
          Logger.error('Failed to parse backup token file - file may be corrupted:', null, {
            errorMessage: parseError.message,
            backupPath: this.backupTokenPath
          });
          return false;
        }

        // Validate backup token before restoring
        if (!this.isValidToken(parsedBackup)) {
          Logger.error('Backup token is invalid or expired');
          return false;
        }

        await this.writeTokenAtomic(parsedBackup);

        // Reload auth with backup token if auth is initialized
        if (this.auth) {
          this.auth.setCredentials(parsedBackup);
        }

        Logger.info('Token restored from backup successfully');
        return true;
      } else {
        Logger.warn('No backup token file found at: ' + this.backupTokenPath);
      }
    } catch (error) {
      const errorCode = error?.code || 'UNKNOWN';
      Logger.error('Could not restore token from backup:', null, {
        errorMessage: error?.message || String(error),
        errorCode: errorCode,
        backupPath: this.backupTokenPath
      });
    }
    return false;
  }

  /**
   * Check if file exists (async helper)
   */
  async fileExists(filepath) {
    try {
      await fs.access(filepath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Force immediate token refresh (manual trigger)
   */
  async forceRefresh() {
    Logger.info('Force refreshing token (manual trigger)...');
    return await this.refreshToken();
  }

  /**
   * Get token status information (async)
   */
  async getTokenStatus() {
    const token = await this.loadToken();
    if (!token) {
      return {
        exists: false,
        valid: false,
        hasRefreshToken: false,
        message: 'No token file found'
      };
    }

    if (!this.isValidToken(token)) {
      return {
        exists: true,
        valid: false,
        hasRefreshToken: !!token.refresh_token,
        message: 'Token missing required fields or invalid format'
      };
    }

    const now = Date.now();
    const expiryTime = token.expiry_date;
    const timeUntilExpiry = expiryTime - now;
    const minutesUntilExpiry = Math.floor(timeUntilExpiry / 60000);
    const isExpired = timeUntilExpiry <= 0;
    const needsRefresh = this.shouldRefreshToken(token);

    return {
      exists: true,
      valid: !isExpired,
      expired: isExpired,
      needsRefresh: needsRefresh,
      expiresIn: minutesUntilExpiry,
      expiryDate: new Date(expiryTime).toISOString(),
      hasRefreshToken: !!token.refresh_token,
      message: isExpired 
        ? 'Token expired' 
        : needsRefresh 
          ? `Token expires soon (${minutesUntilExpiry} minutes)` 
          : `Token valid (${minutesUntilExpiry} minutes remaining)`
    };
  }

  /**
   * Get service metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      consecutiveFailures: this.consecutiveFailures,
      isRunning: this.refreshInterval !== null,
      successRate: this.metrics.refreshCount > 0
        ? `${((this.metrics.successCount / this.metrics.refreshCount) * 100).toFixed(2)}%`
        : 'N/A'
    };
  }

  /**
   * Get the initialized OAuth2 client
   */
  getAuthClient() {
    if (!this.auth) {
      throw new Error("OAuth2 client not initialized");
    }
    return this.auth;
  }

  /**
   * Generate OAuth authorization URL
   */
  async getAuthUrl() {
    if (!this.auth) {
      throw new Error("OAuth2 client not initialized");
    }
    return this.auth.generateAuthUrl({
      access_type: "offline",
      scope: [
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/drive.metadata.readonly",
      ],
      prompt: "consent",
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  async setAuthCode(code) {
    try {
      const { tokens } = await this.auth.getToken(code);
      this.auth.setCredentials(tokens);
      await this.writeTokenAtomic(tokens);
      return true;
    } catch (error) {
      Logger.error("Failed to exchange authorization code:", error.message);
      throw new Error("Failed to complete OAuth2 authorization");
    }
  }
}

module.exports = new GoogleAuthService();
