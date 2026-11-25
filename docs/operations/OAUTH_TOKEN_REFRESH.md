# Tokens and Re-authorization

The system holds two kinds of credentials:

| | Google Drive | Zoom |
|---|---|---|
| Type | OAuth 2.0 user consent (Desktop app client) | Server-to-Server OAuth (account credentials) |
| Long-lived secret | Refresh token in `token.json` | Client ID / secret / account ID in `.env` or `config.json` |
| Access token | 1 hour, stored in `token.json` | 1 hour, stored in `zoom_token.json` |
| Backup copy | `token.backup.json` | `zoom_token.backup.json` |
| Can stop working for good? | Yes: a person must re-authorize | No: a new token is requested automatically |
| Code | `services/googleAuthService.js` | `src/zoomAuth.js`, `services/zoomTokenRefreshService.js` |

All files live in the app folder (`APP_ROOT`, default: the working directory).

## How refresh works

- **`mail-bot` is the only process with refresh timers**; the dashboard and backups only load
  the tokens. Google is checked every 30 minutes and refreshed when less than 35 minutes remain.
  Zoom is checked every 20 minutes and refreshed when less than 25 minutes remain.
- **On use**, the Google client refreshes an expired access token by itself and saves it, and
  Zoom requests a new token when the saved one has expired. Backups therefore work even if
  `mail-bot` is down.
- **Writes are atomic** (temporary file + rename), so a crash or two processes writing at once
  never leave a half-written token.
- **Encryption**: with `APP_SECRET` set, token files are written AES-256-GCM encrypted; plain JSON
  files are still read. To encrypt existing files once: `node scripts/encrypt-tokens.js`.
  If `APP_SECRET` is lost or changed, the files can no longer be decrypted: re-authorize Google
  Drive (the Zoom token is replaced automatically).
- If a Google refresh fails, the service retries every 30 minutes, falls back to
  `token.backup.json`, and emails `ALLOWED_SENDERS` on `invalid_grant` or after 5 failures in a
  row. The daily health check reports it too, and backups stop at the first file with
  "Google Drive authorization expired - re-authorize ...".

## When Google Drive must be re-authorized

The refresh token stops working (`invalid_grant`) when:

- the OAuth consent screen is in **Testing** mode (tokens expire after 7 days); set it to
  **In production** in Google Cloud Console;
- access was removed at <https://myaccount.google.com/permissions>, or the account was disabled;
- the token was not used for 6 months (only possible if every process was stopped that long);
- the OAuth client in `oauth_credentials.json` was deleted or its secret was reset.

### Re-authorize from the dashboard

1. Dashboard → **Auth & Tokens** → get the authorization link.
2. Sign in with the Google account that owns the backup folder and allow access.
3. The browser goes to `http://localhost/?code=...`. The page may not load; that is expected.
   Copy the value of `code` from the address bar.
4. Paste it into the dashboard and submit.

### Re-authorize on the server

```bash
cd zoom-recording-backup
node cli.js oauth-setup        # prints the link, then asks for the code (same steps 2 and 3)
```

Nothing needs restarting afterwards: each process reads `token.json` again when it next needs
it. To make `mail-bot` pick it up immediately: `pm2 restart mail-bot`.

Scopes requested: `drive.file` (files this app creates) and `drive.metadata.readonly`
(to check the backup folder).

## Token manager

```bash
npm run token:status                        # = node scripts/token-manager.js status
npm run token:refresh                       # refresh the Google token now
node scripts/token-manager.js check         # refresh only if needed
node scripts/token-manager.js backup        # copy token.json to token.backup.json
node scripts/token-manager.js restore       # restore token.json from the backup
```

## Zoom credentials

Nothing to re-authorize. If the Zoom health check or a backup fails with `Invalid credentials`,
`Invalid request. Please check your Account ID` or `Missing required Zoom API scopes`, fix the
Server-to-Server app in the Zoom Marketplace (active, with the scopes listed in the README) and
update `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` and `ZOOM_ACCOUNT_ID`.

## Where to see status

- Dashboard → **Auth & Tokens**
- `curl -s http://127.0.0.1:3456/token/status` and `/metrics` (see [HEALTH_CHECK_GUIDE](HEALTH_CHECK_GUIDE.md))
- Logs: `grep -i token logs/application/combined-$(date +%F).log`
