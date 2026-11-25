# Zoom Drive Backup

Backs up Zoom cloud recordings (MP4) to Google Drive, keeps a copy on local/NAS storage,
and tracks every run in a PostgreSQL-backed web dashboard. Backups can be started four ways:

| Trigger | How |
|---|---|
| Nightly schedule | PM2 app `nightly-backup`, every day at 02:00 |
| Email | Send a mail with "backup" in the subject to the bot mailbox |
| Dashboard | Backups page or Explorer page in the web UI |
| CLI | `node cli.js backup ...` |

Recordings already in Drive are skipped, so every run is incremental.

## How it works

```mermaid
flowchart LR
    subgraph Triggers
        U([You]) -- "email: Topic / Date / UserId" --> MB["mail-bot<br/>(PM2, always on)"]
        U -- "web UI" --> DB["dashboard<br/>(PM2, port 5000)"]
        CRON["nightly-backup<br/>(PM2 cron 02:00)"]
    end

    MB -- "spawns, --source email" --> CLI
    DB -- "spawns via jobQueue" --> CLI
    CRON -- "runs, --source scheduled" --> CLI

    CLI["cli.js backup<br/>one at a time (lock)"]

    subgraph External
        ZOOM[("Zoom Cloud<br/>recordings")]
        DRIVE[("Google Drive<br/>backup folder")]
    end

    ZOOM -- "list + download MP4<br/>(Server-to-Server OAuth)" --> CLI
    CLI -- "skip if already uploaded,<br/>else upload + verify (OAuth)" --> DRIVE
    CLI -- "local copy" --> NAS[("savePath<br/>/mnt/shared/zoom-backups")]
    CLI -- "runs, files, alerts" --> PG[(PostgreSQL)]
    CLI -- "progress_ID.json" --> LOGS[("logs/")]

    PG --> DB
    MB -- "start + result emails" --> U
    MB -. "token refresh, daily health check,<br/>alert emails" .-> External
```

A single email-triggered backup, step by step:

```mermaid
sequenceDiagram
    autonumber
    actor You
    participant Bot as mail-bot
    participant CLI as cli.js backup
    participant Zoom
    participant Drive as Google Drive
    participant DB as PostgreSQL

    You->>Bot: Email "Backup" with Topic / Date / UserId
    Bot->>Bot: Check sender, DMARC, duplicate (5 min)
    Bot-->>You: "Backup started" email
    Bot->>CLI: spawn --backup-id BACKUP-timestamp --source email
    CLI->>CLI: Acquire lock (wait if another backup runs)
    CLI->>Zoom: List recordings (30-day windows, paged)
    loop each MP4 file
        CLI->>Drive: Already uploaded? (zoomFileId tag)
        alt already in Drive
            CLI->>DB: count as skipped
        else new
            CLI->>Zoom: Download to savePath
            CLI->>Drive: Upload (tagged) and verify size
            CLI->>DB: backup_files row (completed / failed)
        end
    end
    CLI->>DB: Final status (success / partial / failed)
    CLI-->>Bot: Exit code 0 / 2 / 1
    Bot->>DB: Read counts for this backup id
    Bot-->>You: Result email (completed / partial / failed)
```

- **`cli.js backup`** does the work: lists recordings, skips files already in Drive (matched by
  the Zoom file id stored on each Drive file), downloads, uploads, verifies size, optionally
  deletes from Zoom, and records progress in `logs/backups/progress_<id>.json` and the database.
- Only one backup runs at a time (lock file `logs/.backup.lock`). A second request waits for
  the running one to finish (up to `BACKUP_LOCK_WAIT_MS`, default 3 h).
- An authorization error (expired Google token, bad Zoom credentials) stops the run at the first
  file with one message explaining how to re-authorize.
- **`mail-bot.js`** polls the inbox every 30 s, starts backups for authorized senders, replies
  with results, refreshes OAuth tokens, and runs a daily health check that emails admins when
  Zoom, Drive, the inbox or disk space have a problem.
- **Dashboard** (`dashboard/`) shows runs, files, alerts, logs and token status, and can start
  backups. Protected by HTTP Basic Auth.

## Applications

Three PM2 apps run from this folder (`ecosystem.config.js`):

| App | What it does | Normal `pm2 status` | Restart it when |
|---|---|---|---|
| `mail-bot` | Reads the inbox every 30 s and runs email-requested backups; sends start/result emails; refreshes Google and Zoom tokens; runs the daily health check; serves `127.0.0.1:3456` health endpoints | `online` | Code or `.env` changed: `pm2 restart mail-bot --update-env` |
| `dashboard` | Web UI and REST API on port 5000 (Basic Auth); starts backups from the UI | `online` | Code, `.env` or UI build changed: `pm2 restart dashboard --update-env` |
| `nightly-backup` | Runs `cli.js backup --source scheduled` every day at 02:00 | `stopped` between runs (normal) | Only to run a backup now: `pm2 restart nightly-backup` |

Every backup, whichever app starts it, runs as a separate `cli.js` process, so backup code
changes apply to the next run without restarting anything. Logs: `logs/pm2/<app>-out.log`,
`logs/pm2/<app>-error.log` and `logs/application/`.

## Requirements

- Node.js 18+ (tested on 24) and PM2
- PostgreSQL 13+
- A Zoom **Server-to-Server OAuth** app with these scopes:
  `cloud_recording:read:list_account_recordings:admin`, `cloud_recording:read:archive_files:admin`,
  `cloud_recording:read:list_recording_files:admin`, `cloud_recording:read:recording:admin`,
  `cloud_recording:read:list_user_recordings:admin`, `user:read:list_users:admin`
  (plus a recording delete scope if you enable `deleteFromZoom`)
- A Google Cloud OAuth client of type **Desktop app** saved as `oauth_credentials.json`, with the
  Drive API enabled. Set the consent screen to **In production**; in "Testing" the refresh token
  expires after 7 days.
- A Gmail account with an **app password** for the email bot (IMAP + SMTP)

## Setup

```bash
npm install
(cd dashboard && npm run install:all && npm run build)

cp config.example.json config.json   # then edit, or run: node cli.js config-setup
# create .env (see below) and place oauth_credentials.json in this folder

node scripts/migrate.js              # create dashboard tables
node cli.js oauth-setup              # authorize Google Drive
node cli.js config-check             # verify configuration
node cli.js backup --dry-run         # list what would be backed up

pm2 start ecosystem.config.js        # mail-bot, dashboard, nightly-backup
pm2 save
```

Full production steps: [docs/operations/DEPLOYMENT_GUIDE.md](docs/operations/DEPLOYMENT_GUIDE.md).

### config.json

| Key | Default | Meaning |
|---|---|---|
| `userId` | — | Zoom user (email or id) whose recordings are backed up |
| `savePath` | `./downloads` | Local/NAS folder for downloaded copies (kept after upload) |
| `googleFolder` | — | Google Drive folder id to upload into |
| `deleteFromZoom` | `false` | Delete each recording file from Zoom after a verified upload |
| `zoomClientId`, `zoomClientSecret`, `zoomAccountId` | — | Zoom S2S app credentials |
| `googleCredentialsPath` | `./oauth_credentials.json` | Checked for existence; the client is always read from `oauth_credentials.json` in the app folder |
| `maxRetries`, `retryDelay` | `3`, `1000` | Download/upload retries and base backoff (ms) |
| `bandwidthLimit` | `0` | Download throttle in bytes/s; 0 = unlimited |
| `minFreeSpaceGB` | `20` | Alert when `savePath` has less free space |

Environment variables `ZOOM_USER_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_ACCOUNT_ID`,
`GOOGLE_DRIVE_FOLDER_ID` and `BACKUP_PATH` override the matching config keys. Without `--date`,
a backup covers the last 365 days.

### .env

```bash
# Zoom (override config.json)
ZOOM_ACCOUNT_ID=...
ZOOM_CLIENT_ID=...
ZOOM_CLIENT_SECRET=...
ZOOM_USER_ID=user@example.com
GOOGLE_DRIVE_FOLDER_ID=...
BACKUP_PATH=/mnt/shared/zoom-backups

# Email bot
EMAIL_USER=bot@gmail.com
EMAIL_PASSWORD=gmail-app-password
ALLOWED_SENDERS=you@example.com          # comma-separated; these addresses also get alert emails
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
REQUIRE_DMARC=true                       # ignore mail whose Authentication-Results lacks dmarc=pass
BACKUP_TIMEOUT_MS=21600000               # kill an email-triggered backup after 6 h
HEALTH_CHECK_HOURS=24                    # daily health check interval
HEALTH_HOST=127.0.0.1                    # health server bind address (port 3456)

# Database
DATABASE_URL=postgres://user:pass@localhost:5432/zoom_backup
ENABLE_DASHBOARD=true                    # false = backups do not write to the database

# Dashboard
DASHBOARD_USER=admin
DASHBOARD_PASSWORD=change-me             # required; the dashboard refuses to start without it
DASHBOARD_HOST=0.0.0.0
DASHBOARD_PORT=5000                      # also set in ecosystem.config.js
# DASHBOARD_TLS_CERT=/path/cert.pem      # optional HTTPS (both required)
# DASHBOARD_TLS_KEY=/path/key.pem
# ALLOWED_ORIGINS=https://host           # CORS in production; default same-origin only

# Tokens and misc
APP_SECRET=long-random-string            # encrypts token.json; see scripts/encrypt-tokens.js
BACKUP_LOCK_WAIT_MS=10800000             # how long a backup waits for a running one (0 = fail at once)
LOG_LEVEL=info
```

## Usage

### CLI

```bash
node cli.js backup                          # everything from the last 365 days
node cli.js backup --topic "Physics"        # topic contains "Physics" (case-insensitive)
node cli.js backup --date 2026-09-01        # from this date until today
node cli.js backup --user other@example.com # a different Zoom user
node cli.js backup --dry-run                # list only; nothing downloaded, uploaded or deleted
node cli.js config-check                    # validate configuration
node cli.js config-setup                    # interactive config.json editor
node cli.js oauth-setup                     # (re)authorize Google Drive
```

Options used by the other triggers: `--backup-id <id>` (link to a dashboard/email record),
`--files <base64 json>` (specific recordings, sent by the dashboard), `--source <name>`
(trigger recorded in the dashboard, e.g. `scheduled`).

Exit codes: `0` all files succeeded or nothing to do, `2` some files failed, `1` failed or invalid
input. The failure reason is printed to stderr as `BACKUP FAILED: ...`.

### Email

Send to `EMAIL_USER` from an address in `ALLOWED_SENDERS`. The subject must contain "backup".
Put the parameters in the body (or subject), one per line:

```
Topic: Physics Lecture
Date: 2026-09-01
UserId: teacher@example.com
```

- `Topic` or `Date` is required; `UserId` defaults to the configured user.
- `Date` means "from that date until today".
- Identical requests within 5 minutes are skipped.
- Mail from other senders, or without `dmarc=pass`, is ignored and marked as read.
- Plain-text, HTML and quoted-printable mail are all understood.

Replies come from "Zoom Drive Backup" and use one layout (`src/emailTemplate.js`): status badge,
headline numbers, request details, notes, and the backup id as `Reference`. Each has a
plain-text version.

| Reply | Subject |
|---|---|
| Started | `Backup started: <topic> [BACKUP-…]` |
| Completed | `Backup completed: <topic> - 2 file(s), 429.48 MB [BACKUP-…]` |
| Partially completed | `Backup partially completed: <topic> - 2 succeeded, 1 failed [BACKUP-…]` (lists each failed file and reason) |
| Nothing found | `Backup completed: no recordings found for <topic> [BACKUP-…]` (with what to check) |
| Failed | `Backup failed: <topic> [BACKUP-…]` (with the error and what to try) |
| Duplicate | `Backup request skipped (duplicate): <topic>` |
| Bad format | `Backup request not understood` (with an example) |

### Dashboard

Open `http://<server>:5000` and log in with `DASHBOARD_USER` / `DASHBOARD_PASSWORD`.
See [dashboard/README.md](dashboard/README.md).

### Nightly backup

`nightly-backup` runs `node cli.js backup --source scheduled` at 02:00 server time (`cron_restart`
in `ecosystem.config.js`). It has `autorestart: false`: it runs one backup, exits, and shows
`stopped` until the next run. PM2 also runs it once whenever the app is (re)started.

- Failures, except "another backup is running", are emailed to `ALLOWED_SENDERS`.
- If an email or dashboard backup is running at 02:00, the nightly run waits for it.
- Check the last run: `pm2 describe nightly-backup` (the `restarts` count goes up by one each
  night), the newest `logs/backups/progress_backup_*.json`, or Dashboard → Backups (trigger
  `scheduled`).
- Change the time: edit `cron_restart`, then
  `pm2 delete nightly-backup && pm2 start ecosystem.config.js --only nightly-backup && pm2 save`.

## Operations

```bash
pm2 status
pm2 logs mail-bot                              # bot, token refresh, health check
pm2 restart mail-bot dashboard --update-env
npm run token:status                           # Google token status (also token:refresh)
npm run cleanup:logs                           # log/progress retention (cleanup:logs:dry to preview)
npm test                                       # test suite, no network access needed
```

| Where | What |
|---|---|
| `logs/application/combined-YYYY-MM-DD.log`, `error-*.log` | Application logs (30-day rotation) |
| `logs/pm2/*.log` | Process stdout/stderr |
| `logs/backups/progress_<id>.json` | Per-run progress with uploaded and failed files |
| `logs/history/backup-history.json` | Last 1000 runs |
| `http://127.0.0.1:3456/health`, `/metrics`, `/token/status` | Health server (inside mail-bot) |

More: [health checks](docs/operations/HEALTH_CHECK_GUIDE.md),
[tokens and re-authorization](docs/operations/OAUTH_TOKEN_REFRESH.md),
[database](docs/setup/DATABASE_SETUP.md), [NAS mount](docs/setup/MOUNT_SETUP_GUIDE.md).

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Google Drive authorization expired" email or health alert | Re-authorize: Dashboard → Auth & Tokens, or `node cli.js oauth-setup` |
| Email backup reports "No recordings found" | Zoom keeps cloud recordings for a limited time; check the topic spelling and the date |
| Health alert "Mail polling" | IMAP login failing: check `EMAIL_PASSWORD` (app password), then `pm2 logs mail-bot` |
| Dashboard does not start | `DASHBOARD_PASSWORD` missing from `.env` |
| `nightly-backup` shows `stopped` | Normal between runs; it starts again at 02:00 |
| "Another backup operation is already in progress" | The running backup took longer than `BACKUP_LOCK_WAIT_MS`. A lock left by a crashed process is cleared automatically |
| `APP_SECRET is required to decrypt this token` | `.env` was not loaded; run commands from this folder |

## Project structure

```
cli.js                    Backup CLI (backup, config-check, config-setup, oauth-setup)
mail-bot.js               Email trigger, token refresh, daily health check
ecosystem.config.js       PM2 apps: mail-bot, dashboard, nightly-backup
src/
  backupOrchestrator.js   Backup workflow (list, skip, download, upload, record)
  zoomAuth.js             Zoom S2S access token
  zoomFetcher.js          Zoom recordings API (pagination, 30-day windows)
  fileDownloader.js       Download with retry and validation
  driveUploader.js        Drive upload, verification, duplicate lookup
  dashboardClient.js      Writes runs, files and alerts to PostgreSQL
  emailTemplate.js        Shared HTML/plain-text layout for all emails
  configManager.js, validation.js, errorHandler.js, logger.js
services/
  googleAuthService.js    Google OAuth client and token refresh
  zoomTokenRefreshService.js
  healthMonitor.js        Daily health check and admin alerts
  notificationService.js  Alert emails
  healthCheckServer.js    HTTP health endpoints (port 3456)
utils/                    Lock, progress files, file naming, token files, history
scripts/
  migrate.js              Create database tables
  token-manager.js        Token status / refresh / backup / restore
  encrypt-tokens.js       Encrypt token files with APP_SECRET
  log-cleanup.js          Log and progress-file retention
dashboard/                Express API (server/) and React UI (client/)
test/                     node:test suite
docs/                     Setup and operations guides
```

## License

MIT
