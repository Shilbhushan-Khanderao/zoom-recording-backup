const { get, all } = require('../utils/dbConnection');

class DashboardRepository {
  async getTodayStats(today) {
    return await get(`
      SELECT
        COUNT(*) as total_backups,
        SUM(CASE WHEN status IN ('success', 'partial') THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(processed_files) as files_processed,
        SUM(processed_size) as total_size
      FROM backups
      WHERE DATE(started_at) = $1
    `, [today]);
  }

  async getRecentBackups(limit) {
    return await all(`
      SELECT backup_id, trigger_source, status, started_at, completed_at,
             total_files, processed_files, failed_files, processed_size, duration_seconds,
             topic_filter, error_message
      FROM backups 
      ORDER BY started_at DESC 
      LIMIT $1
    `, [limit]);
  }

  async getActiveAlertsCount() {
    return await get(`
      SELECT COUNT(*) as count
      FROM alerts 
      WHERE resolved = 0
    `);
  }

  async getAllTimeStats() {
    return await get(`
      SELECT
        COUNT(*) as total_backups,
        SUM(CASE WHEN status IN ('success', 'partial') THEN 1 ELSE 0 END) as successful,
        SUM(processed_files) as files_processed,
        SUM(processed_size) as total_size
      FROM backups
    `);
  }

  async getDailyStats(days) {
    // PostgreSQL specific date interval query
    return await all(`
      SELECT
        DATE(started_at) as date,
        COUNT(*) as total_backups,
        SUM(CASE WHEN status IN ('success', 'partial') THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(processed_files) as files_processed,
        SUM(processed_size) as total_size,
        AVG(duration_seconds) as avg_duration
      FROM backups
      WHERE started_at >= NOW() - INTERVAL '1 day' * $1
      GROUP BY DATE(started_at)
      ORDER BY date DESC
    `, [days]);
  }

  async getWeeklyStats(weeks) {
    // PostgreSQL specific week extraction (ISO week format YYYY-Www)
    return await all(`
      SELECT
        TO_CHAR(started_at, 'IYYY-"W"IW') as week,
        COUNT(*) as total_backups,
        SUM(CASE WHEN status IN ('success', 'partial') THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(processed_files) as files_processed,
        SUM(processed_size) as total_size
      FROM backups
      WHERE started_at >= NOW() - INTERVAL '1 week' * $1
      GROUP BY TO_CHAR(started_at, 'IYYY-"W"IW')
      ORDER BY week DESC
    `, [weeks]);
  }
}

module.exports = new DashboardRepository();
