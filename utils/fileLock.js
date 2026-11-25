const fs = require('fs').promises;
const path = require('path');
const Logger = require('../src/logger');

/**
 * File-based locking mechanism for preventing concurrent backup operations
 * Uses atomic file system operations for cross-process locking
 */
class FileLock {
  constructor(lockName = 'backup') {
    this.lockName = lockName;
    this.lockFile = path.join(process.cwd(), 'logs', `.${lockName}.lock`);
    this.lockData = {
      pid: process.pid,
      hostname: require('os').hostname(),
      acquiredAt: null
    };
    this.refreshInterval = null;
    this.STALE_LOCK_TIMEOUT = 2 * 60 * 60 * 1000; // 2 hours
  }

  /**
   * Try to acquire the lock (non-blocking)
   * @returns {Promise<boolean>} True if lock acquired, false if already locked
   */
  async tryAcquire() {
    try {
      // Check if lock file exists
      try {
        const existingLock = await fs.readFile(this.lockFile, 'utf8');
        const lockData = JSON.parse(existingLock);

        // Check if lock is stale (holder process died or lock is too old)
        const lockAge = Date.now() - new Date(lockData.acquiredAt).getTime();
        const holderDead = lockData.hostname === this.lockData.hostname && !this._isAlive(lockData.pid);
        if (holderDead || lockAge > this.STALE_LOCK_TIMEOUT) {
          Logger.warn(`Removing stale lock (PID ${lockData.pid}, ${Math.round(lockAge/1000/60)} minutes old)`);
          await this.release();
        } else {
          Logger.debug(`Backup already running (PID: ${lockData.pid}, acquired: ${lockData.acquiredAt})`);
          return false;
        }
      } catch (error) {
        // Missing lock is fine; a corrupted one would block forever, so remove it
        if (error instanceof SyntaxError) await this.release();
      }

      // Try to create lock file atomically using 'wx' flag (fails if exists)
      this.lockData.acquiredAt = new Date().toISOString();
      await fs.writeFile(
        this.lockFile,
        JSON.stringify(this.lockData, null, 2),
        { flag: 'wx', mode: 0o600 }
      );

      Logger.info(`Lock acquired: ${this.lockFile}`);

      // Start refresh interval to keep lock fresh
      this.startRefreshInterval();

      return true;
    } catch (error) {
      if (error.code === 'EEXIST') {
        // File was created by another process between our check and create
        Logger.info('Lock already held by another process');
        return false;
      }
      Logger.error('Error acquiring lock:', error);
      return false;
    }
  }

  _isAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error.code === 'EPERM'; // exists but owned by another user
    }
  }

  /**
   * Wait for lock with timeout
   * @param {number} timeout - Max wait time in milliseconds (default: 60s)
   * @param {number} pollInterval - Check interval in milliseconds (default: 1s)
   * @returns {Promise<boolean>} True if acquired, false if timeout
   */
  async acquire(timeout = 60000, pollInterval = 1000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (await this.tryAcquire()) {
        return true;
      }

      // Wait before trying again
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    Logger.error(`Lock acquisition timeout after ${timeout}ms`);
    return false;
  }

  /**
   * Release the lock
   * @returns {Promise<void>}
   */
  async release() {
    try {
      // Stop refresh interval
      if (this.refreshInterval) {
        clearInterval(this.refreshInterval);
        this.refreshInterval = null;
      }

      // Remove lock file
      try {
        await fs.unlink(this.lockFile);
        Logger.info(`Lock released: ${this.lockFile}`);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          Logger.warn('Error removing lock file:', error.message);
        }
      }
    } catch (error) {
      Logger.error('Error releasing lock:', error);
    }
  }

  /**
   * Refresh lock timestamp to prevent it from being considered stale
   */
  startRefreshInterval() {
    // Refresh every 5 minutes
    this.refreshInterval = setInterval(async () => {
      try {
        this.lockData.acquiredAt = new Date().toISOString();
        await fs.writeFile(
          this.lockFile,
          JSON.stringify(this.lockData, null, 2),
          { mode: 0o600 }
        );
        Logger.debug('Lock refreshed');
      } catch (error) {
        Logger.error('Failed to refresh lock:', error);
      }
    }, 5 * 60 * 1000);

    // Don't keep process alive just for this interval
    if (this.refreshInterval.unref) {
      this.refreshInterval.unref();
    }
  }

  /**
   * Check if lock is currently held
   * @returns {Promise<Object|null>} Lock data if held, null otherwise
   */
  async isLocked() {
    try {
      const data = await fs.readFile(this.lockFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return null;
    }
  }

  /**
   * Force remove lock (dangerous - only use for cleanup)
   * @returns {Promise<void>}
   */
  async forceRelease() {
    try {
      await fs.unlink(this.lockFile);
      Logger.warn(`Lock forcefully removed: ${this.lockFile}`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        Logger.error('Error force-removing lock:', error);
      }
    }
  }
}

module.exports = FileLock;
