const fs = require("fs").promises;
const path = require("path");
const { validateSavePath, validateGoogleDriveFolder } = require("./validation");
const Logger = require("./logger");
const { ValidationError } = require("./errorHandler");
require('dotenv').config();

class ConfigManager {
  constructor() {
    this.configPath = path.join(process.cwd(), "config.json");
    // Encryption removed for CLI version
  }

  async loadConfig() {
    try {
      // Try loading from file
      let config = {};
      try {
        const data = await fs.readFile(this.configPath, "utf-8");
        config = JSON.parse(data);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
        // If file doesn't exist, we'll fall back to ENV vars or defaults
        Logger.info("Config file not found, using defaults/environment variables");
      }

      // Merge with Environment Variables
      if (process.env.ZOOM_USER_ID) config.userId = process.env.ZOOM_USER_ID;
      if (process.env.ZOOM_CLIENT_ID) config.zoomClientId = process.env.ZOOM_CLIENT_ID;
      if (process.env.ZOOM_CLIENT_SECRET) config.zoomClientSecret = process.env.ZOOM_CLIENT_SECRET;
      if (process.env.ZOOM_ACCOUNT_ID) config.zoomAccountId = process.env.ZOOM_ACCOUNT_ID;
      if (process.env.GOOGLE_DRIVE_FOLDER_ID) config.googleFolder = process.env.GOOGLE_DRIVE_FOLDER_ID;
      if (process.env.BACKUP_PATH) config.savePath = process.env.BACKUP_PATH;
      
      // Decryption skipped in CLI version (using plain config or ENV)
      return { ...this.getDefaultConfig(), ...config };
    } catch (error) {
      Logger.error("Error loading config:", error);
      throw error;
    }
  }

  async saveConfig(config) {
    try {
      // Enhanced validation before saving
      if (config.savePath) {
        config.savePath = validateSavePath(config.savePath);
      }
      
      if (config.googleFolder) {
        config.googleFolder = validateGoogleDriveFolder(config.googleFolder);
      }
      
      await fs.writeFile(
        this.configPath,
        JSON.stringify(config, null, 2)
      );
      
      Logger.info("Configuration saved successfully");
      return config;
    } catch (error) {
      Logger.error("Failed to save config:", error);
      throw new ValidationError(`Configuration save failed: ${error.message}`, error);
    }
  }

  getDefaultConfig() {
    // Default to fetching recordings from 1 Year ago
    const defaultFromDate = new Date();
    defaultFromDate.setDate(defaultFromDate.getDate() - 365);
    const fromDateStr = defaultFromDate.toISOString().split('T')[0];
    
    return {
      userId: process.env.ZOOM_USER_ID || "",
      savePath: process.env.BACKUP_PATH || path.join(process.cwd(), "downloads"),
      googleFolder: process.env.GOOGLE_DRIVE_FOLDER_ID || "",
      deleteFromZoom: false,
      fromDate: fromDateStr, // Default to 1 year ago
      zoomClientId: process.env.ZOOM_CLIENT_ID || "",
      zoomClientSecret: process.env.ZOOM_CLIENT_SECRET || "",
      zoomAccountId: process.env.ZOOM_ACCOUNT_ID || "",
      googleClientId: process.env.GOOGLE_CLIENT_ID || "",
      googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      googleCredentialsPath: "./oauth_credentials.json", // Default path for OAuth credentials
      maxRetries: 3,
      retryDelay: 1000,
      bandwidthLimit: 0, // 0 means no limit
    };
  }

  validateConfig(config) {
    const requiredFields = [
      "userId",
      "savePath",
      "googleFolder",
      "zoomClientId",
      "zoomClientSecret",
      "zoomAccountId",
      //"googleCredentialsPath", // Made optional if using ENV for Google Auth (later improvement)
    ];
    
    // If not using Service Account/OAuth file, we might need these
    // But for now, we stick to the existing requirement of googleCredentialsPath
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !config.googleCredentialsPath) {
        // requiredFields is already checking this
    }

    const missingFields = requiredFields.filter((field) => !config[field]);

    if (missingFields.length > 0) {
      // Don't throw immediately, maybe they are in ENV?
      // But loadConfig merges ENV, so config object *should* have them.
      throw new Error(`Missing required fields: ${missingFields.join(", ")}`);
    }

    // Validate savePath exists and is writable
    try {
      const fsSync = require('fs');
      if (!fsSync.existsSync(config.savePath)) {
         fsSync.mkdirSync(config.savePath, { recursive: true });
      }
      fsSync.accessSync(config.savePath, fsSync.constants.W_OK);
    } catch (error) {
      throw new Error(`Save path is not writable: ${config.savePath}`);
    }

    return true;
  }

}

module.exports = ConfigManager;
