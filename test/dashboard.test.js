// Dashboard server tests: auth, validation, rate limiting, job queue, secret stripping.
// No real DB, Zoom or child processes: everything external is stubbed before app is required.
process.env.DASHBOARD_PASSWORD = 'pa:ss-wörd';
process.env.DASHBOARD_USER = 'admin';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { EventEmitter } = require('events');

// --- stubs (must be in place before app/routes destructure them) ---
const childProcess = require('child_process');
const spawned = [];
childProcess.spawn = (cmd, args, opts) => {
  const child = new EventEmitter();
  child.pid = 4242;
  child.unref = () => {};
  spawned.push({ cmd, args, opts });
  return child;
};

const zoomAuth = require('../src/zoomAuth');
const zoomFetcher = require('../src/zoomFetcher');
zoomAuth.getZoomAccessToken = async () => 'tok';
zoomFetcher.fetchAllRecordings = async () => [
  {
    id: 1, topic: 'Physics Lecture', password: 'p1', recording_play_passcode: 'pc', encrypted_password: 'e',
    share_url: 'https://share',
    recording_files: [{ id: 'f1', download_url: 'https://dl', download_access_token: 'secret', password: 'x' }],
  },
  { id: 2, topic: 'Chemistry', password: 'p2' },
];

const backupRepository = require('../dashboard/server/repositories/backupRepository');
const repoCalls = [];
let runningBackup = null;
backupRepository.getRunningBackup = async () => runningBackup;
backupRepository.updateBackupStatus = async (...args) => repoCalls.push(['updateBackupStatus', ...args]);
backupRepository.createBackupRecord = async (...args) => repoCalls.push(['createBackupRecord', ...args]);
backupRepository.getBackups = async () => [];
backupRepository.countBackups = async () => 0;

const jobQueue = require('../dashboard/server/services/jobQueue');
const backupService = require('../dashboard/server/services/backupService');
const realTrigger = jobQueue.triggerBackupJob.bind(jobQueue);

const app = require('../dashboard/server/app');
const basicAuth = require('../dashboard/server/middlewares/basicAuth');

let server;
let port;
test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  port = server.address().port;
});
test.after(() => server.close());

const basic = (user, pass) => 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
const GOOD = basic('admin', 'pa:ss-wörd');

function request(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, method, path,
      headers: { ...headers, ...(data && { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }) },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, json, raw });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('health is open without credentials', async () => {
  const res = await request('GET', '/api/health');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.status, 'healthy');
});

test('API rejects missing, wrong and malformed credentials', async () => {
  const cases = [
    {},
    { Authorization: basic('admin', 'wrong') },
    { Authorization: basic('root', 'pa:ss-wörd') },
    { Authorization: 'Basic' },
    { Authorization: 'Basic !!!not-base64!!!' },
    { Authorization: 'Basic ' + Buffer.from('nocolon').toString('base64') },
    { Authorization: 'Bearer ' + Buffer.from('admin:pa:ss-wörd').toString('base64') },
  ];
  for (const headers of cases) {
    const res = await request('GET', '/api/backups', { headers });
    assert.strictEqual(res.status, 401, JSON.stringify(headers));
    assert.match(res.headers['www-authenticate'], /^Basic realm=/);
  }
});

test('correct credentials (password with colon + unicode) pass', async () => {
  const res = await request('GET', '/api/backups', { headers: { Authorization: GOOD } });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.json.backups, []);
});

test('empty DASHBOARD_PASSWORD rejects everything, even empty password', async () => {
  const saved = process.env.DASHBOARD_PASSWORD;
  process.env.DASHBOARD_PASSWORD = '';
  try {
    for (const auth of [basic('admin', ''), GOOD]) {
      const res = await request('GET', '/api/backups', { headers: { Authorization: auth } });
      assert.strictEqual(res.status, 401);
    }
  } finally {
    process.env.DASHBOARD_PASSWORD = saved;
  }
});

test('SPA requires auth', async () => {
  assert.strictEqual((await request('GET', '/')).status, 401);
  assert.strictEqual((await request('GET', '/some/client/route')).status, 401);
});

test('basicAuth compare handles different-length inputs without throwing', () => {
  let status;
  const res = { set() {}, status(s) { status = s; return { json() {} }; } };
  const longUser = 'a'.repeat(10000);
  basicAuth({ headers: { authorization: basic(longUser, 'x') } }, res, () => assert.fail('passed'));
  assert.strictEqual(status, 401);
});

test('trigger: validation, success, conflict, then rate limit (limiter counts invalid bodies)', async () => {
  const H = { Authorization: GOOD };
  const triggered = [];
  jobQueue.triggerBackupJob = async (params) => { triggered.push(params); return 'BACKUP-1'; };
  try {
    // 1-3: invalid bodies (dryRun boolean checked in trigger-specific test, outside the limiter)
    assert.strictEqual((await request('POST', '/api/backups/trigger', { headers: H, body: { date: 'not-a-date' } })).status, 422);
    assert.strictEqual((await request('POST', '/api/backups/trigger', { headers: H, body: { date: '2026-13-45' } })).status, 422);
    assert.strictEqual((await request('POST', '/api/backups/trigger', { headers: H, body: { topic: 'x'.repeat(256) } })).status, 422);

    // 4: success; unknown keys stripped, dryRun defaulted
    const ok = await request('POST', '/api/backups/trigger', { headers: H, body: { topic: 'Physics', date: '2026-01-09', evil: 1 } });
    assert.strictEqual(ok.status, 202);
    assert.strictEqual(ok.json.backupId, 'BACKUP-1');
    assert.deepStrictEqual(triggered[0], { topic: 'Physics', date: '2026-01-09', dryRun: false, triggerSource: 'dashboard' });

    // 5: conflict
    jobQueue.triggerBackupJob = async () => { throw new Error('A backup job is already running'); };
    assert.strictEqual((await request('POST', '/api/backups/trigger', { headers: H, body: {} })).status, 409);

    // 6: rate limited (5 per 5 minutes)
    const limited = await request('POST', '/api/backups/trigger', { headers: H, body: {} });
    assert.strictEqual(limited.status, 429);
  } finally {
    jobQueue.triggerBackupJob = realTrigger;
  }
});

test('trigger-specific validates file entries and forwards fileSize', async () => {
  const H = { Authorization: GOOD };
  assert.strictEqual((await request('POST', '/api/backups/trigger-specific', { headers: H, body: { files: [] } })).status, 422);
  assert.strictEqual((await request('POST', '/api/backups/trigger-specific', { headers: H, body: { files: [{ meetingId: 'm', fileId: 'f' }], dryRun: 'maybe' } })).status, 422);
  assert.strictEqual((await request('POST', '/api/backups/trigger-specific', { headers: H, body: { files: [{ meetingId: 'm' }] } })).status, 422);
  assert.strictEqual((await request('POST', '/api/backups/trigger-specific', { headers: H, body: { files: [{ meetingId: 'm', fileId: 'f', fileSize: -1 }] } })).status, 422);
  assert.strictEqual((await request('POST', '/api/backups/trigger-specific', { headers: H, body: { files: [{ meetingId: 'm', fileId: 'f', fileSize: 1.5 }] } })).status, 422);

  const forwarded = [];
  jobQueue.triggerBackupJob = async (params) => { forwarded.push(params); return 'BACKUP-2'; };
  try {
    const file = { meetingId: 'm==', fileId: 'f1', topic: 'Chem', startTime: '2026-01-01T00:00:00Z', downloadUrl: 'https://dl', fileSize: 123456789 };
    const res = await request('POST', '/api/backups/trigger-specific', { headers: H, body: { files: [file] } });
    assert.strictEqual(res.status, 202);
    assert.deepStrictEqual(forwarded[0].files, [file]);
    assert.strictEqual(forwarded[0].triggerSource, 'dashboard-specific');
  } finally {
    jobQueue.triggerBackupJob = realTrigger;
  }
});

test('jobQueue builds CLI args and refuses concurrent jobs', async () => {
  runningBackup = null;
  jobQueue.activeJob = null;
  spawned.length = 0;

  const id1 = await realTrigger({ topic: 'Physics', date: '2026-01-09', userId: 'u@x.com', dryRun: true });
  assert.match(id1, /^BACKUP-\d+$/);
  const a1 = spawned[0].args;
  assert.ok(a1[0].endsWith('cli.js'));
  for (const [flag, val] of [['--topic', 'Physics'], ['--date', '2026-01-09'], ['--user', 'u@x.com'], ['--backup-id', id1]]) {
    assert.strictEqual(a1[a1.indexOf(flag) + 1], val, flag);
  }
  assert.ok(a1.includes('--dry-run'));

  // in-memory job blocks a second trigger
  await assert.rejects(realTrigger({}), /already running/);

  // child exit frees the queue; --files path encodes files and omits topic/date flags
  jobQueue.activeJob = null;
  const files = [{ meetingId: 'm==', fileId: 'f1', topic: 'Chem', downloadUrl: 'https://dl' }];
  const id2 = await realTrigger({ files });
  const a2 = spawned[1].args;
  assert.deepStrictEqual(JSON.parse(Buffer.from(a2[a2.indexOf('--files') + 1], 'base64').toString()), files);
  assert.ok(!a2.includes('--topic') && !a2.includes('--dry-run'));
  assert.strictEqual(a2[a2.indexOf('--backup-id') + 1], id2);
  // record created with topic taken from the first file
  assert.deepStrictEqual(repoCalls.filter((c) => c[0] === 'createBackupRecord').at(-1).slice(1, 3), [id2, 'dashboard']);

  // DB says a backup is running -> refuse
  jobQueue.activeJob = null;
  runningBackup = { backup_id: 'B', started_at: new Date().toISOString(), total_files: 2, processed_files: 1 };
  await assert.rejects(realTrigger({}), /already running/);
  runningBackup = null;
  jobQueue.activeJob = null;
});

test('running status: progress computed, stale (>12h) backup auto-failed', async () => {
  runningBackup = { backup_id: 'B1', started_at: new Date().toISOString(), total_files: 4, processed_files: 1 };
  const live = await backupService.getRunningBackupStatus();
  assert.strictEqual(live.running, true);
  assert.strictEqual(live.backup.progress, 25);

  runningBackup = { backup_id: 'B2', started_at: new Date(Date.now() - 13 * 3600e3).toISOString(), total_files: 0, processed_files: 0 };
  const stale = await backupService.getRunningBackupStatus();
  assert.deepStrictEqual(stale, { running: false, backup: null });
  const call = repoCalls.filter((c) => c[0] === 'updateBackupStatus').at(-1);
  assert.deepStrictEqual(call.slice(1, 3), ['B2', 'failed']);
  runningBackup = null;
});

test('zoom recordings: secrets stripped, userId required, topic filter case-insensitive', async () => {
  const H = { Authorization: GOOD };
  assert.strictEqual((await request('GET', '/api/zoom/recordings', { headers: H })).status, 400);

  const res = await request('GET', '/api/zoom/recordings?userId=u%40x.com&topic=PHYSICS', { headers: H });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.totalRecordings, 1);
  const [m] = res.json.recordings;
  for (const k of ['password', 'recording_play_passcode', 'encrypted_password']) assert.ok(!(k in m), k);
  assert.strictEqual(m.share_url, 'https://share');
  assert.ok(!('download_access_token' in m.recording_files[0]));
  assert.ok(!('password' in m.recording_files[0]));
  assert.strictEqual(m.recording_files[0].download_url, 'https://dl');
  assert.ok(!res.raw.includes('secret') && !res.raw.includes('"p1"'));
});

test('SSE stream opens with event-stream content type when authed', async () => {
  const res = await new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/events', headers: { Authorization: GOOD } }, (r) => {
      r.once('data', (chunk) => { resolve({ status: r.statusCode, type: r.headers['content-type'], first: String(chunk) }); req.destroy(); });
    });
    req.on('error', (e) => (e.code === 'ECONNRESET' ? null : reject(e)));
  });
  assert.strictEqual(res.status, 200);
  assert.match(res.type, /text\/event-stream/);
  assert.match(res.first, /event: connected/);
  assert.strictEqual((await request('GET', '/api/events')).status, 401);
});
