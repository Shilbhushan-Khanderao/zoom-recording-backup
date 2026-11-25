
// Enhanced backup error class for production debugging
class BackupError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "BackupError";
    this.code = details.code || "BACKUP_ERROR";
    this.details = details;
    this.timestamp = new Date().toISOString();
    this.context = this._gatherContext();

    // Enhanced production features
    this.retryable = details.retryable !== false; // Default to retryable unless explicitly set to false
    this.errorType = details.errorType || "UNKNOWN";
    this.severity = details.severity || "medium";

    // Capture enhanced stack trace
    Error.captureStackTrace(this, BackupError);
  }

  _gatherContext() {
    return {
      platform: process.platform,
      nodeVersion: process.version,
      architecture: process.arch,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
      timestamp: this.timestamp,
    };
  }

  // Create user-friendly error messages for technical users
  toUserMessage() {
    const userErrors = {
      ENOENT: "File or folder not found. Please check the file path.",
      EACCES:
        "Permission denied. Please run as administrator or check folder permissions.",
      ENOSPC:
        "Insufficient disk space. Please free up disk space and try again.",
      NETWORK_ERROR:
        "Network connection failed. Please check your internet connection.",
      AUTH_FAILED:
        "Authentication failed. Please check your credentials and try again.",
      RATE_LIMITED:
        "API rate limit exceeded. Please wait a moment and try again.",
      INVALID_CONFIG: "Configuration error. Please check your settings.",
      FILE_TOO_LARGE: "File is too large for processing.",
      TIMEOUT: "Operation timed out. Please try again.",
      INSUFFICIENT_PERMISSIONS:
        "Insufficient permissions to perform this operation.",
    };

    return userErrors[this.code] || this.message;
  }

  // Get structured error data for logging
  toLogData() {
    return {
      message: this.message,
      code: this.code,
      errorType: this.errorType,
      severity: this.severity,
      retryable: this.retryable,
      details: this.details,
      context: this.context,
      stack: this.stack,
      timestamp: this.timestamp,
    };
  }
}

class ValidationError extends BackupError {
  constructor(message, details = {}) {
    super(message, {
      ...details,
      code: "VALIDATION_ERROR",
      errorType: "VALIDATION",
      severity: "high",
    });
    this.name = "ValidationError";
  }
}

// Walk the originalError chain so the real cause survives wrapping:
// "Failed to process x.mp4: Upload failed after all retries: invalid_grant"
function describeError(error) {
  const parts = [];
  for (let e = error, depth = 0; e && depth < 6; e = e.details?.originalError, depth++) {
    const msg = e.message || String(e);
    if (!parts.includes(msg)) parts.push(msg);
  }
  return parts.join(": ");
}

module.exports = {
  describeError,
  BackupError,
  ValidationError,
};
