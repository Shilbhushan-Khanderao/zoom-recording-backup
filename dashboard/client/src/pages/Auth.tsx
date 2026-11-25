import { useState, useEffect } from 'react'
import { ShieldCheck, Key, Link as LinkIcon, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react'

interface AuthStatus {
  google: { authenticated: boolean }
  zoom: { authenticated: boolean }
  timestamp: string
}

export default function Auth() {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [authUrl, setAuthUrl] = useState<string | null>(null)
  const [authCode, setAuthCode] = useState('')
  const [submittingCode, setSubmittingCode] = useState(false)
  const [message, setMessage] = useState<{type: 'success' | 'error', text: string} | null>(null)

  const fetchStatus = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/auth/status')
      const data = await res.json()
      setStatus(data)
    } catch (error) {
      console.error('Failed to fetch auth status', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStatus()
  }, [])

  const handleGetGoogleUrl = async () => {
    try {
      setMessage(null)
      const res = await fetch('/api/auth/google/url')
      const data = await res.json()
      if (data.url) {
        setAuthUrl(data.url)
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to get URL' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error generating URL' })
    }
  }

  const handleSubmitCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!authCode.trim()) return

    try {
      setSubmittingCode(true)
      setMessage(null)
      const res = await fetch('/api/auth/google/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: authCode.trim() })
      })
      const data = await res.json()
      
      if (res.ok) {
        setMessage({ type: 'success', text: 'Google authentication successful!' })
        setAuthCode('')
        setAuthUrl(null)
        fetchStatus() // Refresh status
      } else {
        setMessage({ type: 'error', text: data.error || 'Authentication failed' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error during authentication' })
    } finally {
      setSubmittingCode(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-100">Auth Management</h2>
          <p className="text-sm text-zinc-400 mt-1">Manage API tokens for Zoom and Google Drive integrations.</p>
        </div>
        <button
          onClick={fetchStatus}
          className="flex items-center px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-md text-sm font-medium text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh Status
        </button>
      </div>

      {message && (
        <div className={`p-4 rounded-md border ${message.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'} flex items-center`}>
          {message.type === 'success' ? <CheckCircle2 className="w-5 h-5 mr-3" /> : <AlertCircle className="w-5 h-5 mr-3" />}
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Google Drive Auth Card */}
        <div className="bg-[#09090b] border border-zinc-800/50 rounded-xl overflow-hidden shadow-sm flex flex-col relative">
          <div className="p-6 flex-1">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 bg-blue-500/10 rounded-lg border border-blue-500/20">
                  <ShieldCheck className="w-6 h-6 text-blue-400" />
                </div>
                <h3 className="text-lg font-medium text-zinc-100">Google Drive</h3>
              </div>
              {status?.google?.authenticated ? (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Connected
                </span>
              ) : (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                  Disconnected
                </span>
              )}
            </div>
            
            <p className="text-sm text-zinc-400 mb-6">
              OAuth2 connection used to upload Zoom recordings to your Google Drive folder.
            </p>

            {!status?.google?.authenticated && !authUrl && (
              <button
                onClick={handleGetGoogleUrl}
                className="w-full flex items-center justify-center px-4 py-2.5 bg-zinc-100 text-zinc-900 rounded-md text-sm font-semibold hover:bg-white transition-colors"
              >
                <LinkIcon className="w-4 h-4 mr-2" />
                Connect Google Drive
              </button>
            )}

            {authUrl && (
              <div className="space-y-4 bg-zinc-900/50 p-4 rounded-lg border border-zinc-800">
                <p className="text-sm text-zinc-300">
                  1. Click the link below to authorize access.
                  <br/>
                  2. Copy the authorization code provided by Google.
                  <br/>
                  3. Paste it here to complete setup.
                </p>
                <a 
                  href={authUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="block text-sm text-blue-400 hover:text-blue-300 break-all bg-zinc-950 p-2 rounded border border-zinc-800"
                >
                  {authUrl}
                </a>
                
                <form onSubmit={handleSubmitCode} className="mt-4 flex gap-2">
                  <input
                    type="text"
                    value={authCode}
                    onChange={(e) => setAuthCode(e.target.value)}
                    placeholder="Enter authorization code"
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    required
                  />
                  <button
                    type="submit"
                    disabled={submittingCode || !authCode.trim()}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submittingCode ? 'Verifying...' : 'Submit'}
                  </button>
                </form>
              </div>
            )}
            
            {status?.google?.authenticated && (
              <button
                onClick={handleGetGoogleUrl}
                className="w-full flex items-center justify-center px-4 py-2 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-md text-sm font-medium hover:bg-zinc-800 hover:text-zinc-100 transition-colors mt-4"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Re-authenticate
              </button>
            )}
          </div>
        </div>

        {/* Zoom Auth Card */}
        <div className="bg-[#09090b] border border-zinc-800/50 rounded-xl overflow-hidden shadow-sm flex flex-col relative">
          <div className="p-6 flex-1">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 bg-indigo-500/10 rounded-lg border border-indigo-500/20">
                  <Key className="w-6 h-6 text-indigo-400" />
                </div>
                <h3 className="text-lg font-medium text-zinc-100">Zoom API</h3>
              </div>
              {status?.zoom?.authenticated ? (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Connected
                </span>
              ) : (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  Setup Required
                </span>
              )}
            </div>
            
            <p className="text-sm text-zinc-400 mb-6">
              Server-to-Server OAuth connection used to list and download your Zoom cloud recordings.
            </p>

            <div className="bg-zinc-900/50 p-4 rounded-lg border border-zinc-800 mb-4">
              <p className="text-sm text-zinc-300">
                Zoom API tokens are managed automatically via your Server-to-Server OAuth credentials.
                <br/><br/>
                If this shows as Setup Required, please run <code>node cli.js config-setup</code> in your terminal to provide your Zoom Client ID and Secret.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
