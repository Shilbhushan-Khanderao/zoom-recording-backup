import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  HardDrive,
  Activity,
  FileText,
  Bell,
  Database,
  Search,
  Key
} from 'lucide-react'

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/backups', label: 'Backups', icon: Database },
  { path: '/system', label: 'System', icon: Activity },
  { path: '/explorer', label: 'Explorer', icon: Search },
  { path: '/auth', label: 'Auth & Tokens', icon: Key },
  { path: '/logs', label: 'Logs', icon: FileText },
  { path: '/alerts', label: 'Alerts', icon: Bell },
]

export default function Sidebar() {
  return (
    <aside className="w-64 bg-[#09090b] border-r border-zinc-800/50 flex flex-col z-30 relative">
      {/* Logo */}
      <div className="h-16 flex items-center px-6 border-b border-zinc-800/50">
        <div className="w-8 h-8 bg-zinc-900 rounded flex items-center justify-center border border-zinc-800">
          <HardDrive className="w-4 h-4 text-zinc-100" />
        </div>
        <div className="ml-3">
          <h1 className="font-semibold text-zinc-100 tracking-tight text-sm">Zoom Backup</h1>
          <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-widest font-mono">Dashboard</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 py-6 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center px-3 py-2 rounded-md text-sm transition-colors group relative ${
                isActive
                  ? 'bg-zinc-800/50 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-zinc-300 rounded-r-full"></div>
                )}
                <item.icon className={`w-4 h-4 mr-3 ${isActive ? 'text-zinc-100' : 'text-zinc-500 group-hover:text-zinc-400'}`} />
                <span className={`font-sans ${isActive ? 'font-medium' : ''}`}>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-zinc-800/50 bg-zinc-900/20">
        <div className="text-xs text-zinc-500 font-medium flex justify-between items-center font-mono">
          <span>v1.0.0</span>
          <span className="flex items-center"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5"></div> Active</span>
        </div>
      </div>
    </aside>
  )
}
