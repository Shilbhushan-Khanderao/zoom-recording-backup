// Mail-bot tests: run with `node --test test/mailbot.test.js` (part of `npm test`)
// No real IMAP/SMTP/child processes: spawn and nodemailer are stubbed before mail-bot is required.
// Logger writes under cwd: keep test logs out of the real logs/ folder
process.chdir(require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'zdb-mail-')));
process.env.ALLOWED_SENDERS = ' Boss@Example.com , ,';
process.env.ENABLE_DASHBOARD = 'false';
delete process.env.REQUIRE_DMARC;

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const childProcess = require('child_process');
const nodemailer = require('nodemailer');

// ---- stubs -------------------------------------------------------------
const spawnCalls = [];
let onSpawn = (child) => setImmediate(() => child.emit('close', 0)); // default: exit 0

childProcess.spawn = (cmd, args, opts) => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.signals = [];
  child.kill = (sig) => { child.signals.push(sig); child.emit('kill', sig); };
  spawnCalls.push({ cmd, args, opts, child });
  onSpawn(child, args);
  return child;
};

const mails = [];
nodemailer.createTransport = () => ({ sendMail: async (m) => { mails.push(m); } });

const bot = require('../mail-bot');
const { parseEmailBody, escapeHtml, runBackup, checkMail, getProgressFileStats, IdleMailBot, config } = bot;

// ---- helpers -----------------------------------------------------------
let uidSeq = 1;
let topicSeq = 0;
const uniqueTopic = (name) => `${name} ${Date.now()}-${topicSeq++}`; // dedup cache is module-global

function msg({ from = 'Boss <boss@example.com>', subject = 'Backup please', auth = 'mx.google.com; dmarc=pass', body = '', noHeader = false } = {}) {
  const parts = [{ which: 'TEXT', body }];
  if (!noHeader) {
    const header = { from: [from], subject: [subject] };
    if (auth !== null) header['authentication-results'] = [auth];
    parts.unshift({ which: 'HEADER', body: header });
  }
  return { attributes: { uid: uidSeq++ }, parts };
}

function fakeConnection(messages, { failFlag = false } = {}) {
  const flags = [];
  return {
    flags,
    search: async () => messages,
    addFlags: async (uid, flag) => {
      if (failFlag) throw new Error('connection closed');
      flags.push([uid, flag]);
    },
  };
}

function reset() {
  spawnCalls.length = 0;
  mails.length = 0;
  onSpawn = (child) => setImmediate(() => child.emit('close', 0));
}

const argValue = (args, flag) => { const i = args.indexOf(flag); return i === -1 ? undefined : args[i + 1]; };
const progressPath = (id) => path.join(__dirname, '..', 'logs', 'backups', `progress_${id}.json`);

// ---- parseEmailBody ----------------------------------------------------
test('parseEmailBody extracts fields case-insensitively across CRLF lines', () => {
  const r = parseEmailBody('topic: Physics Lecture\r\nDATE: 2026-01-09\r\nuserid: user@example.com\r\n');
  assert.deepStrictEqual(r, { topic: 'Physics Lecture', date: '2026-01-09', userId: 'user@example.com' });
});

test('parseEmailBody returns null for missing/empty fields and non-string input', () => {
  assert.deepStrictEqual(parseEmailBody('hello there'), { topic: null, date: null, userId: null });
  assert.deepStrictEqual(parseEmailBody(undefined), { topic: null, date: null, userId: null });
  // empty value must not swallow the next line
  assert.strictEqual(parseEmailBody('Topic:\nDate: 2026-01-01').topic, null);
  assert.strictEqual(parseEmailBody('Topic:   \nDate: 2026-01-01').date, '2026-01-01');
});

test('parseEmailBody does not read "update:" as a Date (word boundary)', () => {
  const r = parseEmailBody('Topic: Weekly update: notes');
  assert.strictEqual(r.topic, 'Weekly update: notes');
  assert.strictEqual(r.date, null);
});

test('parseEmailBody works on a one-line subject', () => {
  assert.strictEqual(parseEmailBody('Backup Topic: Physics').topic, 'Physics');
});

test('parseEmailBody strips injection characters', () => {
  assert.strictEqual(parseEmailBody('Topic: <script>"x"\'y\'`z`${a}</script>').topic, 'scriptxyza/script');
});

test('parseEmailBody caps lengths at 255/50/100', () => {
  const r = parseEmailBody(`Topic: ${'t'.repeat(400)}\nDate: ${'d'.repeat(80)}\nUserId: ${'u'.repeat(150)}`);
  assert.strictEqual(r.topic.length, 255);
  assert.strictEqual(r.date.length, 50);
  assert.strictEqual(r.userId.length, 100);
});

// ---- escapeHtml --------------------------------------------------------
test('escapeHtml escapes all five characters and tolerates null/undefined', () => {
  assert.strictEqual(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  assert.strictEqual(escapeHtml(null), '');
  assert.strictEqual(escapeHtml(undefined), '');
  assert.strictEqual(escapeHtml(42), '42');
});

// ---- sender + DMARC ----------------------------------------------------
test('IMAP config sends SNI and keeps certificate verification on', () => {
  assert.strictEqual(config.imap.tlsOptions.servername, config.imap.host);
  assert.notStrictEqual(config.imap.tlsOptions.rejectUnauthorized, false);
});

test('config normalises allowed senders (lowercase, empty entries dropped)', () => {
  assert.deepStrictEqual(config.allowedSenders, ['boss@example.com']);
  assert.strictEqual(config.requireDmarc, true);
});

test('allowed sender is matched case-insensitively from "Name <addr>"', async () => {
  reset();
  const topic = uniqueTopic('CaseTest');
  const conn = fakeConnection([msg({ from: 'The Boss <BOSS@EXAMPLE.COM>', body: `Topic: ${topic}` })]);
  await checkMail(conn);
  assert.strictEqual(spawnCalls.length, 1);
  assert.ok(mails.every(m => m.to === 'boss@example.com'));
});

test('bare address in From header is accepted', async () => {
  reset();
  await checkMail(fakeConnection([msg({ from: 'boss@example.com', body: `Topic: ${uniqueTopic('Bare')}` })]));
  assert.strictEqual(spawnCalls.length, 1);
});

test('unknown sender is ignored: no reply, no spawn, still flagged seen', async () => {
  reset();
  const m = msg({ from: 'Mallory <mallory@evil.com>', body: 'Topic: X' });
  const conn = fakeConnection([m]);
  await checkMail(conn);
  assert.strictEqual(spawnCalls.length, 0);
  assert.strictEqual(mails.length, 0);
  assert.deepStrictEqual(conn.flags, [[m.attributes.uid, '\\Seen']]);
});

test('empty From header never matches (empty ALLOWED_SENDERS entries are dropped)', async () => {
  reset();
  await checkMail(fakeConnection([msg({ from: '', body: 'Topic: X' })]));
  assert.strictEqual(spawnCalls.length, 0);
  assert.strictEqual(mails.length, 0);
});

test('DMARC: missing header and dmarc=fail are rejected silently', async () => {
  reset();
  await checkMail(fakeConnection([
    msg({ auth: null, body: `Topic: ${uniqueTopic('NoAuth')}` }),
    msg({ auth: 'mx.google.com; spf=pass; dmarc=fail (p=NONE)', body: `Topic: ${uniqueTopic('Fail')}` }),
  ]));
  assert.strictEqual(spawnCalls.length, 0);
  assert.strictEqual(mails.length, 0);
});

test('DMARC: REQUIRE_DMARC=false (config.requireDmarc) accepts missing header', async (t) => {
  reset();
  config.requireDmarc = false;
  t.after(() => { config.requireDmarc = true; });
  await checkMail(fakeConnection([msg({ auth: null, body: `Topic: ${uniqueTopic('NoDmarc')}` })]));
  assert.strictEqual(spawnCalls.length, 1);
});

// ---- routing -----------------------------------------------------------
test('subject without "backup" is ignored but flagged seen', async () => {
  reset();
  const m = msg({ subject: 'Lunch?', body: 'Topic: X' });
  const conn = fakeConnection([m]);
  await checkMail(conn);
  assert.strictEqual(spawnCalls.length, 0);
  assert.strictEqual(mails.length, 0);
  assert.deepStrictEqual(conn.flags, [[m.attributes.uid, '\\Seen']]);
});

test('message without HEADER part is skipped but flagged seen', async () => {
  reset();
  const m = msg({ noHeader: true });
  const conn = fakeConnection([m]);
  await checkMail(conn);
  assert.strictEqual(spawnCalls.length, 0);
  assert.deepStrictEqual(conn.flags, [[m.attributes.uid, '\\Seen']]);
});

test('every handled message is flagged \\Seen exactly once', async () => {
  reset();
  const messages = [
    msg({ body: `Topic: ${uniqueTopic('A')}` }),
    msg({ from: 'x@evil.com' }),
    msg({ subject: 'hi' }),
    msg({ body: 'no params' }),
    msg({ auth: null }),
  ];
  const conn = fakeConnection(messages);
  await checkMail(conn);
  assert.deepStrictEqual(conn.flags.map(f => f[0]).sort(), messages.map(m => m.attributes.uid).sort());
  assert.strictEqual(new Set(conn.flags.map(f => f[0])).size, messages.length);
});

test('failed \\Seen flag aborts the batch (connection dead) and throws', async () => {
  reset();
  await assert.rejects(checkMail(fakeConnection([msg({ body: 'Topic: Y' })], { failFlag: true })), /connection closed/);
  assert.strictEqual(spawnCalls.length, 0);
});

test('invalid format (no Topic/Date) gets Invalid Format reply, no spawn', async () => {
  reset();
  await checkMail(fakeConnection([msg({ body: 'please back up everything' })]));
  assert.strictEqual(spawnCalls.length, 0);
  assert.strictEqual(mails.length, 1);
  assert.match(mails[0].subject, /not understood/);
  assert.match(mails[0].html, /from that date until today/);
});

test('topic in subject is used when body has none', async () => {
  reset();
  const topic = uniqueTopic('SubjTopic');
  await checkMail(fakeConnection([msg({ subject: `Backup Topic: ${topic}`, body: '' })]));
  assert.strictEqual(argValue(spawnCalls[0].args, '--topic'), topic);
});

test('raw multipart quoted-printable body (Gmail style) is decoded before parsing', async () => {
  reset();
  const topic = uniqueTopic('Physics=Lecture');
  const qpTopic = topic.replace('=', '=3D');
  const raw = [
    'From: boss@example.com', 'Subject: Backup', 'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="b1"', '',
    '--b1', 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: quoted-printable', '',
    `Topic: ${qpTopic}`, 'Date: 2026-01-=', '09', '',
    '--b1', 'Content-Type: text/html; charset="UTF-8"', '', `<div>Topic: ${topic}</div>`, '--b1--', '',
  ].join('\r\n');
  const m = msg();
  m.parts = [m.parts[0], { which: '', body: raw }];
  await checkMail(fakeConnection([m]));
  assert.strictEqual(spawnCalls.length, 1);
  assert.strictEqual(argValue(spawnCalls[0].args, '--topic'), topic);
  assert.strictEqual(argValue(spawnCalls[0].args, '--date'), '2026-01-09');
});

test('duplicate within 5 minutes gets Skipped reply and spawns once', async () => {
  reset();
  const topic = uniqueTopic('Dup');
  await checkMail(fakeConnection([msg({ body: `Topic: ${topic}` }), msg({ body: `Topic: ${topic}` })]));
  assert.strictEqual(spawnCalls.length, 1);
  assert.ok(mails.some(m => /skipped \(duplicate\)/.test(m.subject)));
});

// ---- outcomes ----------------------------------------------------------
test('success (exit 0): correct CLI args, started + success emails, HTML escaped', async () => {
  reset();
  const topic = uniqueTopic('Physics & Chem');
  await checkMail(fakeConnection([msg({ body: `Topic: ${topic}\nDate: 2026-01-09\nUserId: u@example.com` })]));
  assert.strictEqual(spawnCalls.length, 1);
  const { cmd, args, opts } = spawnCalls[0];
  assert.strictEqual(cmd, 'node');
  assert.deepStrictEqual(args.slice(0, 2), ['cli.js', 'backup']);
  assert.strictEqual(argValue(args, '--topic'), topic);
  assert.strictEqual(argValue(args, '--date'), '2026-01-09');
  assert.strictEqual(argValue(args, '--user'), 'u@example.com');
  assert.match(argValue(args, '--backup-id'), /^BACKUP-\d+$/);
  assert.strictEqual(opts.cwd, path.join(__dirname, '..'));

  assert.strictEqual(mails.length, 2);
  assert.match(mails[0].subject, /^Backup started: /);
  assert.ok(mails[0].subject.includes(argValue(args, '--backup-id')));
  assert.match(mails[1].subject, /^Backup completed/);
  assert.ok(mails[1].html.includes('Physics &amp; Chem'));
  assert.ok(!mails[1].html.includes('Physics & Chem'));
  assert.ok(mails[1].html.includes('2026-01-09 to today'));
});

test('success with optional fields omitted: no --date / --user args', async () => {
  reset();
  await checkMail(fakeConnection([msg({ body: `Topic: ${uniqueTopic('Only')}` })]));
  const { args } = spawnCalls[0];
  assert.strictEqual(args.includes('--date'), false);
  assert.strictEqual(args.includes('--user'), false);
});

test('success reads counts from this backup\'s progress file', async () => {
  reset();
  let file;
  onSpawn = (child, args) => {
    file = progressPath(argValue(args, '--backup-id'));
    fs.writeFileSync(file, JSON.stringify({
      totalFiles: 2, uploadedFiles: [{ fileName: 'a.mp4', fileSize: 3 * 1024 * 1024 }, { fileName: 'b.mp4', fileSize: 1024 * 1024 }], failedFiles: [],
    }));
    setImmediate(() => child.emit('close', 0));
  };
  try {
    await checkMail(fakeConnection([msg({ body: `Topic: ${uniqueTopic('Counts')}` })]));
  } finally {
    fs.rmSync(file, { force: true });
  }
  assert.match(mails[1].subject, /Backup completed: .* - 2 file\(s\), 4\.00 MB/);
  assert.ok(mails[1].html.includes('4.00 MB'));
  assert.ok(mails[1].html.includes('All files have been successfully uploaded'));
});

test('partial (exit 2): partial email lists failed files from progress file', async () => {
  reset();
  let file;
  onSpawn = (child, args) => {
    file = progressPath(argValue(args, '--backup-id'));
    fs.writeFileSync(file, JSON.stringify({
      totalFiles: 3,
      uploadedFiles: [{ fileName: 'ok.mp4', fileSize: 2048 }],
      failedFiles: [{ fileName: 'Lecture <1>', error: 'Upload failed after all retries' }, { fileName: 'Lecture 2', error: 'Download validation failed' }],
    }));
    setImmediate(() => child.emit('close', 2));
  };
  try {
    await checkMail(fakeConnection([msg({ body: `Topic: ${uniqueTopic('Partial')}` })]));
  } finally {
    fs.rmSync(file, { force: true });
  }
  const done = mails[1];
  assert.match(done.subject, /Backup partially completed: .* - 1 succeeded, 2 failed/);
  assert.ok(done.html.includes('Backup partially completed'));
  assert.ok(done.html.includes('Lecture &lt;1&gt;'));
  assert.ok(done.html.includes('Download validation failed'));
  assert.ok(!done.html.includes('All files have been successfully uploaded'));
});

test('exit 0 but failed files in progress file is still reported as partial', async () => {
  reset();
  let file;
  onSpawn = (child, args) => {
    file = progressPath(argValue(args, '--backup-id'));
    fs.writeFileSync(file, JSON.stringify({ uploadedFiles: [], failedFiles: [{ fileName: 'x', error: 'boom' }] }));
    setImmediate(() => child.emit('close', 0));
  };
  try {
    await checkMail(fakeConnection([msg({ body: `Topic: ${uniqueTopic('Exit0Fail')}` })]));
  } finally {
    fs.rmSync(file, { force: true });
  }
  assert.match(mails[1].subject, /Backup partially completed/);
});

test('failure (exit 1): failure email includes escaped stderr tail', async () => {
  reset();
  onSpawn = (child) => {
    setImmediate(() => {
      child.stderr.emit('data', Buffer.from('x'.repeat(1000) + '\nError: <Zoom> auth "failed"'));
      child.emit('close', 1);
    });
  };
  await checkMail(fakeConnection([msg({ body: `Topic: ${uniqueTopic('Fail')}` })]));
  const done = mails[1];
  assert.match(done.subject, /^Backup failed: /);
  assert.ok(done.html.includes('Error: &lt;Zoom&gt; auth &quot;failed&quot;'));
  assert.ok(!done.html.includes('x'.repeat(500)), 'only the tail of stderr is included');
});

test('no recordings found (exit 0, nothing uploaded) gets the no-recordings email', async () => {
  reset();
  await checkMail(fakeConnection([msg({ body: `Topic: ${uniqueTopic('Empty')}` })]));
  assert.match(mails[1].subject, /no recordings found/);
});

// ---- runBackup ---------------------------------------------------------
test('runBackup timeout sends SIGTERM, then SIGKILL, and resolves as failure', async (t) => {
  reset();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const original = config.backupTimeoutMs;
  config.backupTimeoutMs = 1000;
  t.after(() => { config.backupTimeoutMs = original; });

  onSpawn = () => {}; // child never exits on its own
  const p = runBackup('T', null, null, 'BACKUP-1');
  const child = spawnCalls[0].child;

  t.mock.timers.tick(999);
  assert.deepStrictEqual(child.signals, []);
  t.mock.timers.tick(1);
  assert.deepStrictEqual(child.signals, ['SIGTERM']);
  t.mock.timers.tick(10000);
  assert.deepStrictEqual(child.signals, ['SIGTERM', 'SIGKILL']);

  child.emit('close', null);
  const r = await p;
  assert.strictEqual(r.success, false);
  assert.strictEqual(r.partial, false);
  assert.match(r.error, /timed out/);
});

test('runBackup that exits after SIGTERM does not get SIGKILL', async (t) => {
  reset();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const original = config.backupTimeoutMs;
  config.backupTimeoutMs = 50;
  t.after(() => { config.backupTimeoutMs = original; });

  onSpawn = (child) => child.on('kill', () => child.emit('close', null));
  const p = runBackup('T', null, null, 'BACKUP-2');
  t.mock.timers.tick(50);
  const r = await p;
  t.mock.timers.tick(20000);
  assert.deepStrictEqual(spawnCalls[0].child.signals, ['SIGTERM']);
  assert.match(r.error, /timed out/);
});

test('runBackup caps buffered stdout/stderr at 64KB, keeping the tail', async () => {
  reset();
  onSpawn = (child) => setImmediate(() => {
    for (let i = 0; i < 10; i++) child.stdout.emit('data', Buffer.from('a'.repeat(10 * 1024)));
    child.stdout.emit('data', Buffer.from('END'));
    child.stderr.emit('data', Buffer.from('e'.repeat(100 * 1024) + 'LAST'));
    child.emit('close', 0);
  });
  const r = await runBackup('T', null, null, 'BACKUP-3');
  assert.ok(r.output.length <= 64 * 1024);
  assert.ok(r.output.endsWith('END'));
  assert.ok(r.error.length <= 64 * 1024);
  assert.ok(r.error.endsWith('LAST'));
  assert.strictEqual(r.success, true);
});

test('runBackup maps exit codes: 0 success, 2 partial, 1 failure', async () => {
  for (const [code, success, partial] of [[0, true, false], [2, false, true], [1, false, false]]) {
    reset();
    onSpawn = (child) => setImmediate(() => child.emit('close', code));
    const r = await runBackup('T', null, null, 'BACKUP-4');
    assert.deepStrictEqual([r.success, r.partial, r.code], [success, partial, code]);
  }
});

test('runBackup spawn error resolves as failure', async () => {
  reset();
  onSpawn = (child) => setImmediate(() => child.emit('error', new Error('ENOENT node')));
  const r = await runBackup('T', null, null, 'BACKUP-5');
  assert.strictEqual(r.success, false);
  assert.strictEqual(r.code, -1);
  assert.match(r.error, /ENOENT/);
});

// ---- getProgressFileStats ----------------------------------------------
test('getProgressFileStats: missing → null, corrupt → null, valid → counts and size', async () => {
  const id = `TEST-${Date.now()}`;
  const file = progressPath(id);
  try {
    assert.strictEqual(await getProgressFileStats(id), null);

    fs.writeFileSync(file, '{not json');
    assert.strictEqual(await getProgressFileStats(id), null);

    fs.writeFileSync(file, JSON.stringify({
      totalFiles: 3, processedFiles: 2,
      uploadedFiles: [{ fileName: 'a', fileSize: 1.5 * 1024 * 1024 * 1024 }, { fileName: 'b', fileSize: 'bad' }],
      failedFiles: [{ fileName: 'c', error: 'x' }],
    }));
    const s = await getProgressFileStats(id);
    assert.strictEqual(s.filesDownloaded, 2);
    assert.strictEqual(s.filesTotalSize, '1.50 GB');
    assert.strictEqual(s.filesFailed, 1);
    assert.strictEqual(s.totalRecordings, 3);

    fs.writeFileSync(file, JSON.stringify({}));
    const empty = await getProgressFileStats(id);
    assert.strictEqual(empty.filesDownloaded, 0);
    assert.strictEqual(empty.filesTotalSize, '0 MB');
  } finally {
    fs.rmSync(file, { force: true });
  }
});

// ---- IdleMailBot reconnect / shutdown ----------------------------------
test('scheduleReconnect keeps a single pending timer and backs off', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const b = new IdleMailBot(config);
  let connects = 0;
  b.connect = () => { b.reconnectTimer = null; connects++; };

  b.scheduleReconnect();
  const first = b.reconnectTimer;
  b.scheduleReconnect(); // error + close firing for one failure
  b.scheduleReconnect();
  assert.strictEqual(b.reconnectTimer, first);
  assert.strictEqual(b.reconnectAttempts, 1);

  t.mock.timers.tick(5000);
  assert.strictEqual(connects, 1);

  b.scheduleReconnect(); // second failure: 2 * 5000
  t.mock.timers.tick(9999);
  assert.strictEqual(connects, 1);
  t.mock.timers.tick(1);
  assert.strictEqual(connects, 2);
});

test('scheduleReconnect waits 60s after max attempts and resets the counter', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const b = new IdleMailBot(config);
  let connects = 0;
  b.connect = () => { b.reconnectTimer = null; connects++; };
  b.reconnectAttempts = b.maxReconnectAttempts;
  b.scheduleReconnect();
  assert.strictEqual(b.reconnectAttempts, 0);
  t.mock.timers.tick(59999);
  assert.strictEqual(connects, 0);
  t.mock.timers.tick(1);
  assert.strictEqual(connects, 1);
});

test('handleNewMail on a connection error schedules exactly one reconnect', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const b = new IdleMailBot(config);
  b.connection = { search: async () => { throw new Error('IMAP connection closed'); }, addFlags: async () => {} };
  await b.handleNewMail();
  await b.handleNewMail();
  assert.ok(b.reconnectTimer);
  assert.strictEqual(b.reconnectAttempts, 1);
  assert.strictEqual(b.isProcessing, false);
  clearTimeout(b.reconnectTimer);
});

test('shutdown cancels a pending reconnect and exits with the given code', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const exit = t.mock.method(process, 'exit', () => {});
  const b = new IdleMailBot(config);
  let connects = 0;
  b.connect = () => { connects++; };
  b.scheduleReconnect();
  b.shutdown(1);
  t.mock.timers.tick(120000);
  assert.strictEqual(connects, 0);
  assert.deepStrictEqual(exit.mock.calls.map(c => c.arguments[0]), [1]);
});

test('hung IMAP call times out with a message that triggers reconnect', async () => {
  const { imapTimeout } = bot;
  await assert.rejects(imapTimeout(new Promise(() => {}), 'search', 20), /IMAP search timed out/);
  assert.strictEqual(await imapTimeout(Promise.resolve(7), 'search', 20), 7);
});

// ---- IdleMailBot races and stalls ---------------------------------------
const imaps = require('imap-simple');
const flush = () => new Promise((r) => setImmediate(r));

// Fake imap-simple connection; search/openBox behaviour is injectable
function fakeImapConnection({ search = async () => [], openBox = async () => {} } = {}) {
  const imap = new EventEmitter();
  imap.destroyed = false;
  imap.destroy = () => { imap.destroyed = true; };
  const conn = { imap, ended: false, searches: 0, openBox, addFlags: async () => {} };
  conn.search = (...a) => { conn.searches++; return search(...a); };
  conn.end = () => { conn.ended = true; };
  return conn;
}

function stubConnect(t, ...connections) {
  const queue = [...connections];
  return t.mock.method(imaps, 'connect', async () => {
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next;
  });
}

test('mail event and poll tick during an in-flight check run checkMail only once', async () => {
  const b = new IdleMailBot(config);
  let release;
  const gate = new Promise((r) => { release = r; });
  b.connection = fakeImapConnection({ search: () => gate });

  const first = b.handleNewMail();
  await b.handleNewMail(); // 'mail' event while search is pending
  await b.handleNewMail(); // poll tick while search is pending
  assert.strictEqual(b.connection.searches, 1);
  assert.strictEqual(b.lastPollAt, undefined);

  release([]);
  await first;
  assert.strictEqual(b.isProcessing, false);
  assert.ok(b.lastPollAt > 0, 'successful poll updates lastPollAt for the health check');

  await b.handleNewMail(); // guard released: next poll runs
  assert.strictEqual(b.connection.searches, 2);
});

test('hung search (half-dead socket) times out, frees the poll loop and reconnects', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const b = new IdleMailBot(config);
  b.connection = fakeImapConnection({ search: () => new Promise(() => {}) });
  b.lastPollAt = 123;

  const pending = b.handleNewMail();
  await flush();
  assert.strictEqual(b.isProcessing, true);
  assert.strictEqual(b.reconnectTimer, null);

  t.mock.timers.tick(2 * 60 * 1000);
  await pending;
  assert.strictEqual(b.isProcessing, false);
  assert.ok(b.reconnectTimer, 'timeout must schedule a reconnect');
  assert.strictEqual(b.lastPollAt, 123, 'failed poll must not look healthy');
  clearTimeout(b.reconnectTimer);
});

test('non-connection error releases the guard without reconnecting', async () => {
  const b = new IdleMailBot(config);
  b.connection = fakeImapConnection({ search: async () => { throw new Error('unexpected parser bug'); } });
  await b.handleNewMail();
  assert.strictEqual(b.isProcessing, false);
  assert.strictEqual(b.reconnectTimer, null);
  assert.strictEqual(b.lastPollAt, undefined);
});

test('connect success: ready, attempts reset, polls immediately', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const conn = fakeImapConnection();
  stubConnect(t, conn);
  const b = new IdleMailBot(config);
  b.reconnectAttempts = 3;

  await b.connect();
  await flush();
  assert.strictEqual(b.isReady, true);
  assert.strictEqual(b.reconnectAttempts, 0);
  assert.ok(b.pollTimer);
  assert.strictEqual(conn.searches, 1);

  t.mock.timers.tick(b.pollInterval);
  await flush();
  assert.strictEqual(conn.searches, 2);
  b.stopPolling();
});

test('IMAP error and close for one failure: polling stops, exactly one reconnect', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const conn = fakeImapConnection();
  stubConnect(t, conn);
  const b = new IdleMailBot(config);
  await b.connect();
  await flush();

  conn.imap.emit('error', new Error('read ECONNRESET'));
  conn.imap.emit('close');
  conn.imap.emit('close');
  assert.strictEqual(b.pollTimer, null);
  assert.ok(b.reconnectTimer);
  assert.strictEqual(b.reconnectAttempts, 1);
  clearTimeout(b.reconnectTimer);
});

test('connect rejected (bad login / network down) schedules a reconnect', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  stubConnect(t, new Error('Invalid credentials (Failure)'));
  const b = new IdleMailBot(config);
  await b.connect();
  assert.strictEqual(b.isReady, false);
  assert.ok(b.reconnectTimer);
  clearTimeout(b.reconnectTimer);
});

test('openBox that never answers times out and schedules a reconnect', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  stubConnect(t, fakeImapConnection({ openBox: () => new Promise(() => {}) }));
  const b = new IdleMailBot(config);
  const pending = b.connect();
  await flush();
  t.mock.timers.tick(2 * 60 * 1000);
  await pending;
  assert.strictEqual(b.isReady, false);
  assert.strictEqual(b.pollTimer, null);
  assert.ok(b.reconnectTimer);
  clearTimeout(b.reconnectTimer);
});

test('reconnect tears down the old connection; its late events are ignored', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const oldConn = fakeImapConnection();
  const newConn = fakeImapConnection();
  stubConnect(t, oldConn, newConn);
  const b = new IdleMailBot(config);
  await b.connect();
  await flush();

  await b.connect(); // reconnect
  await flush();
  assert.strictEqual(oldConn.ended, true);
  assert.strictEqual(oldConn.imap.destroyed, true);
  assert.strictEqual(oldConn.imap.listenerCount('close'), 0);
  assert.strictEqual(b.connection, newConn);

  oldConn.imap.emit('close'); // stale socket finally closes
  assert.strictEqual(b.reconnectTimer, null);
  assert.ok(b.pollTimer, 'live polling must survive a stale close');
  b.stopPolling();
});

test('imapTimeout passes the original error through and leaves no timer behind', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { imapTimeout } = bot;
  await assert.rejects(imapTimeout(Promise.reject(new Error('NO [AUTHENTICATIONFAILED]')), 'connect'), /AUTHENTICATIONFAILED/);
  assert.strictEqual(await imapTimeout(Promise.resolve('ok'), 'search'), 'ok');
  t.mock.timers.tick(10 * 60 * 1000); // a leaked timer would reject nothing but keep the process alive
});
