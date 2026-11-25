import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { backupsApi } from '../services/api'
import { Backup } from '../types'
import { formatBytes, formatDuration, formatTimeAgo } from '../utils/formatters'
import { 
  Play, 
  Loader2, 
  CheckCircle, 
  XCircle, 
  Clock,
  Filter,
  ChevronLeft,
  ChevronRight 
} from 'lucide-react'

export default function Backups() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [showTriggerForm, setShowTriggerForm] = useState(false)
  const [triggerParams, setTriggerParams] = useState({
    topic: '',
    date: '',
    userId: '',
    dryRun: false,
  })

  const { data, isLoading, error } = useQuery({
    queryKey: ['backups', page, statusFilter],
    queryFn: () => backupsApi.list(page, 20, statusFilter || undefined),
    refetchInterval: 10000,
  })

  const { data: runningBackup } = useQuery({
    queryKey: ['backups', 'running'],
    queryFn: backupsApi.getRunning,
    refetchInterval: 3000,
  })

  const triggerMutation = useMutation({
    mutationFn: backupsApi.trigger,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backups'] })
      setShowTriggerForm(false)
      setTriggerParams({ topic: '', date: '', userId: '', dryRun: false })
    },
  })

  const handleTrigger = (e: React.FormEvent) => {
    e.preventDefault()
    triggerMutation.mutate({
      topic: triggerParams.topic || undefined,
      date: triggerParams.date || undefined,
      userId: triggerParams.userId || undefined,
      dryRun: triggerParams.dryRun,
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100 dark:text-zinc-100">Backup Management</h1>
          <p className="text-zinc-400 dark:text-zinc-400 mt-1">View and manage backup operations</p>
        </div>
        <button
          onClick={() => setShowTriggerForm(!showTriggerForm)}
          disabled={runningBackup?.running}
          className="flex items-center px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Play className="w-4 h-4 mr-2" />
          Trigger Backup
        </button>
      </div>

      {/* Running Backup */}
      {runningBackup?.running && runningBackup.backup && (
        <div className="bg-blue-900 bg-opacity-30 border border-blue-700 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center">
              <Loader2 className="w-5 h-5 text-blue-400 animate-spin mr-2" />
              <span className="font-medium text-blue-200">
                Backup in progress
              </span>
            </div>
            <span className="text-sm text-blue-300">
              {runningBackup.backup.progress}%
            </span>
          </div>
          <div className="h-2 bg-blue-900 bg-opacity-50 rounded-full overflow-hidden">
            <div 
              className="h-full bg-blue-400 transition-all duration-500"
              style={{ width: `${runningBackup.backup.progress}%` }}
            ></div>
          </div>
          <p className="text-sm text-blue-300 mt-2">
            {runningBackup.backup.processed_files} / {runningBackup.backup.total_files} files processed
          </p>
        </div>
      )}

      {/* Trigger Form */}
      {showTriggerForm && (
        <div className="bg-zinc-800 dark:bg-zinc-800 rounded-lg border border-zinc-700 dark:border-zinc-700 p-6">
          <h3 className="font-semibold text-zinc-100 dark:text-zinc-100 mb-4">Trigger New Backup</h3>
          <form onSubmit={handleTrigger} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-200 dark:text-zinc-200 mb-1">
                  Topic Filter
                </label>
                <input
                  type="text"
                  value={triggerParams.topic}
                  onChange={(e) => setTriggerParams({ ...triggerParams, topic: e.target.value })}
                  placeholder="e.g., 'webinar-2024'"
                  className="w-full px-3 py-2 border border-zinc-600 dark:border-zinc-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-zinc-700 dark:bg-zinc-700 text-zinc-100 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-200 dark:text-zinc-200 mb-1">
                  Date Filter
                </label>
                <input
                  type="date"
                  value={triggerParams.date}
                  onChange={(e) => setTriggerParams({ ...triggerParams, date: e.target.value })}
                  className="w-full px-3 py-2 border border-zinc-600 dark:border-zinc-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-zinc-700 dark:bg-zinc-700 text-zinc-100 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-200 dark:text-zinc-200 mb-1">
                  User ID (optional)
                </label>
                <input
                  type="text"
                  value={triggerParams.userId}
                  onChange={(e) => setTriggerParams({ ...triggerParams, userId: e.target.value })}
                  placeholder="user@example.com"
                  className="w-full px-3 py-2 border border-zinc-600 dark:border-zinc-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-zinc-700 dark:bg-zinc-700 text-zinc-100 dark:text-zinc-100"
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={triggerParams.dryRun}
                  onChange={(e) => setTriggerParams({ ...triggerParams, dryRun: e.target.checked })}
                  className="mr-2"
                />
                <span className="text-sm text-zinc-300 dark:text-zinc-300">Dry run (simulate only)</span>
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowTriggerForm(false)}
                  className="px-4 py-2 text-zinc-200 dark:text-zinc-200 hover:bg-zinc-700 dark:bg-zinc-700 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={triggerMutation.isPending}
                  className="flex items-center px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
                >
                  {triggerMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Start Backup
                </button>
              </div>
            </div>
            {triggerMutation.isError && (
              <p className="text-sm text-red-600">
                Failed to trigger backup: {triggerMutation.error instanceof Error ? triggerMutation.error.message : 'Unknown error'}
              </p>
            )}
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-zinc-400 dark:text-zinc-400" />
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value)
              setPage(1)
            }}
            className="px-3 py-2 border border-zinc-600 dark:border-zinc-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          >
            <option value="">All statuses</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="running">Running</option>
          </select>
        </div>
      </div>

      {/* Backups Table */}
      <div className="bg-zinc-800 dark:bg-zinc-800 rounded-lg border border-zinc-700 dark:border-zinc-700 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center p-12">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-500 dark:text-zinc-500" />
          </div>
        ) : error ? (
          <div className="p-6 text-center text-red-600">
            Failed to load backups
          </div>
        ) : data?.backups.length === 0 ? (
          <div className="p-12 text-center text-zinc-400 dark:text-zinc-400">
            No backups found
          </div>
        ) : (
          <>
            <table className="w-full">
              <thead className="bg-zinc-800 dark:bg-zinc-800 border-b border-zinc-700 dark:border-zinc-700">
                <tr className="text-left text-sm text-zinc-300 dark:text-zinc-300">
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Backup ID</th>
                  <th className="px-6 py-3 font-medium">Topic</th>
                  <th className="px-6 py-3 font-medium">Files</th>
                  <th className="px-6 py-3 font-medium">Size</th>
                  <th className="px-6 py-3 font-medium">Duration</th>
                  <th className="px-6 py-3 font-medium">Started</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-700 dark:divide-zinc-700">
                {data?.backups.map((backup: Backup) => (
                  <BackupRow key={backup.backup_id} backup={backup} />
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {data && data.pagination.totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-700 dark:border-zinc-700">
                <p className="text-sm text-zinc-300 dark:text-zinc-300">
                  Page {data.pagination.page} of {data.pagination.totalPages}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(page - 1)}
                    disabled={page === 1}
                    className="p-2 text-zinc-300 dark:text-zinc-300 hover:bg-zinc-700 dark:bg-zinc-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setPage(page + 1)}
                    disabled={page >= data.pagination.totalPages}
                    className="p-2 text-zinc-300 dark:text-zinc-300 hover:bg-zinc-700 dark:bg-zinc-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function BackupRow({ backup }: { backup: Backup }) {
  const statusIcons = {
    completed: <CheckCircle className="w-4 h-4 text-green-600" />,
    failed: <XCircle className="w-4 h-4 text-red-600" />,
    running: <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />,
    cancelled: <Clock className="w-4 h-4 text-zinc-300 dark:text-zinc-300" />,
  }

  const statusColors = {
    completed: 'bg-green-900 bg-opacity-30 text-green-300',
    failed: 'bg-red-900 bg-opacity-30 text-red-300',
    running: 'bg-blue-900 bg-opacity-30 text-blue-300',
    cancelled: 'bg-zinc-700 dark:bg-zinc-700 text-zinc-300 dark:text-zinc-300',
  }

  return (
    <tr className="hover:bg-zinc-800 dark:bg-zinc-800">
      <td className="px-6 py-4">
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${statusColors[backup.status]}`}>
          {statusIcons[backup.status]}
          <span className="ml-1 capitalize">{backup.status}</span>
        </span>
      </td>
      <td className="px-6 py-4">
        <span className="text-sm font-mono text-zinc-300 dark:text-zinc-300">
          {backup.backup_id.slice(0, 20)}...
        </span>
      </td>
      <td className="px-6 py-4">
        <span className="text-sm text-zinc-100 dark:text-zinc-100">
          {backup.topic_filter || 'All recordings'}
        </span>
      </td>
      <td className="px-6 py-4">
        <span className="text-sm text-zinc-100 dark:text-zinc-100">
          {backup.processed_files}
          {backup.failed_files > 0 && (
            <span className="text-red-500 ml-1">({backup.failed_files} failed)</span>
          )}
        </span>
      </td>
      <td className="px-6 py-4">
        <span className="text-sm text-zinc-300 dark:text-zinc-300">
          {formatBytes(backup.processed_size)}
        </span>
      </td>
      <td className="px-6 py-4">
        <span className="text-sm text-zinc-300 dark:text-zinc-300">
          {backup.duration_seconds > 0 ? formatDuration(backup.duration_seconds) : '-'}
        </span>
      </td>
      <td className="px-6 py-4">
        <span className="text-sm text-zinc-400 dark:text-zinc-400" title={backup.started_at}>
          {formatTimeAgo(backup.started_at)}
        </span>
      </td>
    </tr>
  )
}
