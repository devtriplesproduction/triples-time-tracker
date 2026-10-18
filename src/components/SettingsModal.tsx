import React, { useState } from 'react'
import { X, Sliders, RefreshCw, LogOut, Check, Shield } from 'lucide-react'
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
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
            <Sliders size={18} style={{ color: 'var(--accent-blue)' }} />
            <h3 className="text-sm font-bold">Tracker Settings</h3>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-slate-500/10"
            style={{ color: 'var(--text-muted)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-3 p-2 rounded-lg text-xs bg-red-500/15 text-red-500 border border-red-500/25 font-medium flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-2 font-bold hover:text-red-600">✕</button>
          </div>
        )}

        <div className="space-y-4 text-xs">
          {/* User Account Info */}
          {user && (
            <div className="p-3 rounded-xl border" style={{ backgroundColor: 'var(--bg-surface-elevated)', borderColor: 'var(--border-color)' }}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold">{user.first_name} {user.last_name || ''}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  isAdmin ? 'bg-purple-500/10 text-purple-500 border border-purple-500/20' : 'bg-blue-500/10 text-blue-500'
                }`}>
                  {user.role}
                </span>
              </div>
              <span className="text-[11px] block truncate" style={{ color: 'var(--text-muted)' }}>
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
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-slate-500/15 text-slate-400 border border-slate-500/20">
                    Managed by Admin
                  </span>
                )}
              </div>
              <span className="font-bold text-blue-500">
                {idleThreshold >= 60 ? `${idleThreshold / 60}m` : `${idleThreshold}s`}
              </span>
            </div>
            <p className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>
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
                    idleThreshold === sec 
                      ? 'border-blue-500 text-blue-500 font-bold' 
                      : ''
                  } ${
                    !isAdmin 
                      ? 'opacity-50 cursor-not-allowed' 
                      : 'hover:border-blue-400 cursor-pointer active:scale-95'
                  }`}
                  style={{
                    backgroundColor: idleThreshold === sec 
                      ? 'rgba(59, 130, 246, 0.12)' 
                      : 'var(--bg-surface-elevated)',
                    borderColor: idleThreshold === sec 
                      ? 'var(--accent-blue)' 
                      : 'var(--border-color)'
                  }}
                >
                  {sec >= 60 ? `${sec / 60}m` : `${sec}s`}
                </button>
              ))}
            </div>
            {!isAdmin && (
              <p className="text-[10px] mt-1.5 text-slate-400 italic">
                Default threshold is 1 minute (60s). Only Admin can adjust this setting.
              </p>
            )}
          </div>

          {/* Minimize to Tray */}
          <div className="flex items-center justify-between py-1">
            <div>
              <span className="font-semibold block">Minimize to Tray on Close</span>
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Keeps active session running in the background
              </span>
            </div>
            <input
              type="checkbox"
              checked={minimizeToTray}
              onChange={(e) => setMinimizeToTray(e.target.checked)}
              className="w-4 h-4 rounded text-blue-600 focus:ring-0 cursor-pointer"
            />
          </div>

          {/* Actions: Sync and Save */}
          <div className="flex items-center gap-2 pt-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
            <button
              onClick={handleManualSync}
              disabled={syncing}
              className="flex-1 py-2 px-3 rounded-lg border font-medium flex items-center justify-center gap-1.5 transition-colors hover:bg-slate-500/10"
              style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
            >
              <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
              <span>{syncing ? 'Syncing...' : 'Sync Now'}</span>
            </button>

            <button
              onClick={handleSave}
              className="flex-1 py-2 px-3 rounded-lg font-bold text-white flex items-center justify-center gap-1.5 transition-all shadow-sm"
              style={{ backgroundColor: 'var(--accent-blue)' }}
            >
              {saved ? <Check size={14} /> : null}
              <span>{saved ? 'Saved' : 'Save Changes'}</span>
            </button>
          </div>

          {/* Sign Out */}
          <div className="pt-2">
            <button
              onClick={onLogout}
              className="w-full py-2 px-3 rounded-lg font-medium text-red-500 hover:bg-red-500/10 flex items-center justify-center gap-1.5 transition-colors"
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

