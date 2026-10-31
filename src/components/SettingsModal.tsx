import React, { useState } from 'react'
import { X, Sliders, RefreshCw, LogOut, Check } from 'lucide-react'
import type { AppSettings, UserProfile } from '../types'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  settings: AppSettings
  user: UserProfile | null
  onSaveSettings: (settings: Partial<AppSettings>) => Promise<{ success: boolean; error?: string } | void>
  onSyncNow: () => Promise<void>
  onLogout: () => void
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  user,
  onSaveSettings,
  onSyncNow,
  onLogout
}) => {
  const [idleThreshold, setIdleThreshold] = useState(settings.idleThresholdSeconds || 60)
  const [minimizeToTray, setMinimizeToTray] = useState(settings.minimizeToTray)
  const [syncing, setSyncing] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Keep state in sync with props
  React.useEffect(() => {
    setIdleThreshold(settings.idleThresholdSeconds || 60)
    setMinimizeToTray(settings.minimizeToTray)
  }, [settings])

  if (!isOpen) return null

  const roleUpper = (user?.role || '').toUpperCase()
  const isAdmin = roleUpper === 'ADMIN' || roleUpper === 'SUPER_ADMIN' || roleUpper === 'SUPER ADMIN'

  const handleSave = async () => {
    setError(null)
    const payload: Partial<AppSettings> = {
      minimizeToTray
    }

    // Only Admin is allowed to submit idleThresholdSeconds
    if (isAdmin) {
      payload.idleThresholdSeconds = idleThreshold
    }

    try {
      const res = await onSaveSettings(payload)
      if (res && res.success === false) {
        setError(res.error || 'Failed to save settings')
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: any) {
      setError(e.message || 'Error saving settings')
    }
  }

  const handleManualSync = async () => {
    setSyncing(true)
    try {
      await onSyncNow()
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in font-sans">
      <div 
        className="w-full max-w-sm rounded-2xl border p-5 shadow-2xl transition-all"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-color)',
          color: 'var(--text-primary)'
        }}
      >
        <div className="flex items-center justify-between pb-3 border-b mb-4" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex items-center gap-2">
            <Sliders size={18} style={{ color: 'var(--text-secondary)' }} />
            <h3 className="text-sm font-bold">Tracker Settings</h3>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-white/10"
            style={{ color: 'var(--text-secondary)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-3 p-2 rounded-lg text-xs bg-red-500/15 text-red-400 border border-red-500/25 font-medium flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-2 font-bold hover:text-red-300">✕</button>
          </div>
        )}

        <div className="space-y-4 text-xs">
          {/* User Account Info */}
          {user && (
            <div className="p-3 rounded-xl border" style={{ backgroundColor: 'var(--bg-surface-elevated)', borderColor: 'var(--border-color)' }}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold">{user.first_name} {user.last_name || ''}</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold border" style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
                  {user.role}
                </span>
              </div>
              <span className="text-[11px] block truncate" style={{ color: 'var(--text-secondary)' }}>
                {user.email}
              </span>
            </div>
          )}

          {/* Inactivity Threshold */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <div className="flex items-center gap-1.5">
                <label className="font-semibold">Inactivity Threshold</label>
                {isAdmin ? (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 text-amber-500 border border-amber-500/30">
                    Admin
                  </span>
                ) : (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-medium border" style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
                    Managed by Admin
                  </span>
                )}
              </div>
              <span className="font-bold" style={{ color: 'var(--text-primary)' }}>
                {idleThreshold >= 60 ? `${idleThreshold / 60}m` : `${idleThreshold}s`}
              </span>
            </div>
            <p className="text-[11px] mb-2" style={{ color: 'var(--text-secondary)' }}>
              {isAdmin 
                ? 'Configure inactivity threshold applied to tracking sessions.' 
                : 'Marks session as idle when no keyboard or mouse activity is detected.'}
            </p>
            <div className="grid grid-cols-4 gap-1.5">
              {[30, 60, 120, 300].map((sec) => (
                <button
                  key={sec}
                  type="button"
                  disabled={!isAdmin}
                  onClick={() => {
                    if (isAdmin) setIdleThreshold(sec)
                  }}
                  title={!isAdmin ? 'Inactivity threshold is managed exclusively by Administrators' : undefined}
                  className={`py-1.5 rounded-lg border font-medium text-xs transition-all ${
                    !isAdmin 
                      ? 'opacity-50 cursor-not-allowed' 
                      : 'cursor-pointer active:scale-95'
                  }`}
                  style={{
                    backgroundColor: idleThreshold === sec 
                      ? 'var(--bg-surface)' 
                      : 'var(--bg-surface-elevated)',
                    borderColor: idleThreshold === sec 
                      ? 'var(--text-primary)' 
                      : 'var(--border-color)',
                    color: idleThreshold === sec
                      ? 'var(--text-primary)'
                      : 'var(--text-secondary)',
                    fontWeight: idleThreshold === sec ? 'bold' : 'normal'
                  }}
                >
                  {sec >= 60 ? `${sec / 60}m` : `${sec}s`}
                </button>
              ))}
            </div>
          </div>

          {/* Minimize to Tray */}
          <div className="flex items-center justify-between py-1">
            <div>
              <span className="font-semibold block">Minimize to Tray on Close</span>
              <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                Keeps active session running in the background
              </span>
            </div>
            <input
              type="checkbox"
              checked={minimizeToTray}
              onChange={(e) => setMinimizeToTray(e.target.checked)}
              className="w-4 h-4 rounded cursor-pointer accent-white"
            />
          </div>

          {/* Actions: Sync and Save */}
          <div className="flex items-center gap-2 pt-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
            <button
              onClick={handleManualSync}
              disabled={syncing}
              className="flex-1 py-2 px-3 rounded-lg border font-medium flex items-center justify-center gap-1.5 transition-colors hover:bg-white/5"
              style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
            >
              <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
              <span>{syncing ? 'Syncing...' : 'Sync Now'}</span>
            </button>

            <button
              onClick={handleSave}
              className="flex-1 py-2 px-3 rounded-lg font-bold flex items-center justify-center gap-1.5 transition-all shadow-sm"
              style={{
                backgroundColor: 'var(--btn-primary-bg)',
                color: 'var(--btn-primary-text)'
              }}
            >
              {saved ? <Check size={14} /> : null}
              <span>{saved ? 'Saved' : 'Save Changes'}</span>
            </button>
          </div>

          {/* Sign Out */}
          <div className="pt-2">
            <button
              onClick={onLogout}
              className="w-full py-2 px-3 rounded-lg font-semibold text-red-400 hover:bg-red-500/10 flex items-center justify-center gap-1.5 transition-colors"
            >
              <LogOut size={14} />
              <span>Sign Out of Tracker</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
