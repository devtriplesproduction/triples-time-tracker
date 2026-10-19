import React, { useState } from 'react'
import { User as UserIcon } from 'lucide-react'
import type { TrackingSession, TrackingStatus, UserProfile } from '../types'

interface EmployeeTimerSectionProps {
  user: UserProfile | null
  currentSession: TrackingSession | null
  todaySessions?: TrackingSession[]
  status: TrackingStatus
  onClockIn: () => Promise<void>
  onTakeBreak: () => Promise<void>
  onResume: () => Promise<void>
  onClockOut: () => Promise<void>
  onOpenLogin: () => void
}

export const EmployeeTimerSection: React.FC<EmployeeTimerSectionProps> = React.memo(({
  user,
  currentSession,
  status,
  onClockIn,
  onTakeBreak,
  onResume,
  onClockOut,
  onOpenLogin
}) => {
  const [loading, setLoading] = useState<boolean>(false)

  // A session is active strictly if user is authenticated, IDs match, and session is non-terminated
  const hasValidSession = Boolean(
    user &&
    currentSession &&
    currentSession.id &&
    currentSession.employee_id === user.id &&
    !currentSession.clock_out &&
    currentSession.status !== 'completed' &&
    currentSession.status !== 'Completed'
  )

  const isWorking = hasValidSession && (status === 'Working' || status === 'working' || currentSession?.status === 'working') && !currentSession?.breaks?.some(b => b.end_time === null)
  const isOnBreak = hasValidSession && (status === 'On Break' || status === 'on_break' || currentSession?.status === 'on_break' || Boolean(currentSession?.breaks?.some(b => b.end_time === null)))

  const handleAction = async (actionFn: () => Promise<void>) => {
    try {
      setLoading(true)
      await actionFn()
    } finally {
      setLoading(false)
    }
  }

  // Real full name and designation from authenticated user
  const fullName = user
    ? [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || 'Employee'
    : 'Not Signed In'

  const designation = user
    ? user.designation || 'Designation not assigned'
    : 'Sign in to start tracking'

  return (
    <div
      className="flex items-center justify-between px-6 py-3 select-none font-sans"
      style={{
        borderBottom: '1px solid var(--border-color)',
        minHeight: '68px'
      }}
    >
      {/* Left side: Avatar + Status Dot + Stacked Info (Name and Designation) */}
      <div className="flex items-center gap-3.5">
        {/* Avatar with overlapping status dot */}
        <div className="relative shrink-0">
          <div
            onClick={() => {
              if (!user) onOpenLogin()
            }}
            className="w-11 h-11 rounded-full flex items-center justify-center overflow-hidden border transition-transform hover:scale-105 cursor-pointer shadow-sm"
            style={{
              backgroundColor: 'var(--bg-surface-elevated)',
              borderColor: 'var(--border-color)'
            }}
            title={fullName}
          >
            {user?.avatar_url ? (
              <img
                src={user.avatar_url}
                alt={fullName}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-400">
                <UserIcon size={22} />
              </div>
            )}
          </div>

          {/* Overlapping status dot at bottom-right corner */}
          <span
            className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 ${
              isWorking ? 'animate-pulse-dot' : ''
            }`}
            style={{
              borderColor: 'var(--bg-primary)',
              backgroundColor: isWorking
                ? 'var(--status-green)'
                : isOnBreak
                ? 'var(--status-amber)'
                : 'var(--text-muted)'
            }}
            title={isWorking ? 'Working' : isOnBreak ? 'On Break' : 'Offline'}
          />
        </div>

        {/* Authenticated Name and Designation */}
        <div className="flex flex-col justify-center">
          <span
            className="text-xs font-bold tracking-tight leading-snug cursor-default truncate max-w-[190px]"
            style={{ color: 'var(--text-primary)' }}
            title={fullName}
          >
            {fullName}
          </span>
          <span
            className="text-[11px] font-medium leading-snug truncate max-w-[190px]"
            style={{ color: 'var(--text-secondary)' }}
            title={designation}
          >
            {designation}
          </span>
        </div>
      </div>

      {/* Right side: Action Buttons on the same horizontal row */}
      <div className="flex items-center gap-2">
        {!hasValidSession ? (
          <button
            onClick={() => {
              if (!user) {
                onOpenLogin()
              } else {
                handleAction(onClockIn)
              }
            }}
            disabled={loading}
            className="px-4 py-2 rounded-lg font-bold text-xs text-white transition-all shadow-sm active:scale-95 disabled:opacity-50"
            style={{
              backgroundColor: 'var(--btn-green)'
            }}
          >
            {loading ? 'Starting...' : 'Clock In'}
          </button>
        ) : isWorking ? (
          <>
            {/* Take a Break (Yellow Button) */}
            <button
              onClick={() => handleAction(onTakeBreak)}
              disabled={loading}
              className="px-3.5 py-2 rounded-lg font-bold text-xs transition-all shadow-sm active:scale-95 disabled:opacity-50"
              style={{
                backgroundColor: 'var(--btn-yellow)',
                color: 'var(--btn-yellow-text)'
              }}
            >
              Take a Break
            </button>

            {/* Clock Out (Red Button) */}
            <button
              onClick={() => handleAction(onClockOut)}
              disabled={loading}
              className="px-3.5 py-2 rounded-lg font-bold text-xs text-white transition-all shadow-sm active:scale-95 disabled:opacity-50"
              style={{
                backgroundColor: 'var(--btn-red)'
              }}
            >
              Clock Out
            </button>
          </>
        ) : isOnBreak ? (
          <>
            {/* Resume Work Button */}
            <button
              onClick={() => handleAction(onResume)}
              disabled={loading}
              className="px-3.5 py-2 rounded-lg font-bold text-xs transition-all shadow-sm active:scale-95 disabled:opacity-50 border"
              style={{
                backgroundColor: 'var(--btn-primary-bg)',
                color: 'var(--btn-primary-text)',
                borderColor: 'var(--border-color)'
              }}
            >
              Resume Work
            </button>

            {/* Clock Out (Red Button) */}
            <button
              onClick={() => handleAction(onClockOut)}
              disabled={loading}
              className="px-3.5 py-2 rounded-lg font-bold text-xs text-white transition-all shadow-sm active:scale-95 disabled:opacity-50"
              style={{
                backgroundColor: 'var(--btn-red)'
              }}
            >
              Clock Out
            </button>
          </>
        ) : (
          <button
            onClick={() => {
              if (!user) {
                onOpenLogin()
              } else {
                handleAction(onClockIn)
              }
            }}
            disabled={loading}
            className="px-4 py-2 rounded-lg font-bold text-xs text-white transition-all shadow-sm active:scale-95 disabled:opacity-50"
            style={{
              backgroundColor: 'var(--btn-green)'
            }}
          >
            {loading ? 'Starting...' : 'Clock In'}
          </button>
        )}
      </div>
    </div>
  )
})
