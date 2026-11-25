// Email layout: escaping, Gmail auto-link suppression, plain-text part.
const test = require('node:test');
const assert = require('node:assert');
const { renderEmail } = require('../src/emailTemplate');

const sample = () => renderEmail({
  tone: 'warning',
  title: 'Backup <partially> completed',
  intro: 'Tom & Jerry',
  stats: [['Uploaded', '1'], ['Failed', '1']],
  details: [['Topic', 'MS.NET'], ['Zoom user', 'a@b.com']],
  notice: { title: 'Recordings that failed', items: ['<x>.mp4: boom'], text: 'Retry later' },
  code: { title: 'Error details', text: 'Error: "quoted" <tag>' },
  reference: 'BACKUP-1',
});

test('all text is HTML-escaped', () => {
  const { html } = sample();
  for (const raw of ['<partially>', 'Tom & Jerry', '<x>', '"quoted" <tag>']) assert.ok(!html.includes(raw), raw);
  assert.ok(html.includes('Backup &lt;partially&gt; completed'));
  assert.ok(html.includes('Error: &quot;quoted&quot; &lt;tag&gt;'));
});

test('dots and @ in values get a word joiner so Gmail does not auto-link them', () => {
  const { html } = sample();
  assert.ok(html.includes('MS.&#8288;NET'));
  assert.ok(html.includes('a@&#8288;b.&#8288;com'));
});

test('plain-text part carries the same content without markup', () => {
  const { text } = sample();
  assert.ok(!/<(td|tr|table|div|span|pre|ul|li|h1|p)\b/.test(text));
  for (const s of ['ATTENTION', 'Backup <partially> completed', 'Topic: MS.NET', 'Failed: 1', '  - <x>.mp4: boom', 'Reference: BACKUP-1']) {
    assert.ok(text.includes(s), s);
  }
});

test('every tone renders and badge falls back to the tone label', () => {
  for (const tone of ['success', 'warning', 'error', 'info', 'neutral', 'bogus']) {
    const { html } = renderEmail({ tone, title: 'T' });
    assert.match(html, /<h1[^>]*>T<\/h1>/);
  }
  assert.match(renderEmail({ tone: 'success', title: 'T' }).html, />Completed</);
  assert.match(renderEmail({ tone: 'info', title: 'T', status: 'Running' }).html, />Running</);
});

test('optional sections are omitted when not given', () => {
  const { html } = renderEmail({ title: 'Only title' });
  assert.ok(!html.includes('<pre') && !html.includes('<ul') && !html.includes('Reference:'));
});
