/**
 * Dashboard Database Client
 * Directly writes backup data to Postgres for the dashboard to read
 */
const { Pool } = require('pg');
const Logger = require('./logger');

class DashboardClient {
  constructor() {
    this.enabled = process.env.ENABLE_DASHBOARD !== 'false';
    const dbUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/zoom_backup';
    this.pool = null;
    
    if (this.enabled) {
      this.initializeDatabase(dbUrl);
    }
  }

  async initializeDatabase(dbUrl) {
    try {
      this.pool = new Pool({ connectionString: dbUrl });
      const client = await this.pool.connect();
      client.release();
      // Tables are now managed by scripts/migrate.js
    } catch (error) {
      Logger.error(`Dashboard DB init failed: ${error.message}`);
      this.enabled = false;
    }
  }



  // Promise wrapper for pool.query
  async run(sql, params = []) {
    if (!this.enabled || !this.pool) return null;

    try {
      // Convert ? to $1, $2, etc.
      let paramCount = 1;
      const pgSql = sql.replace(/\?/g, () => "$" + (paramCount++));
      
      const res = await this.pool.query(pgSql, params);
      return { changes: res.rowCount };
    } catch (err) {
      Logger.debug(`DB query failed: ${err.message}`);
      return null;
    }
  }

  // ========== BACKUP OPERATIONS ==========

  async createBackup(backupId, options = {}) {
    const { totalFiles = 0, totalSize = 0, triggerSource = 'manual', topicFilter = null, dateFilter = null } = options;
    
    // Postgres UPSERT equivalent (ON CONFLICT)
    const result = await this.run(`
      INSERT INTO backups 
        (backup_id, trigger_source, status, started_at, total_files, total_size, topic_filter, date_filter)
      VALUES (?, ?, 'running', CURRENT_TIMESTAMP, ?, ?, ?, ?)
      ON CONFLICT (backup_id) DO UPDATE SET 
        trigger_source = COALESCE(backups.trigger_source, EXCLUDED.trigger_source),
        status = 'running',
        started_at = CURRENT_TIMESTAMP,
        total_files = EXCLUDED.total_files,
        total_size = EXCLUDED.total_size,
        topic_filter = EXCLUDED.topic_filter,
        date_filter = EXCLUDED.date_filter
    `, [backupId, triggerSource, totalFiles, totalSize, topicFilter, dateFilter]);

    return result;
  }

  async updateProgress(backupId, stats = {}) {
    const { processedFiles = 0, processedSize = 0, failedFiles = 0, skippedFiles = 0 } = stats;
    
    return this.run(`
      UPDATE backups SET 
        processed_files = ?, processed_size = ?, failed_files = ?, skipped_files = ?
      WHERE backup_id = ?
    `, [processedFiles, processedSize, failedFiles, skippedFiles, backupId]);
  }

  async completeBackup(backupId, status, errorMessage = null) {
    return this.run(`
      UPDATE backups SET 
        status = ?, 
        completed_at = CURRENT_TIMESTAMP,
        duration_seconds = CAST(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at)) AS INTEGER),
        error_message = ?
      WHERE backup_id = ?
    `, [status, errorMessage, backupId]);
  }

  // ========== FILE OPERATIONS ==========

  async addFile(backupId, fileData = {}) {
    const { 
      fileName = 'unknown', 
      fileSize = 0, 
      fileType = null,
      meetingTopic = null,
      status = 'pending' 
    } = fileData;
    
    return this.run(`
      INSERT INTO backup_files (backup_id, file_name, file_size, file_type, meeting_topic, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [backupId, fileName, fileSize, fileType, meetingTopic, status]);
  }

  // ========== ALERT OPERATIONS ==========

  async createAlert(type, message, severity = 'warning', backupId = null) {
    return this.run(`
      INSERT INTO alerts (type, message, severity, backup_id)
      VALUES (?, ?, ?, ?)
    `, [type, message, severity, backupId]);
  }

  close() {
    if (this.pool) {
      this.pool.end();
      this.pool = null;
    }
  }
}

module.exports = DashboardClient;
