
/**
 * Configuration Validator
 * Validates OAuth and API credentials before backup operations
 */
const fs = require('fs');

class ConfigValidator {
  static async validateZoomConfig(config) {
    const errors = [];
    
    if (!config.zoomClientId || config.zoomClientId.trim() === '') {
      errors.push('Zoom Client ID is missing');
    }
    
    if (!config.zoomClientSecret || config.zoomClientSecret.trim() === '') {
      errors.push('Zoom Client Secret is missing');
    }
    
    if (!config.zoomAccountId || config.zoomAccountId.trim() === '') {
      errors.push('Zoom Account ID is missing');
    } else {
      // Validate Account ID format (should start with specific pattern)
      const accountId = config.zoomAccountId.trim();
      if (!/^[A-Za-z0-9_-]{11,}$/.test(accountId)) {
        errors.push('Zoom Account ID format appears invalid (should be 11+ alphanumeric characters)');
      }
    }
    
    return errors;
  }
  
  static async validateGoogleConfig(config) {
    const errors = [];
    
    if (!config.googleCredentialsPath) {
      errors.push('Google credentials path is missing');
    } else if (!fs.existsSync(config.googleCredentialsPath)) {
      errors.push(`Google credentials file not found at: ${config.googleCredentialsPath}`);
    }
    
    // Check token.json
    const tokenPath = 'token.json';
    if (!fs.existsSync(tokenPath)) {
      errors.push('Google OAuth token missing - authentication required');
    } else {
      try {
        const tokenData = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
        if (!tokenData.access_token) {
          errors.push('Invalid Google OAuth token - re-authentication required');
        }
      } catch (error) {
        errors.push('Corrupted Google OAuth token - re-authentication required');
      }
    }
    
    return errors;
  }
  
  static async validateAll(config) {
    const zoomErrors = await this.validateZoomConfig(config);
    const googleErrors = await this.validateGoogleConfig(config);
    
    return {
      zoom: zoomErrors,
      google: googleErrors,
      isValid: zoomErrors.length === 0 && googleErrors.length === 0,
      allErrors: [...zoomErrors, ...googleErrors]
    };
  }
}

module.exports = ConfigValidator;
