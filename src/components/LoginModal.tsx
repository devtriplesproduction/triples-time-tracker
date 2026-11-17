import React, { useState } from 'react'
import { Lock, Mail, ArrowRight, ShieldCheck, AlertCircle, Download } from 'lucide-react'
import type { UserProfile } from '../types'

interface LoginModalProps {
  isOpen: boolean
  onClose?: () => void
  onSuccess: (user: UserProfile) => void
  initialError?: string | null
}

export const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onClose, onSuccess, initialError }) => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(initialError || null)
  const isWebEnvironment = typeof window !== 'undefined' && !window.electronAPI

  React.useEffect(() => {
    if (initialError) {
      setError(initialError)
    }
  }, [initialError])

  if (!isOpen) return null

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) {
      setError('Please provide both email and password.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      if (window.electronAPI?.login) {
        const res = await window.electronAPI.login(email.trim(), password)
        if (res.success && res.user) {
          onSuccess(res.user)
          return
        } else {
          setError(res.error || 'Authentication failed. Please verify credentials.')
        }
      } else {
        setError('Desktop application bridge unavailable. TripleS Time Tracker must be run as an installed Windows Desktop Application (.exe) to track activity and sync sessions.')
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred during authentication')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in font-sans">
      <div 
        className="w-full max-w-sm rounded-2xl border p-6 shadow-2xl transition-all relative"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-color)',
          color: 'var(--text-primary)'
        }}
      >
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-xs font-semibold px-2 py-1 rounded hover:bg-white/10"
            style={{ color: 'var(--text-secondary)' }}
          >
            ✕
          </button>
        )}

        <div className="flex flex-col items-center text-center mb-5">
          <div 
            className="w-12 h-12 rounded-xl flex items-center justify-center mb-3 shadow-md border"
            style={{
              backgroundColor: 'var(--btn-primary-bg)',
              color: 'var(--btn-primary-text)',
              borderColor: 'var(--border-color)'
            }}
          >
            <ShieldCheck size={26} />
          </div>
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            Sign In to TripleS
          </h3>
          <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
            Authenticate with your canonical TripleS ERP employee credentials
          </p>
        </div>

        {error && (
          <div className="p-3 mb-4 rounded-lg text-xs bg-red-500/10 text-red-400 border border-red-500/20 space-y-2">
            <div className="flex items-start gap-2">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <span className="leading-relaxed">{error}</span>
            </div>
            {isWebEnvironment && (
              <a
                href="https://github.com/devtriplesproduction/triples-time-tracker/releases/download/v1.0.0/TripleS-Time-Tracker-Setup-1.0.0.exe"
                download="TripleS-Time-Tracker-Setup-1.0.0.exe"
                className="mt-2 w-full py-2 px-3 rounded-lg font-semibold text-xs flex items-center justify-center gap-1.5 bg-red-500/20 hover:bg-red-500/30 text-white transition-colors"
              >
                <Download size={13} />
                <span>Download Windows Installer (.exe)</span>
              </a>
            )}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-3.5">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
              Work Email
            </label>
            <div className="relative">
              <Mail size={16} className="absolute left-3 top-3" style={{ color: 'var(--text-secondary)' }} />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@tsp.com"
                className="w-full pl-9 pr-3 py-2.5 rounded-lg border text-sm outline-none transition-all"
                style={{
                  backgroundColor: 'var(--bg-surface-elevated)',
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-primary)'
                }}
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
              Password
            </label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-3" style={{ color: 'var(--text-secondary)' }} />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-9 pr-3 py-2.5 rounded-lg border text-sm outline-none transition-all"
                style={{
                  backgroundColor: 'var(--bg-surface-elevated)',
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-primary)'
                }}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-md active:scale-[0.98] disabled:opacity-50 mt-4"
            style={{
              backgroundColor: 'var(--btn-primary-bg)',
              color: 'var(--btn-primary-text)'
            }}
          >
            <span>{loading ? 'Authenticating...' : 'Sign In'}</span>
            <ArrowRight size={16} />
          </button>
        </form>
      </div>
    </div>
  )
}
