module.exports = {
  apps: [
    {
      name: "mail-bot",
      script: "./mail-bot.js",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      max_memory_restart: "500M",  // Restart if memory exceeds 500MB
      node_args: "--max-old-space-size=512",  // Set heap limit to 512MB
      env: {
        NODE_ENV: "production",
      },
      error_file: "logs/pm2/mail-bot-error.log",
      out_file: "logs/pm2/mail-bot-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      restart_delay: 4000,
      instance_var: "INSTANCE_ID",
      merge_logs: true,
      listen_timeout: 5000,
      kill_timeout: 5000,
      exp_backoff_restart_delay: 100  // Exponential backoff for restarts
    },
    {
      name: "dashboard",
      script: "./dashboard/server/index.js",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
        DASHBOARD_PORT: 5000
      },
      error_file: "logs/pm2/dashboard-error.log",
      out_file: "logs/pm2/dashboard-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      restart_delay: 2000,
      merge_logs: true,
      kill_timeout: 5000,
    },
    {
      // Nightly incremental backup: files already in Drive are skipped, so this only
      // uploads new recordings - and it exercises Zoom + Drive auth every day.
      name: "nightly-backup",
      script: "./cli.js",
      args: "backup --source scheduled",
      cron_restart: "0 2 * * *",   // 02:00 server time
      autorestart: false,          // run once per cron tick, don't loop
      watch: false,
      env: {
        NODE_ENV: "production",
      },
      error_file: "logs/pm2/nightly-backup-error.log",
      out_file: "logs/pm2/nightly-backup-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
    }
  ]
}