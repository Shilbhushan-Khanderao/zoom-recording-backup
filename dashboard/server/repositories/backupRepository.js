const { get, all, run } = require('../utils/dbConnection');

class BackupRepository {
  async getBackups(status, triggerSource, limit, offset) {
    let whereClause = '1=1';
    const params = [];

    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }

    if (triggerSource) {
      whereClause += ' AND trigger_source = ?';
      params.push(triggerSource);
    }

    const backups = await all(
      `SELECT backup_id, trigger_source, status, started_at, completed_at,
              total_files, processed_files, failed_files, skipped_files,
              total_size, processed_size, duration_seconds,
              topic_filter, date_filter, error_message
       FROM backups 
       WHERE ${whereClause}
       ORDER BY started_at DESC 
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return backups;
  }

  async countBackups(status, triggerSource) {
    let whereClause = '1=1';
    const params = [];

    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }

    if (triggerSource) {
      whereClause += ' AND trigger_source = ?';
      params.push(triggerSource);
    }

    const countResult = await get(
      `SELECT COUNT(*) as total FROM backups WHERE ${whereClause}`,
      params
    );

    return countResult?.total || 0;
  }

  async getRunningBackup() {
    return await get(`
      SELECT backup_id, trigger_source, status, started_at,
             total_files, processed_files, failed_files,
             total_size, processed_size, topic_filter, date_filter
      FROM backups 
      WHERE status = 'running'
      ORDER BY started_at DESC 
      LIMIT 1
    `);
  }

  async getBackupById(id) {
    return await get(`
      SELECT *
      FROM backups 
      WHERE backup_id = ?
    `, [id]);
  }

  async getBackupFiles(backupId) {
    return await all(`
      SELECT file_name, file_size, file_type, meeting_topic,
             status, download_time_ms, upload_time_ms, error_message, created_at
      FROM backup_files 
      WHERE backup_id = ?
      ORDER BY created_at ASC
    `, [backupId]);
  }

  async createBackupRecord(backupId, triggerSource, topicFilter, dateFilter, userFilter) {
    await run(`
      INSERT INTO backups (backup_id, trigger_source, topic_filter, date_filter, user_filter)
      VALUES (?, ?, ?, ?, ?)
    `, [backupId, triggerSource, topicFilter || null, dateFilter || null, userFilter || null]);
  }

  async updateBackupStatus(backupId, status, errorMessage = null) {
    const completedAt = (status === 'success' || status === 'partial' || status === 'failed') 
      ? new Date().toISOString() 
      : null;
      
    await run(`
      UPDATE backups 
      SET status = ?, 
          completed_at = COALESCE(completed_at, ?),
          error_message = COALESCE(?, error_message)
      WHERE backup_id = ?
    `, [status, completedAt, errorMessage, backupId]);
  }
}

module.exports = new BackupRepository();
