# Dashboard Database (PostgreSQL)

Backups record their runs, files and alerts in PostgreSQL; the dashboard reads them. The
backup itself does not depend on the database: if it is unreachable, backups still run and
only the dashboard history is missing. Set `ENABLE_DASHBOARD=false` to skip it entirely.

## Setup

```bash
sudo apt install postgresql
sudo -u postgres psql <<'SQL'
CREATE USER zoom_backup WITH PASSWORD 'choose-a-password';
CREATE DATABASE zoom_backup OWNER zoom_backup;
SQL
```

Add to `.env`:

```bash
DATABASE_URL=postgres://zoom_backup:choose-a-password@localhost:5432/zoom_backup
```

Create the tables (safe to re-run; it only creates what is missing):

```bash
node scripts/migrate.js
```

Without `DATABASE_URL` everything falls back to `postgres://postgres:postgres@localhost:5432/zoom_backup`.

## Who writes what

| Writer | Rows |
|---|---|
| Dashboard trigger (`jobQueue`) | Creates the `backups` row (`BACKUP-<timestamp>`) before starting `cli.js` |
| `cli.js` (`src/dashboardClient.js`) | Creates/updates the `backups` row, adds one `backup_files` row per file (`completed` or `failed`), updates progress, sets the final status, adds an `alerts` row when a run fails or disk space is low |
| Email bot | Passes its `BACKUP-<timestamp>` id to `cli.js` and reads `backup_files` for the result email |
| Dashboard | Reads everything; resolves/deletes alerts; marks runs stuck in `running` for over 12 h as `failed` |

## Schema

### backups

| Column | Type | Notes |
|---|---|---|
| `backup_id` | text, unique | `BACKUP-<ms>` (dashboard/email) or `backup_<ms>` (CLI/nightly) |
| `trigger_source` | text | `dashboard`, `dashboard-specific`, `email`, `scheduled`, `manual` (CLI) |
| `status` | text | `running`, `success`, `partial`, `failed` |
| `started_at`, `completed_at` | timestamp | |
| `total_files`, `processed_files`, `failed_files`, `skipped_files` | integer | `skipped_files` = already in Drive |
| `total_size`, `processed_size` | bigint | bytes |
| `duration_seconds` | integer | set on completion |
| `error_message` | text | failure reason, or "N of M files failed" |
| `topic_filter`, `date_filter`, `user_filter`, `triggered_by` | text | request parameters |

### backup_files

| Column | Type | Notes |
|---|---|---|
| `backup_id` | text | FK → `backups.backup_id`, cascade delete |
| `file_name` | text | Name in Drive (the topic, for failed files) |
| `file_size` | bigint | bytes |
| `file_type`, `meeting_topic`, `meeting_date` | text / date | |
| `status` | text | `completed` or `failed` |
| `download_time_ms`, `upload_time_ms`, `drive_file_id`, `error_message` | | optional |

### alerts

| Column | Type | Notes |
|---|---|---|
| `type` | text | e.g. `backup_failed`, `low_disk` |
| `message`, `details` | text | |
| `severity` | text | `info`, `warning`, `critical` |
| `category` | text | default `system` |
| `backup_id` | text | related run, if any |
| `resolved`, `resolved_at` | integer / timestamp | |

`system_metrics` and `daily_stats` are also created by the migration for dashboard statistics.

## Useful queries

```bash
psql "$DATABASE_URL"
```

```sql
-- Last 10 runs
SELECT backup_id, trigger_source, status, started_at, processed_files, failed_files, error_message
FROM backups ORDER BY started_at DESC LIMIT 10;

-- Files of one run
SELECT file_name, status, file_size FROM backup_files WHERE backup_id = 'BACKUP-...';

-- Runs per day, last 30 days
SELECT DATE(started_at) AS day, COUNT(*), SUM(processed_files) AS files
FROM backups WHERE started_at > NOW() - INTERVAL '30 days' GROUP BY 1 ORDER BY 1;

-- Open alerts
SELECT type, severity, message, created_at FROM alerts WHERE resolved = 0 ORDER BY created_at DESC;
```

## Backup and restore

```bash
pg_dump "$DATABASE_URL" > zoom_backup_$(date +%F).sql
psql "$DATABASE_URL" < zoom_backup_2026-10-26.sql
```

## Troubleshooting

| Symptom | Check |
|---|---|
| Dashboard shows no runs | Did `node scripts/migrate.js` run? Is `DATABASE_URL` correct in `.env`? |
| Runs missing from history but backups worked | The database was unreachable during the run, or `ENABLE_DASHBOARD=false` |
| A run stays `running` | The CLI process was killed; the dashboard marks it `failed` after 12 h |
| `Dashboard DB init failed` in logs | PostgreSQL is not running: `sudo systemctl status postgresql` |
