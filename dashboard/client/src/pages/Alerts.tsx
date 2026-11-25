import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { alertsApi } from '../services/api'
import { Alert, AlertStats } from '../types'
import { 
  AlertCircle, 
  AlertTriangle, 
  Info,
  Check,
  Trash2,
  Bell,
  BellOff,
  Loader2,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import { formatTimeAgo } from '../utils/formatters'

export default function Alerts() {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<'all' | 'active' | 'resolved'>('all')

  const { data: alertsResponse, isLoading } = useQuery({
    queryKey: ['alerts'],
    queryFn: () => alertsApi.list(undefined, undefined, 100),
    refetchInterval: 30000,
  })

  const alerts = alertsResponse?.alerts || []

  const { data: stats } = useQuery<AlertStats>({
    queryKey: ['alertStats'],
    queryFn: alertsApi.getStats,
    refetchInterval: 30000,
  })

  const resolveMutation = useMutation({
    mutationFn: alertsApi.resolve,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      queryClient.invalidateQueries({ queryKey: ['alertStats'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: alertsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      queryClient.invalidateQueries({ queryKey: ['alertStats'] })
    },
  })

  const filteredAlerts = alerts.filter((alert: Alert) => {
    if (filter === 'active') return !alert.resolved
    if (filter === 'resolved') return alert.resolved
    return true
  })

  const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 }
  const sortedAlerts = [...filteredAlerts].sort((a: Alert, b: Alert) => {
    if (a.resolved !== b.resolved) return a.resolved ? 1 : -1
    return (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2)
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100 dark:text-zinc-100">Alerts</h1>
          <p className="text-zinc-400 dark:text-zinc-400 mt-1">System alerts and notifications</p>
        </div>
      </div>

      {/* Stats */}
      {stats && <AlertStatsCards stats={stats} />}

      {/* Filter tabs */}
      <div className="flex gap-2">
        {(['all', 'active', 'resolved'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === f
                ? 'bg-primary-100 text-primary-700'
                : 'bg-zinc-700 dark:bg-zinc-700 text-zinc-300 dark:text-zinc-300 hover:bg-zinc-600 dark:bg-zinc-600'
            }`}
          >
            {f ? f.charAt(0).toUpperCase() + f.slice(1) : ''}
            {f === 'active' && stats && stats.active > 0 && (
              <span className="ml-2 px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full">
                {stats.active}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Alert list */}
      <div className="bg-zinc-800 dark:bg-zinc-800 rounded-lg border border-zinc-700 dark:border-zinc-700 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center p-12">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-500 dark:text-zinc-500" />
          </div>
        ) : sortedAlerts.length === 0 ? (
          <div className="p-12 text-center">
            <BellOff className="w-12 h-12 text-zinc-500 dark:text-zinc-500 mx-auto mb-4" />
            <p className="text-zinc-400 dark:text-zinc-400">No alerts to display</p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-700 dark:divide-zinc-700">
            {sortedAlerts.map((alert) => (
              <AlertRow
                key={alert.id}
                alert={alert}
                onResolve={() => resolveMutation.mutate(alert.id)}
                onDelete={() => deleteMutation.mutate(alert.id)}
                isResolving={resolveMutation.isPending}
                isDeleting={deleteMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AlertStatsCards({ stats }: { stats: AlertStats }) {
  const cards = [
    { 
      label: 'Total Alerts', 
      value: stats.total, 
      icon: Bell, 
      color: 'bg-blue-900 bg-opacity-30 text-blue-300' 
    },
    { 
      label: 'Active', 
      value: stats.active, 
      icon: AlertCircle, 
      color: 'bg-red-900 bg-opacity-30 text-red-300' 
    },
    { 
      label: 'Resolved', 
      value: stats.resolved, 
      icon: Check, 
      color: 'bg-green-900 bg-opacity-30 text-green-300' 
    },
    { 
      label: 'Critical', 
      value: stats.bySeverity.critical, 
      icon: AlertTriangle, 
      color: 'bg-orange-900 bg-opacity-30 text-orange-300' 
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map((card) => (
        <div key={card.label} className="bg-zinc-800 dark:bg-zinc-800 rounded-lg border border-zinc-700 dark:border-zinc-700 p-4">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${card.color}`}>
              <card.icon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{card.value}</p>
              <p className="text-sm text-zinc-400 dark:text-zinc-400">{card.label}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

interface AlertRowProps {
  alert: Alert
  onResolve: () => void
  onDelete: () => void
  isResolving: boolean
  isDeleting: boolean
}

function AlertRow({ alert, onResolve, onDelete, isResolving, isDeleting }: AlertRowProps) {
  const [expanded, setExpanded] = useState(false)

  const severityConfig = {
    critical: {
      icon: AlertCircle,
      bg: 'bg-red-900 bg-opacity-30',
      border: 'border-red-700',
      iconColor: 'text-red-400',
      badge: 'bg-red-900 text-red-200',
    },
    warning: {
      icon: AlertTriangle,
      bg: 'bg-yellow-900 bg-opacity-30',
      border: 'border-yellow-700',
      iconColor: 'text-yellow-400',
      badge: 'bg-yellow-900 text-yellow-200',
    },
    info: {
      icon: Info,
      bg: 'bg-blue-900 bg-opacity-30',
      border: 'border-blue-700',
      iconColor: 'text-blue-400',
      badge: 'bg-blue-900 text-blue-200',
    },
  }

  const config = severityConfig[alert.severity] || severityConfig.info
  const Icon = config.icon

  return (
    <div className={`p-4 ${alert.resolved ? 'opacity-60' : ''} ${!alert.resolved ? config.bg : ''}`}>
      <div className="flex items-start gap-3">
        <Icon className={`w-5 h-5 mt-0.5 ${config.iconColor}`} />
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${config.badge}`}>
              {alert.severity}
            </span>
            <span className="text-xs text-zinc-400 dark:text-zinc-400">{alert.type}</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-500">
              {formatTimeAgo(alert.created_at)}
            </span>
            {alert.resolved && (
              <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
                Resolved
              </span>
            )}
          </div>
          
          <p className="text-sm text-zinc-100 dark:text-zinc-100">{alert.message}</p>
          
          {expanded && alert.details && (
            <pre className="mt-2 p-3 bg-zinc-700 dark:bg-zinc-700 rounded-lg text-xs text-zinc-300 dark:text-zinc-300 overflow-x-auto">
              {JSON.stringify(alert.details, null, 2)}
            </pre>
          )}
        </div>

        <div className="flex items-center gap-1">
          {alert.details && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-2 text-zinc-500 dark:text-zinc-500 hover:text-zinc-300 dark:text-zinc-300 hover:bg-zinc-700 dark:bg-zinc-700 rounded transition-colors"
              title={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          )}
          
          {!alert.resolved && (
            <button
              onClick={onResolve}
              disabled={isResolving}
              className="p-2 text-green-400 hover:bg-green-900 hover:bg-opacity-30 rounded transition-colors disabled:opacity-50"
              title="Resolve"
            >
              <Check className="w-4 h-4" />
            </button>
          )}
          
          <button
            onClick={onDelete}
            disabled={isDeleting}
            className="p-2 text-red-400 hover:bg-red-900 hover:bg-opacity-30 rounded transition-colors disabled:opacity-50"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
