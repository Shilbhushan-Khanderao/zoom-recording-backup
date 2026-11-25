import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { logsApi } from '../services/api'
import { LogEntry } from '../types'
import { 
  Search, 
  Download, 
  Trash2, 
  Filter,
  Loader2,
  AlertCircle,
  AlertTriangle,
  Info,
  Bug
} from 'lucide-react'
import { formatDateTime } from '../utils/formatters'

export default function Logs() {
  const [lines, setLines] = useState(100)
  const [level, setLevel] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['logs', lines, level],
    queryFn: () => logsApi.getRecent(lines, level || undefined),
    refetchInterval: 10000,
  })

  const levelIcons = {
    error: <AlertCircle className="w-4 h-4 text-red-500" />,
    warn: <AlertTriangle className="w-4 h-4 text-yellow-500" />,
    info: <Info className="w-4 h-4 text-blue-500" />,
    debug: <Bug className="w-4 h-4 text-zinc-500 dark:text-zinc-500" />,
  }

  const levelColors = {
    error: 'bg-red-900 bg-opacity-30 border-red-700',
    warn: 'bg-yellow-900 bg-opacity-30 border-yellow-700',
    info: 'bg-blue-900 bg-opacity-30 border-blue-700',
    debug: 'bg-zinc-800 border-zinc-700',
  }

  const filteredLogs = data?.logs.filter(log => 
    !searchQuery || 
    log.message.toLowerCase().includes(searchQuery.toLowerCase())
  ) || []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100 dark:text-zinc-100">Log Viewer</h1>
          <p className="text-zinc-400 dark:text-zinc-400 mt-1">View and search application logs</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => refetch()}
            className="p-2 text-zinc-300 dark:text-zinc-300 hover:bg-zinc-700 dark:bg-zinc-700 rounded-lg transition-colors"
            title="Refresh"
          >
            <Download className="w-5 h-5" />
          </button>
          <button
            onClick={() => logsApi.cleanup()}
            className="p-2 text-zinc-300 dark:text-zinc-300 hover:bg-zinc-700 dark:bg-zinc-700 rounded-lg transition-colors"
            title="Cleanup old logs"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-zinc-800 dark:bg-zinc-800 rounded-lg border border-zinc-700 dark:border-zinc-700 p-4">
        <div className="flex flex-wrap gap-4">
          {/* Search */}
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -tranzinc-y-1/2 w-4 h-4 text-zinc-500 dark:text-zinc-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search logs..."
                className="w-full pl-10 pr-4 py-2 border border-zinc-600 dark:border-zinc-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>

          {/* Level filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-zinc-400 dark:text-zinc-400" />
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              className="px-3 py-2 border border-zinc-600 dark:border-zinc-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="">All levels</option>
              <option value="error">Error</option>
              <option value="warn">Warning</option>
              <option value="info">Info</option>
              <option value="debug">Debug</option>
            </select>
          </div>

          {/* Lines limit */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-300 dark:text-zinc-300">Show:</span>
            <select
              value={lines}
              onChange={(e) => setLines(Number(e.target.value))}
              className="px-3 py-2 border border-zinc-600 dark:border-zinc-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value={50}>50 lines</option>
              <option value={100}>100 lines</option>
              <option value={200}>200 lines</option>
              <option value={500}>500 lines</option>
            </select>
          </div>
        </div>
      </div>

      {/* Log entries */}
      <div className="bg-zinc-800 dark:bg-zinc-800 rounded-lg border border-zinc-700 dark:border-zinc-700 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center p-12">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-500 dark:text-zinc-500" />
          </div>
        ) : error ? (
          <div className="p-6 text-center text-red-600">
            Failed to load logs
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-12 text-center text-zinc-400 dark:text-zinc-400">
            No log entries found
          </div>
        ) : (
          <div className="divide-y divide-zinc-700 dark:divide-zinc-700 max-h-[600px] overflow-y-auto">
            {filteredLogs.map((log, index) => (
              <LogRow key={index} log={log} levelIcons={levelIcons} levelColors={levelColors} />
            ))}
          </div>
        )}
      </div>

      {/* Footer info */}
      {data && (
        <div className="text-sm text-zinc-400 dark:text-zinc-400 text-center">
          Showing {filteredLogs.length} of {data.totalLines} entries from {data.file}
        </div>
      )}
    </div>
  )
}

interface LogRowProps {
  log: LogEntry
  levelIcons: Record<string, JSX.Element>
  levelColors: Record<string, string>
}

function LogRow({ log, levelIcons, levelColors }: LogRowProps) {
  const [expanded, setExpanded] = useState(false)
  const level = log.level || 'info'

  return (
    <div 
      className={`px-4 py-3 hover:bg-zinc-800 dark:bg-zinc-800 cursor-pointer ${levelColors[level] || ''}`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          {levelIcons[level] || levelIcons.info}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-zinc-400 dark:text-zinc-400 uppercase">
              {level}
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-500">
              {formatDateTime(log.timestamp)}
            </span>
          </div>
          <p className={`text-sm text-zinc-200 dark:text-zinc-200 ${expanded ? '' : 'truncate'}`}>
            {log.message}
          </p>
          {expanded && Object.keys(log).length > 3 && (
            <pre className="mt-2 p-2 bg-zinc-700 dark:bg-zinc-700 rounded text-xs text-zinc-300 dark:text-zinc-300 overflow-x-auto">
              {JSON.stringify(log, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
