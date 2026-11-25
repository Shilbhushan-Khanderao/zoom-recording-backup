# Health Checks and Alerts

Three layers report problems without waiting for someone to request a backup:

1. **Daily health check** (inside `mail-bot`): end-to-end checks, emails admins on failure.
2. **Alert emails** for token refresh failures and failed nightly backups.
3. **Health endpoints** for manual checks and external monitors.

All alert emails go to every address in `ALLOWED_SENDERS`, sent from `EMAIL_USER`.

## Daily health check

Runs 2 minutes after `mail-bot` starts, then every `HEALTH_CHECK_HOURS` (default 24).
Code: `services/healthMonitor.js`.

| Check | Passes when | Typical failure |
|---|---|---|
| Zoom API | A Zoom token is obtained and today's recordings for `userId` can be listed | Wrong or deactivated Zoom app credentials, missing scopes |
| Google Drive | The Google token works and the backup folder (`googleFolder`) is reachable | Expired/revoked refresh token, folder deleted or unshared |
| Mail polling | The inbox was checked successfully within the last 7 hours | IMAP login failure (app password revoked), network |
| Disk space | `savePath` has at least `minFreeSpaceGB` free (default 20) | NAS full or unmounted |

Result in the log (`pm2 logs mail-bot` or `logs/application/combined-*.log`):

```
Health check passed: Zoom API, Google Drive, Mail polling, Disk space
Health check failed  {"failed":[{"name":"Google Drive","error":"invalid_grant"}]}
```

On failure an email titled `🚨 Zoom backup health check failed: <checks>` lists each failing
check and its error. The same set of failures is emailed at most once per 24 hours; the
throttle resets when `mail-bot` restarts.

To run the checks on demand, restart the bot (`pm2 restart mail-bot`) and read the log two
minutes later.

## Other alerts

| Email | Sent by | When |
|---|---|---|
| `🚨 CRITICAL: Google Drive Token Refresh Failed` | `services/googleAuthService.js` | Refresh returns `invalid_grant`, or 5 refreshes fail in a row |
| `❌ Scheduled Zoom backup failed` | `cli.js` (nightly run) | The nightly backup fails (not when another backup is already running) |
| `⚠️ Scheduled Zoom backup had failures` | `cli.js` (nightly run) | Some files failed; lists each file and reason |
| Backup result emails | `mail-bot.js` | Every email-triggered backup (sent to the requester) |

Failed runs and low disk space are also recorded on the dashboard **Alerts** page.

## Health endpoints

### mail-bot health server (`127.0.0.1:3456`)

Bound to localhost (`HEALTH_HOST`). From another machine, use an SSH tunnel.

```bash
curl -s http://127.0.0.1:3456/health
# {"status":"healthy","uptime":2914,"timestamp":"...","service":"zoom-backup-system"}

curl -s http://127.0.0.1:3456/metrics
# {"uptime":..., "tokenService":{"refreshCount":..,"successCount":..,"failureCount":..,
#   "lastRefreshTime":..,"consecutiveFailures":0,"isRunning":true,"successRate":"100%"}}

curl -s http://127.0.0.1:3456/token/status
# {"exists":true,"valid":true,"expired":false,"needsRefresh":false,"expiresIn":42,
#  "expiryDate":"...","hasRefreshToken":true,"message":"..."}
```

`/health` only means the process is up. `/token/status` describes the stored Google access
token (`expiresIn` in minutes). A briefly expired access token is harmless; it is refreshed on
the next check or the next use. `hasRefreshToken: false` means Google Drive must be re-authorized.

### Dashboard

- `GET /api/health` (no auth): the dashboard process is up.
- `GET /api/system/health`, `/api/tokens/status`, `/api/auth/status` (Basic Auth): server and
  token status, as shown on the System and Auth & Tokens pages.

## External monitoring

An uptime monitor can poll `http://<server>:5000/api/health` (no credentials needed). For deeper
checks, run a cron job on the server, for example:

```bash
*/15 * * * * curl -sf http://127.0.0.1:3456/health >/dev/null || echo "mail-bot down" | mail -s "zoom-backup" admin@example.com
```

## When an alert arrives

| Alert | Action |
|---|---|
| Google Drive / token refresh | Re-authorize: Dashboard → Auth & Tokens, or `node cli.js oauth-setup` ([details](OAUTH_TOKEN_REFRESH.md)) |
| Zoom API | Check that the Zoom Marketplace app is active and its credentials match `.env` / `config.json` |
| Mail polling | Check `EMAIL_PASSWORD` (Gmail app password) and `pm2 logs mail-bot` for IMAP errors |
| Disk space | Free space on `BACKUP_PATH`, or remount the NAS ([mount guide](../setup/MOUNT_SETUP_GUIDE.md)) |
| Scheduled backup failed | The email contains the reason; also see the dashboard Backups page |
