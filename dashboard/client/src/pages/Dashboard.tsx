import { useQuery } from '@tanstack/react-query'
import { dashboardApi, backupsApi, tokensApi, systemApi } from '../services/api'
import StatsCards from '../components/dashboard/StatsCards'
import BackupChart from '../components/dashboard/BackupChart'
import RecentBackups from '../components/dashboard/RecentBackups'
import Pm2Workers from '../components/dashboard/Pm2Workers'
import SystemStatus from '../components/dashboard/SystemStatus'
import TokenStatus from '../components/dashboard/TokenStatus'
import { Loader2 } from 'lucide-react'

export default function Dashboard() {
  const { data: overview, isLoading: overviewLoading, error: overviewError } = useQuery({
    queryKey: ['dashboard', 'overview'],
    queryFn: dashboardApi.getOverview,
    refetchInterval: 30000, // 30 seconds
  })

  const { data: dailyStats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard', 'daily-stats'],
    queryFn: () => dashboardApi.getDailyStats(180),
    refetchInterval: 60000, // 1 minute
  })

  const { data: runningBackup } = useQuery({
    queryKey: ['backups', 'running'],
    queryFn: backupsApi.getRunning,
    refetchInterval: 5000, // 5 seconds when backup might be running
  })

  const { data: tokenStatus, isLoading: tokenLoading, isError: tokenError } = useQuery({
    queryKey: ['tokens', 'status'],
    queryFn: tokensApi.getStatus,
    refetchInterval: 60000, // 1 minute
  })

  const { data: zoomTokenStatus, isLoading: zoomLoading, isError: zoomError } = useQuery({
    queryKey: ['tokens', 'zoom', 'status'],
    queryFn: tokensApi.getZoomStatus,
    refetchInterval: 60000, // 1 minute
  })

  const { data: systemHealth } = useQuery({
    queryKey: ['system', 'health'],
    queryFn: systemApi.getHealth,
    refetchInterval: 30000, // 30 seconds
  })

  if (overviewLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-400" />
        <span className="ml-3 text-zinc-400">Loading dashboard...</span>
      </div>
    )
  }

  if (overviewError) {
    return (
      <div className="bg-red-900 bg-opacity-30 border border-red-700 rounded-lg p-6 text-center">
        <p className="text-red-400 font-medium">Failed to load dashboard</p>
        <p className="text-red-400 text-sm mt-1">
          {overviewError instanceof Error ? overviewError.message : 'Unknown error'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Running Backup Banner */}
      {runningBackup?.running && runningBackup.backup && (
        <div className="bg-blue-900 bg-opacity-30 border border-blue-700 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="w-3 h-3 bg-blue-400 rounded-full animate-pulse mr-3"></div>
              <span className="font-medium text-blue-200">
                Backup in progress: {runningBackup.backup.topic_filter || 'All recordings'}
              </span>
            </div>
            <div className="flex items-center space-x-4 text-sm text-blue-300">
              <span>
                {runningBackup.backup.processed_files} / {runningBackup.backup.total_files} files
              </span>
              <span className="font-medium">{runningBackup.backup.progress}%</span>
            </div>
          </div>
          <div className="mt-3 h-2 bg-blue-900 bg-opacity-50 rounded-full overflow-hidden">
            <div 
              className="h-full bg-blue-400 transition-all duration-500"
              style={{ width: `${runningBackup.backup.progress}%` }}
            ></div>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <StatsCards 
        today={overview?.today}
        allTime={overview?.allTime}
        activeAlerts={overview?.activeAlerts || 0}
      />

      {/* Auth Tokens & Workers Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <TokenStatus 
          title="Google Drive Token" 
          status={tokenError ? { status: 'error', message: 'Failed to fetch token status', expiresInMinutes: null, hasRefreshToken: false } as any : tokenStatus} 
          showRefresh={true}
          isLoading={tokenLoading}
        />
        <TokenStatus 
          title="Zoom OAuth Token" 
          status={zoomError ? { status: 'error', message: 'Failed to fetch Zoom token status', expiresInMinutes: null, hasRefreshToken: false } as any : zoomTokenStatus} 
          showRefresh={false}
          isLoading={zoomLoading}
        />
        <Pm2Workers />
      </div>

      {/* Charts and Status Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Backup Activity Chart */}
        <div className="lg:col-span-2">
          <BackupChart 
            stats={dailyStats?.stats || []}
            isLoading={statsLoading}
          />
        </div>

        {/* System Status */}
        <div className="space-y-6">
          <SystemStatus health={systemHealth} />
        </div>
      </div>

      {/* Recent Backups */}
      <RecentBackups backups={overview?.recentBackups || []} />
    </div>
  )
}
