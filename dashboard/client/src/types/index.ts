// API Types for Dashboard

export interface DashboardOverview {
  today: {
    backups: number;
    successful: number;
    failed: number;
    filesProcessed: number;
    totalSize: number;
    successRate: number;
  };
  allTime: {
    totalBackups: number;
    successful: number;
    filesProcessed: number;
    totalSize: number;
  };
  recentBackups: Backup[];
  activeAlerts: number;
  timestamp: string;
}

export interface Backup {
  backup_id: string;
  trigger_source: 'manual' | 'email' | 'dashboard' | 'scheduled';
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  started_at: string;
  completed_at: string | null;
  total_files: number;
  processed_files: number;
  failed_files: number;
  skipped_files: number;
  total_size: number;
  processed_size: number;
  duration_seconds: number;
  topic_filter: string | null;
  date_filter: string | null;
  error_message: string | null;
}

export interface BackupFile {
  file_name: string;
  file_size: number;
  file_type: string | null;
  meeting_topic: string | null;
  status: 'pending' | 'downloading' | 'uploading' | 'completed' | 'failed';
  download_time_ms: number | null;
  upload_time_ms: number | null;
  error_message: string | null;
  created_at: string;
}

export interface BackupsListResponse {
  backups: Backup[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  timestamp: string;
}

export interface RunningBackup {
  running: boolean;
  backup: (Backup & {
    progress: number;
    elapsedSeconds: number;
  }) | null;
  timestamp: string;
}

export interface Alert {
  id: number;
  type: string;
  category: 'backup' | 'token' | 'system' | 'disk';
  message: string;
  details: string | null;
  severity: 'critical' | 'warning' | 'info';
  backup_id: string | null;
  resolved: number;
  resolved_at: string | null;
  created_at: string;
  createdAt?: string;
}

export interface AlertStats {
  total: number;
  active: number;
  resolved: number;
  bySeverity: {
    critical: number;
    warning: number;
    info: number;
  };
}

export interface AlertsResponse {
  alerts: Alert[];
  totalCount: number;
  timestamp: string;
}

export interface ActiveAlertsResponse {
  alerts: Alert[];
  summary: {
    critical: number;
    warning: number;
    info: number;
  };
  totalActive: number;
  timestamp: string;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded';
  checks: {
    database: HealthCheck;
    filesystem: HealthCheck;
    memory: HealthCheck;
    services: HealthCheck;
  };
  uptime: number;
  timestamp: string;
}

export interface HealthCheck {
  status: 'healthy' | 'warning' | 'unhealthy';
  message: string;
}

export interface DiskUsage {
  directories: {
    logs: { path: string; size: string };
    downloads: { path: string; size: string };
  };
  disk: {
    filesystem: string;
    size: string;
    used: string;
    available: string;
    usePercent: string;
    mountPoint: string;
  } | null;
  timestamp: string;
}

export interface MemoryUsage {
  process: {
    rss: string;
    heapTotal: string;
    heapUsed: string;
    external: string;
    raw: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      external: number;
    };
  };
  system: {
    total: string;
    free: string;
    used: string;
    usedPercent: number;
    raw: {
      total: number;
      free: number;
      used: number;
    };
  };
  timestamp: string;
}

export interface PM2Process {
  name: string;
  pid: number;
  status: string;
  memory: string;
  cpu: string;
  uptime: string;
  restarts: number;
}

export interface ProcessesResponse {
  pm2Available: boolean;
  processes: PM2Process[];
  timestamp: string;
}

export interface TokenStatus {
  status: 'healthy' | 'warning' | 'critical' | 'expired' | 'error' | 'unknown';
  message: string;
  expiryDate: string | null;
  expiresInMinutes: number | null;
  hasRefreshToken: boolean;
  source: string;
  timestamp: string;
}

export interface LogEntry {
  timestamp: string;
  level: 'error' | 'warn' | 'info' | 'debug';
  message: string;
  [key: string]: unknown;
}

export interface LogsResponse {
  logs: LogEntry[];
  file: string;
  totalLines: number;
  timestamp: string;
}

export interface DailyStats {
  date: string;
  total_backups: number;
  successful: number;
  failed: number;
  files_processed: number;
  total_size: number;
  avg_duration: number;
}

export interface DailyStatsResponse {
  days: number;
  stats: DailyStats[];
  timestamp: string;
}
