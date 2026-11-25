import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { DailyStats } from '../../types'
import { Loader2 } from 'lucide-react'

interface BackupChartProps {
  stats: DailyStats[]
  isLoading: boolean
}

export default function BackupChart({ stats, isLoading }: BackupChartProps) {
  // Format data for chart (reverse to show oldest first)
  const chartData = [...stats].reverse().map((day) => ({
    date: new Date(day.date).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    }),
    successful: day.successful,
    failed: day.failed,
    total: day.total_backups,
  }))

  if (isLoading) {
    return (
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
        <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-4">Backup Activity</h3>
        <div className="h-96 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
        </div>
      </div>
    )
  }

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
      <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-6 flex items-center">
        Backup Activity <span className="text-xs text-zinc-500 ml-2">(Last 6 Months)</span>
      </h3>
      
      {chartData.length === 0 ? (
        <div className="h-80 flex items-center justify-center text-zinc-500">
          <div className="flex flex-col items-center">
            <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mb-3">
              <span className="text-xl opacity-50">📊</span>
            </div>
            <p className="text-sm">No backup data available</p>
          </div>
        </div>
      ) : (
        <div className="h-80 font-mono">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="successGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="failedGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis 
                dataKey="date" 
                stroke="#71717a"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                dy={10}
                style={{ fontFamily: 'Fira Code' }}
              />
              <YAxis 
                stroke="#71717a"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                dx={-10}
                style={{ fontFamily: 'Fira Code' }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#09090b',
                  border: '1px solid #27272a',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)',
                  color: '#f4f4f5',
                  padding: '10px',
                  fontSize: '12px',
                  fontFamily: 'Fira Code'
                }}
                itemStyle={{
                  color: '#e4e4e7',
                  fontWeight: 500,
                  fontSize: '13px',
                  fontFamily: 'Fira Code'
                }}
              />
              <Legend 
                verticalAlign="top" 
                height={36}
                iconType="circle"
                wrapperStyle={{ fontSize: '11px', color: '#71717a', fontFamily: 'Fira Sans' }}
              />
              <Area
                type="monotone"
                dataKey="successful"
                stroke="#3b82f6"
                fillOpacity={1}
                fill="url(#successGradient)"
                strokeWidth={2}
                name="Successful"
                activeDot={{ r: 4, strokeWidth: 0, fill: '#60a5fa' }}
              />
              <Area
                type="monotone"
                dataKey="failed"
                stroke="#ef4444"
                fillOpacity={1}
                fill="url(#failedGradient)"
                strokeWidth={2}
                name="Failed"
                activeDot={{ r: 4, strokeWidth: 0, fill: '#f87171' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
