/**
 * Dashboard Overview Routes
 * Provides main dashboard statistics and overview data
 */

const express = require('express');
const router = express.Router();
const Logger = require('../utils/logger');
const dashboardService = require('../services/dashboardService');

/**
 * GET /api/dashboard/overview
 * Returns dashboard overview statistics
 */
router.get('/overview', async (req, res, next) => {
  try {
    const result = await dashboardService.getOverviewStats();
    
    res.json({
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error('Failed to get dashboard overview:', { error: error.message });
    next(error);
  }
});

/**
 * GET /api/dashboard/stats/daily
 * Returns daily backup statistics for charting
 */
router.get('/stats/daily', async (req, res, next) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 180, 365);
    const stats = await dashboardService.getDailyStats(days);

    res.json({
      days,
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error('Failed to get daily stats:', { error: error.message });
    next(error);
  }
});

/**
 * GET /api/dashboard/stats/weekly
 * Returns weekly backup statistics
 */
router.get('/stats/weekly', async (req, res, next) => {
  try {
    const weeks = Math.min(parseInt(req.query.weeks) || 4, 12);
    const stats = await dashboardService.getWeeklyStats(weeks);

    res.json({
      weeks,
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error('Failed to get weekly stats:', { error: error.message });
    next(error);
  }
});

module.exports = router;
