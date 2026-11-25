require('dotenv').config();
const { Pool } = require('pg');
const Logger = require('../src/logger');

async function migrate() {
  const dbUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/zoom_backup';
  Logger.info(`Connecting to database at ${dbUrl.replace(/:[^:@]+@/, ':***@')}`);

  const pool = new Pool({
    connectionString: dbUrl,
  });

  try {
    const client = await pool.connect();
    Logger.info('Connected to PostgreSQL successfully. Running migrations...');

    // Backups table
    await client.query(`
      CREATE TABLE IF NOT EXISTS backups (
        id SERIAL PRIMARY KEY,
        backup_id TEXT UNIQUE NOT NULL,
        trigger_source TEXT DEFAULT 'manual',
        status TEXT DEFAULT 'running',
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        total_files INTEGER DEFAULT 0,
        processed_files INTEGER DEFAULT 0,
        failed_files INTEGER DEFAULT 0,
        skipped_files INTEGER DEFAULT 0,
        total_size BIGINT DEFAULT 0,
        processed_size BIGINT DEFAULT 0,
        duration_seconds INTEGER DEFAULT 0,
        error_message TEXT,
        topic_filter TEXT,
        date_filter TEXT,
        user_filter TEXT,
        triggered_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    Logger.info('✅ backups table verified');

    // Backup files table
    await client.query(`
      CREATE TABLE IF NOT EXISTS backup_files (
        id SERIAL PRIMARY KEY,
        backup_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_size BIGINT DEFAULT 0,
        file_type TEXT,
        meeting_topic TEXT,
        meeting_date DATE,
        status TEXT DEFAULT 'pending',
        download_time_ms INTEGER,
        upload_time_ms INTEGER,
        drive_file_id TEXT,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (backup_id) REFERENCES backups(backup_id) ON DELETE CASCADE
      )
    `);
    Logger.info('✅ backup_files table verified');

    // Alerts table
    await client.query(`
      CREATE TABLE IF NOT EXISTS alerts (
        id SERIAL PRIMARY KEY,
        type TEXT NOT NULL,
        category TEXT DEFAULT 'system',
        message TEXT NOT NULL,
        details TEXT,
        severity TEXT DEFAULT 'info',
        backup_id TEXT,
        resolved INTEGER DEFAULT 0,
        resolved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    Logger.info('✅ alerts table verified');

    // System metrics table
    await client.query(`
      CREATE TABLE IF NOT EXISTS system_metrics (
        id SERIAL PRIMARY KEY,
        metric_name TEXT NOT NULL,
        metric_value REAL NOT NULL,
        unit TEXT,
        recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    Logger.info('✅ system_metrics table verified');

    // Daily stats table
    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_stats (
        id SERIAL PRIMARY KEY,
        date DATE UNIQUE NOT NULL,
        total_backups INTEGER DEFAULT 0,
        successful_backups INTEGER DEFAULT 0,
        failed_backups INTEGER DEFAULT 0,
        files_processed INTEGER DEFAULT 0,
        total_size BIGINT DEFAULT 0,
        avg_duration_seconds INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    Logger.info('✅ daily_stats table verified');

    // Indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_backups_status ON backups(status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_backups_started ON backups(started_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_backups_trigger ON backups(trigger_source)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_files_backup ON backup_files(backup_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_files_status ON backup_files(status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_alerts_resolved ON alerts(resolved)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_alerts_category ON alerts(category)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_metrics_name_time ON system_metrics(metric_name, recorded_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(date)`);
    Logger.info('✅ Indexes verified');

    Logger.info('🎉 Database migration completed successfully.');
    client.release();
  } catch (error) {
    Logger.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
