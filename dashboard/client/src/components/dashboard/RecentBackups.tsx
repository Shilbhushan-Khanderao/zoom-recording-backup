import { Backup } from '../../types'
import { formatBytes, formatDuration, formatTimeAgo } from '../../utils/formatters'
import { 
  CheckCircle, 
  XCircle, 
  Loader2,
  Mail,
  MousePointer,
  Calendar,
  Database
} from 'lucide-react'

interface RecentBackupsProps {
  backups: Backup[]
}

const statusConfig = {
  completed: {
    icon: CheckCircle,
    color: 'text-green-400',
    bg: 'bg-green-900 bg-opacity-30',
    label: 'Completed',
  },
  failed: {
    icon: XCircle,
    color: 'text-red-400',
    bg: 'bg-red-900 bg-opacity-30',
    label: 'Failed',
  },
  running: {
    icon: Loader2,
    color: 'text-blue-400',
    bg: 'bg-blue-900 bg-opacity-30',
    label: 'Running',
  },
  cancelled: {
    icon: XCircle,
    color: 'text-zinc-400',
    bg: 'bg-zinc-800',
    label: 'Cancelled',
  },
}

const triggerIcons = {
  email: Mail,
  manual: MousePointer,
  dashboard: MousePointer,
  scheduled: Calendar,
}

export default function RecentBackups({ backups }: RecentBackupsProps) {
  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      <div className="flex items-center justify-between p-6 border-b border-zinc-800">
        <h3 className="font-medium text-zinc-100 flex items-center">
          Recent Backups
        </h3>
        <a 
          href="/backups" 
          className="text-sm text-blue-400 hover:text-blue-300 font-medium px-4 py-2 rounded-lg hover:bg-zinc-800 transition-colors"
        >
          View all →
        </a>
      </div>

      {backups.length === 0 ? (
        <div className="text-center py-12 text-zinc-500 flex flex-col items-center">
          <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mb-3">
            <Database className="w-6 h-6 opacity-30" />
          </div>
          <p className="text-sm font-mono">No backups yet</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-900 border-b border-zinc-800">
                <th className="py-3 px-6 text-xs font-semibold text-zinc-400 uppercase tracking-wider font-mono">Status</th>
                <th className="py-3 px-6 text-xs font-semibold text-zinc-400 uppercase tracking-wider font-mono">Topic</th>
                <th className="py-3 px-6 text-xs font-semibold text-zinc-400 uppercase tracking-wider font-mono">Trigger</th>
                <th className="py-3 px-6 text-xs font-semibold text-zinc-400 uppercase tracking-wider font-mono">Files</th>
                <th className="py-3 px-6 text-xs font-semibold text-zinc-400 uppercase tracking-wider font-mono">Size</th>
                <th className="py-3 px-6 text-xs font-semibold text-zinc-400 uppercase tracking-wider font-mono">Duration</th>
                <th className="py-3 px-6 text-xs font-semibold text-zinc-400 uppercase tracking-wider font-mono">Started</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {backups.map((backup, idx) => {
                const status = statusConfig[backup.status as keyof typeof statusConfig] || statusConfig.completed
                const StatusIcon = status.icon
                const TriggerIcon = triggerIcons[backup.trigger_source as keyof typeof triggerIcons] || MousePointer

                return (
                  <tr 
                    key={backup.backup_id} 
                    className={`hover:bg-zinc-800/50 transition-colors ${idx % 2 === 0 ? 'bg-zinc-900' : 'bg-zinc-900/50'}`}
                  >
                    <td className="py-4 px-6">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border font-mono ${status.bg} ${status.color} border-current/20`}>
                        <StatusIcon className={`w-3 h-3 mr-1.5 ${backup.status === 'running' ? 'animate-spin' : ''}`} />
                        {status.label}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-sm text-zinc-300 font-mono">
                      {backup.topic_filter || 'All recordings'}
                    </td>
                    <td className="py-4 px-6">
                      <span className="inline-flex items-center text-sm text-zinc-400 capitalize font-mono">
                        <TriggerIcon className="w-4 h-4 mr-2 opacity-70" />
                        {backup.trigger_source}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-sm text-zinc-300 font-mono">
                      {backup.processed_files} / {backup.total_files}
                      {backup.failed_files > 0 && (
                        <span className="ml-2 text-xs bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full">
                          {backup.failed_files} failed
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-sm text-zinc-300 font-mono">
                      {formatBytes(backup.processed_size || 0)}
                    </td>
                    <td className="py-4 px-6 text-sm text-zinc-400 font-mono">
                      {backup.duration_seconds > 0 
                        ? formatDuration(backup.duration_seconds)
                        : backup.status === 'running' ? 'In progress...' : '-'
                      }
                    </td>
                    <td className="py-4 px-6 text-sm text-zinc-400 font-mono" title={backup.started_at}>
                      {formatTimeAgo(backup.started_at)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
