/**
 * Daily end-to-end health check for the email backup path.
 * Problems (expired Drive auth, broken Zoom credentials, dead IMAP, full disk)
 * are emailed to the admins when they happen, not months later when someone
 * finally sends a backup request.
 */
const fs = require('fs').promises;
const { google } = require('googleapis');
const Logger = require('../src/logger');
const notificationService = require('./notificationService');

const MAIL_STALL_MS = 7 * 60 * 60 * 1000; // longer than the 6h backup timeout

// Each check throws with a readable message on failure
function buildChecks({ config, googleAuthService, getZoomAccessToken, fetchAllRecordings, bot }) {
  return {
    'Zoom API': async () => {
      const token = await getZoomAccessToken();
      const today = new Date().toISOString().slice(0, 10);
      await fetchAllRecordings(config.userId, today, today, token);
    },
    'Google Drive': async () => {
      const auth = googleAuthService.auth || ((await googleAuthService.initialize()) && googleAuthService.auth);
      if (!auth) throw new Error('No Google credentials - re-authorize in Dashboard > Auth & Tokens');
      const drive = google.drive({ version: 'v3', auth });
      await drive.about.get({ fields: 'user(emailAddress)' }); // forces a token refresh if needed
      await drive.files.get({ fileId: config.googleFolder, fields: 'id', supportsAllDrives: true });
    },
    'Mail polling': async () => {
      const idle = Date.now() - (bot.lastPollAt || 0);
      if (idle > MAIL_STALL_MS) {
        throw new Error(`No successful inbox check for ${Math.round(idle / 3600000)}h (IMAP login or connection broken?)`);
      }
    },
    'Disk space': async () => {
      const { bavail, bsize } = await fs.statfs(config.savePath);
      const freeGB = (bavail * bsize) / 1024 ** 3;
      const minGB = Number(config.minFreeSpaceGB) || 20;
      if (freeGB < minGB) throw new Error(`${freeGB.toFixed(1)} GB free on ${config.savePath} (minimum ${minGB} GB)`);
    },
  };
}

async function runHealthCheck(checks, alert = notificationService) {
  const results = [];
  for (const [name, check] of Object.entries(checks)) {
    try {
      await check();
      results.push({ name, ok: true });
    } catch (error) {
      results.push({ name, ok: false, error: error.message || String(error) });
    }
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    Logger.error('Health check failed', null, { failed });
    await alert.sendAlert(
      `health:${failed.map((f) => f.name).join(',')}`,
      `🚨 Zoom backup health check failed: ${failed.map((f) => f.name).join(', ')}`,
      [
        ...failed.map((f) => `${f.name}: ${f.error}`),
        'Email-triggered and scheduled backups will fail until this is fixed.',
      ]
    );
  } else {
    Logger.info('Health check passed: ' + results.map((r) => r.name).join(', '));
  }
  return { ok: failed.length === 0, results, checkedAt: new Date().toISOString() };
}

// First run shortly after start, then every HEALTH_CHECK_HOURS (default 24)
function startHealthMonitor(deps) {
  const run = async () => {
    try {
      deps.bot.lastHealth = await runHealthCheck(buildChecks(deps));
    } catch (error) {
      Logger.error('Health monitor crashed:', error);
    }
  };
  const hours = Number(process.env.HEALTH_CHECK_HOURS) || 24;
  setTimeout(run, 2 * 60 * 1000).unref();
  setInterval(run, hours * 3600 * 1000).unref();
}

module.exports = { buildChecks, runHealthCheck, startHealthMonitor, MAIL_STALL_MS };
