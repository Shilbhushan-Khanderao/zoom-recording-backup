// CLI input handling (real process, temp cwd, no network) and small utilities.
process.chdir(require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'zdb-cli-')));
process.env.LOG_LEVEL = 'error';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'cli.js');
const runCli = (...args) => spawnSync(process.execPath, [CLI, ...args], {
  cwd: process.cwd(),
  env: { ...process.env, ENABLE_DASHBOARD: 'false', ZOOM_CLIENT_ID: '', ZOOM_CLIENT_SECRET: '', ZOOM_ACCOUNT_ID: '' },
  encoding: 'utf8',
  timeout: 30000,
});
const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64');

// ---- CLI ----------------------------------------------------------------
test('cli: invalid --date exits 1 before touching Zoom', () => {
  for (const bad of ['2026/01/01', 'yesterday', '01-02-2026']) {
    const r = runCli('backup', '--date', bad);
    assert.strictEqual(r.status, 1, bad);
    assert.match(r.stdout + r.stderr, /Invalid --date/);
  }
});

test('cli: --files that is not base64 JSON exits 1', () => {
  const r = runCli('backup', '--files', b64('not json'));
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout + r.stderr, /Failed to parse --files/);
});

test('cli: --files empty array or non-array exits 1', () => {
  for (const v of [[], { a: 1 }]) {
    const r = runCli('backup', '--files', b64(v));
    assert.strictEqual(r.status, 1);
    assert.match(r.stdout + r.stderr, /No files provided/);
  }
});

test('cli: missing Zoom credentials fails with exit 1 (no silent success)', () => {
  const r = runCli('backup', '--dry-run', '--date', '2026-10-01');
  assert.strictEqual(r.status, 1);
  // production disables console logging; the reason must still reach stderr for the mail-bot
  assert.match(r.stderr, /BACKUP FAILED: .*Zoom/);
});

test('cli: failure reason reaches stderr even with NODE_ENV=production', () => {
  const r = spawnSync(process.execPath, [CLI, 'backup', '--files', b64([])], {
    cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'production', ENABLE_DASHBOARD: 'false' }, encoding: 'utf8',
  });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /BACKUP FAILED: No files provided/);
});

test('cli: unknown --config option was removed', () => {
  const r = runCli('-c', 'x.json', 'backup');
  assert.notStrictEqual(r.status, 0);
});

test('cli: config-check reports INVALID when required fields missing', () => {
  const r = runCli('config-check');
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout + r.stderr, /INVALID/);
});

// ---- utilities ----------------------------------------------------------
const ProgressPersistence = require('../utils/progressPersistence');
const FileLock = require('../utils/fileLock');
const FileNaming = require('../utils/fileNaming');
const FileNamingEnhanced = require('../utils/fileNamingEnhanced');
const { appendBackupHistory } = require('../utils/history');

test('progress: tracks uploads/failures and writes atomically (no temp files left)', async () => {
  const p = new ProgressPersistence('UNIT-1');
  await p.initialize();
  await p.setTotalFiles(3);
  await p.markFileDownloaded('a.mp4', 'url', 10);
  await p.markFileUploaded('a.mp4', 'drive-a', 10);
  await p.markFileFailed('b.mp4', new Error('boom'), 'backup');
  await p.markCompleted(false);
  const dir = path.dirname(p.progressFile);
  assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
  const state = JSON.parse(fs.readFileSync(p.progressFile, 'utf8'));
  assert.strictEqual(state.status, 'failed');
  assert.strictEqual(state.uploadedFiles[0].driveFileId, 'drive-a');
  assert.strictEqual(state.failedFiles[0].error, 'boom');
  assert.strictEqual(p.getProgressSummary().progress, '1/3');
});

test('progress: concurrent saves never corrupt the file', async () => {
  const Logger = require('../src/logger');
  const origError = Logger.error;
  let errors = 0;
  Logger.error = () => { errors++; };
  const p = new ProgressPersistence('UNIT-2');
  try {
    await p.initialize();
    await Promise.all(Array.from({ length: 20 }, (_, i) => p.markFileUploaded(`f${i}`, `d${i}`, 1)));
  } finally {
    Logger.error = origError;
  }
  assert.strictEqual(errors, 0, 'a concurrent save failed');
  const state = JSON.parse(fs.readFileSync(p.progressFile, 'utf8'));
  assert.strictEqual(state.uploadedFiles.length, 20);
});

test('history: keeps only the newest 1000 entries and repairs corrupt file', async () => {
  const file = path.join(process.cwd(), 'logs', 'history', 'backup-history.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{corrupt');
  await appendBackupHistory({ status: 'success', marker: 'first' });
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).length, 1);
  fs.writeFileSync(file, JSON.stringify(Array.from({ length: 1005 }, (_, i) => ({ i }))));
  await appendBackupHistory({ status: 'success', marker: 'last' });
  const h = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(h.length, 1000);
  assert.strictEqual(h.at(-1).marker, 'last');
  assert.strictEqual(h[0].i, 6);
});

const writeLock = (lock, data) => {
  fs.mkdirSync(path.dirname(lock.lockFile), { recursive: true });
  fs.writeFileSync(lock.lockFile, typeof data === 'string' ? data : JSON.stringify(data));
};

test('lock: held by a live local process is respected', async () => {
  const lock = new FileLock('unit-live');
  writeLock(lock, { pid: process.pid, hostname: os.hostname(), acquiredAt: new Date().toISOString() });
  assert.strictEqual(await lock.tryAcquire(), false);
  await lock.forceRelease();
});

test('lock: corrupted lock file is cleared', async () => {
  const lock = new FileLock('unit-corrupt');
  writeLock(lock, '{not json');
  assert.strictEqual(await lock.tryAcquire(), true);
  await lock.release();
});

test('lock: older than 2h is stale even on another host', async () => {
  const lock = new FileLock('unit-stale');
  writeLock(lock, { pid: 1, hostname: 'other-host', acquiredAt: new Date(Date.now() - 3 * 3600e3).toISOString() });
  assert.strictEqual(await lock.tryAcquire(), true);
  await lock.release();
});

test('lock: fresh lock from another host is respected (cannot check its PID)', async () => {
  const lock = new FileLock('unit-remote');
  writeLock(lock, { pid: 2147483646, hostname: 'other-host', acquiredAt: new Date().toISOString() });
  assert.strictEqual(await lock.tryAcquire(), false);
  await lock.forceRelease();
});

test('lock: second acquire in same process fails until released', async () => {
  const a = new FileLock('unit-twice');
  const b = new FileLock('unit-twice');
  assert.strictEqual(await a.tryAcquire(), true);
  assert.strictEqual(await b.tryAcquire(), false);
  await a.release();
  assert.strictEqual(await b.tryAcquire(), true);
  await b.release();
});

test('naming: unsafe topic characters never produce path separators', () => {
  const name = FileNaming.generateFileName({ topic: '../../etc/passwd: A|B?*<>"', startTime: '2026-10-01T10:00:00Z', fileType: 'MP4' }, { includeTime: true });
  assert.ok(!name.includes('/') && !name.includes('\\'), name);
  assert.match(name, /^2026-10-01_.*\.mp4$/);
});

test('naming: collisions get _01, _02 suffixes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zdb-name-'));
  const info = { topic: 'T', startTime: '2026-10-01T10:00:00Z', fileType: 'MP4' };
  const first = FileNamingEnhanced.generateUniqueFileName(info, dir);
  fs.writeFileSync(path.join(dir, first), '');
  const second = FileNamingEnhanced.generateUniqueFileName(info, dir);
  fs.writeFileSync(path.join(dir, second), '');
  const third = FileNamingEnhanced.generateUniqueFileName(info, dir);
  assert.deepStrictEqual([second, third], [first.replace('.mp4', '_01.mp4'), first.replace('.mp4', '_02.mp4')]);
});

test('naming: missing topic/startTime still yields a valid name', () => {
  const name = FileNaming.generateFileName({ fileType: 'MP4' }, { includeTime: true });
  assert.match(name, /\.mp4$/);
});
