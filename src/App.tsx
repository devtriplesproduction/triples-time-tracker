import React, { useState, useEffect, useRef, useCallback } from 'react'
import { TitleBar } from './components/TitleBar'
import { AppHeader } from './components/AppHeader'
import { EmployeeTimerSection } from './components/EmployeeTimerSection'
import { CenterGreeting } from './components/CenterGreeting'
import { DailyMetricCards } from './components/DailyMetricCards'
import { LoginModal } from './components/LoginModal'
import { SettingsModal } from './components/SettingsModal'
import { BugReportModal } from './components/BugReportModal'
import { WorkReportModal } from './components/WorkReportModal'
import { ApplyLeaveModal } from './components/ApplyLeaveModal'
import { ClockInScreen } from './components/ClockInScreen'
import { HelpModal } from './components/HelpModal'
import type {
  TrackingState,
  TrackingStatus,
  TrackingSession,
  UserProfile,
  AppSettings,
  BreakRecord
} from './types'

export const App: React.FC = () => {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [status, setStatus] = useState<TrackingStatus>('Not Clocked In')
  const [currentSession, setCurrentSession] = useState<TrackingSession | null>(null)
  const [todaySessions, setTodaySessions] = useState<TrackingSession[]>([])
  const [todayWorkedMinutes, setTodayWorkedMinutes] = useState<number>(0)
  const [todayActiveMinutes, setTodayActiveMinutes] = useState<number>(0)
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0)
  const [isOnline, setIsOnline] = useState<boolean>(true)
  const [user, setUser] = useState<UserProfile | null>(null)
  const [settings, setSettings] = useState<AppSettings>({
    idleThresholdSeconds: 60,
    minimizeToTray: true,
    theme: 'dark',
    apiUrl: 'http://localhost:3000'
  })

  // Synchronous ref to prevent stale closures in IPC event listeners
  const userRef = useRef<UserProfile | null>(null)
  const applyStateRef = useRef<(state: TrackingState, currentUserOverride?: UserProfile | null) => void>(() => {})

  // Modals state
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false)
  const [isLoginOpen, setIsLoginOpen] = useState<boolean>(false)
  const [isBugReportOpen, setIsBugReportOpen] = useState<boolean>(false)
  const [isWorkReportOpen, setIsWorkReportOpen] = useState<boolean>(false)
  const [isApplyLeaveOpen, setIsApplyLeaveOpen] = useState<boolean>(false)
  const [isHelpOpen, setIsHelpOpen] = useState<boolean>(false)

  const [isInitializing, setIsInitializing] = useState<boolean>(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [isRetryingSync, setIsRetryingSync] = useState<boolean>(false)
  const [isClockingIn, setIsClockingIn] = useState<boolean>(false)

  useEffect(() => {
    userRef.current = user
  }, [user])

  const applyState = useCallback((state: TrackingState, currentUserOverride?: UserProfile | null) => {
    const activeUser = currentUserOverride !== undefined ? currentUserOverride : userRef.current
    if (!activeUser) {
      setStatus('Not Clocked In')
      setCurrentSession(null)
      setTodaySessions([])
      setTodayWorkedMinutes(0)
      setTodayActiveMinutes(0)
      setPendingSyncCount(0)
      return
    }

    // Strictly validate that currentSession belongs to activeUser and is non-terminated
    let validSession: TrackingSession | null = null
    if (state.currentSession && state.currentSession.employee_id === activeUser.id) {
      if (!state.currentSession.clock_out && state.currentSession.status !== 'completed' && state.currentSession.status !== 'Completed') {
        validSession = state.currentSession
      }
    }

    // Memoized session update avoiding re-renders when session hasn't changed
    setCurrentSession((prev) => {
      if (!prev && !validSession) return null
      if (!prev || !validSession) return validSession
      if (
        prev.id === validSession.id &&
        prev.status === validSession.status &&
        prev.clock_out === validSession.clock_out &&
        prev.worked_minutes === validSession.worked_minutes &&
        prev.active_minutes === validSession.active_minutes &&
        prev.breaks.length === validSession.breaks.length
      ) {
        return prev
      }
      return validSession
    })

    const targetStatus = validSession
      ? (validSession.breaks && validSession.breaks.some((b) => b.end_time === null) ? 'on_break' : 'working')
      : state.status

    setStatus((prev) => (prev === targetStatus ? prev : targetStatus))
    setTodayWorkedMinutes((prev) => (prev === state.todayWorkedMinutes ? prev : state.todayWorkedMinutes))
    setTodayActiveMinutes((prev) => (prev === state.todayActiveMinutes ? prev : state.todayActiveMinutes))

    if (state.todaySessions) {
      const filtered = state.todaySessions.filter((s) => s.employee_id === activeUser.id)
      setTodaySessions((prev) => {
        if (prev.length !== filtered.length) return filtered
        const isIdentical = prev.every((p, idx) => {
          const f = filtered[idx]
          return (
            p.id === f.id &&
            p.status === f.status &&
            p.clock_out === f.clock_out &&
            p.worked_minutes === f.worked_minutes &&
            p.active_minutes === f.active_minutes &&
            p.breaks.length === f.breaks.length
          )
        })
        return isIdentical ? prev : filtered
      })
    }
    setPendingSyncCount((prev) => (prev === (state.pendingSyncCount || 0) ? prev : (state.pendingSyncCount || 0)))
    setIsOnline((prev) => (prev === state.isOnline ? prev : state.isOnline))
  }, [])

  useEffect(() => {
    applyStateRef.current = applyState
  }, [applyState])

  // Initialize
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)

    const init = async () => {
      try {
        if (window.electronAPI) {
          // Fetch settings
          const loadedSettings = await window.electronAPI.getSettings()
          if (loadedSettings) {
            setSettings(loadedSettings)
            if (loadedSettings.theme) {
              setTheme(loadedSettings.theme)
              document.documentElement.setAttribute('data-theme', loadedSettings.theme)
            }
          }

          // Fetch user from secure persistent storage / Supabase session restoration
          let loadedUser: UserProfile | null = null
          if (window.electronAPI.initSession) {
            const initRes = await window.electronAPI.initSession()
            if (initRes.success && initRes.user) {
              loadedUser = initRes.user
            } else if (initRes.error) {
              setAuthError(initRes.error)
            }
          } else {
            loadedUser = await window.electronAPI.getAuthUser()
          }

          if (loadedUser) {
            userRef.current = loadedUser
            setUser(loadedUser)

            // Fetch initial state strictly for loadedUser
            const state = await window.electronAPI.getTrackingState()
            applyState(state, loadedUser)

            // Attempt background session sync without blocking initial display
            if (window.electronAPI.syncSessions) {
              const syncRes = await window.electronAPI.syncSessions()
              if (!syncRes.success) {
                setSyncError(syncRes.error || 'Failed to verify session with server')
              }
            }

            if (window.electronAPI.getTodaySessions) {
              const sessions = await window.electronAPI.getTodaySessions()
              if (sessions) setTodaySessions(sessions.filter((s) => s.employee_id === loadedUser.id))
            }
          } else {
            // Zero fallback to mock identity. Prompt login.
            userRef.current = null
            setUser(null)
            setStatus('Not Clocked In')
            setCurrentSession(null)
            setTodaySessions([])
            setTodayWorkedMinutes(0)
            setTodayActiveMinutes(0)
            setIsLoginOpen(true)
          }

          // Subscribe to live state updates via applyStateRef to avoid stale closures
          const unsubscribe = window.electronAPI.onStateUpdate((updatedState) => {
            applyStateRef.current(updatedState)
          })

          return () => {
            unsubscribe()
          }
        } else {
          userRef.current = null
          setUser(null)
          setStatus('Not Clocked In')
          setTodayWorkedMinutes(0)
          setTodayActiveMinutes(0)
          setCurrentSession(null)
          setTodaySessions([])
          setIsLoginOpen(true)
        }
      } catch (err: any) {
        console.error('[App] Init exception:', err)
        setIsLoginOpen(true)
      } finally {
        setIsInitializing(false)
      }
    }

    init()
  }, [])

  const handleToggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(nextTheme)
    document.documentElement.setAttribute('data-theme', nextTheme)
    if (window.electronAPI) {
      window.electronAPI.saveSettings({ theme: nextTheme })
    }
  }

  const handleClockIn = async () => {
    const activeUser = userRef.current || user
    if (!activeUser) {
      setIsLoginOpen(true)
      return
    }
    if (isClockingIn) return

    try {
      setIsClockingIn(true)
      setErrorMessage(null)

      if (window.electronAPI) {
        const res = await window.electronAPI.clockIn()
        if (!res.success) {
          setErrorMessage(res.error || 'Failed to clock in')
          setTimeout(() => setErrorMessage(null), 5000)
        } else if (res.session && res.session.employee_id === activeUser.id) {
          setCurrentSession(res.session)
          setStatus(res.session.status)
          setTodaySessions((prev) => {
            const exists = prev.some((s) => s.id === res.session!.id)
            return exists
              ? prev.map((s) => (s.id === res.session!.id ? res.session! : s))
              : [...prev, res.session!]
          })
        }
      } else {
        setErrorMessage('Tracker engine is not connected')
        setTimeout(() => setErrorMessage(null), 5000)
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Unexpected error during clock in')
      setTimeout(() => setErrorMessage(null), 5000)
    } finally {
      setIsClockingIn(false)
    }
  }

  const handleTakeBreak = async () => {
    if (!currentSession) return

    const isWorking = status === 'Working' || status === 'working'
    if (!isWorking) return
    if (currentSession.breaks.some((b) => b.end_time === null)) {
      return
    }

    const previousStatus = status
    const previousSession = JSON.parse(JSON.stringify(currentSession))

    // 1. Immediately update UI (Optimistic update)
    const breakStartTime = new Date().toISOString()
    const optimisticBreak: BreakRecord = {
      id: crypto.randomUUID(),
      session_id: currentSession.id,
      start_time: breakStartTime,
      end_time: null,
      duration_minutes: 0,
      reason: 'Break'
    }

    const updatedSession = {
      ...currentSession,
      status: 'on_break' as TrackingStatus,
      breaks: [...currentSession.breaks, optimisticBreak]
    }

    setStatus('on_break')
    setCurrentSession(updatedSession)
    setTodaySessions((prev) =>
      prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
    )
    setErrorMessage(null)

    // 2. Confirm through server/electron
    try {
      if (window.electronAPI) {
        const res = await window.electronAPI.takeBreak()
        if (!res.success) {
          setStatus(previousStatus)
          setCurrentSession(previousSession)
          setTodaySessions((prev) =>
            prev.map((s) => (s.id === previousSession.id ? previousSession : s))
          )
          setErrorMessage(res.error || 'Failed to persist break on server. Rolled back.')
          setTimeout(() => setErrorMessage(null), 5000)
          return
        }
        if (res.session) {
          setCurrentSession(res.session)
          setTodaySessions((prev) =>
            prev.map((s) => (s.id === res.session!.id ? res.session! : s))
          )
        }
      }
    } catch (err: any) {
      setStatus(previousStatus)
      setCurrentSession(previousSession)
      setTodaySessions((prev) =>
        prev.map((s) => (s.id === previousSession.id ? previousSession : s))
      )
      setErrorMessage(err.message || 'Connection error while saving break. Rolled back.')
      setTimeout(() => setErrorMessage(null), 5000)
    }
  }

  const handleResume = async () => {
    if (!currentSession) return

    const isOnBreak = status === 'On Break' || status === 'on_break'
    if (!isOnBreak) return

    const previousStatus = status
    const previousSession = JSON.parse(JSON.stringify(currentSession))

    // 1. Immediately update UI (Optimistic update)
    const resumeTime = new Date().toISOString()
    const updatedBreaks = currentSession.breaks.map((b) => {
      if (b.end_time === null) {
        const startMs = new Date(b.start_time).getTime()
        const endMs = new Date(resumeTime).getTime()
        return {
          ...b,
          end_time: resumeTime,
          duration_minutes: Math.max(0, Math.floor((endMs - startMs) / 60000))
        }
      }
      return b
    })

    const updatedSession = {
      ...currentSession,
      status: 'working' as TrackingStatus,
      breaks: updatedBreaks
    }

    setStatus('working')
    setCurrentSession(updatedSession)
    setTodaySessions((prev) =>
      prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
    )
    setErrorMessage(null)

    // 2. Confirm through server/electron
    try {
      if (window.electronAPI) {
        const res = await window.electronAPI.resumeBreak()
        if (!res.success) {
          setStatus(previousStatus)
          setCurrentSession(previousSession)
          setTodaySessions((prev) =>
            prev.map((s) => (s.id === previousSession.id ? previousSession : s))
          )
          setErrorMessage(res.error || 'Failed to resume session on server. Rolled back.')
          setTimeout(() => setErrorMessage(null), 5000)
          return
        }
        if (res.session) {
          setCurrentSession(res.session)
          setTodaySessions((prev) =>
            prev.map((s) => (s.id === res.session!.id ? res.session! : s))
          )
        }
      }
    } catch (err: any) {
      setStatus(previousStatus)
      setCurrentSession(previousSession)
      setTodaySessions((prev) =>
        prev.map((s) => (s.id === previousSession.id ? previousSession : s))
      )
      setErrorMessage(err.message || 'Connection error while resuming session. Rolled back.')
      setTimeout(() => setErrorMessage(null), 5000)
    }
  }

  const handleClockOut = async () => {
    if (window.electronAPI) {
      const res = await window.electronAPI.clockOut()
      if (res && res.session) {
        setCurrentSession(null)
        setStatus('Completed')
        setTodaySessions((prev) => {
          const idx = prev.findIndex((s) => s.id === res.session!.id)
          if (idx !== -1) {
            const next = [...prev]
            next[idx] = res.session!
            return next
          }
          return [...prev, res.session!]
        })
      }
    } else {
      setStatus('Completed')
      if (currentSession) {
        currentSession.status = 'Completed'
      }
    }
  }

  const handleSaveSettings = async (updates: Partial<AppSettings>) => {
    if (window.electronAPI) {
      const res = await window.electronAPI.saveSettings(updates)
      if (!res.success) {
        setErrorMessage(res.error || 'Failed to save settings')
        setTimeout(() => setErrorMessage(null), 5000)
        return res
      }
      setSettings((prev) => ({ ...prev, ...updates }))
      return res
    }
    setSettings((prev) => ({ ...prev, ...updates }))
    return { success: true }
  }

  const handleSyncNow = async () => {
    if (window.electronAPI) {
      await window.electronAPI.syncWithERP()
    }
  }

  const handleLogout = async () => {
    if (window.electronAPI) {
      await window.electronAPI.logout()
    }
    userRef.current = null
    setUser(null)
    setStatus('Not Clocked In')
    setCurrentSession(null)
    setTodaySessions([])
    setTodayWorkedMinutes(0)
    setTodayActiveMinutes(0)
    setPendingSyncCount(0)
    setAuthError(null)
    setIsSettingsOpen(false)
    setIsLoginOpen(true)
  }

  if (isInitializing) {
    return (
      <div
        className="flex flex-col h-screen select-none overflow-hidden font-['Montserrat']"
        style={{ backgroundColor: 'var(--bg-primary, #050505)' }}
      >
        <TitleBar status="Not Clocked In" theme={theme} onToggleTheme={handleToggleTheme} />
        <div className="flex-1 flex flex-col items-center justify-center -mt-6">
          <img
            src="./logo.png"
            alt="TripleS Logo"
            className="h-16 w-auto mb-4 object-contain animate-pulse"
          />
          <h2 className="text-white text-sm font-semibold tracking-wider">
            TRIPLES PRODUCTION
          </h2>
          <div className="mt-5 flex items-center gap-2.5 text-neutral-400 text-xs">
            <div className="w-3.5 h-3.5 border-2 border-neutral-600 border-t-white rounded-full animate-spin" />
            <span>Restoring secure session...</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex flex-col h-screen select-none overflow-hidden"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      {/* 1. Title Bar (TripleS Time Tracker + Window Controls) */}
      <TitleBar status={status} theme={theme} onToggleTheme={handleToggleTheme} />

      {/* 2. Top Application Header (TRIPLES PRODUCTION + User Avatar) */}
      <AppHeader
        user={user}
        onOpenBugReport={() => setIsBugReportOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onSignOut={handleLogout}
        onOpenLogin={() => setIsLoginOpen(true)}
      />

      {/* Session Lookup / Network Error Banner with Safe Retry */}
      {syncError && (
        <div className="mx-5 mt-2 p-2 rounded-lg text-xs bg-red-500/15 text-red-400 border border-red-500/25 flex items-center justify-between shadow-sm animate-fade-in shrink-0">
          <div className="flex items-center gap-2">
            <span>Unable to verify session with server: {syncError}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                if (window.electronAPI?.syncSessions) {
                  setIsRetryingSync(true)
                  const res = await window.electronAPI.syncSessions()
                  setIsRetryingSync(false)
                  if (res.success) {
                    setSyncError(null)
                    const state = await window.electronAPI.getTrackingState()
                    applyState(state)
                  } else {
                    setSyncError(res.error || 'Sync failed')
                  }
                }
              }}
              disabled={isRetryingSync}
              className="px-2 py-0.5 rounded text-white text-[11px] font-bold bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {isRetryingSync ? 'Retrying...' : 'Retry'}
            </button>
            <button
              onClick={() => setSyncError(null)}
              className="ml-1 text-xs font-bold hover:text-red-300 px-1 py-0.5 rounded"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Error / Rollback Alert Banner */}
      {errorMessage && (
        <div className="mx-5 mt-2 p-2 rounded-lg text-xs bg-red-500/15 text-red-400 border border-red-500/25 flex items-center justify-between shadow-sm animate-fade-in shrink-0">
          <span className="font-medium">{errorMessage}</span>
          <button
            onClick={() => setErrorMessage(null)}
            className="ml-2 text-xs font-bold hover:text-red-300 px-1.5 py-0.5 rounded"
          >
            ✕
          </button>
        </div>
      )}

      {/* State-Based Rendering:
          1. No valid active session: Display Clock In Screen matching screenshot
             (Good Afternoon, {fullName} \n Yet to start work for today! \n [ Clock In ]).
          2. Valid active session (working or break): Display full working screen
             (EmployeeTimerSection, CenterGreeting, and DailyMetricCards).
      */}
      {!(user && currentSession && currentSession.id && currentSession.employee_id === user.id && !currentSession.clock_out && currentSession.status !== 'completed' && currentSession.status !== 'Completed') ? (
        <ClockInScreen
          user={user}
          subtitle={
            (status === 'Completed' || status === 'completed') && todaySessions.length > 0
              ? 'Your work session has ended'
              : 'Yet to start work for today!'
          }
          loading={isClockingIn}
          onClockIn={handleClockIn}
          onOpenLogin={() => setIsLoginOpen(true)}
        />
      ) : (
        <>
          {/* 3. Employee Profile & Actions Section (Avatar + Name + Designation on Left; Action Buttons on Right) */}
          <EmployeeTimerSection
            user={user}
            currentSession={currentSession}
            todaySessions={todaySessions}
            status={status}
            onClockIn={handleClockIn}
            onTakeBreak={handleTakeBreak}
            onResume={handleResume}
            onClockOut={handleClockOut}
            onOpenLogin={() => setIsLoginOpen(true)}
          />

          {/* 4. Center Content (Greeting, Work-Status & Daily Metrics) */}
          <div className="flex-1 flex flex-col justify-center items-center overflow-hidden px-4">
            <CenterGreeting user={user} status={status} currentSession={currentSession} />

            {/* 5. Daily Metrics (Worked Hours & Active Hours positioned 50-80px below status) */}
            <div className="mt-14 flex justify-center w-full">
              <DailyMetricCards
                currentSession={currentSession}
                todaySessions={todaySessions}
                status={status}
              />
            </div>
          </div>
        </>
      )}

      {/* 6. Help Control at bottom-right */}
      <div className="absolute right-5 bottom-4">
        <button
          onClick={() => setIsHelpOpen(true)}
          className="px-3.5 py-1.5 rounded-full font-bold text-xs transition-transform active:scale-95 shadow-md flex items-center justify-center border hover:border-slate-500"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-color)',
            color: 'var(--text-secondary)'
          }}
        >
          Need help ?
        </button>
      </div>

      {/* Modals */}
      <LoginModal
        isOpen={isLoginOpen}
        initialError={authError}
        onClose={() => {
          setAuthError(null)
          setIsLoginOpen(false)
        }}
        onSuccess={async (loggedUser) => {
          // Immediately reset all state before loading new account
          userRef.current = loggedUser
          setUser(loggedUser)
          setStatus('Not Clocked In')
          setCurrentSession(null)
          setTodaySessions([])
          setTodayWorkedMinutes(0)
          setTodayActiveMinutes(0)
          setPendingSyncCount(0)
          setSyncError(null)
          setAuthError(null)
          setIsLoginOpen(false)

          if (window.electronAPI) {
            const state = await window.electronAPI.getTrackingState()
            applyState(state, loggedUser)

            if (window.electronAPI.syncSessions) {
              const syncRes = await window.electronAPI.syncSessions()
              if (!syncRes.success) {
                setSyncError(syncRes.error || 'Failed to verify session with server')
              }
            }

            if (window.electronAPI.getTodaySessions) {
              const sessions = await window.electronAPI.getTodaySessions()
              if (sessions) setTodaySessions(sessions.filter((s) => s.employee_id === loggedUser.id))
            }
          }
        }}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        user={user}
        onSaveSettings={handleSaveSettings}
        onSyncNow={handleSyncNow}
        onLogout={handleLogout}
      />

      <BugReportModal
        isOpen={isBugReportOpen}
        onClose={() => setIsBugReportOpen(false)}
        user={user}
      />

      <WorkReportModal
        isOpen={isWorkReportOpen}
        onClose={() => setIsWorkReportOpen(false)}
        user={user}
        workedMinutes={todayWorkedMinutes}
        activeMinutes={todayActiveMinutes}
        todaySessions={todaySessions}
        settings={settings}
      />

      <ApplyLeaveModal
        isOpen={isApplyLeaveOpen}
        onClose={() => setIsApplyLeaveOpen(false)}
        user={user}
        settings={settings}
      />

      <HelpModal
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
      />
    </div>
  )
}
