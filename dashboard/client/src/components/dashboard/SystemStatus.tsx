import { SystemHealth } from '../../types'
import { 
  CheckCircle, 
  AlertTriangle, 
  XCircle,
  Database,
  HardDrive,
  Cpu,
  Server
} from 'lucide-react'

interface SystemStatusProps {
  health?: SystemHealth
}

const checkIcons = {
  database: Database,
  filesystem: HardDrive,
  memory: Cpu,
  services: Server,
}

const statusConfig = {
  healthy: {
    icon: CheckCircle,
    color: 'text-green-400',
    bg: 'bg-green-900 bg-opacity-30',
  },
  warning: {
    icon: AlertTriangle,
    color: 'text-yellow-400',
    bg: 'bg-yellow-900 bg-opacity-30',
  },
  unhealthy: {
    icon: XCircle,
    color: 'text-red-400',
    bg: 'bg-red-900 bg-opacity-30',
  },
}

export default function SystemStatus({ health }: SystemStatusProps) {
  if (!health) {
    return (
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
        <h3 className="font-semibold text-zinc-100 mb-4">System Health</h3>
        <p className="text-sm text-zinc-400">Loading system status...</p>
      </div>
    )
  }

  const checks = Object.entries(health.checks) as [
    keyof typeof checkIcons,
    { status: keyof typeof statusConfig; message: string }
  ][]

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 hover:border-zinc-700 hover:shadow-[0_0_15px_rgba(255,255,255,0.05)] transition-all duration-300">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium text-zinc-100">System Health</h3>
        <span
          className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider font-mono ${
            health.status === 'healthy'
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
          }`}
        >
          {health.status ? health.status : 'Unknown'}
        </span>
      </div>

      <div className="space-y-3">
        {checks.map(([name, check]) => {
          const Icon = checkIcons[name] || Server
          const config = statusConfig[check.status] || statusConfig.healthy
          const StatusIcon = config.icon

          return (
            <div
              key={name}
              className={`flex items-center justify-between p-3 rounded-lg ${config.bg} border border-transparent hover:border-zinc-700 transition-colors`}
            >
              <div className="flex items-center">
                <Icon className="w-4 h-4 text-zinc-400 mr-2" />
                <span className="text-sm font-medium text-zinc-300 capitalize font-mono">
                  {name}
                </span>
              </div>
              <div className="flex items-center">
                <StatusIcon className={`w-4 h-4 ${config.color}`} />
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-4 pt-4 border-t border-zinc-800/50">
        <div className="flex justify-between text-sm text-zinc-400">
          <span className="font-mono uppercase tracking-wider text-xs">Uptime</span>
          <span className="font-medium text-zinc-300 font-mono">
            {formatUptime(health.uptime)}
          </span>
        </div>
      </div>
    </div>
  )
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}
