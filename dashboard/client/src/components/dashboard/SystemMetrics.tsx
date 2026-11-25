import { useQuery } from '@tanstack/react-query'
import { systemApi } from '../../services/api'
import { HardDrive, Cpu, Server, Loader2, Activity } from 'lucide-react'

export default function SystemMetrics() {
  const { data: disk, isLoading: diskLoading } = useQuery({
    queryKey: ['system', 'disk'],
    queryFn: systemApi.getDisk,
    refetchInterval: 60000,
  })

  const { data: memory, isLoading: memoryLoading } = useQuery({
    queryKey: ['system', 'memory'],
    queryFn: systemApi.getMemory,
    refetchInterval: 15000,
  })

  const { data: processes, isLoading: procLoading } = useQuery({
    queryKey: ['system', 'processes'],
    queryFn: systemApi.getProcesses,
    refetchInterval: 30000,
  })

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
      {/* Disk Usage */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 hover:border-zinc-700 transition-colors">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-medium text-zinc-100 flex items-center">
            <HardDrive className="w-5 h-5 mr-2 text-zinc-400" /> Disk Usage
          </h3>
          {diskLoading && <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />}
        </div>
        
        {disk ? (
          <div className="space-y-4">
            {disk.disk && (
              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-zinc-400 uppercase tracking-wider">Main Storage ({disk.disk.usePercent})</span>
                  <span className="text-zinc-300 font-medium">{disk.disk.used} / {disk.disk.size}</span>
                </div>
                <div className="w-full bg-zinc-800 rounded-full h-1.5">
                  <div 
                    className={`h-1.5 rounded-full ${parseInt(disk.disk.usePercent) > 85 ? 'bg-red-500' : 'bg-blue-500'}`}
                    style={{ width: disk.disk.usePercent }}
                  ></div>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-zinc-800/50">
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Downloads Dir</p>
                <p className="text-sm font-medium text-zinc-300">{disk.directories.downloads.size}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Logs Dir</p>
                <p className="text-sm font-medium text-zinc-300">{disk.directories.logs.size}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-zinc-500 text-sm">Failed to load disk metrics</div>
        )}
      </div>

      {/* Memory Usage */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 hover:border-zinc-700 transition-colors">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-medium text-zinc-100 flex items-center">
            <Cpu className="w-5 h-5 mr-2 text-zinc-400" /> Memory Usage
          </h3>
          {memoryLoading && <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />}
        </div>

        {memory ? (
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-zinc-400 uppercase tracking-wider">System RAM ({Math.round(memory.system.usedPercent)}%)</span>
                <span className="text-zinc-300 font-medium">{memory.system.used} / {memory.system.total}</span>
              </div>
              <div className="w-full bg-zinc-800 rounded-full h-1.5">
                <div 
                  className={`h-1.5 rounded-full ${memory.system.usedPercent > 85 ? 'bg-red-500' : 'bg-cyan-500'}`}
                  style={{ width: `${Math.min(100, memory.system.usedPercent)}%` }}
                ></div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-zinc-800/50">
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Node Heap Used</p>
                <p className="text-sm font-medium text-zinc-300">{memory.process.heapUsed}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">RSS</p>
                <p className="text-sm font-medium text-zinc-300">{memory.process.rss}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-zinc-500 text-sm">Failed to load memory metrics</div>
        )}
      </div>

      {/* PM2 Processes */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 hover:border-zinc-700 transition-colors">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-zinc-100 flex items-center">
            <Server className="w-5 h-5 mr-2 text-zinc-400" /> PM2 Workers
          </h3>
          {procLoading && <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />}
        </div>

        {processes?.pm2Available ? (
          <div className="space-y-2 overflow-auto max-h-[140px] pr-2 custom-scrollbar">
            {processes.processes.map(proc => (
              <div key={proc.pid} className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-800/30 border border-zinc-800 hover:bg-zinc-800/50 transition-colors">
                <div className="flex items-center">
                  <div className={`w-2 h-2 rounded-full mr-3 ${proc.status === 'online' ? 'bg-emerald-400' : 'bg-red-400'}`}></div>
                  <div>
                    <p className="text-sm font-medium text-zinc-300">{proc.name}</p>
                    <p className="text-[10px] text-zinc-500">Up: {proc.uptime} • Restarts: {proc.restarts}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-zinc-300">{proc.memory}</p>
                  <p className="text-[10px] text-zinc-500"><Activity className="w-2.5 h-2.5 inline mr-1 opacity-70"/>{proc.cpu}%</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-[120px] text-zinc-500 text-sm border border-dashed border-zinc-800 rounded-lg">
            PM2 Not Available
          </div>
        )}
      </div>
    </div>
  )
}
