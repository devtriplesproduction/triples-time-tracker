import React, { useState } from 'react'
import { Lock, Mail, ArrowRight, ShieldCheck, AlertCircle } from 'lucide-react'
import type { UserProfile } from '../types'

interface LoginModalProps {
  isOpen: boolean
  onClose?: () => void
  onSuccess: (user: UserProfile) => void
  initialError?: string | null
}

export const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onSuccess, initialError }) => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(initialError || null)

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
        setError('Desktop application bridge unavailable. Cannot authenticate.')
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
        className="w-full max-w-sm rounded-2xl border p-6 shadow-2xl transition-all"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-color)',
          color: 'var(--text-primary)'
        }}
      >
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
          <div className="flex items-center gap-2 p-3 mb-4 rounded-lg text-xs bg-red-500/10 text-red-400 border border-red-500/20">
            <AlertCircle size={15} className="shrink-0" />
            <span>{error}</span>
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
