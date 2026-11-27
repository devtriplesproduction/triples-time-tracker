import React, { useState } from 'react'
import { X, Sliders, RefreshCw, LogOut, Check, History, ChevronDown, ChevronUp } from 'lucide-react'
import type { AppSettings, UserProfile, TimeResetAuditRecord } from '../types'
import { formatSecondsToHHMMSS } from '../utils/timeCalculator'

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
  const [launchOnStartup, setLaunchOnStartup] = useState(settings.launchOnStartup !== false)
  const [timezone, setTimezone] = useState(settings.timezone || 'Asia/Kolkata')
  const [syncing, setSyncing] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAuditLogs, setShowAuditLogs] = useState<boolean>(false)
  const [auditLogs, setAuditLogs] = useState<TimeResetAuditRecord[]>([])
  const [loadingLogs, setLoadingLogs] = useState<boolean>(false)

  const handleToggleAuditLogs = async () => {
    if (!showAuditLogs) {
      setShowAuditLogs(true)
      if (window.electronAPI?.getResetAuditLogs) {
        setLoadingLogs(true)
        try {
          const res = await window.electronAPI.getResetAuditLogs()
          if (res.success && res.logs) {
            setAuditLogs(res.logs)
          }
        } finally {
          setLoadingLogs(false)
        }
      }
    } else {
      setShowAuditLogs(false)
    }
  }

  // Keep state in sync with props
  React.useEffect(() => {
    setIdleThreshold(settings.idleThresholdSeconds || 60)
    setMinimizeToTray(settings.minimizeToTray)
    setLaunchOnStartup(settings.launchOnStartup !== false)
    setTimezone(settings.timezone || 'Asia/Kolkata')
  }, [settings])

  if (!isOpen) return null

  const roleUpper = (user?.role || '').toUpperCase()
  const isAdmin = roleUpper === 'ADMIN' || roleUpper === 'SUPER_ADMIN' || roleUpper === 'SUPER ADMIN'

  const handleSave = async () => {
    setError(null)
    const payload: Partial<AppSettings> = {
      minimizeToTray,
      launchOnStartup,
      timezone
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
        className="w-full max-w-sm max-h-[calc(100vh-2rem)] flex flex-col rounded-2xl border p-5 shadow-2xl transition-all"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-color)',
          color: 'var(--text-primary)'
        }}
      >
        <div className="shrink-0 flex items-center justify-between pb-3 border-b mb-4" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex items-center gap-2">
            <Sliders size={18} style={{ color: 'var(--text-secondary)' }} />
            <h3 className="text-sm font-bold">Tracker Settings</h3>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover-surface"
            style={{ color: 'var(--text-secondary)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div className="shrink-0 mb-3 p-2 rounded-lg text-xs bg-red-500/15 text-red-400 border border-red-500/25 font-medium flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-2 font-bold hover:text-red-300">✕</button>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4 text-xs">
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
                  className={`py-1.5 rounded-lg border font-medium text-xs transition-all ${!isAdmin
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

          {/* Timezone Configuration */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="font-semibold">Work Timezone</span>
              <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                {timezone === 'Asia/Kolkata' ? 'IST (UTC+5:30)' : timezone}
              </span>
            </div>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full py-1.5 px-2 rounded-lg border text-xs outline-none transition-all cursor-pointer"
              style={{
                backgroundColor: 'var(--bg-surface-elevated)',
                borderColor: 'var(--border-color)',
                color: 'var(--text-primary)'
              }}
            >
              <option value="Asia/Kolkata">Asia/Kolkata (IST - UTC+05:30)</option>
              <option value="UTC">UTC (Coordinated Universal Time)</option>
              <option value="America/New_York">America/New_York (EST/EDT)</option>
              <option value="Europe/London">Europe/London (GMT/BST)</option>
              <option value="Asia/Dubai">Asia/Dubai (GST - UTC+04:00)</option>
            </select>
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
              className="w-4 h-4 rounded cursor-pointer"
              style={{ accentColor: 'var(--btn-primary-bg)' }}
            />
          </div>

          {/* Launch on Windows Startup */}
          <div className="flex items-center justify-between py-1">
            <div>
              <span className="font-semibold block">Launch on Windows Startup</span>
              <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                Automatically open tracker when you start or log into your laptop
              </span>
            </div>
            <input
              type="checkbox"
              checked={launchOnStartup}
              onChange={(e) => setLaunchOnStartup(e.target.checked)}
              className="w-4 h-4 rounded cursor-pointer"
              style={{ accentColor: 'var(--btn-primary-bg)' }}
            />
          </div>

          {/* Automatic Daily Time Reset & Audit Trail Section */}
          <div className="pt-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
            <div className="mb-2">
              <span className="font-semibold block">Automatic Daily Time Reset & Audit Trail</span>
              <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                Worked and Active hours automatically reset to 00:00:00 at 12:00 AM midnight in your configured timezone ({timezone === 'Asia/Kolkata' ? 'IST' : timezone}). Previous-day totals are permanently archived to the audit log.
              </span>
            </div>

            {/* View Audit Trail Collapsible */}
            <div className="mt-1">
              <button
                type="button"
                onClick={handleToggleAuditLogs}
                className="w-full py-1.5 px-2.5 rounded-lg border flex items-center justify-between text-[11px] font-medium transition-colors hover-surface"
                style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
              >
                <div className="flex items-center gap-1.5">
                  <History size={13} />
                  <span>View Time Reset & Rollover Audit Logs</span>
                </div>
                {showAuditLogs ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>

              {showAuditLogs && (
                <div
                  className="mt-2 p-2 rounded-xl border max-h-36 overflow-y-auto space-y-2 text-[11px]"
                  style={{
                    backgroundColor: 'var(--bg-surface-elevated)',
                    borderColor: 'var(--border-color)'
                  }}
                >
                  {loadingLogs ? (
                    <div className="text-center py-2 animate-pulse" style={{ color: 'var(--text-secondary)' }}>Loading audit logs...</div>
                  ) : auditLogs.length === 0 ? (
                    <div className="text-center py-2" style={{ color: 'var(--text-secondary)' }}>No reset events recorded yet.</div>
                  ) : (
                    auditLogs.map((log) => (
                      <div
                        key={log.id}
                        className="p-2 rounded-lg border text-[10px]"
                        style={{
                          backgroundColor: 'var(--bg-surface)',
                          borderColor: 'var(--border-color)'
                        }}
                      >
                        <div className="flex items-center justify-between font-bold">
                          <span className={
                            log.reset_type === 'automatic_daily_reset'
                              ? 'text-sky-500'
                              : log.reset_type === 'discard_session'
                                ? 'text-red-500'
                                : 'text-amber-500'
                          }>
                            {log.reset_type === 'automatic_daily_reset'
                              ? 'Daily Midnight Reset'
                              : log.reset_type === 'discard_session'
                                ? 'Session Discarded'
                                : 'Session Restarted'}
                          </span>
                          <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>
                            {new Date(log.created_at).toLocaleDateString()} {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="mt-0.5" style={{ color: 'var(--text-primary)' }}>
                          Archived Worked: <span className="font-mono font-semibold text-emerald-500">{formatSecondsToHHMMSS(log.previous_worked_seconds)}</span>
                          {log.previous_active_seconds !== undefined && (
                            <span className="ml-2">
                              Active: <span className="font-mono font-semibold text-sky-500">{formatSecondsToHHMMSS(log.previous_active_seconds)}</span>
                            </span>
                          )}
                        </div>
                        <div className="truncate mt-0.5" style={{ color: 'var(--text-secondary)' }} title={log.reason}>
                          {log.reason}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions: Sync, Save, and Sign Out */}
        <div className="shrink-0 pt-3 mt-3 border-t space-y-2 text-xs" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex items-center gap-2">
            <button
              onClick={handleManualSync}
              disabled={syncing}
              className="flex-1 py-2 px-3 rounded-lg border font-medium flex items-center justify-center gap-1.5 transition-colors hover-surface"
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
  )
}
