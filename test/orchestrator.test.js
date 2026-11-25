// Backup flow tests with fake Zoom/Drive/dashboard. Run with: npm test
process.chdir(require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'zdb-orch-')));
process.env.ENABLE_DASHBOARD = 'false';
process.env.LOG_LEVEL = 'error';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');

const zoomAuth = require('../src/zoomAuth');
const zoomFetcher = require('../src/zoomFetcher');
let tokenOk = true;
zoomAuth.getZoomAccessToken = async () => {
  if (!tokenOk) throw new Error('Invalid credentials');
  return 'tok';
};
let meetings = [];
zoomFetcher.fetchRecordings = async () => meetings;
zoomFetcher.fetchRecordingsByTopic = async () => meetings;

const BackupOrchestrator = require('../src/backupOrchestrator');
const ProgressPersistence = require('../utils/progressPersistence');
const { BackupError } = require('../src/errorHandler');

const meeting = (n, files) => ({
  id: 100 + n, uuid: `uuid/${n}==`, topic: `Lecture ${n}`, start_time: `2026-10-0${n}T10:00:00Z`,
  recording_files: files.map((id) => ({ id, file_type: 'MP4', download_url: `https://zoom/${id}`, file_size: 2048 })),
});

function fakeDashboard() {
  const calls = [];
  const rec = (name) => async (...args) => { calls.push([name, ...args]); return { changes: 1 }; };
  return {
    calls, enabled: true,
    createBackup: rec('createBackup'), updateProgress: rec('updateProgress'),
    completeBackup: rec('completeBackup'), addFile: rec('addFile'),
    createAlert: rec('createAlert'), close() {},
    of(name) { return calls.filter((c) => c[0] === name); },
  };
}

// Builds an orchestrator wired to fakes; failUpload: Set of zoom file ids whose upload throws
async function setup({ failUpload = new Set(), existing = new Set(), uploadError = 'Drive 500', backupId } = {}) {
  const savePath = fs.mkdtempSync(path.join(os.tmpdir(), 'zdb-save-'));
  const o = new BackupOrchestrator();
  o.dashboardClient = fakeDashboard();
  o.downloads = [];
  o.downloader = {
    downloadFile: async (url, filePath) => {
      o.downloads.push(url);
      fs.writeFileSync(filePath, Buffer.alloc(2048));
      return { size: 2048 };
    },
    validateDownload: async () => true,
  };
  o.uploader = {
    drive: {},
    findExisting: async (id) => (existing.has(id) ? { id: `drive-${id}`, name: `${id}.mp4`, size: '2048' } : null),
    uploadFile: async (filePath, name, folder, cb, zoomFileId) => {
      if (failUpload.has(zoomFileId)) throw new Error(uploadError);
      return { fileId: `drive-${zoomFileId}` };
    },
    verifyUpload: async () => true,
  };
  o.progressPersistence = new ProgressPersistence(backupId || `BACKUP-${Date.now()}`);
  await o.progressPersistence.initialize();
  const config = { userId: 'u', fromDate: '2026-01-01', savePath, googleFolder: 'folder', cliOptions: {} };
  return { o, config, savePath };
}

const progressFile = (o) => JSON.parse(fs.readFileSync(o.progressPersistence.progressFile, 'utf8'));

test('full backup: all files succeed and dashboard/progress agree', async () => {
  meetings = [meeting(1, ['a', 'b']), meeting(2, ['c'])];
  const { o, config } = await setup({ backupId: 'BACKUP-1' });
  const res = await o.orchestrateBackup(config);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.successCount, 3);
  assert.strictEqual(res.errorCount, 0);
  assert.strictEqual(res.backupId, 'BACKUP-1');
  const d = o.dashboardClient;
  assert.deepStrictEqual(d.of('completeBackup').map((c) => c.slice(1)), [['BACKUP-1', 'success', null]]);
  assert.strictEqual(d.of('addFile').length, 3, 'exactly one dashboard row per file');
  assert.ok(d.of('addFile').every((c) => c[2].status === 'completed'));
  const p = progressFile(o);
  assert.strictEqual(p.status, 'completed');
  assert.strictEqual(p.uploadedFiles.length, 3);
  assert.strictEqual(p.totalFiles, 3);
});

test('partial backup: one upload fails, others continue', async () => {
  meetings = [meeting(1, ['a', 'b'])];
  const { o, config, savePath } = await setup({ failUpload: new Set(['b']) });
  const res = await o.orchestrateBackup(config);
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.successCount, 1);
  assert.strictEqual(res.errorCount, 1);
  const d = o.dashboardClient;
  const [, , status, msg] = d.of('completeBackup')[0];
  assert.strictEqual(status, 'partial');
  assert.strictEqual(typeof msg, 'string');
  assert.deepStrictEqual(d.of('addFile').map((c) => c[2].status).sort(), ['completed', 'failed']);
  assert.strictEqual(progressFile(o).failedFiles.length, 1);
  // failed upload's local file is cleaned up, successful one kept
  assert.strictEqual(fs.readdirSync(savePath).length, 1);
});

test('Drive auth failure aborts the run at the first file with one actionable error', async () => {
  meetings = [meeting(1, ['a', 'b']), meeting(2, ['c'])];
  const { o, config, savePath } = await setup({
    failUpload: new Set(['a', 'b', 'c']), uploadError: 'OAUTH_AUTH_REQUIRED', backupId: 'BACKUP-OAUTH',
  });
  await assert.rejects(o.orchestrateBackup(config), (err) => {
    assert.match(err.message, /re-authorize in Dashboard > Auth & Tokens/);
    assert.match(err.message, /OAUTH_AUTH_REQUIRED/);
    return true;
  });
  assert.deepStrictEqual(o.downloads.length, 1, 'stopped after first file');
  assert.strictEqual(fs.readdirSync(savePath).length, 1, 'downloaded file kept for retry');
  const [, id, status, msg] = o.dashboardClient.of('completeBackup')[0];
  assert.deepStrictEqual([id, status], ['BACKUP-OAUTH', 'failed']);
  assert.match(msg, /re-authorize/);
});

test('expired refresh token surfacing from the Drive lookup also aborts (nested invalid_grant)', async () => {
  const { o, config } = await setup();
  o.uploader.findExisting = async () => {
    throw new BackupError('Drive list failed', { originalError: new Error('invalid_grant') });
  };
  await assert.rejects(o.downloadSpecificFiles(config, [
    { meetingId: 'm1', fileId: 'f1', topic: 'One', downloadUrl: 'https://zoom/f1' },
    { meetingId: 'm2', fileId: 'f2', topic: 'Two', downloadUrl: 'https://zoom/f2' },
  ]), /Google Drive authorization expired.*invalid_grant/);
  assert.deepStrictEqual(o.downloads, []);
  assert.strictEqual(o.dashboardClient.of('completeBackup')[0][2], 'failed');
});

test('per-file failure message keeps the root cause', async () => {
  meetings = [meeting(1, ['a'])];
  const { o, config } = await setup({ failUpload: new Set(['a']), uploadError: 'Drive quota exceeded' });
  const res = await o.orchestrateBackup(config);
  assert.match(res.errors[0].error, /Failed to process .*: Drive quota exceeded/);
  assert.match(progressFile(o).failedFiles[0].error, /Drive quota exceeded/);
});

test('files already in Drive are skipped without download', async () => {
  meetings = [meeting(1, ['a', 'b'])];
  const { o, config } = await setup({ existing: new Set(['a']) });
  const res = await o.orchestrateBackup(config);
  assert.strictEqual(res.successCount, 2);
  assert.deepStrictEqual(o.downloads, ['https://zoom/b?access_token=tok']);
  const lastProgress = o.dashboardClient.of('updateProgress').at(-1)[2];
  assert.strictEqual(lastProgress.skippedFiles, 1);
});

test('no recordings completes as success with message', async () => {
  meetings = [];
  const { o, config } = await setup();
  const res = await o.orchestrateBackup(config);
  assert.strictEqual(res.success, true);
  assert.match(res.message, /No recordings/);
  assert.strictEqual(o.dashboardClient.of('completeBackup')[0][2], 'success');
});

test('meetings without recording_files or MP4s are ignored', async () => {
  meetings = [{ id: 1, uuid: 'x', topic: 'empty' }, { ...meeting(1, []), recording_files: [{ id: 'z', file_type: 'M4A' }] }];
  const { o, config } = await setup();
  const res = await o.orchestrateBackup(config);
  assert.match(res.message, /No recordings/);
});

test('Zoom auth failure fails backup, alerts dashboard with correct argument order', async () => {
  meetings = [meeting(1, ['a'])];
  tokenOk = false;
  const { o, config } = await setup({ backupId: 'BACKUP-AUTH' });
  try {
    await assert.rejects(o.orchestrateBackup(config), /Backup operation failed/);
  } finally {
    tokenOk = true;
  }
  const d = o.dashboardClient;
  assert.deepStrictEqual(d.of('completeBackup')[0].slice(1, 3), ['BACKUP-AUTH', 'failed']);
  const [, type, message, severity, backupId] = d.of('createAlert')[0];
  assert.deepStrictEqual([type, severity, backupId], ['backup_failed', 'critical', 'BACKUP-AUTH']);
  assert.match(message, /Zoom authentication failed/);
});

test('second concurrent backup is refused by the lock when waiting is disabled', async (t) => {
  process.env.BACKUP_LOCK_WAIT_MS = '0';
  t.after(() => { delete process.env.BACKUP_LOCK_WAIT_MS; });
  meetings = [meeting(1, ['a'])];
  const { o, config } = await setup();
  fs.writeFileSync(path.join(process.cwd(), 'logs', '.backup.lock'),
    JSON.stringify({ pid: process.pid, hostname: os.hostname(), acquiredAt: new Date().toISOString() }));
  try {
    await assert.rejects(o.orchestrateBackup(config), /already in progress/);
    assert.strictEqual(o.dashboardClient.calls.length, 0);
  } finally {
    fs.unlinkSync(path.join(process.cwd(), 'logs', '.backup.lock'));
  }
});

test('backup waits for a running backup to release the lock, then proceeds', async (t) => {
  process.env.BACKUP_LOCK_WAIT_MS = '3000';
  t.after(() => { delete process.env.BACKUP_LOCK_WAIT_MS; });
  meetings = [meeting(1, ['a'])];
  const { o, config } = await setup();
  const lockFile = path.join(process.cwd(), 'logs', '.backup.lock');
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, hostname: os.hostname(), acquiredAt: new Date().toISOString() }));
  setTimeout(() => fs.unlinkSync(lockFile), 300); // "nightly run" finishes
  const started = Date.now();
  const res = await o.orchestrateBackup(config);
  assert.strictEqual(res.successCount, 1);
  assert.ok(Date.now() - started >= 300, 'waited for the lock');
});

test('backup gives up after the lock wait times out', async (t) => {
  process.env.BACKUP_LOCK_WAIT_MS = '400';
  t.after(() => { delete process.env.BACKUP_LOCK_WAIT_MS; });
  const { o, config } = await setup();
  const lockFile = path.join(process.cwd(), 'logs', '.backup.lock');
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, hostname: os.hostname(), acquiredAt: new Date().toISOString() }));
  try {
    await assert.rejects(o.orchestrateBackup(config), /already in progress/);
  } finally {
    fs.unlinkSync(lockFile);
  }
});

test('delete from Zoom uses double-encoded meeting UUID and the file id', async () => {
  meetings = [meeting(1, ['a'])];
  const { o, config } = await setup();
  const urls = [];
  const orig = axios.delete;
  axios.delete = async (url) => { urls.push(url); return { data: {} }; };
  try {
    await o.orchestrateBackup({ ...config, deleteFromZoom: true });
  } finally {
    axios.delete = orig;
  }
  assert.deepStrictEqual(urls, ['https://api.zoom.us/v2/meetings/uuid%252F1%253D%253D/recordings/a']);
});

test('delete from Zoom is skipped when file id is unknown', async () => {
  const { o, config } = await setup();
  let called = false;
  const orig = axios.delete;
  axios.delete = async () => { called = true; };
  try {
    await o.downloadSpecificFiles({ ...config, deleteFromZoom: true },
      [{ meetingId: 'm', topic: 'T', downloadUrl: 'https://zoom/x' }]);
  } finally {
    axios.delete = orig;
  }
  assert.strictEqual(called, false);
});

test('downloadSpecificFiles: partial result and string completion message', async () => {
  const { o, config } = await setup({ failUpload: new Set(['f2']), backupId: 'BACKUP-SPEC' });
  const res = await o.downloadSpecificFiles(config, [
    { meetingId: 'm1', fileId: 'f1', topic: 'One', downloadUrl: 'https://zoom/f1' },
    { meetingId: 'm2', fileId: 'f2', topic: 'Two', downloadUrl: 'https://zoom/f2' },
  ]);
  assert.strictEqual(res.successCount, 1);
  assert.strictEqual(res.errorCount, 1);
  const [, id, status, msg] = o.dashboardClient.of('completeBackup')[0];
  assert.deepStrictEqual([id, status, msg], ['BACKUP-SPEC', 'partial', '1 of 2 files failed']);
  assert.strictEqual(progressFile(o).failedFiles.length, 1);
});

test('dry run with specific files records nothing', async () => {
  const { o, config } = await setup();
  const res = await o.downloadSpecificFiles({ ...config, cliOptions: { dryRun: true } },
    [{ meetingId: 'm1', fileId: 'f1', topic: 'One', downloadUrl: 'https://zoom/f1' }]);
  assert.strictEqual(res.successCount, 1);
  assert.deepStrictEqual(o.downloads, []);
  assert.strictEqual(o.dashboardClient.of('addFile').length, 0);
});

test('missing download URL fails that file only', async () => {
  const { o, config } = await setup();
  const res = await o.downloadSpecificFiles(config, [
    { meetingId: 'm1', fileId: 'f1', topic: 'No URL' },
    { meetingId: 'm2', fileId: 'f2', topic: 'Good', downloadUrl: 'https://zoom/f2' },
  ]);
  assert.deepStrictEqual([res.successCount, res.errorCount], [1, 1]);
});

test('low disk space raises a dashboard alert', async () => {
  const o = new BackupOrchestrator();
  o.dashboardClient = fakeDashboard();
  await o._warnIfLowDisk({ savePath: os.tmpdir(), minFreeSpaceGB: 1e9 });
  assert.strictEqual(o.dashboardClient.of('createAlert')[0][1], 'low_disk');
  await o._warnIfLowDisk({ savePath: '/does/not/exist' }); // must not throw
});
