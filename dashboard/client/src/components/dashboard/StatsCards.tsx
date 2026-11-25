import { Database, AlertTriangle, CheckCircle, Files } from 'lucide-react'

interface StatsCardsProps {
  today?: {
    backups: number
    successful: number
    failed: number
    filesProcessed: number
    totalSize: number
    successRate: number
  }
  allTime?: {
    totalBackups: number
    successful: number
    filesProcessed: number
    totalSize: number
  }
  activeAlerts: number
}

const formatNumber = (num: number) => new Intl.NumberFormat('en-US').format(num)

export default function StatsCards({ today, allTime, activeAlerts }: StatsCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mt-6">
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 hover:border-zinc-700 hover:shadow-[0_0_15px_rgba(59,130,246,0.15)] transition-all duration-300 group">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-zinc-400">Total Backups</h3>
          <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 group-hover:bg-blue-500/20 transition-colors">
            <Database className="w-5 h-5 text-blue-500" />
          </div>
        </div>
        <p className="text-3xl font-bold text-zinc-100 font-mono tracking-tight">{today?.backups || 0}</p>
        <p className="text-sm text-zinc-500 mt-2 flex items-center font-mono">
          <span className="text-zinc-400 mr-2">All time:</span> {allTime?.totalBackups || 0}
        </p>
      </div>

      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 hover:border-zinc-700 hover:shadow-[0_0_15px_rgba(16,185,129,0.15)] transition-all duration-300 group">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-zinc-400">Success Rate</h3>
          <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 group-hover:bg-emerald-500/20 transition-colors">
            <CheckCircle className="w-5 h-5 text-emerald-500" />
          </div>
        </div>
        <p className="text-3xl font-bold text-zinc-100 font-mono tracking-tight">{today?.successRate || 100}%</p>
        <p className="text-sm text-zinc-500 mt-2 flex items-center font-mono">
          <span className="text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded mr-2">{today?.successful || 0}</span> successful
        </p>
      </div>

      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 hover:border-zinc-700 hover:shadow-[0_0_15px_rgba(168,85,247,0.15)] transition-all duration-300 group">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-zinc-400">Files Processed</h3>
          <div className="p-2 rounded-lg bg-purple-500/10 border border-purple-500/20 group-hover:bg-purple-500/20 transition-colors">
            <Files className="w-5 h-5 text-purple-400" />
          </div>
        </div>
        <p className="text-3xl font-bold text-zinc-100 font-mono tracking-tight">{formatNumber(today?.filesProcessed || 0)}</p>
        <p className="text-sm text-zinc-500 mt-2 flex items-center font-mono">
          <span className="text-zinc-400 mr-2">Total:</span> {formatNumber(allTime?.filesProcessed || 0)}
        </p>
      </div>

      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 hover:border-zinc-700 hover:shadow-[0_0_15px_rgba(249,115,22,0.15)] transition-all duration-300 group">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-zinc-400">Active Alerts</h3>
          <div className={`p-2 rounded-lg border transition-colors ${
            activeAlerts > 0 
              ? 'bg-orange-500/10 border-orange-500/20 text-orange-500 group-hover:bg-orange-500/20' 
              : 'bg-zinc-800/50 border-zinc-700/50 text-zinc-500'
          }`}>
            <AlertTriangle className="w-5 h-5" />
          </div>
        </div>
        <p className={`text-3xl font-bold font-mono tracking-tight ${activeAlerts > 0 ? 'text-orange-500' : 'text-zinc-100'}`}>
          {activeAlerts}
        </p>
        <p className="text-sm text-zinc-500 mt-2">
          {activeAlerts === 0 ? 'All systems nominal' : 'Action required'}
        </p>
      </div>
    </div>
  )
}
