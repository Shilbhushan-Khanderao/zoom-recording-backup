/**
 * PostgreSQL Database Connection Manager
 * Provides connection pooling and query utilities
 */

const { Pool } = require('pg');
const Logger = require('./logger');

let pool = null;

/**
 * Initialize the database connection
 */
async function initDatabase() {
  return new Promise(async (resolve, reject) => {
    try {
      const dbUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/zoom_backup';
      
      pool = new Pool({
        connectionString: dbUrl,
      });

      // Test connection
      const client = await pool.connect();
      client.release();
      
      Logger.info('Connected to PostgreSQL database');
      
      // Create tables if they don't exist
      // Tables are now managed by scripts/migrate.js
      resolve(pool);
    } catch (err) {
      Logger.error('Failed to connect to PostgreSQL database:', { error: err.message });
      reject(err);
    }
  });
}


/**
 * Close the database connection
 */
async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
    Logger.info('Database connection closed');
  }
}

/**
 * Get the database instance
 */
function getDatabase() {
  if (!pool) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return pool;
}

/**
 * Helper to convert sqlite parameterized queries (? or $1) to Postgres $1, $2, etc.
 * Simplistic conversion assuming either ? or standard PG syntax is passed.
 */
function normalizeQuery(sql) {
  let paramCount = 1;
  return sql.replace(/\?/g, () => `$${paramCount++}`);
}

/**
 * Run a query that modifies data (INSERT, UPDATE, DELETE)
 */
async function run(sql, params = []) {
  if (!pool) throw new Error('Database not initialized');
  try {
    const res = await pool.query(normalizeQuery(sql), params);
    // PG doesn't have lastID reliably without RETURNING, but we provide mock changes
    return { changes: res.rowCount };
  } catch (err) {
    Logger.error('Database run error:', { error: err.message, sql: sql.substring(0, 100) });
    throw err;
  }
}

/**
 * Get a single row
 */
async function get(sql, params = []) {
  if (!pool) throw new Error('Database not initialized');
  try {
    const res = await pool.query(normalizeQuery(sql), params);
    return res.rows[0];
  } catch (err) {
    Logger.error('Database get error:', { error: err.message, sql: sql.substring(0, 100) });
    throw err;
  }
}

/**
 * Get all rows
 */
async function all(sql, params = []) {
  if (!pool) throw new Error('Database not initialized');
  try {
    const res = await pool.query(normalizeQuery(sql), params);
    return res.rows || [];
  } catch (err) {
    Logger.error('Database all error:', { error: err.message, sql: sql.substring(0, 100) });
    throw err;
  }
}

/**
 * Begin a database transaction
 */
async function beginTransaction() {
  await run('BEGIN');
}

/**
 * Commit a transaction
 */
async function commit() {
  await run('COMMIT');
}

/**
 * Rollback a transaction
 */
async function rollback() {
  await run('ROLLBACK');
}

/**
 * Execute queries within a transaction
 */
async function transaction(callback) {
  try {
    await beginTransaction();
    const result = await callback();
    await commit();
    return result;
  } catch (error) {
    await rollback();
    throw error;
  }
}

module.exports = {
  initDatabase,
  closeDatabase,
  getDatabase,
  run,
  get,
  all,
  beginTransaction,
  commit,
  rollback,
  transaction,
};
