# Documentation

Start with the [main README](../README.md): overview, setup, configuration, usage and
troubleshooting.

| Guide | Covers |
|---|---|
| [Deployment](operations/DEPLOYMENT_GUIDE.md) | PM2 apps, first install, updates, rollback, checks after deploying |
| [Health checks and alerts](operations/HEALTH_CHECK_GUIDE.md) | Daily health check, alert emails, health endpoints, what to do on an alert |
| [Tokens and re-authorization](operations/OAUTH_TOKEN_REFRESH.md) | Google and Zoom tokens, refresh, encryption, re-authorizing Google Drive |
| [Database](setup/DATABASE_SETUP.md) | PostgreSQL setup, schema, useful queries, backup/restore |
| [NAS mount](setup/MOUNT_SETUP_GUIDE.md) | SMB share for local copies (`/mnt/shared`) |
| [Dashboard](../dashboard/README.md) | Pages, configuration, security, REST API |

Quick answers:

- **Start a backup by email**: subject contains "backup"; body `Topic: ...`, `Date: YYYY-MM-DD`
  (from that date until today), optional `UserId: ...`. See [README → Email](../README.md#email).
- **Google Drive stopped working**: [re-authorize](operations/OAUTH_TOKEN_REFRESH.md#re-authorize-from-the-dashboard).
- **Where are the logs**: `logs/application/` and `logs/pm2/`; per-run details in `logs/backups/`.
- **Run the tests**: `npm test`.
