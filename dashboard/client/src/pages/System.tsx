import { useQuery } from '@tanstack/react-query'
import { systemApi, tokensApi } from '../services/api'
import { 
  CheckCircle, 
  AlertTriangle, 
  XCircle,
  Database,
  HardDrive,
  Cpu,
  Server,
  RefreshCw,
  Loader2
} from 'lucide-react'

export default function System() {
  const { data: health, isLoading: healthLoading } = useQuery({
    queryKey: ['system', 'health'],
    queryFn: systemApi.getHealth,
    refetchInterval: 30000,
  })

  const { data: disk } = useQuery({
    queryKey: ['system', 'disk'],
    queryFn: systemApi.getDisk,
    refetchInterval: 60000,
  })

  const { data: memory } = useQuery({
    queryKey: ['system', 'memory'],
    queryFn: systemApi.getMemory,
    refetchInterval: 30000,
  })

  const { data: processes } = useQuery({
    queryKey: ['system', 'processes'],
    queryFn: systemApi.getProcesses,
    refetchInterval: 30000,
  })

  const { data: tokenStatus } = useQuery({
    queryKey: ['tokens', 'status'],
    queryFn: tokensApi.getStatus,
    refetchInterval: 60000,
  })

  const statusIcons = {
    healthy: CheckCircle,
    warning: AlertTriangle,
    unhealthy: XCircle,
  }

  const statusColors = {
    healthy: 'text-green-400 bg-green-900 bg-opacity-30',
    warning: 'text-yellow-400 bg-yellow-900 bg-opacity-30',
    unhealthy: 'text-red-400 bg-red-900 bg-opacity-30',
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100 dark:text-zinc-100">System Health</h1>
        <p className="text-zinc-400 dark:text-zinc-400 mt-1">Monitor system status and resources</p>
      </div>

      {/* Overall Status */}
      <div className="bg-zinc-800 dark:bg-zinc-800 rounded-lg border border-zinc-700 dark:border-zinc-700 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <div className={`p-3 rounded-full ${health?.status === 'healthy' ? 'bg-green-100' : 'bg-yellow-100'}`}>
              {health?.status === 'healthy' 
                ? <CheckCircle className="w-6 h-6 text-green-600" />
                : <AlertTriangle className="w-6 h-6 text-yellow-600" />
              }
            </div>
            <div className="ml-4">
              <h2 className="text-lg font-semibold text-zinc-100 dark:text-zinc-100">
                System Status: {health?.status?.toUpperCase() || 'Loading...'}
              </h2>
              <p className="text-sm text-zinc-400 dark:text-zinc-400">
                Uptime: {health?.uptime ? formatUptime(health.uptime) : 'N/A'}
              </p>
            </div>
          </div>
          <button className="p-2 text-zinc-400 hover:bg-zinc-700 dark:hover:bg-zinc-700 rounded-lg">
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Health Checks Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {healthLoading ? (
          <div className="col-span-2 flex items-center justify-center p-12">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-500 dark:text-zinc-500" />
          </div>
        ) : health?.checks && (
          Object.entries(health.checks).map(([name, check]) => {
            const Icon = statusIcons[check.status as keyof typeof statusIcons] || AlertTriangle
            const colorClass = statusColors[check.status as keyof typeof statusColors] || statusColors.warning
            const checkIcons: Record<string, typeof Database> = {
              database: Database,
              filesystem: HardDrive,
              memory: Cpu,
              services: Server,
            }
            const CheckIcon = checkIcons[name] || Server

            return (
              <div key={name} className="bg-zinc-800 dark:bg-zinc-800 rounded-lg border border-zinc-700 dark:border-zinc-700 p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <CheckIcon className="w-5 h-5 text-zinc-400 dark:text-zinc-400 mr-2" />
                    <h3 className="font-semibold text-zinc-100 dark:text-zinc-100 capitalize">{name}</h3>
                  </div>
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${colorClass}`}>
                    <Icon className="w-3.5 h-3.5 mr-1" />
                    {check.status}
                  </span>
                </div>
                <p className="text-sm text-zinc-300 dark:text-zinc-300">{check.message}</p>
              </div>
            )
          })
        )}
      </div>

      {/* Resource Usage */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Memory Usage */}
        <div className="bg-zinc-800 dark:bg-zinc-800 rounded-lg border border-zinc-700 dark:border-zinc-700 p-6">
          <h3 className="font-semibold text-zinc-100 dark:text-zinc-100 mb-4">Memory Usage</h3>
          {memory ? (
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-zinc-300 dark:text-zinc-300">System Memory</span>
                  <span className="font-medium">{memory.system.usedPercent}%</span>
                </div>
                <div className="h-2 bg-zinc-600 dark:bg-zinc-600 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all ${
                      memory.system.usedPercent > 90 ? 'bg-red-500' :
                      memory.system.usedPercent > 75 ? 'bg-yellow-500' : 'bg-green-500'
                    }`}
                    style={{ width: `${memory.system.usedPercent}%` }}
                  ></div>
                </div>
                <p className="text-xs text-zinc-400 dark:text-zinc-400 mt-1">
                  {memory.system.used} / {memory.system.total}
                </p>
              </div>
              <div className="pt-4 border-t border-zinc-700 dark:border-zinc-700">
                <p className="text-sm text-zinc-300 dark:text-zinc-300">Process Heap: {memory.process.heapUsed}</p>
                <p className="text-sm text-zinc-400 dark:text-zinc-400">RSS: {memory.process.rss}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-400 dark:text-zinc-400">Loading...</p>
          )}
        </div>

        {/* Disk Usage */}
        <div className="bg-zinc-800 dark:bg-zinc-800 rounded-lg border border-zinc-700 dark:border-zinc-700 p-6">
          <h3 className="font-semibold text-zinc-100 dark:text-zinc-100 mb-4">Disk Usage</h3>
          {disk ? (
            <div className="space-y-4">
              {disk.disk && (
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-zinc-300 dark:text-zinc-300">{disk.disk.mountPoint}</span>
                    <span className="font-medium">{disk.disk.usePercent}</span>
                  </div>
                  <div className="h-2 bg-zinc-600 dark:bg-zinc-600 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-500 transition-all"
                      style={{ width: disk.disk.usePercent }}
                    ></div>
                  </div>
                  <p className="text-xs text-zinc-400 dark:text-zinc-400 mt-1">
                    {disk.disk.used} used of {disk.disk.size}
                  </p>
                </div>
              )}
              <div className="pt-4 border-t border-zinc-700 dark:border-zinc-700 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-300 dark:text-zinc-300">Logs Directory</span>
                  <span className="font-medium text-zinc-300 dark:text-zinc-300">{disk.directories.logs.size}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-300 dark:text-zinc-300">Downloads Directory</span>
                  <span className="font-medium text-zinc-300 dark:text-zinc-300">{disk.directories.downloads.size}</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-400 dark:text-zinc-400">Loading...</p>
          )}
        </div>
      </div>

      {/* PM2 Processes */}
      <div className="bg-zinc-800 dark:bg-zinc-800 rounded-lg border border-zinc-700 dark:border-zinc-700 p-6">
        <h3 className="font-semibold text-zinc-100 dark:text-zinc-100 mb-4">PM2 Processes</h3>
        {!processes?.pm2Available ? (
          <p className="text-sm text-zinc-400 dark:text-zinc-400">PM2 not available</p>
        ) : processes.processes.length === 0 ? (
          <p className="text-sm text-zinc-400 dark:text-zinc-400">No processes running</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-zinc-300 dark:text-zinc-300 border-b border-zinc-700 dark:border-zinc-700">
                  <th className="pb-3 font-medium">Name</th>
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 font-medium">CPU</th>
                  <th className="pb-3 font-medium">Memory</th>
                  <th className="pb-3 font-medium">Uptime</th>
                  <th className="pb-3 font-medium">Restarts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-700 dark:divide-zinc-700">
                {processes.processes.map((proc) => (
                  <tr key={proc.name}>
                    <td className="py-3 font-medium text-zinc-100 dark:text-zinc-100">{proc.name}</td>
                    <td className="py-3 px-6">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        proc.status === 'online' ? 'bg-green-900 text-green-200' : 'bg-red-900 text-red-200'
                      }`}>
                        {proc.status}
                      </span>
                    </td>
                    <td className="py-3 text-zinc-300 dark:text-zinc-300">{proc.cpu}</td>
                    <td className="py-3 text-zinc-300 dark:text-zinc-300">{proc.memory}</td>
                    <td className="py-3 text-zinc-300 dark:text-zinc-300">{proc.uptime}</td>
                    <td className="py-3 text-zinc-300 dark:text-zinc-300">{proc.restarts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Token Status */}
      <div className="bg-zinc-800 dark:bg-zinc-800 rounded-lg border border-zinc-700 dark:border-zinc-700 p-6">
        <h3 className="font-semibold text-zinc-100 dark:text-zinc-100 mb-4">OAuth Token Status</h3>
        {tokenStatus ? (
          <div className="flex items-center justify-between">
            <div>
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium ${
                tokenStatus.status === 'healthy' ? 'bg-green-900 bg-opacity-30 text-green-300' :
                tokenStatus.status === 'warning' ? 'bg-yellow-900 bg-opacity-30 text-yellow-300' :
                'bg-red-900 bg-opacity-30 text-red-300'
              }`}>
                {tokenStatus.status ? tokenStatus.status.toUpperCase() : 'UNKNOWN'}
              </span>
              <p className="text-sm text-zinc-300 dark:text-zinc-300 mt-2">{tokenStatus.message}</p>
            </div>
            {tokenStatus.expiresInMinutes !== null && tokenStatus.expiresInMinutes !== undefined && (
              <div className="text-right">
                <p className="text-2xl font-bold text-zinc-100 dark:text-zinc-100">
                  {tokenStatus.expiresInMinutes > 60 
                    ? `${Math.floor(tokenStatus.expiresInMinutes / 60)}h`
                    : `${tokenStatus.expiresInMinutes}m`
                  }
                </p>
                <p className="text-sm text-zinc-400 dark:text-zinc-400">until expiry</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-zinc-400 dark:text-zinc-400">Loading...</p>
        )}
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
  return `${minutes}m ${seconds % 60}s`
}
