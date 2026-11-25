
/**
 * File Protection during OAuth errors
 * Prevents file deletion when authentication fails
 */
const AUTH_ERROR_MARKERS = [
  'OAUTH_AUTH_REQUIRED',
  'Google Drive authentication required',
  'Token expired',
  'Token has been expired or revoked',
  'invalid_grant',
  'unauthorized_client',
  'Invalid credentials',
  'Authentication failed',
  'Zoom authentication failed',
];

class BackupProtection {
  // True when any error in the wrap chain is an auth failure: retrying other
  // files cannot succeed, so the run should stop and ask for re-authorization
  static isAuthError(error) {
    const { describeError } = require('../src/errorHandler');
    const text = describeError(error);
    return AUTH_ERROR_MARKERS.some((m) => text.includes(m));
  }

  static shouldPreserveFile(error, stage) {
    const isOAuthError = this.isAuthError(error);
    
    const isPreUploadStage = ['download', 'validate-download'].includes(stage);
    
    // Preserve file if:
    // 1. OAuth error occurred
    // 2. File hasn't been uploaded yet
    // 3. Error happened during authentication
    return isOAuthError && (isPreUploadStage || stage === 'upload');
  }
  
  static getPreservationMessage(fileName, error) {
    return `File '${fileName}' preserved locally due to authentication error: ${error.message}`;
  }
}

module.exports = BackupProtection;
