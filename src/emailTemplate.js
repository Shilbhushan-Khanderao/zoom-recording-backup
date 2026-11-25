/**
 * Shared layout for every email the bot sends.
 * Table-based with inline styles so it renders the same in Gmail, Outlook and mobile clients.
 * All text passed in is HTML-escaped here; callers pass plain strings.
 */

const TONES = {
  success: { accent: '#15803d', soft: '#f0fdf4', label: 'Completed' },
  warning: { accent: '#b45309', soft: '#fffbeb', label: 'Attention' },
  error: { accent: '#b91c1c', soft: '#fef2f2', label: 'Failed' },
  info: { accent: '#1d4ed8', soft: '#eff6ff', label: 'In progress' },
  neutral: { accent: '#475569', soft: '#f8fafc', label: 'Notice' },
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "SFMono-Regular,Consolas,'Liberation Mono',Menlo,monospace";

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Gmail turns "MS.NET" and addresses into links; an invisible word joiner after
// "." and "@" stops that without changing what the reader sees
const noAutoLink = (html) => html.replace(/([.@])/g, '$1&#8288;');

function formatDateTime(date) {
  return date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * @param {object} opts
 * @param {'success'|'warning'|'error'|'info'|'neutral'} opts.tone
 * @param {string} opts.title             Headline
 * @param {string} [opts.status]          Badge text (defaults per tone)
 * @param {string} [opts.intro]           One-sentence summary under the title
 * @param {Array<[string,string]>} [opts.stats]    Up to 3 headline numbers: [label, value]
 * @param {Array<[string,string]>} [opts.details]  Key/value rows
 * @param {{title:string, items?:string[], text?:string}} [opts.notice]  Tinted panel
 * @param {{title?:string, text:string}} [opts.code]  Monospace block (errors, examples)
 * @param {string} [opts.reference]       Session id shown in the footer
 * @returns {{html: string, text: string}}
 */
function renderEmail({ tone = 'neutral', title, status, intro, stats = [], details = [], notice, code, reference }) {
  const t = TONES[tone] || TONES.neutral;
  const e = escapeHtml;

  const statsHtml = stats.length ? `
          <tr><td style="padding:0 32px 8px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:8px 0;">
              <tr>${stats.map(([label, value]) => `
                <td width="${Math.floor(100 / stats.length)}%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 12px;text-align:center;">
                  <div style="font-size:20px;line-height:26px;font-weight:600;color:#0f172a;">${e(value)}</div>
                  <div style="font-size:11px;line-height:16px;color:#64748b;text-transform:uppercase;letter-spacing:.04em;">${e(label)}</div>
                </td>`).join('')}
              </tr>
            </table>
          </td></tr>` : '';

  const detailsHtml = details.length ? `
          <tr><td style="padding:16px 32px 8px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;line-height:20px;">
              ${details.map(([k, v], i) => `
              <tr>
                <td style="padding:9px 0;color:#64748b;width:38%;vertical-align:top;${i ? 'border-top:1px solid #f1f5f9;' : ''}">${e(k)}</td>
                <td style="padding:9px 0;color:#0f172a;font-weight:500;word-break:break-word;${i ? 'border-top:1px solid #f1f5f9;' : ''}">${noAutoLink(e(v))}</td>
              </tr>`).join('')}
            </table>
          </td></tr>` : '';

  const noticeHtml = notice ? `
          <tr><td style="padding:12px 32px 8px;">
            <div style="background:${t.soft};border-left:3px solid ${t.accent};border-radius:6px;padding:14px 16px;">
              <div style="font-size:14px;line-height:20px;font-weight:600;color:${t.accent};">${e(notice.title)}</div>
              ${notice.text ? `<div style="margin-top:6px;font-size:13px;line-height:20px;color:#334155;">${e(notice.text)}</div>` : ''}
              ${notice.items?.length ? `<ul style="margin:8px 0 0;padding-left:18px;font-size:13px;line-height:20px;color:#334155;">${notice.items.map((i) => `<li style="margin:2px 0;">${noAutoLink(e(i))}</li>`).join('')}</ul>` : ''}
            </div>
          </td></tr>` : '';

  const codeHtml = code ? `
          <tr><td style="padding:12px 32px 8px;">
            ${code.title ? `<div style="font-size:13px;font-weight:600;color:#334155;margin-bottom:6px;">${e(code.title)}</div>` : ''}
            <pre style="margin:0;background:#0f172a;color:#e2e8f0;border-radius:6px;padding:12px 14px;font-family:${MONO};font-size:12px;line-height:18px;white-space:pre-wrap;word-break:break-word;">${e(code.text)}</pre>
          </td></tr>` : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;font-family:${FONT};color:#0f172a;">
        <tr><td style="height:4px;background:${t.accent};border-radius:10px 10px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:20px 32px 0;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#64748b;">Zoom Drive Backup</td></tr>
        <tr><td style="padding:12px 32px 4px;">
          <span style="display:inline-block;background:${t.soft};color:${t.accent};border:1px solid ${t.accent};border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600;">${e(status || t.label)}</span>
          <h1 style="margin:10px 0 0;font-size:22px;line-height:30px;font-weight:600;color:#0f172a;">${e(title)}</h1>
          ${intro ? `<p style="margin:8px 0 0;font-size:15px;line-height:22px;color:#475569;">${e(intro)}</p>` : ''}
        </td></tr>
        <tr><td style="height:16px;font-size:0;line-height:0;">&nbsp;</td></tr>${statsHtml}${detailsHtml}${noticeHtml}${codeHtml}
        <tr><td style="padding:24px 32px;">
          <div style="border-top:1px solid #e2e8f0;padding-top:16px;font-size:12px;line-height:18px;color:#94a3b8;">
            ${reference ? `Reference: <span style="font-family:${MONO};color:#64748b;">${e(reference)}</span><br>` : ''}
            Automated message from the Zoom Drive Backup system.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `ZOOM DRIVE BACKUP - ${(status || t.label).toUpperCase()}`,
    '',
    title,
    intro || '',
    '',
    ...stats.map(([l, v]) => `${l}: ${v}`),
    ...(stats.length ? [''] : []),
    ...details.map(([k, v]) => `${k}: ${v}`),
    ...(notice ? ['', notice.title, ...(notice.text ? [notice.text] : []), ...(notice.items || []).map((i) => `  - ${i}`)] : []),
    ...(code ? ['', ...(code.title ? [code.title] : []), code.text] : []),
    '',
    ...(reference ? [`Reference: ${reference}`] : []),
    'Automated message from the Zoom Drive Backup system.',
  ].join('\n').replace(/\n{3,}/g, '\n\n');

  return { html, text };
}

module.exports = { renderEmail, escapeHtml, formatDateTime };
