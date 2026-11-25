import { useLocation } from 'react-router-dom'
import { RefreshCw, Bell } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { alertsApi } from '../../services/api'

const pageTitles: Record<string, string> = {
  '/': 'Dashboard Overview',
  '/backups': 'Backup Management',
  '/system': 'System Health',
  '/logs': 'Log Viewer',
  '/alerts': 'Alert Center',
}

export default function Header() {
  const location = useLocation()
  const title = pageTitles[location.pathname] || 'Dashboard'

  const { data: alertsData } = useQuery({
    queryKey: ['alerts', 'active'],
    queryFn: () => alertsApi.getActive(),
    refetchInterval: 30000, // Refresh every 30 seconds
  })

  const activeAlerts = alertsData?.totalActive || 0
  const criticalAlerts = alertsData?.summary?.critical || 0

  return (
    <header className="h-16 bg-zinc-950/80 backdrop-blur-xl border-b border-zinc-800/50 flex items-center justify-between px-6 sticky top-0 z-20">
      <h2 className="text-xl font-semibold text-zinc-100 tracking-tight">{title}</h2>
      
      <div className="flex items-center space-x-4">
        {/* Refresh indicator */}
        <button 
          className="p-2 text-zinc-400 hover:text-white hover:bg-white/5 rounded-xl transition-all duration-300 hover:scale-105 active:scale-95"
          title="Data auto-refreshes"
        >
          <RefreshCw className="w-5 h-5" />
        </button>

        {/* Alerts indicator */}
        <button className="relative p-2 text-zinc-400 hover:text-white hover:bg-white/5 rounded-xl transition-all duration-300 hover:scale-105 active:scale-95">
          <Bell className="w-5 h-5" />
          {activeAlerts > 0 && (
            <span 
              className={`absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center text-xs font-bold text-white rounded-full ring-2 ring-zinc-950 animate-pulse ${
                criticalAlerts > 0 ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]' : 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]'
              }`}
            >
              {activeAlerts > 9 ? '9+' : activeAlerts}
            </span>
          )}
        </button>

        {/* Status badge */}
        <div className="flex items-center px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full backdrop-blur-md">
          <span className="w-2 h-2 bg-emerald-400 rounded-full mr-2 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse"></span>
          <span className="text-sm font-semibold text-emerald-300 tracking-wide font-mono">System Online</span>
        </div>
      </div>
    </header>
  )
}
