/**
 * Backups Routes
 * Backup listing, details, and trigger operations
 */

const express = require('express');
const router = express.Router();
const Joi = require('joi');
const Logger = require('../utils/logger');
const backupService = require('../services/backupService');
const jobQueue = require('../services/jobQueue');
const { validateBody } = require('../middlewares/validate');

// Schema for triggering a backup
const triggerBackupSchema = Joi.object({
  topic: Joi.string().max(255).optional().allow(''),
  // raw(): keep the client's YYYY-MM-DD instead of Joi's UTC-converted timestamp
  date: Joi.date().iso().raw().optional().allow(''),
  userId: Joi.string().max(100).optional().allow(''),
  dryRun: Joi.boolean().default(false)
});

// Schema for triggering specific files backup
const triggerSpecificSchema = Joi.object({
  files: Joi.array().items(
    Joi.object({
      meetingId: Joi.string().required(),
      fileId: Joi.string().required(),
      topic: Joi.string().optional().allow(''),
      startTime: Joi.string().optional().allow(''),
      downloadUrl: Joi.string().optional().allow(''),
      fileSize: Joi.number().integer().min(0).optional()
    })
  ).min(1).required(),
  dryRun: Joi.boolean().default(false)
});

/**
 * GET /api/backups
 * List backups with pagination and filtering
 */
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const status = req.query.status;
    const triggerSource = req.query.trigger;

    const result = await backupService.getBackupsList(page, limit, status, triggerSource);

    res.json({
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error('Failed to list backups:', { error: error.message });
    next(error);
  }
});

/**
 * GET /api/backups/running
 * Get currently running backup status
 */
router.get('/running', async (req, res, next) => {
  try {
    const result = await backupService.getRunningBackupStatus();

    res.json({
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error('Failed to get running backup:', { error: error.message });
    next(error);
  }
});

/**
 * GET /api/backups/:id
 * Get backup details
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const backup = await backupService.getBackupDetails(id);

    if (!backup) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Backup ${id} not found`,
      });
    }

    res.json({
      backup,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error('Failed to get backup details:', { error: error.message });
    next(error);
  }
});

/**
 * GET /api/backups/:id/files
 * Get backup file details
 */
router.get('/:id/files', async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await backupService.getBackupFilesList(id);

    res.json({
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error('Failed to get backup files:', { error: error.message });
    next(error);
  }
});

/**
 * POST /api/backups/trigger
 * Trigger a new backup via JobQueue
 */
router.post('/trigger', validateBody(triggerBackupSchema), async (req, res, next) => {
  try {
    const backupId = await jobQueue.triggerBackupJob({
      ...req.body,
      triggerSource: 'dashboard'
    });

    res.status(202).json({
      message: 'Backup triggered successfully',
      backupId,
      parameters: req.body,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (error.message.includes('already running')) {
      return res.status(409).json({
        error: 'Conflict',
        message: error.message,
      });
    }
    
    Logger.error('Failed to trigger backup:', { error: error.message });
    next(error);
  }
});

/**
 * POST /api/backups/trigger-specific
 * Trigger a backup for specific recording files via JobQueue
 */
router.post('/trigger-specific', validateBody(triggerSpecificSchema), async (req, res, next) => {
  try {
    const backupId = await jobQueue.triggerBackupJob({
      files: req.body.files,
      dryRun: req.body.dryRun,
      triggerSource: 'dashboard-specific'
    });

    res.status(202).json({
      message: 'Specific files backup triggered successfully',
      backupId,
      fileCount: req.body.files.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (error.message.includes('already running')) {
      return res.status(409).json({
        error: 'Conflict',
        message: error.message,
      });
    }
    
    Logger.error('Failed to trigger specific backup:', { error: error.message });
    next(error);
  }
});

module.exports = router;
