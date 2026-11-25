const { spawn } = require('child_process');
const path = require('path');
const Logger = require('../utils/logger');
const backupService = require('./backupService');

class JobQueue {
  constructor() {
    this.activeJob = null;
  }

  async triggerBackupJob(params = {}) {
    let { topic, date, userId, dryRun = false, triggerSource = 'dashboard', files = null } = params;

    if (!topic && files && files.length > 0) {
      topic = files[0].topic;
    }

    // Check if a backup is already running in the database
    const { running } = await backupService.getRunningBackupStatus();
    
    if (running || this.activeJob !== null) {
      throw new Error('A backup job is already running');
    }

    const backupId = `BACKUP-${Date.now()}`;
    
    // Create backup record
    await backupService.createBackupRecord(backupId, triggerSource, topic, date, userId);

    const cliPath = path.join(__dirname, '../../../cli.js');
    const args = ['backup'];
    
    if (files && Array.isArray(files) && files.length > 0) {
      // Pass base64 encoded files to cli
      const filesJson = JSON.stringify(files);
      const filesBase64 = Buffer.from(filesJson).toString('base64');
      args.push('--files', filesBase64);
    } else {
      if (topic) args.push('--topic', topic);
      if (date) args.push('--date', date);
      if (userId) args.push('--user', userId);
    }
    
    
    if (dryRun) args.push('--dry-run');
    args.push('--backup-id', backupId);

    Logger.info('Triggering backup job via JobQueue', { backupId, args });

    // Spawn backup process detached to prevent blocking dashboard
    const child = spawn('node', [cliPath, ...args], {
      cwd: path.join(__dirname, '../../..'),
      env: { ...process.env },
      stdio: 'ignore', // We ignore stdio to prevent buffer exhaustion, file logger handles output
      detached: true,
    });

    this.activeJob = {
      backupId,
      pid: child.pid,
      startTime: Date.now()
    };

    child.on('error', (err) => {
      Logger.error(`JobQueue: Failed to start child process for backup ${backupId}: ${err.message}`);
      this.activeJob = null;
    });

    child.on('exit', (code, signal) => {
      Logger.info(`JobQueue: Backup job ${backupId} exited with code ${code} and signal ${signal}`);
      this.activeJob = null;
    });

    // Unref the child so the dashboard process can exit independently
    child.unref();

    return backupId;
  }

  getActiveJob() {
    return this.activeJob;
  }
}

module.exports = new JobQueue();
