const express = require('express');
const router = express.Router();

// Zoom returns meeting passcodes and download tokens; the dashboard never needs them
const SECRET_FIELDS = ['password', 'recording_play_passcode', 'encrypted_password', 'h323_password', 'pstn_password', 'download_access_token'];
const omitSecrets = (obj) => Object.fromEntries(Object.entries(obj).filter(([k]) => !SECRET_FIELDS.includes(k)));
const stripSecrets = (meeting) => ({
  ...omitSecrets(meeting),
  ...(meeting.recording_files && { recording_files: meeting.recording_files.map(omitSecrets) }),
});
const Logger = require('../utils/logger');
const { getZoomAccessToken } = require('../../../src/zoomAuth');
const { fetchLicensedUsers, fetchAllRecordings } = require('../../../src/zoomFetcher');

/**
 * GET /api/zoom/users
 * Fetch licensed Zoom users for the account
 */
router.get('/users', async (req, res, next) => {
  try {
    const token = await getZoomAccessToken();
    const users = await fetchLicensedUsers(token);
    
    res.json({
      users,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    Logger.error('Failed to fetch Zoom users:', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch users', message: error.message });
  }
});

/**
 * GET /api/zoom/recordings
 * Fetch all recordings for a specific user and date range
 */
router.get('/recordings', async (req, res, next) => {
  try {
    const { userId, fromDate, toDate, topic } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'Bad Request', message: 'userId is required' });
    }
    
    let finalFromDate = fromDate;
    let finalToDate = toDate;

    // If dates are omitted, default to 8 months ago
    if (!finalFromDate) {
      const d = new Date();
      d.setMonth(d.getMonth() - 8);
      finalFromDate = d.toISOString().split('T')[0];
    }
    if (!finalToDate) {
      finalToDate = new Date().toISOString().split('T')[0];
    }

    const token = await getZoomAccessToken();
    let recordings = await fetchAllRecordings(userId, finalFromDate, finalToDate, token);

    // Filter by topic if provided
    if (topic) {
      const searchTopic = topic.toLowerCase();
      recordings = recordings.filter(r => r.topic && r.topic.toLowerCase().includes(searchTopic));
    }

    res.json({
      userId,
      recordings: recordings.map(stripSecrets),
      totalRecordings: recordings.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    Logger.error('Failed to fetch Zoom recordings:', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch recordings', message: error.message });
  }
});

module.exports = router;
