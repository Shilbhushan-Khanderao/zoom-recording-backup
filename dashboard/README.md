# Zoom Backup Dashboard

Web UI and REST API for monitoring and starting backups. The API server (`server/`, Express)
reads the PostgreSQL database that backups write to and serves the built React app
(`client/`, Vite + TypeScript + Tailwind) from `client/dist`.

## Pages

| Page | What it shows |
|---|---|
| Dashboard | Overview, daily/weekly charts, running backup |
| Backups | Run history with per-file details; start a backup by topic / date / user |
| System | Server disk, memory and process status |
| Explorer | Browse a Zoom user's recordings and back up selected files |
| Auth & Tokens | Google Drive and Zoom auth status; re-authorize Google Drive |
| Logs | Recent application logs, errors, search |
| Alerts | Backup failures, low disk and other alerts; resolve / reopen |

## Running

Production runs under PM2 as the `dashboard` app (see `../ecosystem.config.js`):

```bash
cd ..                               # node-cli/
(cd dashboard && npm run build)     # rebuild client/dist after UI changes
pm2 restart dashboard --update-env
```

Development (API on 5000, Vite on 3000 proxying `/api`):

```bash
cd dashboard
npm run install:all
npm run dev
```

## Configuration

Read from `../.env` (loaded by `server/index.js`):

| Variable | Default | |
|---|---|---|
| `DASHBOARD_PASSWORD` | — | **Required.** The server exits if it is not set |
| `DASHBOARD_USER` | `admin` | Basic Auth user |
| `DASHBOARD_PORT` | `5000` | |
| `DASHBOARD_HOST` | `0.0.0.0` | Use `127.0.0.1` to allow local access only |
| `DASHBOARD_TLS_CERT`, `DASHBOARD_TLS_KEY` | — | Serve HTTPS when both are set |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/zoom_backup` | |
| `ALLOWED_ORIGINS` | — | Comma-separated CORS origins in production; otherwise same-origin only |
| `NODE_ENV` | — | `production` hides error details in API responses |

## Security

- Everything except `GET /api/health` (the web app and every other API route) requires HTTP
  Basic Auth. Credentials are compared in constant time.
- Over plain HTTP the password crosses the network readable by anyone on it. Use
  `DASHBOARD_TLS_CERT`/`DASHBOARD_TLS_KEY`, a reverse proxy with HTTPS, or `DASHBOARD_HOST=127.0.0.1`
  plus an SSH tunnel.
- `/api/zoom/recordings` removes meeting passwords and passcodes before responding.
- Backup triggers are rate-limited to 5 per 5 minutes; all API routes to 100 per minute.

## API

All paths are under `/api`. Request bodies are JSON.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness (no auth) |
| GET | `/dashboard/overview`, `/dashboard/stats/daily`, `/dashboard/stats/weekly` | Summary and charts |
| GET | `/backups?page=&limit=&status=&trigger=` | Run history |
| GET | `/backups/running` | Running backup and progress (runs older than 12 h are marked failed) |
| GET | `/backups/:id`, `/backups/:id/files` | Run details and files |
| POST | `/backups/trigger` | Start a backup. Body: `{ topic?, date? (YYYY-MM-DD), userId?, dryRun? }` |
| POST | `/backups/trigger-specific` | Back up chosen files. Body: `{ files: [{ meetingId, fileId, topic?, startTime?, downloadUrl?, fileSize? }], dryRun? }` |
| GET | `/events` | Server-sent events (`connected`, `heartbeat`, backup updates) |
| GET | `/zoom/users` | Licensed Zoom users |
| GET | `/zoom/recordings?userId=&fromDate=&toDate=&topic=` | Recordings (default: last 8 months) |
| GET | `/auth/status` | Google / Zoom token validity |
| GET | `/auth/google/url` | Google consent URL |
| POST | `/auth/google/callback` | Body: `{ code }` — save a new Google token |
| GET | `/tokens/status`, `/tokens/zoom/status`, `/tokens/metrics`, `/tokens/history` | Token details |
| POST | `/tokens/refresh` | Refresh the Google token now (runs `scripts/token-manager.js refresh`) |
| GET | `/alerts`, `/alerts/active`, `/alerts/stats` | Alerts |
| POST | `/alerts/:id/reopen`, `/alerts/resolve-all` | Manage alerts |
| DELETE | `/alerts/:id` | Delete an alert |
| GET | `/system/health`, `/system/disk`, `/system/memory`, `/system/processes` | Server status |
| GET | `/logs/recent`, `/logs/errors`, `/logs/search?query=&days=`, `/logs/files` | Logs from `../logs/application` |
| DELETE | `/logs/cleanup` | Run `scripts/log-cleanup.js` |

`POST /backups/trigger*` returns `202 { backupId }`, `409` if a backup is already running and
`422` for invalid input. The backup itself runs as a separate `cli.js` process.

## Re-authorizing Google Drive

1. Open **Auth & Tokens** and click to get the authorization link.
2. Sign in with the Google account that owns the backup folder and allow access.
3. The browser is redirected to `http://localhost/?code=...` (the page may not load; that is
   expected). Copy the `code` value from the address bar.
4. Paste it into the dashboard and submit.

The same flow is available on the server with `node cli.js oauth-setup`.

## Database

Tables are created by `node scripts/migrate.js`. Schema and useful queries:
[../docs/setup/DATABASE_SETUP.md](../docs/setup/DATABASE_SETUP.md).

## Structure

```
dashboard/
  package.json            Workspace scripts (dev, build, install:all)
  server/
    index.js              Entry: loads .env, checks DASHBOARD_PASSWORD, starts HTTP(S)
    app.js                Middleware (helmet, CORS, rate limits, Basic Auth), routes, static files
    middlewares/          basicAuth.js, validate.js (Joi)
    routes/               dashboard, backups, events, zoom, auth, tokens, alerts, system, logs
    services/             jobQueue (spawns cli.js), backupService, dashboardService
    repositories/         SQL queries
    utils/                dbConnection (pg pool), logger
  client/
    src/pages/            Dashboard, Backups, System, Explorer, Auth, Logs, Alerts
    src/services/api.ts   API client
    dist/                 Built app served by the API server
```
