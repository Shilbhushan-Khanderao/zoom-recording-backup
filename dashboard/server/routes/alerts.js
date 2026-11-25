/**
 * Alerts Routes
 * Alert listing and management
 */

const express = require('express');
const router = express.Router();
const { get, all, run } = require('../utils/dbConnection');
const Logger = require('../utils/logger');

/**
 * GET /api/alerts
 * List all alerts with optional filtering
 */
router.get('/', async (req, res, next) => {
  try {
    const { resolved, severity, category, limit = 50 } = req.query;
    
    let whereClause = '1=1';
    const params = [];

    if (resolved !== undefined) {
      whereClause += ' AND resolved = ?';
      params.push(resolved === 'true' ? 1 : 0);
    }

    if (severity) {
      whereClause += ' AND severity = ?';
      params.push(severity);
    }

    if (category) {
      whereClause += ' AND category = ?';
      params.push(category);
    }

    params.push(Math.min(200, parseInt(limit)));

    const alerts = await all(`
      SELECT id, type, category, message, details, severity, 
             backup_id, resolved, resolved_at, created_at
      FROM alerts 
      WHERE ${whereClause}
      ORDER BY created_at DESC 
      LIMIT ?
    `, params);

    res.json({
      alerts,
      totalCount: alerts.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error('Failed to list alerts:', { error: error.message });
    next(error);
  }
});

/**
 * GET /api/alerts/active
 * Get active (unresolved) alerts
 */
router.get('/active', async (req, res, next) => {
  try {
    const alerts = await all(`
      SELECT id, type, category, message, details, severity, 
             backup_id, created_at
      FROM alerts 
      WHERE resolved = 0
      ORDER BY 
        CASE severity 
          WHEN 'critical' THEN 1 
          WHEN 'warning' THEN 2 
          ELSE 3 
        END,
        created_at DESC
    `);

    const summary = {
      critical: alerts.filter(a => a.severity === 'critical').length,
      warning: alerts.filter(a => a.severity === 'warning').length,
      info: alerts.filter(a => a.severity === 'info').length,
    };

    res.json({
      alerts,
      summary,
      totalActive: alerts.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error('Failed to get active alerts:', { error: error.message });
    next(error);
  }
});

/**
 * GET /api/alerts/stats
 * Get alert statistics
 */
router.get('/stats', async (req, res, next) => {
  try {
    const [totalStats, categoryStats, recentStats] = await Promise.all([
      get(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN resolved = 0 THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN resolved = 1 THEN 1 ELSE 0 END) as resolved
        FROM alerts
      `),
      all(`
        SELECT category, COUNT(*) as count
        FROM alerts
        WHERE resolved = 0
        GROUP BY category
      `),
      get(`
        SELECT COUNT(*) as count
        FROM alerts
        WHERE created_at >= NOW() - INTERVAL '24 hours'
      `),
      all(`
        SELECT severity, COUNT(*) as count
        FROM alerts
        WHERE resolved = 0
        GROUP BY severity
      `),
    ]);

    // Build bySeverity object from the query result
    const bySeverity = { critical: 0, warning: 0, info: 0 };
    const severityStats = await all(`
      SELECT severity, COUNT(*) as count
      FROM alerts
      WHERE resolved = 0
      GROUP BY severity
    `);
    if (Array.isArray(severityStats)) {
      severityStats.forEach(row => {
        if (bySeverity.hasOwnProperty(row.severity)) {
          bySeverity[row.severity] = row.count;
        }
      });
    }

    res.json({
      total: totalStats?.total || 0,
      active: totalStats?.active || 0,
      resolved: totalStats?.resolved || 0,
      last24Hours: recentStats?.count || 0,
      byCategory: categoryStats || [],
      bySeverity,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error('Failed to get alert stats:', { error: error.message });
    next(error);
  }
});

/**
 * PATCH /api/alerts/:id/resolve
 * Resolve an alert
 */
router.patch('/:id/resolve', async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await run(`
      UPDATE alerts 
      SET resolved = 1, resolved_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [id]);

    if (result.changes === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Alert ${id} not found`,
      });
    }

    res.json({
      message: 'Alert resolved',
      alertId: id,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error('Failed to resolve alert:', { error: error.message });
    next(error);
  }
});

/**
 * POST /api/alerts/:id/reopen
 * Reopen a resolved alert
 */
router.post('/:id/reopen', async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await run(`
      UPDATE alerts 
      SET resolved = 0, resolved_at = NULL
      WHERE id = ?
    `, [id]);

    if (result.changes === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Alert ${id} not found`,
      });
    }

    res.json({
      message: 'Alert reopened',
      alertId: id,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error('Failed to reopen alert:', { error: error.message });
    next(error);
  }
});

/**
 * DELETE /api/alerts/:id
 * Delete an alert
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await run('DELETE FROM alerts WHERE id = ?', [id]);

    if (result.changes === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Alert ${id} not found`,
      });
    }

    res.json({
      message: 'Alert deleted',
      alertId: id,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error('Failed to delete alert:', { error: error.message });
    next(error);
  }
});

/**
 * POST /api/alerts/resolve-all
 * Resolve all active alerts
 */
router.post('/resolve-all', async (req, res, next) => {
  try {
    const result = await run(`
      UPDATE alerts 
      SET resolved = 1, resolved_at = CURRENT_TIMESTAMP
      WHERE resolved = 0
    `);

    res.json({
      message: 'All alerts resolved',
      count: result.changes,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error('Failed to resolve all alerts:', { error: error.message });
    next(error);
  }
});

module.exports = router;
