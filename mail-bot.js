const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const nodemailer = require('nodemailer');
const { spawn } = require('child_process');
const path = require('path');
const Logger = require('./src/logger');
const googleAuthService = require('./services/googleAuthService');
const ZoomTokenRefreshService = require('./services/zoomTokenRefreshService');
const HealthCheckServer = require('./services/healthCheckServer');
require('dotenv').config();

// Database instance for stats retrieval
const { Pool } = require('pg');
let pool = null;

/**
 * Initialize PostgreSQL database connection for stats retrieval
 */
function initDatabase() {
  try {
    const dbUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/zoom_backup';
    pool = new Pool({ connectionString: dbUrl });
    pool.query('SELECT 1', (err) => {
      if (err) {
        Logger.debug(`Dashboard DB not available for stats: ${err.message}`);
        pool = null;
      } else {
        Logger.debug('Dashboard DB connected for stats retrieval');
      }
    });
  } catch (error) {
    Logger.debug(`Failed to initialize dashboard DB: ${error.message}`);
    pool = null;
  }
}

/**
 * Get backup statistics from dashboard database
 * @param {string} backupSessionId - The backup session ID
 * @returns {Promise<Object|null>} Stats object or null if not available
 */
async function getBackupStatsFromDatabase(backupSessionId) {
  return new Promise((resolve) => {
    if (!pool) {
      resolve(null);
      return;
    }

    // Fixed query: removed OR condition that caused double counting
    const query = `
      SELECT 
        COUNT(*) as total_files,
        SUM(file_size) as total_size,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_files,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_files
      FROM backup_files 
      WHERE backup_id = $1
    `;

    pool.query(query, [backupSessionId], (err, res) => {
      if (err) {
        Logger.debug(`Failed to query backup stats: ${err.message}`);
        resolve(null);
        return;
      }

      const row = res.rows[0];
      if (row && row.total_files > 0) {
        resolve({
          total_files: parseInt(row.total_files) || 0,
          total_size: parseInt(row.total_size) || 0,
          completed_files: parseInt(row.completed_files) || 0,
          failed_files: parseInt(row.failed_files) || 0
        });
      } else {
        resolve(null);
      }
    });
  });
}

// Configuration
const config = {
  imap: {
    user: process.env.EMAIL_USER,
    password: process.env.EMAIL_PASSWORD,
    host: process.env.IMAP_HOST || 'imap.gmail.com',
    port: process.env.IMAP_PORT || 993,
    tls: true,
    // node-imap omits SNI; without it Gmail serves a self-signed placeholder cert
    tlsOptions: { servername: process.env.IMAP_HOST || 'imap.gmail.com' },
    authTimeout: 60000,  // 60 seconds - Gmail sometimes slow to respond
    connTimeout: 60000   // 60 seconds
  },
  smtp: {
    service: 'gmail', // Or use host/port
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    }
  },
  allowedSenders: (process.env.ALLOWED_SENDERS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  requireDmarc: process.env.REQUIRE_DMARC !== 'false',
  backupTimeoutMs: parseInt(process.env.BACKUP_TIMEOUT_MS, 10) || 6 * 60 * 60 * 1000, // 6 hours
  pollInterval: 60000 * 3 // 3 minutes
};

const MAX_BUFFERED_OUTPUT = 64 * 1024; // keep only the tail of child output to bound memory

const { renderEmail, escapeHtml, formatDateTime } = require('./src/emailTemplate');

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 MB';
  if (bytes > 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  if (bytes > 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  if (bytes > 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return bytes + ' B';
}

// Deduplication cache to prevent reprocessing of same topics within 5 minutes
const deduplicationCache = new Map(); // Maps topic+date -> timestamp
const DEDUP_INTERVAL = 5 * 60 * 1000; // 5 minutes in milliseconds

function isDuplicate(topic, date) {
  const key = `${topic || 'all'}-${date || 'all'}`;
  const lastProcessedTime = deduplicationCache.get(key);
  const now = Date.now();

  if (lastProcessedTime && (now - lastProcessedTime) < DEDUP_INTERVAL) {
    Logger.warn(`Duplicate request ignored: Topic=${topic}, Date=${date}. Last processed ${(now - lastProcessedTime) / 1000}s ago.`);
    return true;
  }

  // Update cache with current timestamp
  deduplicationCache.set(key, now);
  return false;
}

// Clean old entries from cache periodically (every 10 minutes) - Fixed memory leak
let cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of deduplicationCache.entries()) {
    if (now - timestamp > DEDUP_INTERVAL) {
      deduplicationCache.delete(key);
    }
  }
  // Removed verbose debug log for production
}, 10 * 60 * 1000);
cleanupInterval.unref(); // the IMAP connection keeps the bot alive; this timer alone should not


async function sendReply(to, subject, { html, text }) {
  try {
    const transporter = nodemailer.createTransport(config.smtp);
    await transporter.sendMail({
      from: `Zoom Drive Backup <${config.imap.user}>`,
      to: to,
      subject: subject,
      html,
      text
    });
    Logger.info(`Email sent to ${to}: ${subject}`);
  } catch (error) {
    Logger.error('Failed to send email:', error);
  }
}

async function runBackup(topic, date, userId, backupId) {
  return new Promise((resolve) => {
    Logger.info(`Triggering backup ${backupId} for UserId: ${userId || 'default'}, Topic: ${topic}, Date: ${date}`);

    const args = ['cli.js', 'backup'];
    if (userId) args.push('--user', userId);
    if (topic) args.push('--topic', topic);
    if (date) args.push('--date', date);
    if (backupId) args.push('--backup-id', backupId);
    args.push('--source', 'email');

    // Ensure child process inherits all environment variables including those loaded by dotenv
    const childEnv = { ...process.env };

    const child = spawn('node', args, {
      cwd: __dirname,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe']  // Detach stdin, keep stdout/stderr
    });

    let output = '';
    let errorOutput = '';
    let timedOut = false;
    let killTimer = null;

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      Logger.logWithContext('error', `Backup ${backupId} exceeded ${config.backupTimeoutMs}ms, terminating`, 'BackupProcess');
      // Arm SIGKILL first so a close fired during kill() can still cancel it
      killTimer = setTimeout(() => child.kill('SIGKILL'), 10000);
      child.kill('SIGTERM');
    }, config.backupTimeoutMs);

    child.stdout.on('data', (data) => {
      output = (output + data.toString()).slice(-MAX_BUFFERED_OUTPUT);
    });

    child.stderr.on('data', (data) => {
      errorOutput = (errorOutput + data.toString()).slice(-MAX_BUFFERED_OUTPUT);
    });

    child.on('close', (code) => {
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      if (timedOut) {
        resolve({ success: false, partial: false, output, error: 'Backup timed out', code: -1 });
        return;
      }
      resolve({
        success: code === 0,
        partial: code === 2,
        output,
        error: errorOutput,
        code
      });
    });

    child.on('error', (err) => {
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      Logger.logWithContext('error', `Failed to spawn process: ${err.message}`, 'BackupProcess');
      resolve({
        success: false,
        output: '',
        error: err.message,
        code: -1
      });
    });
  });
}

function parseEmailBody(text) {
  // Matches "Topic: <topic>", "Date: <date>", "UserId: <userId>" (case insensitive) as whole words,
  // so "Weekly update: notes" is not read as a Date. [^\n\r]+ stops at the line break.
  text = String(text || '');
  const topicMatch = text.match(/\bTopic:[ \t]*([^\n\r]+)/i);
  const dateMatch = text.match(/\bDate:[ \t]*([^\n\r]+)/i);
  const userIdMatch = text.match(/\bUserId:[ \t]*([^\n\r]+)/i);

  // Validate and sanitize extracted values
  const sanitizeInput = (value, maxLength = 255) => {
    if (!value) return null;
    // Remove any potentially dangerous characters and limit length
    return value
      .trim()
      .replace(/[<>\"'`${}]/g, '') // Remove shell/injection characters
      .substring(0, maxLength); // Limit length to prevent DOS
  };

  return {
    topic: sanitizeInput(topicMatch ? topicMatch[1] : null),
    date: sanitizeInput(dateMatch ? dateMatch[1] : null, 50), // Date should be shorter
    userId: sanitizeInput(userIdMatch ? userIdMatch[1] : null, 100)
  };
}

// Get backup stats from this backup's own progress file (written by cli.js --backup-id)
async function getProgressFileStats(backupSessionId) {
  return new Promise((resolve) => {
    try {
      const fs = require('fs');
      const progressFile = path.join(__dirname, 'logs', 'backups', `progress_${backupSessionId}.json`);

      if (!fs.existsSync(progressFile)) {
        Logger.debug(`Progress file not found: ${progressFile}`);
        resolve(null);
        return;
      }

      const data = fs.readFileSync(progressFile, 'utf-8');

      // Safe JSON parsing with error handling
      let progressData;
      try {
        progressData = JSON.parse(data);
      } catch (parseError) {
        Logger.error(`Failed to parse progress file ${progressFile}:`, parseError);
        resolve(null);
        return;
      }

      // Use uploaded files count as the most reliable metric
      let filesCount = 0;
      let totalSizeFormatted = '0 MB';
      if (Array.isArray(progressData.uploadedFiles)) {
        filesCount = progressData.uploadedFiles.length;
        const totalBytes = progressData.uploadedFiles.reduce(
          (sum, file) => sum + (typeof file?.fileSize === 'number' ? file.fileSize : 0), 0);
        totalSizeFormatted = formatBytes(totalBytes);
      }

      const stats = {
        filesDownloaded: filesCount,
        filesTotalSize: totalSizeFormatted,
        totalRecordings: progressData.totalFiles || 0,
        recordingsProcessed: progressData.processedFiles || 0,
        filesFailed: (progressData.failedFiles && progressData.failedFiles.length) || 0,
        uploadedFiles: progressData.uploadedFiles || [],
        failedFiles: progressData.failedFiles || [],
        recordings: progressData.recordings || [],
        startTime: progressData.startTime,
        endTime: progressData.endTime,
        details: progressData.uploadedFiles || []
      };

      Logger.info(`Progress file stats - Files uploaded: ${stats.filesDownloaded}, Total size: ${stats.filesTotalSize}, Recordings found: ${stats.totalRecordings}`);
      resolve(stats);
    } catch (err) {
      Logger.debug(`Failed to read progress file stats: ${err.message}`);
      resolve(null);
    }
  });
}

// A half-dead socket makes IMAP commands hang forever with no error/close event, leaving
// isProcessing stuck true and polling silently dead. Bound each IMAP call so it throws instead.
const IMAP_OP_TIMEOUT_MS = 2 * 60 * 1000;
function imapTimeout(promise, what, ms = IMAP_OP_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`IMAP ${what} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function checkMail(existingConnection) {
  let connection;
  let ownsConnection = false;
  try {
    if (existingConnection) {
      connection = existingConnection;
    } else {
      connection = await imapTimeout(imaps.connect({ imap: config.imap }), 'connect');
      ownsConnection = true;
      await imapTimeout(connection.openBox('INBOX'), 'openBox');
    }

    const searchCriteria = ['UNSEEN'];
    const fetchOptions = {
      bodies: ['HEADER', ''], // '' = full raw message, decoded with simpleParser below
      markSeen: false // flagged per message below, so a crash only loses the message in hand
    };

    const messages = await imapTimeout(connection.search(searchCriteria, fetchOptions), 'search');

    // Only log if there are new messages
    if (messages.length > 0) {
      Logger.logWithContext('info', `Found ${messages.length} new message(s)`, 'MailBot');
    }

    for (const item of messages) {
      const id = item.attributes.uid;
      let sender = '';

      // Flag before handling: a backup can run for hours and the IMAP connection may be gone by
      // the time it finishes, so flagging afterwards would re-run the same backup on every poll.
      // A failed flag means the connection is dead; stop and let reconnect pick the rest up.
      try {
        await imapTimeout(connection.addFlags(id, '\\Seen'), 'addFlags');
      } catch (flagError) {
        Logger.logWithContext('error', `Failed to mark UID ${id} as seen: ${flagError.message}`, 'MailBot');
        throw flagError;
      }

      try {
        const headerPart = item.parts?.find(part => part.which === 'HEADER');

        if (!headerPart) {
          Logger.logWithContext('warn', `No HEADER part for UID ${id}`, 'EmailParser');
          continue;
        }

        // Safely extract from field
        try {
          if (!headerPart.body) {
            throw new Error('headerPart.body is undefined');
          }

          const fromField = headerPart.body.from;

          if (Array.isArray(fromField) && fromField.length > 0) {
            const fromStr = fromField[0];
            sender = (typeof fromStr === 'string') ? (fromStr.match(/<(.+)>/)?.[1] || fromStr) : fromStr;
          } else if (typeof fromField === 'string') {
            sender = fromField.match(/<(.+)>/)?.[1] || fromField;
          }
        } catch (parseError) {
          Logger.logWithContext('error', `Failed to extract sender: ${parseError.message}`, 'EmailParser');
          continue;
        }

        sender = String(sender || '').trim().toLowerCase();
        if (!sender || !config.allowedSenders.includes(sender)) {
          Logger.logWithContext('warn', `Unauthorized sender: ${sender}`, 'EmailParser');
          sender = ''; // never reply to unauthorized senders, even from the error handler
          continue;
        }

        // The From header is trivially spoofed; require the receiving server's DMARC verdict
        if (config.requireDmarc) {
          const authResults = [].concat(headerPart.body['authentication-results'] || []).join(' ').toLowerCase();
          if (!authResults.includes('dmarc=pass')) {
            Logger.logWithContext('warn', `Rejected email from ${sender}: DMARC not passed`, 'EmailParser');
            sender = '';
            continue;
          }
        }

        // Extract subject safely
        let subject = '';
        try {
          const subjectField = headerPart.body.subject;
          if (Array.isArray(subjectField) && subjectField.length > 0) {
            subject = subjectField[0] || '';
          } else if (typeof subjectField === 'string') {
            subject = subjectField;
          }
        } catch (subjectError) {
          Logger.logWithContext('error', `Failed to extract subject: ${subjectError.message}`, 'EmailParser');
        }

        if (!subject.toLowerCase().includes('backup')) {
          continue;
        }

        // Get email body content from TEXT part
        // Decode MIME (multipart, quoted-printable, base64) so Gmail HTML/QP mail parses
        const rawPart = item.parts?.find(p => p.which === '');
        const bodyContent = rawPart
          ? ((await simpleParser(rawPart.body)).text || '')
          : (item.parts?.find(p => p.which === 'TEXT')?.body || '');

        const params = parseEmailBody(bodyContent);

        if (!params.topic && !params.date) {
          const subjectParams = parseEmailBody(subject);
          params.topic = params.topic || subjectParams.topic;
          params.date = params.date || subjectParams.date;
        }

        // Shared request details for every reply (renderEmail escapes all values)
        const topicLabel = params.topic || 'All recordings';
        const requestDetails = [
          ['Topic', topicLabel],
          ['Date range', params.date ? `${params.date} to today` : 'Last 12 months'],
          ['Zoom user', params.userId || 'Default account user'],
        ];

        if (params.topic || params.date) {

          // Check for duplicate requests within 5-minute interval
          if (isDuplicate(params.topic, params.date)) {
            Logger.logWithContext('warn', 'Duplicate request detected, skipping', 'BackupTrigger', { topic: params.topic, date: params.date });
            await sendReply(sender, `Backup request skipped (duplicate): ${topicLabel}`, renderEmail({
              tone: 'neutral',
              status: 'Skipped',
              title: 'Duplicate request skipped',
              intro: 'The same request was received within the last 5 minutes, so it was not started again.',
              details: requestDetails,
            }));
            continue; // Skip this email
          }

          // Send backup started notification
          const backupStartTime = new Date();
          const backupSessionId = `BACKUP-${backupStartTime.getTime()}`;
          await sendReply(sender, `Backup started: ${topicLabel} [${backupSessionId}]`, renderEmail({
            tone: 'info',
            title: 'Backup started',
            intro: "Your request was received and the backup is running. You'll get another email when it finishes.",
            details: [...requestDetails, ['Started', formatDateTime(backupStartTime)]],
            reference: backupSessionId,
          }));

          const result = await runBackup(params.topic, params.date, params.userId, backupSessionId);
          const backupEndTime = new Date();
          const backupDuration = Math.round((backupEndTime - backupStartTime) / 1000);
          const durationStr = backupDuration < 60 ? `${backupDuration}s` : `${Math.floor(backupDuration / 60)}m ${backupDuration % 60}s`;

          const outcome = result.success ? 'completed' : result.partial ? 'partial' : 'failed';
          Logger.logOperation('Backup', outcome, { topic: params.topic, exitCode: result.code });

          // Send completion notification (exit 0 = success, 2 = partial, anything else = failure)
          if (result.success || result.partial) {
            // Counts: dashboard DB first, then this backup's progress file. Failed-file names only live in the progress file.
            const progressStats = await getProgressFileStats(backupSessionId);
            const dbStats = await getBackupStatsFromDatabase(backupSessionId);

            const stats = {
              filesDownloaded: dbStats ? dbStats.completed_files : (progressStats?.filesDownloaded || 0),
              filesTotalSize: dbStats ? formatBytes(dbStats.total_size) : (progressStats?.filesTotalSize || '0 MB'),
            };
            const failedFiles = progressStats?.failedFiles || [];
            const failedCount = dbStats ? dbStats.failed_files : failedFiles.length;
            const isPartial = result.partial || failedCount > 0;

            const noRecordingsFound = !isPartial && stats.filesDownloaded === 0;
            const timing = [['Started', formatDateTime(backupStartTime)], ['Finished', formatDateTime(backupEndTime)]];

            if (isPartial) {
              await sendReply(sender, `Backup partially completed: ${topicLabel} - ${stats.filesDownloaded} succeeded, ${failedCount} failed [${backupSessionId}]`, renderEmail({
                tone: 'warning',
                status: 'Partially completed',
                title: 'Backup partially completed',
                intro: `${stats.filesDownloaded} of ${stats.filesDownloaded + failedCount} recordings were uploaded to Google Drive. The rest could not be backed up.`,
                stats: [['Uploaded', String(stats.filesDownloaded)], ['Failed', String(failedCount)], ['Duration', durationStr]],
                details: [...requestDetails, ['Data uploaded', stats.filesTotalSize], ...timing],
                notice: {
                  title: 'Recordings that failed',
                  items: failedFiles.map(f => `${f.fileName}: ${f.error || 'Unknown error'}`),
                  text: 'Send the same request again to retry. Recordings already in Google Drive are skipped.',
                },
                reference: backupSessionId,
              }));
            } else if (noRecordingsFound) {
              await sendReply(sender, `Backup completed: no recordings found for ${topicLabel} [${backupSessionId}]`, renderEmail({
                tone: 'warning',
                status: 'No recordings found',
                title: 'No recordings matched your request',
                intro: 'The backup ran, but Zoom returned no recordings for these filters.',
                details: [...requestDetails, ...timing],
                notice: {
                  title: 'What to check',
                  items: [
                    'Topic matches any part of the meeting name (not case-sensitive); try a shorter word.',
                    'Date backs up recordings from that date until today.',
                    'Zoom deletes cloud recordings after the retention period set for your account.',
                    'UserId must be the Zoom account that hosted the meeting.',
                  ],
                },
                reference: backupSessionId,
              }));
            } else {
              await sendReply(sender, `Backup completed: ${topicLabel} - ${stats.filesDownloaded} file(s), ${stats.filesTotalSize} [${backupSessionId}]`, renderEmail({
                tone: 'success',
                title: 'Backup completed',
                intro: 'All files have been successfully uploaded to Google Drive.',
                stats: [['Recordings', String(stats.filesDownloaded)], ['Total size', stats.filesTotalSize], ['Duration', durationStr]],
                details: [...requestDetails, ...timing],
                reference: backupSessionId,
              }));
            }
          } else {
            // Tail of stderr: the actual error is usually at the end
            const errorMsg = (result.error || 'Unknown error occurred').trim().slice(-400);
            await sendReply(sender, `Backup failed: ${topicLabel} [${backupSessionId}]`, renderEmail({
              tone: 'error',
              title: 'Backup failed',
              intro: 'The backup could not be completed. Details are below.',
              details: [...requestDetails, ['Started', formatDateTime(backupStartTime)], ['Duration', durationStr]],
              code: { title: 'Error details', text: errorMsg },
              notice: {
                title: 'What to try',
                items: [
                  'Check the Topic, Date and UserId spelling.',
                  'If the error mentions authorization, an administrator must re-authorize Google Drive (Dashboard > Auth & Tokens).',
                  'Send the same request again once the issue is fixed; recordings already in Google Drive are skipped.',
                ],
              },
              reference: backupSessionId,
            }));
          }
        } else {
          await sendReply(sender, 'Backup request not understood', renderEmail({
            tone: 'warning',
            status: 'Action needed',
            title: "We couldn't read your backup request",
            intro: 'Add at least a Topic or a Date line to the email body (the subject must contain "backup").',
            code: { title: 'Example', text: 'Topic: Physics Lecture\nDate: 2026-01-09\nUserId: teacher@example.com' },
            notice: {
              title: 'Fields',
              items: [
                'Topic: part of the meeting name, not case-sensitive.',
                'Date: YYYY-MM-DD; backs up recordings from that date until today.',
                'UserId: Zoom user email (optional; defaults to the configured account).',
              ],
            },
          }));
        }
      } catch (itemError) {
        Logger.logWithContext('error', `Failed to process email ${item?.attributes?.uid}: ${itemError.message}`, 'EmailParser', { stack: itemError.stack });
        try {
          // Only reply to an authorized sender (sender is cleared for rejected mail)
          if (sender) {
            await sendReply(sender, 'Backup request error', renderEmail({
              tone: 'error',
              title: 'Your request could not be processed',
              intro: 'Please contact your administrator if this keeps happening.',
              code: { title: 'Error details', text: itemError.message },
            }));
          }
        } catch (emailError) {
          Logger.error('Failed to send error email:', emailError);
        }
      }
    }

    if (ownsConnection) {
      connection.end();
    }
  } catch (error) {
    Logger.logWithContext('error', `Mail check failed: ${error.message}`, 'MailBot', { type: error.type || error.constructor.name });
    if (ownsConnection && connection) {
      try { connection.end(); } catch (e) { }
    }
    throw error;
  }
}

/**
 * IDLE-Style Mail Bot - Real-time email monitoring with fallback to adaptive polling
 * Attempts IDLE but falls back to efficient polling if IDLE not supported
 */
class IdleMailBot {
  constructor(config) {
    this.config = config;
    this.imap = null;
    this.isReady = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 5000;
    this.pollInterval = 30000; // 30 seconds - much faster than 3 minutes
    this.idleTimeout = 25 * 60 * 1000; // 25 minutes (Gmail timeout ~30 min)
    this.idleTimer = null;
    this.isProcessing = false;
    this.pollTimer = null;
    this.reconnectTimer = null;
    this.hasUnread = false;
  }

  async start() {
    Logger.info('MailBot: Production logging mode - minimal logs only');
    Logger.logOperation('MailBot', 'started', { mode: 'Adaptive' });
    this.connect();
  }

  async connect() {
    this.reconnectTimer = null;
    try {
      if (this.connection) {
        try { this.connection.end(); } catch (e) { }
      }
      if (this.imap) {
        try {
          this.imap.removeAllListeners();
          this.imap.destroy();
        } catch (e) {
          Logger.debug('Error cleaning up old IMAP connection');
        }
        this.imap = null;
      }

      this.connection = await imapTimeout(imaps.connect({ imap: this.config.imap }), 'connect');
      this.imap = this.connection.imap;

      await imapTimeout(this.connection.openBox('INBOX'), 'openBox');
      this.isReady = true;
      this.reconnectAttempts = 0;
      this.startAdaptivePolling();

      this.imap.on('mail', () => { this.handleNewMail(); });
      this.imap.on('update', () => { if (!this.isProcessing) this.handleNewMail(); });

      let reconnecting = false;
      const handleDisconnect = () => {
        if (reconnecting) return;
        reconnecting = true;
        this.stopPolling();
        this.scheduleReconnect();
      };

      // Handle errors
      this.imap.on('error', (err) => {
        Logger.logWithContext('error', `IMAP error: ${err.message}`, 'MailBotAdaptive');
        handleDisconnect();
      });

      // Handle close
      this.imap.on('close', () => {
        handleDisconnect();
      });

    } catch (error) {
      Logger.logWithContext('error', `Connection error: ${error.message}`, 'MailBotAdaptive');
      this.scheduleReconnect();
    }
  }

  startAdaptivePolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }

    // Poll immediately
    this.handleNewMail();

    // Then poll at intervals
    this.pollTimer = setInterval(() => {
      if (!this.isProcessing) {
        this.handleNewMail();
      }
    }, this.pollInterval);
  }

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async handleNewMail() {
    if (this.isProcessing) {
      return;
    }

    try {
      this.isProcessing = true;

      // Process emails using existing checkMail logic
      await checkMail(this.connection);
      this.lastPollAt = Date.now(); // read by the daily health check
    } catch (error) {
      Logger.logWithContext('error', `Error handling new mail: ${error.message}`, 'MailBotAdaptive');
      const msg = error.message.toLowerCase();
      if (msg.includes('imap') || msg.includes('connection') || msg.includes('socket') || msg.includes('authenticated') || msg.includes('closed') || error.code === 'EPIPE' || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
        this.scheduleReconnect();
      }
    } finally {
      this.isProcessing = false;
    }
  }

  disconnect() {
    if (this.connection) {
      try { this.connection.end(); } catch (e) { }
      this.connection = null;
    }
    if (this.imap) {
      try {
        this.imap.removeAllListeners();  // Remove all event listeners to prevent memory leaks
        this.imap.destroy();
      } catch (error) {
        Logger.logWithContext('debug', `Error disconnecting: ${error.message}`, 'MailBotAdaptive');
      }
      this.imap = null;
      this.isReady = false;
    }
  }

  scheduleReconnect() {
    this.stopPolling();

    // Error, close and handleNewMail can all fire for one failure; only one reconnect may be pending
    if (this.reconnectTimer) return;

    let delay;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      // Reset counter and wait longer before retrying
      this.reconnectAttempts = 0;
      delay = 60000;
    } else {
      this.reconnectAttempts++;
      delay = this.reconnectDelay * this.reconnectAttempts;
    }

    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  shutdown(exitCode = 0) {
    clearTimeout(this.reconnectTimer);
    this.stopPolling();
    this.disconnect();
    process.exit(exitCode);
  }
}

module.exports = { imapTimeout, parseEmailBody, escapeHtml, formatBytes, runBackup, checkMail, getProgressFileStats, isDuplicate, IdleMailBot, config };

// Startup side effects only when run directly (PM2 / node mail-bot.js), not when required by tests
if (require.main === module) {
// Create and start the adaptive mail bot
const bot = new IdleMailBot(config);

// Initialize database for stats retrieval
initDatabase();

// Google auth service is a singleton
const zoomTokenRefreshService = new ZoomTokenRefreshService();

// Initialize health check server (INDUSTRY STANDARD: Monitoring endpoints)
const healthCheckServer = new HealthCheckServer(3456, googleAuthService);

(async () => {
  try {
    // Initialize Google OAuth Token Refresh Service
    const googleInitialized = await googleAuthService.initialize();
    if (googleInitialized) {
      googleAuthService.start();
      Logger.info('✅ Google Token Refresh Service started - OAuth tokens will be auto-refreshed');

      // Log initial token status
      const googleStatus = await googleAuthService.getTokenStatus();
      Logger.info(`Google Token Status: ${googleStatus.message}`);
    } else {
      Logger.warn('⚠️  Google Token Refresh Service could not start - manual re-authorization may be needed');
    }

    // Initialize Zoom Token Refresh Service
    const zoomInitialized = await zoomTokenRefreshService.initialize();
    if (zoomInitialized) {
      zoomTokenRefreshService.start();
      Logger.info('✅ Zoom Token Refresh Service started - Zoom API tokens will be auto-refreshed');

      // Log initial token status
      const zoomStatus = zoomTokenRefreshService.getTokenStatus();
      Logger.info(`Zoom Token Status: ${zoomStatus.message}`);
    } else {
      Logger.warn('⚠️  Zoom Token Refresh Service could not start - new tokens will be obtained on demand');
    }

    // Start health check server after both token services are initialized
    healthCheckServer.start();
  } catch (error) {
    Logger.error('Failed to initialize Token Services:', {
      error: error.message,
      stack: error.stack
    });
    // Continue running mail-bot even if token services fail
    Logger.warn('Mail-bot will continue without automatic token refresh');
    healthCheckServer.start(); // Still start health check
  }

  // Daily end-to-end check (Zoom, Drive, inbox, disk); emails admins on first failure
  try {
    const appConfig = await new (require('./src/configManager'))().loadConfig();
    require('./services/healthMonitor').startHealthMonitor({
      config: appConfig,
      googleAuthService,
      bot,
      getZoomAccessToken: require('./src/zoomAuth').getZoomAccessToken,
      fetchAllRecordings: require('./src/zoomFetcher').fetchAllRecordings,
    });
  } catch (error) {
    Logger.error('Health monitor could not start:', error);
  }
})();

bot.start();

// Graceful shutdown handlers with cleanup (CRITICAL FIX for memory leaks)
const gracefulShutdown = (signal, exitCode = 0) => {
  Logger.info(`Received ${signal}, shutting down gracefully...`);

  // Clear cleanup interval to prevent memory leak
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }

  // Stop health check server
  if (healthCheckServer) {
    healthCheckServer.stop();
  }

  // Stop token refresh services
  googleAuthService.stop();
  zoomTokenRefreshService.stop();


  // Shutdown bot
  bot.shutdown(exitCode);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  if (error.code === 'EPIPE' || (error.message && error.message.includes('socket has been ended'))) {
    Logger.warn('Caught EPIPE socket error, preventing crash: ' + error.message);
    return;
  }
  Logger.error('Uncaught Exception:', {
    error: error.message,
    stack: error.stack
  });
  gracefulShutdown('uncaughtException', 1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  Logger.error('Unhandled Promise Rejection:', {
    reason: reason,
    promise: promise
  });
});
}
