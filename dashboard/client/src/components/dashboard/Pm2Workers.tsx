import { useQuery } from '@tanstack/react-query'
import { systemApi } from '../../services/api'
import { Server, Loader2, Activity } from 'lucide-react'

export default function Pm2Workers() {
  const { data: processes, isLoading: procLoading } = useQuery({
    queryKey: ['system', 'processes'],
    queryFn: systemApi.getProcesses,
    refetchInterval: 30000,
  })

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 hover:border-zinc-700 hover:shadow-[0_0_15px_rgba(139,92,246,0.1)] transition-all duration-300 h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium text-zinc-100 flex items-center">
          <Server className="w-5 h-5 mr-2 text-zinc-400" /> PM2 Workers
        </h3>
        {procLoading && <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />}
      </div>

      {processes?.pm2Available ? (
        <div className="space-y-2 overflow-auto max-h-[300px] pr-2 custom-scrollbar">
          {processes.processes.map(proc => (
            <div key={proc.pid} className="flex items-center justify-between p-3 rounded-lg bg-zinc-800/30 border border-zinc-800 hover:bg-zinc-800/50 transition-colors">
              <div className="flex items-center">
                <div className={`w-2 h-2 rounded-full mr-3 ${proc.status === 'online' ? 'bg-emerald-400' : 'bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.6)]'}`}></div>
                <div>
                  <p className="text-sm font-medium text-zinc-300 font-mono">{proc.name}</p>
                  <p className="text-xs text-zinc-500 font-mono">Up: {proc.uptime} • Restarts: {proc.restarts}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium text-zinc-300 font-mono">{proc.memory}</p>
                <p className="text-xs text-zinc-500 font-mono"><Activity className="w-3 h-3 inline mr-1 opacity-70"/>{proc.cpu}%</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-center h-[200px] text-zinc-500 text-sm border border-dashed border-zinc-800 rounded-lg font-mono">
          PM2 Not Available
        </div>
      )}
    </div>
  )
}
