// Run with: npm test  (node --test, no extra dependencies)
// Work in a temp dir: progress files, locks and logs are cwd-relative
process.chdir(require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'zdb-core-')));
process.env.ENABLE_DASHBOARD = 'false';
process.env.LOG_LEVEL = 'error';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Stub Zoom auth/fetch before the orchestrator destructures them
const zoomAuth = require('../src/zoomAuth');
const zoomFetcher = require('../src/zoomFetcher');
zoomAuth.getZoomAccessToken = async () => 'test-token';
const fakeMeetings = [
  {
    id: 111, uuid: 'abc/==', topic: 'Physics', start_time: '2026-10-01T10:00:00Z',
    recording_files: [
      { id: 'f1', file_type: 'MP4', download_url: 'https://zoom/f1' },
      { id: 'f2', file_type: 'MP4', download_url: 'https://zoom/f2' },
      { id: 'f3', file_type: 'M4A', download_url: 'https://zoom/f3' },
    ],
  },
  { id: 222, uuid: 'def', topic: 'No files' },
];
zoomFetcher.fetchRecordings = async () => fakeMeetings;
zoomFetcher.fetchRecordingsByTopic = async () => fakeMeetings;

const BackupOrchestrator = require('../src/backupOrchestrator');
const FileLock = require('../utils/fileLock');
const FileNamingEnhanced = require('../utils/fileNamingEnhanced');

test('date ranges include same-day and chunk by 30 days', () => {
  const z = new zoomFetcher.ZoomFetcherEnhanced();
  assert.deepStrictEqual(z._generateDateRanges('2026-10-26', '2026-10-26'),
    [{ from: '2026-10-26', to: '2026-10-26' }]);
  const ranges = z._generateDateRanges('2026-01-01', '2026-03-15');
  assert.strictEqual(ranges[0].from, '2026-01-01');
  assert.strictEqual(ranges.at(-1).to, '2026-03-15');
  assert.strictEqual(ranges.length, 3);
});

test('every MP4 file is mapped with fileId and meeting UUID', async () => {
  const files = await new BackupOrchestrator().getRecordingsToBackup({ userId: 'u', fromDate: '2026-01-01' });
  assert.deepStrictEqual(files.map(f => [f.fileId, f.meetingId]), [['f1', 'abc/=='], ['f2', 'abc/==']]);
});

test('dry run touches nothing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zdb-'));
  const o = new BackupOrchestrator();
  o.downloader = { downloadFile: () => assert.fail('downloaded during dry run') };
  o.uploader = { uploadFile: () => assert.fail('uploaded during dry run') };
  const res = await o.processFile(
    { topic: 'T', fileId: 'f1', meetingId: 'm', downloadUrl: 'https://x' },
    { savePath: dir, googleFolder: 'g', deleteFromZoom: true, cliOptions: { dryRun: true } },
    () => {}
  );
  assert.strictEqual(res.dryRun, true);
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

test('file already in Drive is skipped before download', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zdb-'));
  const o = new BackupOrchestrator();
  o.downloader = { downloadFile: () => assert.fail('re-downloaded existing file') };
  o.uploader = { drive: {}, findExisting: async () => ({ id: 'drive1', name: 'x.mp4', size: '42' }) };
  const res = await o.processFile(
    { topic: 'T', fileId: 'f1', meetingId: 'm', downloadUrl: 'https://x' },
    { savePath: dir, googleFolder: 'g' },
    () => {}
  );
  assert.strictEqual(res.skipped, true);
  assert.strictEqual(res.fileSize, 42);
});

test('lock held by a dead PID is reclaimed', async () => {
  const lock = new FileLock('test-dead-pid');
  fs.mkdirSync(path.dirname(lock.lockFile), { recursive: true });
  fs.writeFileSync(lock.lockFile, JSON.stringify({
    pid: 2147483646, hostname: os.hostname(), acquiredAt: new Date().toISOString(),
  }));
  assert.strictEqual(await lock.tryAcquire(), true);
  await lock.release();
});

test('unwritable save path fails loudly instead of using /tmp', () => {
  const readOnly = fs.mkdtempSync(path.join(os.tmpdir(), 'zdb-ro-'));
  fs.chmodSync(readOnly, 0o500);
  assert.throws(() => FileNamingEnhanced.ensureWritableDirectory(path.join(readOnly, 'sub')), /not writable/);
  assert.throws(() => FileNamingEnhanced.ensureWritableDirectory(readOnly), /not writable/);
  assert.throws(() => FileNamingEnhanced.ensureWritableDirectory(''), /not configured/);
});
