// Zoom API authentication module
const axios = require("axios");
const Buffer = require("buffer").Buffer;
const TokenManager = require('../utils/tokenManager');
const ConfigManager = require("./configManager");
const Logger = require("./logger");
const appPaths = require("../utils/appPaths");

// Store for Zoom API scopes and rate limiting
let zoomApiScopes = null;
let currentToken = null;
let tokenExpiry = null;
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 100; // Minimum 100ms between requests
const MAX_RETRIES = 3;

// Required scopes for the application
const REQUIRED_SCOPES = [
  "cloud_recording:read:list_account_recordings:admin",
  "cloud_recording:read:archive_files:admin",
  "cloud_recording:read:list_recording_files:admin",
  "cloud_recording:read:recording:admin",
  "cloud_recording:read:list_user_recordings:admin",
  "user:read:list_users:admin",
];

async function enforceRateLimit() {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise((resolve) =>
      setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest)
    );
  }
  lastRequestTime = Date.now();
}

/**
 * Try to load a previously saved/refreshed Zoom token
 * Used by ZoomTokenRefreshService for persistent token management
 */
async function loadSavedZoomToken() {
  try {
    const tokenPath = appPaths.getZoomTokenPath();
    const token = await TokenManager.readTokenAsync(tokenPath);
    
    if (token && token.access_token && token.expiry_date) {
      // Check if token is still valid (with 1 minute buffer)
      if (Date.now() < token.expiry_date - 60000) {
        Logger.debug('Using saved Zoom token from persistent storage');
        return token;
      }
    }
  } catch (error) {
    Logger.debug(`No valid saved Zoom token: ${error.message}`);
  }
  return null;
}

async function getZoomAccessToken(credentials = null, retryCount = 0) {
  try {
    await enforceRateLimit();

    // Check if we have a valid token in memory
    if (currentToken && tokenExpiry && Date.now() < tokenExpiry) {
      return currentToken;
    }

    // Try to load saved token from ZoomTokenRefreshService
    const savedToken = await loadSavedZoomToken();
    if (savedToken) {
      currentToken = savedToken.access_token;
      tokenExpiry = savedToken.expiry_date;
      return currentToken;
    }

    let clientId, clientSecret, accountId;

    if (credentials) {
      clientId = credentials.clientId;
      clientSecret = credentials.clientSecret;
      accountId = credentials.accountId;
    } else {
      const configManager = new ConfigManager();
      const config = await configManager.loadConfig();
      clientId = config.zoomClientId;
      clientSecret = config.zoomClientSecret;
      accountId = config.zoomAccountId;
    }

    // Validate all required credentials are present
    const missingCreds = [];
    if (!clientId) missingCreds.push("Client ID");
    if (!clientSecret) missingCreds.push("Client Secret");
    if (!accountId) missingCreds.push("Account ID");

    if (missingCreds.length > 0) {
      throw new Error(
        `Missing Zoom credentials: ${missingCreds.join(
          ", "
        )}. Please configure your Zoom credentials in the application settings.`
      );
    }

    const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString(
      "base64"
    );

    const response = await axios.post("https://zoom.us/oauth/token", null, {
      headers: {
        Authorization: `Basic ${encoded}`,
        "Content-Type": "application/json",
      },
      params: {
        grant_type: "account_credentials",
        account_id: accountId,
      },
      validateStatus: function (status) {
        return status < 500; // Handle 4xx errors gracefully
      },
    });

    if (response.status !== 200) {
      Logger.error("Failed to obtain Zoom token:", {
        status: response.status,
        data: response.data,
      });

      if (response.status === 429 && retryCount < MAX_RETRIES) {
        const retryAfter = parseInt(response.headers["retry-after"]) || 60;
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        return getZoomAccessToken(credentials, retryCount + 1);
      }

      switch (response.status) {
        case 400:
          throw new Error("Invalid request. Please check your Account ID.");
        case 401:
          throw new Error(
            "Invalid credentials. Please check your Client ID and Client Secret."
          );
        case 429:
          throw new Error("Rate limit exceeded. Please try again later.");
        default:
          throw new Error(
            response.data?.message || "Failed to obtain access token"
          );
      }
    }

    // Store the scopes from the token response
    if (response.data.scope) {
      zoomApiScopes = response.data.scope.split(" ");

      // Validate required scopes
      const missingScopes = REQUIRED_SCOPES.filter(
        (scope) => !zoomApiScopes.includes(scope)
      );
      if (missingScopes.length > 0) {
        throw new Error(
          `Missing required Zoom API scopes: ${missingScopes.join(
            ", "
          )}. Please update your Zoom App settings in the Zoom Marketplace.`
        );
      }
    }

    // Store token and set expiry (default to 1 hour if not provided)
    currentToken = response.data.access_token;
    tokenExpiry = Date.now() + (response.data.expires_in || 3600) * 1000;

    return currentToken;
  } catch (error) {
    // Clear token on error
    currentToken = null;
    tokenExpiry = null;

    // Log the error with appropriate context
    Logger.error("Zoom authentication error:", {
      code: error.code || error.response?.status,
      message: error.message,
      response: error.response?.data,
    });

    if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
      throw new Error(
        "Could not connect to Zoom API. Please check your internet connection."
      );
    }

    if (error.response?.data?.message) {
      throw new Error(`Zoom API error: ${error.response.data.message}`);
    }

    // Rethrow the error with original or formatted message
    throw error;
  }
}

module.exports = {
  getZoomAccessToken,
};
