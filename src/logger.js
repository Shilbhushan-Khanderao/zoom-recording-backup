const fs = require("fs");
const path = require("path");
const winston = require("winston");
require("winston-daily-rotate-file");

function getUserDataPath(subPath) {
  // In CLI mode, we just use the current working directory or a 'data' folder
  return require('path').join(process.cwd(), ...(subPath ? [subPath] : []));
}

const logsDir = path.join(getUserDataPath('logs'), 'application');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.DailyRotateFile({
      filename: path.join(logsDir, "combined-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      maxFiles: "30d",
    }),
    new winston.transports.DailyRotateFile({
      filename: path.join(logsDir, "error-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      maxFiles: "30d",
      level: "error",
    }),
  ],
});

if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    })
  );
}

class SmartLogger {
  constructor() {
    this.recentMessages = new Map(); // Store recent messages to prevent duplicates
    this.messageTimeout = 60000; // 1 minute timeout for duplicate detection
    this.maxDuplicates = 3; // Maximum duplicate messages before suppression
  }

  // Generate a key for message deduplication
  _generateMessageKey(message, level) {
    return `${level}:${message.substring(0, 100)}`; // Use first 100 chars for key
  }

  // Check if message is a duplicate and should be suppressed
  _shouldSuppressMessage(message, level) {
    const key = this._generateMessageKey(message, level);
    const now = Date.now();
    
    if (this.recentMessages.has(key)) {
      const messageData = this.recentMessages.get(key);
      
      // If within timeout period
      if (now - messageData.lastSeen < this.messageTimeout) {
        messageData.count++;
        messageData.lastSeen = now;
        
        // Suppress if we've seen too many duplicates
        if (messageData.count > this.maxDuplicates) {
          messageData.suppressed = true;
          return true;
        }
      } else {
        // Reset if timeout expired
        messageData.count = 1;
        messageData.lastSeen = now;
        messageData.suppressed = false;
      }
    } else {
      // First time seeing this message
      this.recentMessages.set(key, {
        count: 1,
        lastSeen: now,
        suppressed: false
      });
    }
    
    return false;
  }

  // Clean up old message data
  _cleanupOldMessages() {
    const now = Date.now();
    for (const [key, data] of this.recentMessages.entries()) {
      if (now - data.lastSeen > this.messageTimeout * 2) {
        this.recentMessages.delete(key);
      }
    }
  }

  // Enhanced logging methods with deduplication
  info(message, meta = {}) {
    // Special handling for certain repetitive patterns
    if (this._isProgressUpdate(message) || this._isRoutineFetch(message)) {
      // Log progress updates less frequently
      if (!this._shouldSuppressMessage(message, 'info')) {
        logger.info(message, { ...meta, timestamp: new Date().toISOString() });
      }
    } else {
      // Regular info logging
      logger.info(message, { ...meta, timestamp: new Date().toISOString() });
    }
    
    // Periodic cleanup
    if (Math.random() < 0.01) { // 1% chance to cleanup
      this._cleanupOldMessages();
    }
  }

  warn(message, meta = {}) {
    if (!this._shouldSuppressMessage(message, 'warn')) {
      logger.warn(message, { ...meta, timestamp: new Date().toISOString() });
    }
  }

  error(message, meta = {}) {
    // Always log errors, but track for suppression of exact duplicates
    if (!this._shouldSuppressMessage(message, 'error')) {
      logger.error(message, { 
        ...meta, 
        timestamp: new Date().toISOString(),
        nodeVersion: process.version,
        platform: process.platform,
        process: process.pid
      });
    }
  }

  debug(message, meta = {}) {
    logger.debug(message, { ...meta, timestamp: new Date().toISOString() });
  }

  // Helper methods to identify repetitive patterns
  _isProgressUpdate(message) {
    return message.includes('downloading') || 
           message.includes('uploading') || 
           message.includes('progress') ||
           message.includes('%');
  }

  _isRoutineFetch(message) {
    return message.includes('Fetching recordings for user') ||
           message.includes('Fetching Zoom recordings for') ||
           message.includes('Successfully fetched') ||
           message.includes('Total licensed users found');
  }

  // Method to log with context (for operations that span multiple log entries)
  logWithContext(level, message, context, meta = {}) {
    const contextKey = context ? `[${context}] ` : '';
    const fullMessage = `${contextKey}${message}`;
    
    switch (level) {
      case 'info':
        this.info(fullMessage, meta);
        break;
      case 'warn':
        this.warn(fullMessage, meta);
        break;
      case 'error':
        this.error(fullMessage, meta);
        break;
      case 'debug':
        this.debug(fullMessage, meta);
        break;
    }
  }

  // Method to log operation start/end for better tracking
  logOperation(operation, status, details = {}) {
    const message = `${operation} ${status}`;
    if (status === 'started') {
      this.info(message, details);
    } else if (status === 'completed') {
      this.info(message, details);
    } else if (status === 'failed') {
      this.error(message, details);
    }
  }
}

// Create singleton instance
const smartLogger = new SmartLogger();

class Logger {
  static info(message, meta = {}) {
    smartLogger.info(message, meta);
  }

  static warn(message, meta = {}) {
    smartLogger.warn(message, meta);
  }

  static error(message, error = null, meta = {}) {
    const errorDetails = {
      ...meta
    };

    if (error) {
      errorDetails.error = {
        message: error.message,
        stack: error.stack,
        code: error.code,
        type: error.constructor.name
      };
      
      // Add additional error context for common error types
      if (error.code === 'ENOENT') {
        errorDetails.context = 'File or directory not found';
      } else if (error.code === 'EACCES') {
        errorDetails.context = 'Permission denied';
      } else if (error.code === 'ENOTDIR') {
        errorDetails.context = 'Not a directory';
      } else if (error.syscall) {
        errorDetails.context = `System call: ${error.syscall}`;
      }
    }

    smartLogger.error(message, errorDetails);
  }

  static debug(message, meta = {}) {
    smartLogger.debug(message, meta);
  }

  static logOperation(operation, status, details = {}) {
    smartLogger.logOperation(operation, status, details);
  }

  static logWithContext(level, message, context, meta = {}) {
    smartLogger.logWithContext(level, message, context, meta);
  }

  static logBackupOperation(operation) {
    const logPath = path.join(logsDir, `backup-${Date.now()}.json`);
    smartLogger.info("Backup operation completed", { operation, logPath });
  }
}

module.exports = Logger;