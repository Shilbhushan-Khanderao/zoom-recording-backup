import { useState, useEffect } from 'react'
import { Search, Calendar, User, DownloadCloud, AlertCircle, CheckCircle2, Loader2, PlaySquare } from 'lucide-react'
import { formatBytes } from '../utils/formatters'

interface ZoomUser {
  id: string
  email: string
  name: string
}

interface ZoomFile {
  id: string
  file_type: string
  download_url: string
  file_size: number
}

interface ZoomRecording {
  id: string
  uuid: string
  topic: string
  start_time: string
  duration: number
  total_size: number
  recording_files: ZoomFile[]
}

export default function Explorer() {
  const [users, setUsers] = useState<ZoomUser[]>([])
  const [loadingUsers, setLoadingUsers] = useState(true)
  
  const [selectedUser, setSelectedUser] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [topicSearch, setTopicSearch] = useState('')
  
  const [recordings, setRecordings] = useState<ZoomRecording[]>([])
  const [loadingRecordings, setLoadingRecordings] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  
  const [selectedRecordings, setSelectedRecordings] = useState<Set<string>>(new Set())
  const [triggeringBackup, setTriggeringBackup] = useState(false)
  
  const [message, setMessage] = useState<{type: 'success' | 'error', text: string} | null>(null)

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await fetch('/api/zoom/users')
        const data = await res.json()
        if (data.users) {
          setUsers(data.users)
          if (data.users.length > 0) setSelectedUser(data.users[0].id)
        }
      } catch (error) {
        console.error('Failed to fetch users', error)
      } finally {
        setLoadingUsers(false)
      }
    }
    fetchUsers()
  }, [])

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedUser) return

    try {
      setLoadingRecordings(true)
      setMessage(null)
      setSelectedRecordings(new Set())
      
      const res = await fetch(`/api/zoom/recordings?userId=${selectedUser}&fromDate=${fromDate}&toDate=${toDate}${topicSearch ? `&topic=${encodeURIComponent(topicSearch)}` : ''}`)
      const data = await res.json()
      
      if (res.ok) {
        setRecordings(data.recordings || [])
        setHasSearched(true)
      } else {
        setMessage({ type: 'error', text: data.message || 'Failed to fetch recordings' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error fetching recordings' })
    } finally {
      setLoadingRecordings(false)
    }
  }

  const toggleRecording = (id: string) => {
    const newSelected = new Set(selectedRecordings)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedRecordings(newSelected)
  }

  const toggleAll = () => {
    if (selectedRecordings.size === recordings.length && recordings.length > 0) {
      setSelectedRecordings(new Set())
    } else {
      setSelectedRecordings(new Set(recordings.map(r => r.uuid)))
    }
  }

  const handleBackupSelected = async () => {
    if (selectedRecordings.size === 0) return

    // Extract exact MP4 files to backup
    const filesToBackup: {meetingId: string, fileId: string, topic: string, startTime: string, downloadUrl: string, fileSize: number}[] = []
    
    recordings.forEach(rec => {
      if (selectedRecordings.has(rec.uuid)) {
        const mp4Files = rec.recording_files.filter(f => f.file_type === 'MP4')
        mp4Files.forEach(file => {
          filesToBackup.push({
            meetingId: rec.uuid,
            fileId: file.id,
            topic: rec.topic,
            startTime: rec.start_time,
            downloadUrl: file.download_url,
            fileSize: file.file_size
          })
        })
      }
    })

    if (filesToBackup.length === 0) {
      setMessage({ type: 'error', text: 'Selected recordings have no MP4 files to backup.' })
      return
    }

    try {
      setTriggeringBackup(true)
      setMessage(null)
      
      const res = await fetch('/api/backups/trigger-specific', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: filesToBackup })
      })
      
      const data = await res.json()
      
      if (res.ok) {
        setMessage({ type: 'success', text: `Backup job started for ${filesToBackup.length} file(s)! Check Dashboard.` })
        setSelectedRecordings(new Set())
      } else {
        setMessage({ type: 'error', text: data.message || 'Failed to start backup' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error starting backup' })
    } finally {
      setTriggeringBackup(false)
    }
  }



  return (
    <div className="space-y-6 pb-24">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-zinc-100">Recordings Explorer</h2>
        <p className="text-sm text-zinc-400 mt-1">Browse and manually select Zoom recordings to backup.</p>
      </div>

      {message && (
        <div className={`p-4 rounded-md border ${message.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'} flex items-center`}>
          {message.type === 'success' ? <CheckCircle2 className="w-5 h-5 mr-3" /> : <AlertCircle className="w-5 h-5 mr-3" />}
          {message.text}
        </div>
      )}

      {/* Search Filters */}
      <div className="bg-[#09090b] border border-zinc-800/50 rounded-xl p-5 shadow-sm">
        <form onSubmit={handleSearch} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className="space-y-1.5 md:col-span-3">
            <label className="text-xs font-medium text-zinc-400 flex items-center">
              <User className="w-3.5 h-3.5 mr-1.5" /> Account
            </label>
            <select
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
              disabled={loadingUsers}
              required
            >
              <option value="">{loadingUsers ? 'Loading accounts...' : 'Select a user...'}</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
              ))}
            </select>
          </div>
          
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-xs font-medium text-zinc-400 flex items-center">
              <Calendar className="w-3.5 h-3.5 mr-1.5" /> From (Optional)
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <label className="text-xs font-medium text-zinc-400 flex items-center">
              <Calendar className="w-3.5 h-3.5 mr-1.5" /> To (Optional)
            </label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-1.5 md:col-span-3">
            <label className="text-xs font-medium text-zinc-400 flex items-center">
              <Search className="w-3.5 h-3.5 mr-1.5" /> Topic (Optional)
            </label>
            <input
              type="text"
              placeholder="Filter by topic..."
              value={topicSearch}
              onChange={(e) => setTopicSearch(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={loadingRecordings || !selectedUser}
              className="w-full flex items-center justify-center px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium transition-colors disabled:opacity-50 h-[38px]"
            >
              {loadingRecordings ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
              {loadingRecordings ? 'Searching...' : 'Search'}
            </button>
          </div>
        </form>
      </div>

      {/* Results Table */}
      {hasSearched && (
        <div className="bg-[#09090b] border border-zinc-800/50 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-zinc-400 bg-zinc-900/50 uppercase border-b border-zinc-800/50">
                <tr>
                  <th className="px-4 py-3 w-12 text-center">
                    <input 
                      type="checkbox" 
                      checked={recordings.length > 0 && selectedRecordings.size === recordings.length}
                      onChange={toggleAll}
                      className="rounded border-zinc-700 bg-zinc-900 text-blue-600 focus:ring-blue-500/20"
                    />
                  </th>
                  <th className="px-4 py-3">Topic</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Duration</th>
                  <th className="px-4 py-3 text-right">Size</th>
                  <th className="px-4 py-3 text-center">Files</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {recordings.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-zinc-500">
                      <Search className="w-8 h-8 mx-auto mb-3 opacity-20" />
                      No recordings found for the selected dates.
                    </td>
                  </tr>
                ) : (
                  recordings.map(rec => {
                    const mp4Count = rec.recording_files?.filter(f => f.file_type === 'MP4').length || 0;
                    return (
                      <tr key={rec.uuid} className={`hover:bg-zinc-900/50 transition-colors ${selectedRecordings.has(rec.uuid) ? 'bg-blue-500/5' : ''}`}>
                        <td className="px-4 py-3 text-center">
                          <input 
                            type="checkbox" 
                            checked={selectedRecordings.has(rec.uuid)}
                            onChange={() => toggleRecording(rec.uuid)}
                            className="rounded border-zinc-700 bg-zinc-900 text-blue-600 focus:ring-blue-500/20"
                          />
                        </td>
                        <td className="px-4 py-3 font-medium text-zinc-200">
                          {rec.topic}
                        </td>
                        <td className="px-4 py-3 text-zinc-400">
                          {new Date(rec.start_time).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right text-zinc-400">
                          {rec.duration} min
                        </td>
                        <td className="px-4 py-3 text-right text-zinc-400">
                          {formatBytes(rec.total_size)}
                        </td>
                        <td className="px-4 py-3 text-center text-zinc-400">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-zinc-800">
                            <PlaySquare className="w-3 h-3 mr-1" />
                            {mp4Count} MP4
                          </span>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Floating Action Button */}
      {selectedRecordings.size > 0 && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 ml-32 z-50 animate-in slide-in-from-bottom-10 fade-in duration-300">
          <div className="bg-zinc-900 border border-zinc-700 shadow-2xl rounded-full px-6 py-4 flex items-center space-x-6">
            <span className="text-sm font-medium text-zinc-200">
              <strong className="text-white">{selectedRecordings.size}</strong> recordings selected
            </span>
            <button
              onClick={handleBackupSelected}
              disabled={triggeringBackup}
              className="flex items-center px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-full text-sm font-semibold shadow-lg shadow-blue-500/20 transition-all disabled:opacity-50 hover:scale-105 active:scale-95"
            >
              {triggeringBackup ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <DownloadCloud className="w-4 h-4 mr-2" />
              )}
              {triggeringBackup ? 'Starting Backup...' : 'Backup Selected'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
