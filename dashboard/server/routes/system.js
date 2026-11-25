/**
 * System Routes
 * System health, disk usage, and process monitoring
 */

const express = require('express');
const router = express.Router();
const os = require('os');
const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
const v8 = require('v8');
const Logger = require('../utils/logger');

/**
 * GET /api/system/health
 * Comprehensive system health check
 */
router.get('/health', async (req, res, next) => {
  try {
    const checks = {
      database: await checkDatabase(),
      filesystem: await checkFilesystem(),
      memory: checkMemory(),
      services: await checkServices(),
    };

    const overallHealth = Object.values(checks).every(c => c.status === 'healthy');

    res.json({
      status: overallHealth ? 'healthy' : 'degraded',
      checks,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error('Health check failed:', { error: error.message });
    next(error);
  }
});

/**
 * GET /api/system/disk
 * Disk usage statistics
 */
router.get('/disk', async (req, res, next) => {
  try {
    const projectRoot = path.join(__dirname, '../../..');
    
    // Get directory sizes
    const sizes = await Promise.all([
      getDirectorySize(path.join(projectRoot, 'logs')),
      getDirectorySize(path.join(projectRoot, 'downloads')),
    ]);

    // Get disk usage via df command
    let diskStats = null;
    try {
      const dfOutput = execSync('df -h .', { cwd: projectRoot, encoding: 'utf-8' });
      const lines = dfOutput.trim().split('\n');
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        diskStats = {
          filesystem: parts[0],
          size: parts[1],
          used: parts[2],
          available: parts[3],
          usePercent: parts[4],
          mountPoint: parts[5],
        };
      }
    } catch (e) {
      Logger.debug('Failed to get disk stats via df');
    }

    res.json({
      directories: {
        logs: { path: 'logs/', size: sizes[0] },
        downloads: { path: 'downloads/', size: sizes[1] },
      },
      disk: diskStats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error('Failed to get disk usage:', { error: error.message });
    next(error);
  }
});

/**
 * GET /api/system/memory
 * Memory usage statistics
 */
router.get('/memory', async (req, res, next) => {
  try {
    const used = process.memoryUsage();
    const systemMemory = {
      total: os.totalmem(),
      free: os.freemem(),
      used: os.totalmem() - os.freemem(),
    };

    res.json({
      process: {
        rss: formatBytes(used.rss),
        heapTotal: formatBytes(used.heapTotal),
        heapUsed: formatBytes(used.heapUsed),
        external: formatBytes(used.external),
        raw: used,
      },
      system: {
        total: formatBytes(systemMemory.total),
        free: formatBytes(systemMemory.free),
        used: formatBytes(systemMemory.used),
        usedPercent: Math.round((systemMemory.used / systemMemory.total) * 100),
        raw: systemMemory,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error('Failed to get memory stats:', { error: error.message });
    next(error);
  }
});

/**
 * GET /api/system/processes
 * PM2 process status
 */
router.get('/processes', async (req, res, next) => {
  try {
    let processes = [];
    
    try {
      const pm2Output = execSync('pm2 jlist', { encoding: 'utf-8' });
      const pm2Data = JSON.parse(pm2Output);
      
      processes = pm2Data.map(proc => ({
        name: proc.name,
        pid: proc.pid,
        status: proc.pm2_env?.status,
        memory: formatBytes(proc.monit?.memory || 0),
        cpu: `${proc.monit?.cpu || 0}%`,
        uptime: proc.pm2_env?.pm_uptime 
          ? formatUptime(Date.now() - proc.pm2_env.pm_uptime)
          : 'N/A',
        restarts: proc.pm2_env?.restart_time || 0,
      }));
    } catch (e) {
      Logger.debug('PM2 not available or not running');
    }

    res.json({
      pm2Available: processes.length > 0,
      processes,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error('Failed to get process info:', { error: error.message });
    next(error);
  }
});

// ==========================================================
// HELPER FUNCTIONS
// ==========================================================

async function checkDatabase() {
  try {
    const { get } = require('../utils/dbConnection');
    await get('SELECT 1');
    return { status: 'healthy', message: 'Database connected' };
  } catch (error) {
    return { status: 'unhealthy', message: error.message };
  }
}

async function checkFilesystem() {
  try {
    const projectRoot = path.join(__dirname, '../../..');
    await fs.access(path.join(projectRoot, 'logs'), fs.constants.W_OK);
    return { status: 'healthy', message: 'Filesystem accessible' };
  } catch (error) {
    return { status: 'unhealthy', message: 'Logs directory not writable' };
  }
}

function checkMemory() {
  const used = process.memoryUsage();
  const heapStats = v8.getHeapStatistics();
  // Calculate percentage based on the maximum allowed heap size, not the currently allocated heap
  const heapPercent = Math.round((used.heapUsed / heapStats.heap_size_limit) * 100);

  // Check system memory availability as well
  const systemMemory = {
    total: os.totalmem(),
    free: os.freemem(),
    used: os.totalmem() - os.freemem(),
  };
  const systemUsedPercent = Math.round((systemMemory.used / systemMemory.total) * 100);

  // Node.js heap can safely go up to 95% before being a concern
  // More important is system memory availability
  if (heapPercent > 95 || systemUsedPercent > 95) {
    return {
      status: 'unhealthy',
      message: `Critical memory: Heap ${heapPercent}%, System ${systemUsedPercent}%`
    };
  }

  // Warn only if heap is very high (>90%) AND system memory is also constrained (>85%)
  if (heapPercent > 90 && systemUsedPercent > 85) {
    return {
      status: 'warning',
      message: `Memory usage: Heap ${heapPercent}%, System ${systemUsedPercent}%`
    };
  }

  return {
    status: 'healthy',
    message: `Memory: Heap ${heapPercent}%, System ${systemUsedPercent}%`
  };
}

async function checkServices() {
  try {
    const http = require('http');
    
    return new Promise((resolve) => {
      const req = http.get('http://localhost:3456/health', { timeout: 2000 }, (res) => {
        resolve({ 
          status: res.statusCode === 200 ? 'healthy' : 'warning',
          message: `Health server on port 3456: ${res.statusCode}`,
        });
      });
      
      req.on('error', () => {
        resolve({ status: 'warning', message: 'Health server not responding' });
      });
      
      req.on('timeout', () => {
        req.destroy();
        resolve({ status: 'warning', message: 'Health server timeout' });
      });
    });
  } catch (error) {
    return { status: 'warning', message: 'Unable to check services' };
  }
}

async function getDirectorySize(dirPath) {
  try {
    let totalSize = 0;
    
    async function walkDir(dir) {
      try {
        const files = await fs.readdir(dir, { withFileTypes: true });
        for (const file of files) {
          const filePath = path.join(dir, file.name);
          if (file.isDirectory()) {
            await walkDir(filePath);
          } else {
            const stats = await fs.stat(filePath);
            totalSize += stats.size;
          }
        }
      } catch (e) {
        // Ignore permission errors
      }
    }
    
    await walkDir(dirPath);
    return formatBytes(totalSize);
  } catch (error) {
    return 'Unknown';
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

module.exports = router;
