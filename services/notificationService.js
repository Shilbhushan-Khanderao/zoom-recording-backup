const nodemailer = require('nodemailer');
const Logger = require('../src/logger');

class NotificationService {
  constructor() {
    this.lastSentTimes = new Map();
    // Default cooldown of 24 hours (in milliseconds)
    this.cooldownMs = 24 * 60 * 60 * 1000;
  }

  /**
   * Notifies admins of a token refresh failure, with a rate limit to prevent spam.
   * @param {string} serviceName - The name of the service (e.g., 'Google Drive', 'Zoom API')
   * @param {string} errorMessage - The error message
   */
  async notifyTokenRefreshFailure(serviceName, errorMessage) {
    return this.sendAlert(
      `token:${serviceName}`,
      `🚨 CRITICAL: ${serviceName} Token Refresh Failed`,
      [
        `The ${serviceName} OAuth token for Zoom Backups has failed to refresh.`,
        `Error: ${errorMessage}`,
        'Backups will fail until re-authorized: Dashboard > Auth & Tokens, or run "node cli.js oauth-setup".',
      ]
    );
  }

  /**
   * Email the admins (ALLOWED_SENDERS) at most once per cooldown per key.
   * @returns {Promise<boolean>} true when an email was sent
   */
  async sendAlert(key, subject, lines) {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD || !process.env.ALLOWED_SENDERS) {
      Logger.warn(`Cannot send alert "${subject}": email configuration is missing.`);
      return false;
    }

    const now = Date.now();
    if (now - (this.lastSentTimes.get(key) || 0) < this.cooldownMs) {
      Logger.debug(`Throttling alert ${key}`);
      return false;
    }

    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD }
      });
      const html = `<h2 style="color: #e74c3c;">${esc(subject)}</h2>` +
        lines.map((l) => `<p>${esc(l)}</p>`).join('');
      const adminEmails = process.env.ALLOWED_SENDERS.split(',').map(e => e.trim()).filter(Boolean);
      for (const email of adminEmails) {
        await transporter.sendMail({ from: process.env.EMAIL_USER, to: email, subject, html, text: lines.join('\n') });
      }
      Logger.info(`Alert email sent: ${subject}`);
      this.lastSentTimes.set(key, now);
      return true;
    } catch (error) {
      Logger.error(`Failed to send alert email "${subject}":`, error);
      return false;
    }
  }
}

module.exports = new NotificationService();
