// Long-idle reliability: health checks, admin alerts, auth detection, atomic token writes.
process.chdir(require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'zdb-health-')));
process.env.LOG_LEVEL = 'error';
process.env.EMAIL_USER = 'bot@example.com';
process.env.EMAIL_PASSWORD = 'x';
process.env.ALLOWED_SENDERS = 'admin@example.com, ops@example.com';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const nodemailer = require('nodemailer');
const sent = [];
nodemailer.createTransport = () => ({ sendMail: async (m) => { sent.push(m); } });

const { BackupError, describeError } = require('../src/errorHandler');
const BackupProtection = require('../utils/backupProtection');
const notificationService = require('../services/notificationService');
const { buildChecks, runHealthCheck, MAIL_STALL_MS } = require('../services/healthMonitor');
const TokenManager = require('../utils/tokenManager');

// ---- error description / auth detection ---------------------------------
test('describeError keeps the root cause through wrapping', () => {
  const root = new Error('invalid_grant');
  const mid = new BackupError('Upload failed after all retries', { originalError: root });
  const top = new BackupError('Failed to process a.mp4', { originalError: mid });
  assert.strictEqual(describeError(top), 'Failed to process a.mp4: Upload failed after all retries: invalid_grant');
  assert.strictEqual(describeError('plain'), 'plain');
});

test('describeError does not repeat identical messages or loop forever', () => {
  const a = new BackupError('same', {});
  a.details.originalError = a; // self-cycle
  assert.strictEqual(describeError(a), 'same');
});

test('isAuthError detects direct and nested auth failures only', () => {
  assert.ok(BackupProtection.isAuthError(new Error('OAUTH_AUTH_REQUIRED')));
  assert.ok(BackupProtection.isAuthError(new BackupError('x', { originalError: new Error('invalid_grant: Token has been expired or revoked') })));
  assert.ok(BackupProtection.isAuthError(new Error('Zoom authentication failed: Invalid credentials')));
  assert.ok(!BackupProtection.isAuthError(new Error('Download failed after all retries')));
  assert.ok(!BackupProtection.isAuthError(new Error('ENOSPC: no space left on device')));
});

// ---- admin alerts --------------------------------------------------------
test('sendAlert emails every admin, escapes HTML, and throttles per key', async () => {
  sent.length = 0;
  assert.strictEqual(await notificationService.sendAlert('k1', 'Subject', ['<b>bad</b> & "x"']), true);
  assert.deepStrictEqual(sent.map((m) => m.to), ['admin@example.com', 'ops@example.com']);
  assert.ok(sent[0].html.includes('&#60;b&#62;bad&#60;/b&#62; &#38; &#34;x&#34;'));
  assert.ok(!sent[0].html.includes('<b>bad'));
  assert.strictEqual(await notificationService.sendAlert('k1', 'Subject', ['again']), false, 'throttled');
  assert.strictEqual(await notificationService.sendAlert('k2', 'Other', ['new key']), true, 'different key not throttled');
});

test('sendAlert without email config does nothing', async () => {
  const saved = process.env.EMAIL_USER;
  delete process.env.EMAIL_USER;
  try {
    assert.strictEqual(await notificationService.sendAlert('k3', 's', ['x']), false);
  } finally {
    process.env.EMAIL_USER = saved;
  }
});

test('token refresh failure alert goes through sendAlert', async () => {
  sent.length = 0;
  await notificationService.notifyTokenRefreshFailure('Google Drive TEST', 'invalid_grant');
  assert.match(sent[0].subject, /Google Drive TEST Token Refresh Failed/);
  assert.match(sent[0].text, /invalid_grant/);
});

// ---- health checks -------------------------------------------------------
const fakeAlert = () => { const calls = []; return { calls, sendAlert: async (...a) => { calls.push(a); return true; } }; };

test('runHealthCheck: all passing sends no alert', async () => {
  const alert = fakeAlert();
  const res = await runHealthCheck({ a: async () => {}, b: async () => {} }, alert);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(alert.calls.length, 0);
});

test('runHealthCheck: failures alert once with every failing check, others still run', async () => {
  const alert = fakeAlert();
  let ranLast = false;
  const res = await runHealthCheck({
    'Zoom API': async () => { throw new Error('401 Invalid access token'); },
    'Google Drive': async () => { throw 'invalid_grant'; }, // non-Error throw
    'Disk space': async () => { ranLast = true; },
  }, alert);
  assert.strictEqual(res.ok, false);
  assert.ok(ranLast);
  assert.strictEqual(alert.calls.length, 1);
  const [key, subject, lines] = alert.calls[0];
  assert.strictEqual(key, 'health:Zoom API,Google Drive');
  assert.match(subject, /Zoom API, Google Drive/);
  assert.deepStrictEqual(lines.slice(0, 2), ['Zoom API: 401 Invalid access token', 'Google Drive: invalid_grant']);
});

function depsFor(overrides = {}) {
  return {
    config: { userId: 'u@x.com', googleFolder: 'folder', savePath: os.tmpdir(), minFreeSpaceGB: 0.001 },
    googleAuthService: { auth: null, initialize: async () => false },
    getZoomAccessToken: async () => 'tok',
    fetchAllRecordings: async () => [],
    bot: { lastPollAt: Date.now() },
    ...overrides,
  };
}

test('check: Zoom calls the recordings API for today with the configured user', async () => {
  const calls = [];
  const checks = buildChecks(depsFor({ fetchAllRecordings: async (...a) => { calls.push(a); return []; } }));
  await checks['Zoom API']();
  const today = new Date().toISOString().slice(0, 10);
  assert.deepStrictEqual(calls[0], ['u@x.com', today, today, 'tok']);
});

test('check: Zoom token failure surfaces', async () => {
  const checks = buildChecks(depsFor({ getZoomAccessToken: async () => { throw new Error('Invalid credentials'); } }));
  await assert.rejects(checks['Zoom API'](), /Invalid credentials/);
});

test('check: Drive without credentials asks for re-authorization', async () => {
  await assert.rejects(buildChecks(depsFor())['Google Drive'](), /re-authorize/);
});

test('check: mail polling stalled beyond threshold fails, recent passes', async () => {
  await buildChecks(depsFor())['Mail polling']();
  const stale = buildChecks(depsFor({ bot: { lastPollAt: Date.now() - MAIL_STALL_MS - 60000 } }));
  await assert.rejects(stale['Mail polling'](), /No successful inbox check/);
  await assert.rejects(buildChecks(depsFor({ bot: {} }))['Mail polling'](), /IMAP/);
});

test('check: disk below minimum fails, missing path fails', async () => {
  await buildChecks(depsFor())['Disk space']();
  const tight = depsFor();
  tight.config = { ...tight.config, minFreeSpaceGB: 1e9 };
  await assert.rejects(buildChecks(tight)['Disk space'](), /GB free/);
  const missing = depsFor();
  missing.config = { ...missing.config, savePath: '/does/not/exist' };
  await assert.rejects(buildChecks(missing)['Disk space']());
});

// ---- atomic token writes -------------------------------------------------
test('token writes are atomic under concurrency and leave no temp files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zdb-tok-'));
  const file = path.join(dir, 'token.json');
  await Promise.all(Array.from({ length: 25 }, (_, i) =>
    TokenManager.writeTokenAsync(file, { access_token: `a${i}`, refresh_token: 'r', padding: 'x'.repeat(5000) })));
  const tok = await TokenManager.readTokenAsync(file);
  assert.strictEqual(tok.refresh_token, 'r');
  assert.deepStrictEqual(fs.readdirSync(dir), ['token.json']);
  assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
});

test('failed token write throws and leaves the old token intact', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zdb-tok-'));
  const file = path.join(dir, 'token.json');
  TokenManager.writeTokenSync(file, { access_token: 'old', refresh_token: 'r' });
  await assert.rejects(TokenManager.writeTokenAsync(path.join(dir, 'missing-dir', 'token.json'), { a: 1 }));
  assert.strictEqual((await TokenManager.readTokenAsync(file)).access_token, 'old');
  assert.deepStrictEqual(fs.readdirSync(dir), ['token.json']);
});
