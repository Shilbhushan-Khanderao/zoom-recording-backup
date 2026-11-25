/**
 * API Service
 * Centralized API client for dashboard
 */

const API_BASE = '/api';

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new ApiError(response.status, error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

// ==========================================================
// DASHBOARD
// ==========================================================

export const dashboardApi = {
  getOverview: () => 
    fetchApi<import('../types').DashboardOverview>('/dashboard/overview'),
  
  getDailyStats: (days = 7) => 
    fetchApi<import('../types').DailyStatsResponse>(`/dashboard/stats/daily?days=${days}`),
  
  getWeeklyStats: (weeks = 4) => 
    fetchApi<import('../types').DailyStatsResponse>(`/dashboard/stats/weekly?weeks=${weeks}`),
};

// ==========================================================
// BACKUPS
// ==========================================================

export const backupsApi = {
  list: (page = 1, limit = 20, status?: string) => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (status) params.append('status', status);
    return fetchApi<import('../types').BackupsListResponse>(`/backups?${params}`);
  },
  
  getById: (id: string) => 
    fetchApi<{ backup: import('../types').Backup }>(`/backups/${id}`),
  
  getFiles: (id: string) => 
    fetchApi<{ backupId: string; files: import('../types').BackupFile[] }>(`/backups/${id}/files`),
  
  getRunning: () => 
    fetchApi<import('../types').RunningBackup>('/backups/running'),
  
  trigger: (params: { topic?: string; date?: string; userId?: string; dryRun?: boolean }) =>
    fetchApi<{ message: string; backupId: string }>('/backups/trigger', {
      method: 'POST',
      body: JSON.stringify(params),
    }),
};

// ==========================================================
// SYSTEM
// ==========================================================

export const systemApi = {
  getHealth: () => 
    fetchApi<import('../types').SystemHealth>('/system/health'),
  
  getDisk: () => 
    fetchApi<import('../types').DiskUsage>('/system/disk'),
  
  getMemory: () => 
    fetchApi<import('../types').MemoryUsage>('/system/memory'),
  
  getProcesses: () => 
    fetchApi<import('../types').ProcessesResponse>('/system/processes'),
};

// ==========================================================
// TOKENS
// ==========================================================

export const tokensApi = {
  getStatus: () => 
    fetchApi<import('../types').TokenStatus>('/tokens/status'),
  
  getZoomStatus: () =>
    fetchApi<import('../types').TokenStatus>('/tokens/zoom/status'),
  
  getMetrics: () => 
    fetchApi<{ refreshCount?: number; successCount?: number; failureCount?: number }>('/tokens/metrics'),
  
  refresh: () => 
    fetchApi<{ success: boolean; message: string }>('/tokens/refresh', { method: 'POST' }),
};

// ==========================================================
// LOGS
// ==========================================================

export const logsApi = {
  getRecent: (lines = 100, level?: string) => {
    const params = new URLSearchParams({ lines: String(lines) });
    if (level) params.append('level', level);
    return fetchApi<import('../types').LogsResponse>(`/logs/recent?${params}`);
  },
  
  getErrors: (lines = 50) => 
    fetchApi<{ errors: import('../types').LogEntry[] }>(`/logs/errors?lines=${lines}`),
  
  search: (query: string, days = 1) => 
    fetchApi<{ query: string; results: import('../types').LogEntry[]; totalResults: number }>(
      `/logs/search?query=${encodeURIComponent(query)}&days=${days}`
    ),
  
  cleanup: () => 
    fetchApi<{ message: string }>('/logs/cleanup', { method: 'DELETE' }),
};

// ==========================================================
// ALERTS
// ==========================================================

export const alertsApi = {
  list: (resolved?: boolean, severity?: string, limit = 50) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (resolved !== undefined) params.append('resolved', String(resolved));
    if (severity) params.append('severity', severity);
    return fetchApi<import('../types').AlertsResponse>(`/alerts?${params}`);
  },
  
  getActive: () => 
    fetchApi<import('../types').ActiveAlertsResponse>('/alerts/active'),
  
  getStats: () => 
    fetchApi<import('../types').AlertStats>('/alerts/stats'),
  
  resolve: (id: number) => 
    fetchApi<{ message: string }>(`/alerts/${id}/resolve`, { method: 'PATCH' }),
  
  reopen: (id: number) => 
    fetchApi<{ message: string }>(`/alerts/${id}/reopen`, { method: 'POST' }),
  
  delete: (id: number) => 
    fetchApi<{ message: string }>(`/alerts/${id}`, { method: 'DELETE' }),
  
  resolveAll: () => 
    fetchApi<{ message: string; count: number }>('/alerts/resolve-all', { method: 'POST' }),
};

export { ApiError };
