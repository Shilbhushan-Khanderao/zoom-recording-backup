import { TokenStatus as TokenStatusType } from '../../types'
import { Key, RefreshCw, AlertTriangle, CheckCircle, XCircle, Clock } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { tokensApi } from '../../services/api'

interface TokenStatusProps {
  title: string
  status?: TokenStatusType
  showRefresh?: boolean
  isLoading?: boolean
}

const statusConfig = {
  healthy: {
    icon: CheckCircle,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
  },
  warning: {
    icon: AlertTriangle,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
  },
  critical: {
    icon: AlertTriangle,
    color: 'text-orange-400',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/20',
  },
  expired: {
    icon: XCircle,
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
  },
  error: {
    icon: XCircle,
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
  },
  unknown: {
    icon: AlertTriangle,
    color: 'text-zinc-400',
    bg: 'bg-zinc-500/10',
    border: 'border-zinc-500/20',
  },
}

export default function TokenStatus({ title, status, showRefresh = false, isLoading = false }: TokenStatusProps) {
  const queryClient = useQueryClient()

  const refreshMutation = useMutation({
    mutationFn: tokensApi.refresh,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tokens'] })
    },
  })

  if (isLoading || !status) {
    return (
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
        <div className="flex items-center mb-4">
          <Key className="w-5 h-5 text-zinc-400 mr-2" />
          <h3 className="font-medium text-zinc-100">{title}</h3>
        </div>
        <p className="text-sm text-zinc-500">Loading token status...</p>
      </div>
    )
  }

  const config = statusConfig[status.status] || statusConfig.unknown

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 hover:border-zinc-700 hover:shadow-[0_0_15px_rgba(59,130,246,0.1)] transition-all duration-300">
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-medium text-zinc-100">{title}</h3>
        <div className="flex items-center space-x-2">
          <span
            className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider border font-mono ${config.bg} ${config.color} ${config.border}`}
          >
            {status.status}
          </span>
          {showRefresh && (
            <button
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              className="p-1 text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50"
              title="Refresh token manually"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
      </div>

      <div className="flex items-start mb-5">
        <div className={`p-2 rounded-lg ${config.bg} ${config.border} border`}>
          <Key className={`w-4 h-4 ${config.color}`} />
        </div>
        <div className="ml-3">
          <p className="text-xs text-zinc-500 uppercase tracking-wider font-mono">Status Message</p>
          <p className="text-sm text-zinc-300 mt-1 font-mono">{status.message}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 pt-4 border-t border-zinc-800/50">
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-wider flex items-center mb-1 font-mono">
            <Clock className="w-3.5 h-3.5 mr-1.5" /> Expires In
          </p>
          <p className="text-sm font-medium text-zinc-300 font-mono">
            {status.expiresInMinutes !== null
              ? status.expiresInMinutes > 60 
                ? `${Math.floor(status.expiresInMinutes / 60)}h ${status.expiresInMinutes % 60}m`
                : `${status.expiresInMinutes}m`
              : 'Unknown'}
          </p>
        </div>
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-wider flex items-center mb-1 font-mono">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Auto-Refresh
          </p>
          <p className="text-sm font-medium text-zinc-300 flex items-center font-mono">
            {status.hasRefreshToken ? (
              <>
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400 mr-1.5" /> Enabled
              </>
            ) : (
              <>
                <XCircle className="w-3.5 h-3.5 text-red-400 mr-1.5" /> Disabled
              </>
            )}
          </p>
        </div>
      </div>

      {showRefresh && refreshMutation.isError && (
        <p className="mt-4 text-xs text-red-400 font-mono">Failed to refresh token.</p>
      )}
    </div>
  )
}
