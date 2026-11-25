#!/usr/bin/env node

/**
 * Log Cleanup Script
 * 
 * Cleans up old log files and progress backups to keep storage manageable.
 * Run via cron or manually: node scripts/log-cleanup.js
 * 
 * Features:
 * - Removes progress files older than 7 days
 * - Compresses old log files
 * - Archives old logs beyond retention period
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const appRoot = process.cwd();

// Configuration
const CONFIG = {
  progressRetentionDays: 7,      // Delete progress files older than this
  logCompressionDays: 1,         // Compress logs older than this
  logRetentionDays: 30,          // Delete compressed logs older than this
  dryRun: process.argv.includes('--dry-run'),
  verbose: process.argv.includes('--verbose'),
};

// Directories to clean
const DIRECTORIES = {
  progressBackups: path.join(appRoot, 'logs', 'backups'),
  applicationLogs: path.join(appRoot, 'logs', 'application'),
  dashboardLogs: path.join(appRoot, 'logs', 'dashboard'),
  pm2Logs: path.join(appRoot, 'logs', 'pm2'),
};

// Statistics
const stats = {
  filesDeleted: 0,
  filesCompressed: 0,
  bytesFreed: 0,
  errors: 0,
};

function log(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : 'ℹ️';
  console.log(`[${timestamp}] ${prefix} ${message}`);
}

function getFilesInDirectory(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir).map(file => ({
    name: file,
    path: path.join(dir, file),
    stats: fs.statSync(path.join(dir, file)),
  }));
}

function isOlderThan(fileStats, days) {
  const now = Date.now();
  const fileAge = now - fileStats.mtime.getTime();
  const daysInMs = days * 24 * 60 * 60 * 1000;
  return fileAge > daysInMs;
}

async function cleanProgressFiles() {
  log('Cleaning progress backup files...');
  const dir = DIRECTORIES.progressBackups;
  const files = getFilesInDirectory(dir);
  
  let cleaned = 0;
  for (const file of files) {
    if (file.name.startsWith('progress_backup_') && file.name.endsWith('.json')) {
      if (isOlderThan(file.stats, CONFIG.progressRetentionDays)) {
        if (!CONFIG.dryRun) {
          try {
            fs.unlinkSync(file.path);
            stats.bytesFreed += file.stats.size;
            stats.filesDeleted++;
            cleaned++;
            if (CONFIG.verbose) log(`Deleted: ${file.name}`);
          } catch (error) {
            log(`Failed to delete ${file.name}: ${error.message}`, 'error');
            stats.errors++;
          }
        } else {
          log(`Would delete: ${file.name} (${file.stats.size} bytes)`);
          cleaned++;
        }
      }
    }
  }
  
  log(`Progress files: ${cleaned} ${CONFIG.dryRun ? 'would be' : ''} deleted`, 'success');
}

async function compressOldLogs() {
  log('Compressing old log files...');
  
  for (const [name, dir] of Object.entries(DIRECTORIES)) {
    if (name === 'progressBackups') continue;
    
    const files = getFilesInDirectory(dir);
    
    for (const file of files) {
      // Skip already compressed files and non-log files
      if (file.name.endsWith('.gz') || !file.name.endsWith('.log')) continue;
      
      if (isOlderThan(file.stats, CONFIG.logCompressionDays)) {
        if (!CONFIG.dryRun) {
          try {
            const content = fs.readFileSync(file.path);
            const compressed = await gzip(content);
            const compressedPath = `${file.path}.gz`;
            
            fs.writeFileSync(compressedPath, compressed);
            fs.unlinkSync(file.path);
            
            const savedBytes = file.stats.size - compressed.length;
            stats.bytesFreed += savedBytes;
            stats.filesCompressed++;
            
            if (CONFIG.verbose) {
              log(`Compressed: ${file.name} (saved ${Math.round(savedBytes / 1024)}KB)`);
            }
          } catch (error) {
            log(`Failed to compress ${file.name}: ${error.message}`, 'error');
            stats.errors++;
          }
        } else {
          log(`Would compress: ${file.name}`);
          stats.filesCompressed++;
        }
      }
    }
  }
  
  log(`Logs compressed: ${stats.filesCompressed}`, 'success');
}

async function deleteOldCompressedLogs() {
  log('Deleting old compressed logs...');
  
  for (const [name, dir] of Object.entries(DIRECTORIES)) {
    if (name === 'progressBackups') continue;
    
    const files = getFilesInDirectory(dir);
    
    for (const file of files) {
      if (file.name.endsWith('.gz') && isOlderThan(file.stats, CONFIG.logRetentionDays)) {
        if (!CONFIG.dryRun) {
          try {
            fs.unlinkSync(file.path);
            stats.bytesFreed += file.stats.size;
            stats.filesDeleted++;
            
            if (CONFIG.verbose) log(`Deleted old compressed: ${file.name}`);
          } catch (error) {
            log(`Failed to delete ${file.name}: ${error.message}`, 'error');
            stats.errors++;
          }
        } else {
          log(`Would delete: ${file.name}`);
          stats.filesDeleted++;
        }
      }
    }
  }
}

async function cleanPM2Logs() {
  log('Cleaning PM2 logs...');
  const dir = DIRECTORIES.pm2Logs;
  const files = getFilesInDirectory(dir);
  
  // Keep only last 5 PM2 log files
  const pm2Logs = files
    .filter(f => f.name.endsWith('.log'))
    .sort((a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime());
  
  const toDelete = pm2Logs.slice(5);
  
  for (const file of toDelete) {
    if (!CONFIG.dryRun) {
      try {
        fs.unlinkSync(file.path);
        stats.bytesFreed += file.stats.size;
        stats.filesDeleted++;
        if (CONFIG.verbose) log(`Deleted PM2 log: ${file.name}`);
      } catch (error) {
        log(`Failed to delete ${file.name}: ${error.message}`, 'error');
        stats.errors++;
      }
    } else {
      log(`Would delete PM2 log: ${file.name}`);
    }
  }
}

async function main() {
  log('=== Log Cleanup Script ===');
  log(`Mode: ${CONFIG.dryRun ? 'DRY RUN' : 'LIVE'}`);
  log(`Progress retention: ${CONFIG.progressRetentionDays} days`);
  log(`Log compression after: ${CONFIG.logCompressionDays} days`);
  log(`Log retention: ${CONFIG.logRetentionDays} days`);
  log('');
  
  await cleanProgressFiles();
  await compressOldLogs();
  await deleteOldCompressedLogs();
  await cleanPM2Logs();
  
  log('');
  log('=== Cleanup Summary ===');
  log(`Files deleted: ${stats.filesDeleted}`);
  log(`Files compressed: ${stats.filesCompressed}`);
  log(`Space freed: ${(stats.bytesFreed / 1024 / 1024).toFixed(2)} MB`);
  log(`Errors: ${stats.errors}`);
  
  if (CONFIG.dryRun) {
    log('');
    log('This was a dry run. No files were actually modified.');
    log('Run without --dry-run to perform actual cleanup.');
  }
}

main().catch(error => {
  log(`Fatal error: ${error.message}`, 'error');
  process.exit(1);
});
