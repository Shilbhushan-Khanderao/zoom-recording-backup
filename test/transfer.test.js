// Downloader (real local HTTP server), uploader (fake Drive), Zoom fetcher (stubbed axios).
process.chdir(require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'zdb-xfer-')));
process.env.LOG_LEVEL = 'error';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const axios = require('axios');

const FileDownloader = require('../src/fileDownloader');
const DriveUploader = require('../src/driveUploader');
const { ZoomFetcherEnhanced } = require('../src/zoomFetcher');

// ---- downloader ---------------------------------------------------------
let hits = {};
const server = http.createServer((req, res) => {
  hits[req.url] = (hits[req.url] || 0) + 1;
  const body = Buffer.alloc(4096, 1);
  switch (req.url) {
    case '/ok': res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': body.length }); return res.end(body);
    case '/nolength': res.writeHead(200, { 'content-type': 'video/mp4' }); return res.end(body);
    case '/html': res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>login</html>');
    case '/small': res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': 10 }); return res.end(Buffer.alloc(10));
    case '/truncated': // promises 4096 bytes, sends 2048, then drops the socket
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': 4096 });
      res.write(Buffer.alloc(2048));
      return setTimeout(() => res.socket.destroy(), 20);
    case '/flaky':
      if (hits[req.url] === 1) { res.writeHead(500); return res.end(); }
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': body.length }); return res.end(body);
    case '/404': res.writeHead(404); return res.end();
    default: res.writeHead(500); return res.end();
  }
});
let base;
test.before(() => new Promise((r) => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
test.after(() => server.close());

const dl = () => new FileDownloader({ maxRetries: 2, retryDelay: 1, timeout: 2000 });
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zdb-dl-')), 'f.mp4');

test('download: success writes exact bytes and reports fractional progress', async () => {
  const file = tmpFile();
  const progress = [];
  const res = await dl().downloadFile(`${base}/ok`, file, (p) => progress.push(p.progress));
  assert.strictEqual(res.size, 4096);
  assert.strictEqual(fs.statSync(file).size, 4096);
  assert.ok(progress.every((p) => p >= 0 && p <= 1), `progress out of range: ${progress}`);
});

test('download: missing content-length still succeeds', async () => {
  const res = await dl().downloadFile(`${base}/nolength`, tmpFile());
  assert.strictEqual(res.size, 4096);
});

test('download: HTML (expired link / login page) is rejected and file removed', async () => {
  const file = tmpFile();
  await assert.rejects(dl().downloadFile(`${base}/html`, file), /after all retries/);
  assert.strictEqual(fs.existsSync(file), false);
});

test('download: suspiciously small file is rejected', async () => {
  await assert.rejects(dl().downloadFile(`${base}/small`, tmpFile()), /after all retries/);
});

test('download: truncated transfer fails and leaves no partial file', async () => {
  const file = tmpFile();
  await assert.rejects(dl().downloadFile(`${base}/truncated`, file));
  assert.strictEqual(fs.existsSync(file), false);
});

test('download: transient 500 is retried then succeeds', async () => {
  hits = {};
  const res = await dl().downloadFile(`${base}/flaky`, tmpFile());
  assert.strictEqual(res.size, 4096);
  assert.strictEqual(hits['/flaky'], 2);
});

test('download: 404 gives up after maxRetries', async () => {
  hits = {};
  await assert.rejects(dl().downloadFile(`${base}/404`, tmpFile()));
  assert.strictEqual(hits['/404'], 2);
});

// ---- uploader -----------------------------------------------------------
function fakeDrive({ createFails = [], getSize = null, listResults = [] } = {}) {
  const calls = { create: [], update: [], list: [] };
  return {
    calls,
    files: {
      create: async (opts) => {
        calls.create.push(opts);
        const err = createFails.shift();
        if (err) throw err;
        return { data: { id: `id${calls.create.length}`, size: String(getSize ?? opts.media.length) } };
      },
      get: async () => ({ data: { size: String(getSize ?? 4096) } }),
      list: async (opts) => { calls.list.push(opts.q); return { data: { files: listResults.shift() || [] } }; },
      update: async (opts) => { calls.update.push(opts); return { data: {} }; },
    },
  };
}

function uploader(drive) {
  const u = new DriveUploader({ maxRetries: 3, retryDelay: 1 });
  u.drive = drive;
  return u;
}

const srcFile = () => { const f = tmpFile(); fs.writeFileSync(f, Buffer.alloc(4096)); return f; };

test('upload: tags file with zoomFileId and returns Drive id', async () => {
  const drive = fakeDrive();
  const res = await uploader(drive).uploadFile(srcFile(), 'a.mp4', 'folder', () => {}, 'zoom-1');
  assert.strictEqual(res.fileId, 'id1');
  const meta = drive.calls.create[0].resource;
  assert.deepStrictEqual(meta, { name: 'a.mp4', parents: ['folder'], appProperties: { zoomFileId: 'zoom-1' } });
  assert.strictEqual(drive.calls.create[0].media.mimeType, 'video/mp4');
});

test('upload: without zoomFileId no appProperties are sent', async () => {
  const drive = fakeDrive();
  await uploader(drive).uploadFile(srcFile(), 'a.mp4', 'folder');
  assert.strictEqual(drive.calls.create[0].resource.appProperties, undefined);
});

test('upload: transient errors are retried', async () => {
  const drive = fakeDrive({ createFails: [Object.assign(new Error('Backend Error'), { code: 500 })] });
  const res = await uploader(drive).uploadFile(srcFile(), 'a.mp4', 'folder');
  assert.strictEqual(res.fileId, 'id2');
  assert.strictEqual(drive.calls.create.length, 2);
});

test('upload: 401 / invalid_grant surfaces OAUTH_AUTH_REQUIRED without retrying', async () => {
  const drive = fakeDrive({ createFails: [Object.assign(new Error('invalid_grant'), { code: 401 })] });
  await assert.rejects(uploader(drive).uploadFile(srcFile(), 'a.mp4', 'folder'), /OAUTH_AUTH_REQUIRED/);
  assert.strictEqual(drive.calls.create.length, 1);
});

test('upload: empty file is refused', async () => {
  const f = tmpFile();
  fs.writeFileSync(f, '');
  await assert.rejects(uploader(fakeDrive()).uploadFile(f, 'a.mp4', 'folder'), /after all retries/);
});

test('upload: missing source file rejects instead of crashing the process', async () => {
  await assert.rejects(uploader(fakeDrive()).uploadFile('/nope/missing.mp4', 'a.mp4', 'folder'));
});

test('verifyUpload: size mismatch throws', async () => {
  await assert.rejects(uploader(fakeDrive({ getSize: 1 })).verifyUpload('id', 4096), /verify/);
});

test('findExisting: tagged file found with one query', async () => {
  const drive = fakeDrive({ listResults: [[{ id: 'd1', name: 'x.mp4', size: '5' }]] });
  const res = await uploader(drive).findExisting('zf', 'folder', { baseName: 'x', size: 5 });
  assert.strictEqual(res.id, 'd1');
  assert.strictEqual(drive.calls.list.length, 1);
  assert.match(drive.calls.list[0], /appProperties has \{ key='zoomFileId' and value='zf' \}/);
  assert.match(drive.calls.list[0], /'folder' in parents and trashed = false/);
});

test('findExisting: untagged legacy file matched by name+size gets tagged', async () => {
  const drive = fakeDrive({ listResults: [[], [
    { id: 'wrong-size', name: '2026_Topic.mp4', size: '1' },
    { id: 'legacy', name: '2026_Topic_01.mp4', size: '4096' },
  ]] });
  const res = await uploader(drive).findExisting('zf', 'folder', { baseName: '2026_Topic', size: 4096 });
  assert.strictEqual(res.id, 'legacy');
  assert.deepStrictEqual(drive.calls.update[0].requestBody, { appProperties: { zoomFileId: 'zf' } });
});

test('findExisting: name match with different size is not treated as existing', async () => {
  const drive = fakeDrive({ listResults: [[], [{ id: 'x', name: '2026_Topic.mp4', size: '1' }]] });
  assert.strictEqual(await uploader(drive).findExisting('zf', 'f', { baseName: '2026_Topic', size: 4096 }), null);
  assert.strictEqual(drive.calls.update.length, 0);
});

test('findExisting: no size known skips the name fallback', async () => {
  const drive = fakeDrive();
  assert.strictEqual(await uploader(drive).findExisting('zf', 'f', { baseName: 'x' }), null);
  assert.strictEqual(drive.calls.list.length, 1);
});

test("findExisting: quotes in ids and names are escaped in the Drive query", async () => {
  const drive = fakeDrive();
  await uploader(drive).findExisting("a'b", 'f', { baseName: "O'Brien", size: 1 });
  assert.match(drive.calls.list[0], /value='a\\'b'/);
  assert.match(drive.calls.list[1], /name contains 'O\\'Brien'/);
});

// ---- Zoom fetcher -------------------------------------------------------
function stubGet(handler) {
  const orig = axios.get;
  const calls = [];
  axios.get = async (url, opts) => { calls.push({ url, params: { ...opts.params } }); return handler(calls.length, url, opts); };
  return { calls, restore: () => { axios.get = orig; } };
}
const fetcher = () => { const f = new ZoomFetcherEnhanced(); f._delay = async () => {}; return f; };

test('fetcher: follows next_page_token and merges pages', async () => {
  const s = stubGet((n) => ({ status: 200, data: n === 1
    ? { meetings: [{ id: 1, start_time: 'a' }], next_page_token: 'tok2' }
    : { meetings: [{ id: 2, start_time: 'b' }], next_page_token: '' } }));
  try {
    const res = await fetcher().fetchAllRecordings('u', '2026-10-01', '2026-10-05', 't');
    assert.deepStrictEqual(res.map((m) => m.id), [1, 2]);
    assert.strictEqual(s.calls[1].params.next_page_token, 'tok2');
  } finally { s.restore(); }
});

test('fetcher: splits long ranges into <=30-day windows and de-duplicates', async () => {
  const s = stubGet(() => ({ status: 200, data: { meetings: [{ id: 7, start_time: 'same' }] } }));
  try {
    const res = await fetcher().fetchAllRecordings('u', '2026-01-01', '2026-03-31', 't');
    assert.strictEqual(s.calls.length, 3); // 90 days = Jan1-30, Jan31-Mar1, Mar2-31
    assert.strictEqual(s.calls.at(-1).params.to, '2026-03-31');
    assert.strictEqual(res.length, 1);
    for (const c of s.calls) {
      const days = (new Date(c.params.to) - new Date(c.params.from)) / 86400000;
      assert.ok(days <= 29, `window too big: ${c.params.from}..${c.params.to}`);
    }
  } finally { s.restore(); }
});

test('fetcher: user id is URL-encoded', async () => {
  const s = stubGet(() => ({ status: 200, data: { meetings: [] } }));
  try {
    await fetcher().fetchAllRecordings('a+b@x.com', '2026-10-01', '2026-10-01', 't');
    assert.strictEqual(s.calls[0].url, 'https://api.zoom.us/v2/users/a%2Bb%40x.com/recordings');
  } finally { s.restore(); }
});

test('fetcher: persistent 429 gives up instead of looping forever', async () => {
  const s = stubGet(() => { throw Object.assign(new Error('429'), { response: { status: 429 } }); });
  try {
    await assert.rejects(fetcher().fetchAllRecordings('u', '2026-10-01', '2026-10-01', 't'));
    assert.ok(s.calls.length < 40, `too many attempts: ${s.calls.length}`);
  } finally { s.restore(); }
});

test('fetcher: non-retryable error (401) fails fast after request retries', async () => {
  const s = stubGet(() => { throw Object.assign(new Error('401'), { response: { status: 401 } }); });
  try {
    await assert.rejects(fetcher().fetchAllRecordings('u', '2026-10-01', '2026-10-01', 't'), /401/);
    assert.strictEqual(s.calls.length, 4); // 1 + MAX_RETRIES
  } finally { s.restore(); }
});
