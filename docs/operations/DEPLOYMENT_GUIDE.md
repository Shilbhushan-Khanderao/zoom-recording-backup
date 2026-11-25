# Deployment Guide

The system runs on one Linux server under PM2, from the `zoom-recording-backup/` folder. All three PM2 apps
use that folder as their working directory, so `.env`, `config.json`, token files and `logs/`
live there.

## PM2 apps (`ecosystem.config.js`)

| App | Script | Runs | Notes |
|---|---|---|---|
| `mail-bot` | `mail-bot.js` | always | Email trigger, token refresh, daily health check, health server on `127.0.0.1:3456`. Restarts above 500 MB |
| `dashboard` | `dashboard/server/index.js` | always | Web UI + API on port 5000. Restarts above 300 MB |
| `nightly-backup` | `cli.js backup --source scheduled` | 02:00 daily (`cron_restart`), `autorestart: false` | Also runs once whenever PM2 (re)starts it |

Logs: `logs/pm2/<app>-out.log` and `<app>-error.log`, plus `logs/application/`.

## First install

```bash
git clone https://github.com/Shilbhushan-Khanderao/zoom-recording-backup.git && cd zoom-recording-backup
npm install
(cd dashboard && npm run install:all && npm run build)
```

1. **Configuration**: create `config.json` (from `config.example.json` or `node cli.js config-setup`)
   and `.env` (all variables are listed in the [README](../../README.md#env)). At minimum: Zoom
   credentials, `GOOGLE_DRIVE_FOLDER_ID`, `BACKUP_PATH`, `EMAIL_USER`, `EMAIL_PASSWORD`,
   `ALLOWED_SENDERS`, `DATABASE_URL`, `DASHBOARD_PASSWORD`, `APP_SECRET`.
2. **Secret file permissions**: `chmod 600 .env oauth_credentials.json config.json`.
3. **Storage**: make sure `BACKUP_PATH` exists and is writable (NAS: [MOUNT_SETUP_GUIDE](../setup/MOUNT_SETUP_GUIDE.md)).
4. **Database**: follow [DATABASE_SETUP](../setup/DATABASE_SETUP.md), then `node scripts/migrate.js`.
5. **Google Drive**: put `oauth_credentials.json` in the folder and run `node cli.js oauth-setup`.
   If token files were created before `APP_SECRET` was set, run `node scripts/encrypt-tokens.js`.
6. **Verify**:
   ```bash
   node cli.js config-check
   node cli.js backup --dry-run --date $(date -d '-7 days' +%F)
   npm test
   ```
7. **Start and enable on boot**:
   ```bash
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup          # run the printed command once so PM2 starts after a reboot
   ```

## Updating

```bash
cd zoom-recording-backup
git pull
npm install
(cd dashboard && npm run install:all && npm run build)   # only if the dashboard changed
node scripts/migrate.js                                  # safe to re-run
npm test
pm2 restart mail-bot dashboard --update-env
pm2 save
```

- Backups started after the update use the new code automatically (each backup is a fresh
  `cli.js` process); only `mail-bot` and `dashboard` need a restart.
- Do not restart `nightly-backup` casually: a restart starts a backup immediately.
- Avoid restarting while a backup runs (`logs/.backup.lock` exists). An email-triggered backup
  is a child process of `mail-bot` and stops with it.

Rollback: `git checkout <previous-commit>` and repeat the restart step.

## Checks after deploying

```bash
pm2 status                                          # all apps online
curl -s http://127.0.0.1:3456/health                # mail-bot health server
curl -s http://127.0.0.1:5000/api/health            # dashboard (no auth needed)
pm2 logs mail-bot --lines 50 | grep -i "health check"
```

About two minutes after `mail-bot` starts, the log shows
`Health check passed: Zoom API, Google Drive, Mail polling, Disk space`, or an alert email naming
the failing check is sent to `ALLOWED_SENDERS`.

## Common changes

| Change | How |
|---|---|
| Nightly time | Edit `cron_restart` in `ecosystem.config.js`, then `pm2 delete nightly-backup && pm2 start ecosystem.config.js --only nightly-backup && pm2 save` |
| Dashboard port | `DASHBOARD_PORT` in the `dashboard` env block of `ecosystem.config.js` |
| Local-only dashboard | `DASHBOARD_HOST=127.0.0.1` in `.env`, then restart `dashboard` |
| HTTPS dashboard | `DASHBOARD_TLS_CERT` and `DASHBOARD_TLS_KEY` in `.env`, then restart `dashboard` |
| Pause email triggers | `pm2 stop mail-bot` (this also stops token refresh and health checks) |

## Housekeeping

- `npm run cleanup:logs` deletes progress files older than 7 days, compresses logs older than
  1 day and deletes compressed logs older than 30 days (`npm run cleanup:logs:dry` previews it).
  The dashboard Logs page can run it too.
- Local copies in `BACKUP_PATH` are never deleted by the app; the daily health check alerts when
  free space drops below `minFreeSpaceGB` (default 20 GB).
