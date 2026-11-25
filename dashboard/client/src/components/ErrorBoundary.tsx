import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo)
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#09090b] flex items-center justify-center p-6 font-sans">
          <div className="max-w-2xl w-full bg-red-900 bg-opacity-20 border border-red-700/50 rounded-xl p-8 shadow-[0_0_30px_rgba(239,68,68,0.15)]">
            <h1 className="text-2xl font-bold text-red-400 mb-4 tracking-wide">Application Error</h1>
            <p className="text-red-300 mb-4">
              Something went wrong. Please refresh the page or contact support.
            </p>
            {this.state.error && (
              <details className="bg-zinc-900/80 p-5 rounded-lg text-sm border border-zinc-800">
                <summary className="text-zinc-400 cursor-pointer mb-3 font-medium outline-none">Error Details</summary>
                <pre className="text-red-400 overflow-auto font-mono text-xs">
                  {this.state.error.toString()}
                  {'\n\n'}
                  {this.state.error.stack}
                </pre>
              </details>
            )}
            <button
              onClick={() => window.location.reload()}
              className="mt-6 px-6 py-2.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 hover:border-red-500/50 rounded-lg transition-all duration-300 font-medium tracking-wide"
            >
              Reload Page
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
