const backupRepository = require('../repositories/backupRepository');

class BackupService {
  async getBackupsList(page, limit, status, triggerSource) {
    const offset = (page - 1) * limit;
    
    const [backups, totalCount] = await Promise.all([
      backupRepository.getBackups(status, triggerSource, limit, offset),
      backupRepository.countBackups(status, triggerSource)
    ]);

    return {
      backups,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit),
      }
    };
  }

  async getRunningBackupStatus() {
    const runningBackup = await backupRepository.getRunningBackup();
    
    if (!runningBackup) {
      return { running: false, backup: null };
    }

    // Check for stale ghost backups (e.g., CLI crashed without updating DB)
    // If it's been running for more than 12 hours, assume it failed.
    const elapsedSeconds = Math.floor((Date.now() - new Date(runningBackup.started_at).getTime()) / 1000);
    const STALE_TIMEOUT_SECONDS = 12 * 60 * 60; // 12 hours

    if (elapsedSeconds > STALE_TIMEOUT_SECONDS) {
      // Auto-fail the stale backup in the database
      const errorMessage = 'Backup marked as failed due to timeout (no progress for 12 hours)';
      await backupRepository.updateBackupStatus(runningBackup.backup_id, 'failed', errorMessage);
      return { running: false, backup: null };
    }

    const progress = runningBackup.total_files > 0
      ? Math.round((runningBackup.processed_files / runningBackup.total_files) * 100)
      : 0;

    return {
      running: true,
      backup: {
        ...runningBackup,
        progress,
        elapsedSeconds: Math.floor((Date.now() - new Date(runningBackup.started_at).getTime()) / 1000),
      }
    };
  }

  async getBackupDetails(id) {
    return await backupRepository.getBackupById(id);
  }

  async getBackupFilesList(id) {
    const files = await backupRepository.getBackupFiles(id);
    return {
      backupId: id,
      files,
      totalFiles: files.length,
    };
  }

  async createBackupRecord(backupId, triggerSource, topic, date, userId) {
    await backupRepository.createBackupRecord(backupId, triggerSource, topic, date, userId);
  }
}

module.exports = new BackupService();
