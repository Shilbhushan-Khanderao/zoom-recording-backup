/**
 * Server-Sent Events (SSE) Routes
 * Real-time event streaming for dashboard updates
 */

const express = require('express');
const router = express.Router();
const Logger = require('../utils/logger');

// Store active SSE connections
const clients = new Set();

/**
 * GET /api/events
 * SSE endpoint for real-time updates
 */
router.get('/', (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  
  // Prevent timeout
  req.setTimeout(0);

  // Send initial connection event
  res.write(`event: connected\n`);
  res.write(`data: ${JSON.stringify({ 
    message: 'Connected to event stream',
    timestamp: new Date().toISOString() 
  })}\n\n`);

  // Add client to set
  const client = {
    id: Date.now(),
    res,
  };
  clients.add(client);
  
  Logger.debug('SSE client connected', { clientId: client.id, totalClients: clients.size });

  // Handle client disconnect
  req.on('close', () => {
    clients.delete(client);
    Logger.debug('SSE client disconnected', { clientId: client.id, totalClients: clients.size });
  });

  // Send heartbeat every 30 seconds to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(`event: heartbeat\n`);
      res.write(`data: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
    } catch (error) {
      clearInterval(heartbeat);
      clients.delete(client);
    }
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
  });
});

/**
 * Broadcast event to all connected clients
 * @param {string} eventType - Event type (e.g., 'backup:started')
 * @param {Object} data - Event data
 */
function broadcast(eventType, data) {
  const payload = JSON.stringify({
    ...data,
    timestamp: new Date().toISOString(),
  });

  for (const client of clients) {
    try {
      client.res.write(`event: ${eventType}\n`);
      client.res.write(`data: ${payload}\n\n`);
    } catch (error) {
      // Remove dead clients
      clients.delete(client);
    }
  }

  Logger.debug('SSE broadcast', { eventType, clientCount: clients.size });
}

/**
 * Get connected client count
 */
function getClientCount() {
  return clients.size;
}

// Expose broadcast function for use by other modules
router.broadcast = broadcast;
router.getClientCount = getClientCount;

// ==========================================================
// EVENT TYPES DOCUMENTATION
// ==========================================================

/**
 * Available event types:
 * 
 * backup:started    - New backup started
 *   { backupId, topic, date, triggerSource }
 * 
 * backup:progress   - Backup progress update
 *   { backupId, processed, total, percentage, currentFile }
 * 
 * backup:completed  - Backup finished
 *   { backupId, status, filesProcessed, totalSize, duration }
 * 
 * backup:failed     - Backup failed
 *   { backupId, error, filesProcessed }
 * 
 * alert:new         - New alert created
 *   { alertId, type, severity, message }
 * 
 * alert:resolved    - Alert resolved
 *   { alertId }
 * 
 * system:health     - System health update
 *   { status, checks }
 * 
 * token:refreshed   - Token was refreshed
 *   { expiresIn, success }
 * 
 * token:expiring    - Token about to expire
 *   { expiresIn, message }
 */

module.exports = router;
