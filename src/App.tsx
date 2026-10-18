import React, { useState, useEffect } from 'react'
import { TitleBar } from './components/TitleBar'
import { ProfileHeader } from './components/ProfileHeader'
import { SessionTimer } from './components/SessionTimer'
import { MetricCards } from './components/MetricCards'
import { ActionControls } from './components/ActionControls'
import { BottomBar } from './components/BottomBar'
import { LoginModal } from './components/LoginModal'
import { SettingsModal } from './components/SettingsModal'
import type { TrackingState, TrackingStatus, TrackingSession, UserProfile, AppSettings, BreakRecord } from './types'

export const App: React.FC = () => {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [status, setStatus] = useState<TrackingStatus>('Not Clocked In')
  const [currentSession, setCurrentSession] = useState<TrackingSession | null>(null)
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
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false)
  const [isLoginOpen, setIsLoginOpen] = useState<boolean>(false)

  // Initialize
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)

    const init = async () => {
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

        // Fetch user from secure storage / Supabase session restoration
        const loadedUser = await window.electronAPI.getAuthUser()
        if (loadedUser) {
          setUser(loadedUser)
        } else {
          // Strict: Zero fallback to mock Omkar Sawant. Prompt login.
          setUser(null)
          setIsLoginOpen(true)
        }

        // Fetch initial state
        const state = await window.electronAPI.getTrackingState()
        applyState(state)

        // Subscribe to live state updates
        const unsubscribe = window.electronAPI.onStateUpdate((updatedState) => {
          applyState(updatedState)
        })

        return () => {
          unsubscribe()
        }
      } else {
        // Strict: Zero mock user or mock tracked hours in preview mode
        setUser(null)
        setStatus('Not Clocked In')
        setTodayWorkedMinutes(0)
        setTodayActiveMinutes(0)
        setCurrentSession(null)
      }
    }

    init()
  }, [])

  const applyState = (state: TrackingState) => {
    setStatus(state.status)
    setCurrentSession(state.currentSession)
    setTodayWorkedMinutes(state.todayWorkedMinutes)
    setTodayActiveMinutes(state.todayActiveMinutes)
    setPendingSyncCount(state.pendingSyncCount || 0)
    setIsOnline(state.isOnline)
  }

  const handleToggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(nextTheme)
    document.documentElement.setAttribute('data-theme', nextTheme)
    if (window.electronAPI) {
      window.electronAPI.saveSettings({ theme: nextTheme })
    }
  }

  const handleClockIn = async () => {
    if (!user) {
      setIsLoginOpen(true)
      return
    }

    if (window.electronAPI) {
      const res = await window.electronAPI.clockIn()
      if (!res.success && res.error) {
        setErrorMessage(res.error)
        setTimeout(() => setErrorMessage(null), 5000)
      } else if (res.success && res.session) {
        setCurrentSession(res.session)
        setStatus(res.session.status)
      }
    } else {
      setErrorMessage('Tracker engine is not connected')
      setTimeout(() => setErrorMessage(null), 5000)
    }
  }

  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleTakeBreak = async () => {
    if (!currentSession) return

    // Prevent duplicate break events and invalid state transitions
    const isWorking = status === 'Working' || status === 'working'
    if (!isWorking) return
    if (currentSession.breaks.some(b => b.end_time === null)) {
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

    setStatus('on_break')
    setCurrentSession({
      ...currentSession,
      status: 'on_break',
      breaks: [...currentSession.breaks, optimisticBreak]
    })
    setErrorMessage(null)

    // 2. Confirm through server/electron
    try {
      if (window.electronAPI) {
        const res = await window.electronAPI.takeBreak()
        if (!res.success) {
          // Rollback and show error if persistence fails
          setStatus(previousStatus)
          setCurrentSession(previousSession)
          setErrorMessage(res.error || 'Failed to persist break on server. Rolled back.')
          setTimeout(() => setErrorMessage(null), 5000)
          return
        }
        if (res.session) {
          setCurrentSession(res.session)
        }
      }
    } catch (err: any) {
      // Rollback on network/client error
      setStatus(previousStatus)
      setCurrentSession(previousSession)
      setErrorMessage(err.message || 'Connection error while saving break. Rolled back.')
      setTimeout(() => setErrorMessage(null), 5000)
    }
  }

  const handleResume = async () => {
    if (!currentSession) return

    // Prevent invalid transitions
    const isOnBreak = status === 'On Break' || status === 'on_break'
    if (!isOnBreak) return

    const previousStatus = status
    const previousSession = JSON.parse(JSON.stringify(currentSession))

    // 1. Immediately update UI (Optimistic update)
    const resumeTime = new Date().toISOString()
    const updatedBreaks = currentSession.breaks.map(b => {
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

    setStatus('working')
    setCurrentSession({
      ...currentSession,
      status: 'working',
      breaks: updatedBreaks
    })
    setErrorMessage(null)

    // 2. Confirm through server/electron
    try {
      if (window.electronAPI) {
        const res = await window.electronAPI.resumeBreak()
        if (!res.success) {
          // Rollback and show error if persistence fails
          setStatus(previousStatus)
          setCurrentSession(previousSession)
          setErrorMessage(res.error || 'Failed to resume session on server. Rolled back.')
          setTimeout(() => setErrorMessage(null), 5000)
          return
        }
        if (res.session) {
          setCurrentSession(res.session)
        }
      }
    } catch (err: any) {
      // Rollback on network/client error
      setStatus(previousStatus)
      setCurrentSession(previousSession)
      setErrorMessage(err.message || 'Connection error while resuming session. Rolled back.')
      setTimeout(() => setErrorMessage(null), 5000)
    }
  }

  const handleClockOut = async () => {
    if (window.electronAPI) {
      await window.electronAPI.clockOut()
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
    setUser(null)
    setStatus('Not Clocked In')
    setCurrentSession(null)
    setTodayWorkedMinutes(0)
    setTodayActiveMinutes(0)
    setPendingSyncCount(0)
    setIsSettingsOpen(false)
    setIsLoginOpen(true)
  }

  return (
    <div className="flex flex-col h-screen select-none overflow-hidden" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Title Bar */}
      <TitleBar status={status} theme={theme} />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col justify-between overflow-y-auto">
        <div>
          {/* Error / Rollback Alert Banner */}
          {errorMessage && (
            <div className="mx-6 mt-3 p-2.5 rounded-xl text-xs bg-red-500/15 text-red-500 border border-red-500/25 flex items-center justify-between shadow-sm animate-fade-in">
              <span className="font-medium">{errorMessage}</span>
              <button 
                onClick={() => setErrorMessage(null)} 
                className="ml-2 text-xs font-bold hover:text-red-600 px-1.5 py-0.5 rounded"
              >
                ✕
              </button>
            </div>
          )}

          {/* Profile Section */}
          <ProfileHeader 
            user={user} 
            onOpenLogin={() => setIsLoginOpen(true)} 
          />

          {/* Session Timer (Circular Gauge) */}
          <SessionTimer 
            currentSession={currentSession} 
            status={status} 
            todayWorkedMinutes={todayWorkedMinutes} 
          />

          {/* Metric Cards (Worked Hours & Active Hours ONLY) */}
          <MetricCards 
            workedMinutes={todayWorkedMinutes} 
            activeMinutes={todayActiveMinutes} 
          />

          {/* Action Controls (Clock In, Take Break, Resume, Clock Out) */}
          <ActionControls
            status={status}
            onClockIn={handleClockIn}
            onTakeBreak={handleTakeBreak}
            onResume={handleResume}
            onClockOut={handleClockOut}
          />
        </div>

        {/* Bottom Bar with Sync & Connection Status */}
        <BottomBar
          theme={theme}
          onToggleTheme={handleToggleTheme}
          onOpenSettings={() => setIsSettingsOpen(true)}
          pendingSyncCount={pendingSyncCount}
          isOnline={isOnline}
        />
      </div>

      {/* Login Modal */}
      <LoginModal
        isOpen={isLoginOpen}
        onClose={() => setIsLoginOpen(false)}
        onSuccess={async (loggedUser) => {
          setUser(loggedUser)
          setIsLoginOpen(false)
          if (window.electronAPI) {
            const state = await window.electronAPI.getTrackingState()
            applyState(state)
          }
        }}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        user={user}
        onSaveSettings={handleSaveSettings}
        onSyncNow={handleSyncNow}
        onLogout={handleLogout}
      />
    </div>
  )
}
