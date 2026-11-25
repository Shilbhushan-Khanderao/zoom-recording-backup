/**
 * Logs Routes
 * Log viewing and management
 */

const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const Logger = require('../utils/logger');

const LOGS_DIR = path.join(__dirname, '../../../logs/application');

/**
 * GET /api/logs/recent
 * Get recent log entries
 */
router.get('/recent', async (req, res, next) => {
  try {
    const lines = Math.min(500, parseInt(req.query.lines) || 100);
    const level = req.query.level; // error, warn, info, debug

    // Find the most recent log file
    const logFile = await findMostRecentLogFile(level === 'error' ? 'error' : 'combined');
    
    if (!logFile) {
      return res.json({
        logs: [],
        message: 'No log files found',
        timestamp: new Date().toISOString(),
      });
    }

    // Read and parse log file
    const content = await fs.readFile(logFile, 'utf-8');
    const logLines = content.trim().split('\n').slice(-lines);
    
    // Parse log entries
    const logs = logLines
      .map(line => parseLogLine(line))
      .filter(log => log !== null)
      .filter(log => !level || log.level === level.toLowerCase());

    res.json({
      logs: logs.reverse(), // Most recent first
      file: path.basename(logFile),
      totalLines: logLines.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error('Failed to get logs:', { error: error.message });
    next(error);
  }
});

/**
 * GET /api/logs/errors
 * Get error logs only
 */
router.get('/errors', async (req, res, next) => {
  try {
    const lines = Math.min(200, parseInt(req.query.lines) || 50);
    
    const logFile = await findMostRecentLogFile('error');
    
    if (!logFile) {
      return res.json({
        errors: [],
        message: 'No error log files found',
        timestamp: new Date().toISOString(),
      });
    }

    const content = await fs.readFile(logFile, 'utf-8');
    const logLines = content.trim().split('\n').slice(-lines);
    
    const errors = logLines
      .map(line => parseLogLine(line))
      .filter(log => log !== null);

    res.json({
      errors: errors.reverse(),
      file: path.basename(logFile),
      totalErrors: errors.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error('Failed to get error logs:', { error: error.message });
    next(error);
  }
});

/**
 * GET /api/logs/search
 * Search logs
 */
router.get('/search', async (req, res, next) => {
  try {
    const { query, days = 1 } = req.query;
    
    if (!query) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Query parameter is required',
      });
    }

    const logFiles = await getLogFilesSince(parseInt(days));
    const results = [];
    
    for (const file of logFiles.slice(0, 7)) { // Limit to 7 files
      try {
        const content = await fs.readFile(file, 'utf-8');
        const lines = content.split('\n');
        
        for (const line of lines) {
          if (line.toLowerCase().includes(query.toLowerCase())) {
            const parsed = parseLogLine(line);
            if (parsed) {
              results.push({
                ...parsed,
                file: path.basename(file),
              });
            }
          }
        }
      } catch (e) {
        // Skip unreadable files
      }
    }

    res.json({
      query,
      results: results.slice(-100), // Limit to 100 results
      totalResults: results.length,
      filesSearched: logFiles.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error('Failed to search logs:', { error: error.message });
    next(error);
  }
});

/**
 * GET /api/logs/files
 * List available log files
 */
router.get('/files', async (req, res, next) => {
  try {
    const files = [];
    
    try {
      const entries = await fs.readdir(LOGS_DIR, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.log')) {
          const filePath = path.join(LOGS_DIR, entry.name);
          const stats = await fs.stat(filePath);
          files.push({
            name: entry.name,
            size: formatBytes(stats.size),
            modified: stats.mtime.toISOString(),
          });
        }
      }
    } catch (e) {
      Logger.debug('Failed to list log files');
    }

    res.json({
      files: files.sort((a, b) => new Date(b.modified) - new Date(a.modified)),
      directory: LOGS_DIR,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error('Failed to list log files:', { error: error.message });
    next(error);
  }
});

/**
 * DELETE /api/logs/cleanup
 * Trigger log cleanup
 */
router.delete('/cleanup', async (req, res, next) => {
  try {
    const { spawn } = require('child_process');
    const cleanupScript = path.join(__dirname, '../../../scripts/log-cleanup.js');
    
    const child = spawn('node', [cleanupScript], {
      cwd: path.join(__dirname, '../../..'),
      stdio: 'ignore',
      detached: true,
    });
    
    child.unref();

    res.json({
      message: 'Log cleanup triggered',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error('Failed to trigger log cleanup:', { error: error.message });
    next(error);
  }
});

// ==========================================================
// HELPER FUNCTIONS
// ==========================================================

async function findMostRecentLogFile(type = 'combined') {
  try {
    const entries = await fs.readdir(LOGS_DIR, { withFileTypes: true });
    const logFiles = entries
      .filter(e => e.isFile() && e.name.includes(type) && e.name.endsWith('.log'))
      .map(e => path.join(LOGS_DIR, e.name));
    
    if (logFiles.length === 0) return null;
    
    // Sort by modification time
    const withStats = await Promise.all(
      logFiles.map(async f => ({
        path: f,
        mtime: (await fs.stat(f)).mtime,
      }))
    );
    
    withStats.sort((a, b) => b.mtime - a.mtime);
    return withStats[0].path;
  } catch (error) {
    return null;
  }
}

async function getLogFilesSince(days) {
  try {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const entries = await fs.readdir(LOGS_DIR, { withFileTypes: true });
    
    const files = [];
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.log')) {
        const filePath = path.join(LOGS_DIR, entry.name);
        const stats = await fs.stat(filePath);
        if (stats.mtime >= cutoff) {
          files.push(filePath);
        }
      }
    }
    
    return files.sort((a, b) => b.localeCompare(a));
  } catch (error) {
    return [];
  }
}

function parseLogLine(line) {
  try {
    // Try JSON format first
    if (line.startsWith('{')) {
      return JSON.parse(line);
    }
    
    // Try Winston default format: [timestamp] [level]: message
    const match = line.match(/^\[(\d{4}-\d{2}-\d{2}[T\s][\d:.-]+Z?)\]\s*\[(\w+)\]:?\s*(.+)$/);
    if (match) {
      return {
        timestamp: match[1],
        level: match[2].toLowerCase(),
        message: match[3],
      };
    }
    
    // Simple format
    return {
      timestamp: new Date().toISOString(),
      level: 'info',
      message: line,
    };
  } catch (error) {
    return null;
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = router;
