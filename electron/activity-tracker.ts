import { app, powerMonitor, BrowserWindow } from 'electron'
import { execFile } from 'child_process'
import path from 'path'
import fs from 'fs'
import { storage } from './storage'
import { screenshotService } from './screenshot-service'
import type { TrackingState, TrackingStatus, ActivityInterval, TrackingSession, BreakRecord, UserProfile } from '../src/types'
import { calculateDailyWorkedSeconds, calculateDailyActiveSeconds, getKolkataDayBounds } from '../src/utils/timeCalculator'

class ActivityTracker {
  private timer: NodeJS.Timeout | null = null
  private appDetectTimer: NodeJS.Timeout | null = null
  private window: BrowserWindow | null = null
  private currentApp: string = 'Desktop Work'
  private currentTitle: string = ''
  private lastInputCheckTime: number = Date.now()
  private lastTickTime: number = Date.now()
  private lastHrTime: bigint = process.hrtime.bigint()
  private currentBusinessDate: string = ''
  private activeSecondsBuffer: number = 0
  private isSuspended: boolean = false
  private isScreenLocked: boolean = false
  private suspendStartTime: number | null = null
  private isDetectingApp: boolean = false
  private tickCounter: number = 0
  private lastEmittedIdle: boolean = false
  private screenshotSecondsBuffer: number = 0

  constructor() {
    this.currentBusinessDate = storage.getTodayBusinessDate()
    this.setupPowerMonitor()
  }

  public getCurrentApp(): string {
    return this.currentApp
  }

  public getCurrentTitle(): string {
    return this.currentTitle
  }

  public setWindow(win: BrowserWindow | null) {
    this.window = win
  }

  private setupPowerMonitor() {
    powerMonitor.on('suspend', () => {
      console.log('[PowerMonitor] System suspended. Recording suspend interval.')
      this.isSuspended = true
      this.suspendStartTime = Date.now()
      this.emitState()
    })

    powerMonitor.on('resume', () => {
      console.log('[PowerMonitor] System resumed.')
      if (this.suspendStartTime) {
        const user = storage.getCurrentUser()
        const session = user ? storage.getCurrentSession(user.id) : null
        if (session && user) {
          const suspendedDurationMs = Math.max(0, Date.now() - this.suspendStartTime)
          const addedSuspendedSec = Math.floor(suspendedDurationMs / 1000)
          session.suspended_seconds = (session.suspended_seconds || 0) + addedSuspendedSec
          console.log(`[PowerMonitor] Excluded ${addedSuspendedSec}s of sleep from employee ${user.id} worked duration.`)
          storage.updateCurrentSession({ suspended_seconds: session.suspended_seconds }, user.id)
        }
        this.suspendStartTime = null
      }
      this.isSuspended = false
      this.lastInputCheckTime = Date.now()
      this.emitState()
    })

    powerMonitor.on('lock-screen', () => {
      console.log('[PowerMonitor] Screen locked')
      this.isScreenLocked = true
      this.emitState()
    })

    powerMonitor.on('unlock-screen', () => {
      console.log('[PowerMonitor] Screen unlocked')
      this.isScreenLocked = false
      this.lastInputCheckTime = Date.now()
      this.emitState()
    })

    powerMonitor.on('shutdown', () => {
      console.log('[PowerMonitor] System shutdown event received. Finalizing active session.')
      this.handleSystemShutdown()
    })
  }

  public start() {
    if (this.timer) clearInterval(this.timer)
    if (this.appDetectTimer) clearInterval(this.appDetectTimer)

    this.lastTickTime = Date.now()
    this.lastHrTime = process.hrtime.bigint()
    this.lastHrTime = process.hrtime.bigint()
    this.currentBusinessDate = storage.getTodayBusinessDate()

    const user = storage.getCurrentUser()
    const session = user ? storage.getCurrentSession(user.id) : null
    if (session) {
      this.activeSecondsBuffer = session.active_seconds_buffer || 0
      this.screenshotSecondsBuffer = session.screenshot_seconds_buffer || 0
    } else {
      this.activeSecondsBuffer = 0
      this.screenshotSecondsBuffer = 0
    }

    // Tick every 1 second for active timer updates
    this.timer = setInterval(() => this.tick(), 1000)

    // Check foreground application every 15 seconds (optimized for reduced CPU overhead)
    this.appDetectTimer = setInterval(() => this.detectForegroundApp(), 15000)
    this.detectForegroundApp()
  }

  public stop() {
    if (this.timer) clearInterval(this.timer)
    if (this.appDetectTimer) clearInterval(this.appDetectTimer)
    this.timer = null
    this.appDetectTimer = null
  }

  public onUserLogin(user: UserProfile) {
    const session = storage.getCurrentSession(user.id)
    if (session && (session.status === 'working' || session.status === 'Working' || session.status === 'on_break' || session.status === 'On Break')) {
      this.activeSecondsBuffer = session.active_seconds_buffer || 0
      this.screenshotSecondsBuffer = session.screenshot_seconds_buffer || 0
    } else {
      this.activeSecondsBuffer = 0
      this.screenshotSecondsBuffer = 0
    }
    this.emitState()
  }

  public onUserLogout() {
    this.activeSecondsBuffer = 0
    this.screenshotSecondsBuffer = 0
    this.currentApp = 'Desktop Work'
    this.currentTitle = ''
    this.suspendStartTime = null
    this.isSuspended = false
    this.isScreenLocked = false
    this.emitState()
  }

  private detectForegroundApp() {
    const user = storage.getCurrentUser()
    if (!user) return

    const session = storage.getCurrentSession(user.id)
    if (!session || (session.status !== 'Working' && session.status !== 'working') || this.isSuspended || this.isScreenLocked) {
      return
    }

    // Performance Optimization: Skip spawning PowerShell when user is idle / away
    const settings = storage.getSettings()
    const idleSeconds = powerMonitor.getSystemIdleTime()
    if (idleSeconds >= settings.idleThresholdSeconds) {
      return
    }

    // Performance Optimization: Concurrency guard preventing overlapping PowerShell processes
    if (this.isDetectingApp) {
      return
    }

    try {
      const scriptPath = app.isPackaged
        ? path.join(process.resourcesPath, 'scripts', 'get-active-window.ps1')
        : path.join(__dirname, '../scripts/get-active-window.ps1')

      if (!fs.existsSync(scriptPath)) {
        return
      }

      this.isDetectingApp = true
      execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { timeout: 3500 }, (error, stdout) => {
        this.isDetectingApp = false
        if (!error && stdout) {
          try {
            const parsed = JSON.parse(stdout.trim())
            if (parsed.ProcessName && parsed.ProcessName !== 'powershell') {
              this.currentApp = parsed.ProcessName
              this.currentTitle = (parsed.Title || '').slice(0, 255)
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      })
    } catch (e) {
      this.isDetectingApp = false
    }
  }

  private tick() {
    const user = storage.getCurrentUser()
    // If no authenticated user, stop UI timer and do not process anything
    if (!user || !user.id) {
      this.activeSecondsBuffer = 0
      this.emitState()
      return
    }

    // 1. Day Rollover check at the beginning of tick
    const today = storage.getTodayBusinessDate()
    if (!this.currentBusinessDate) {
      this.currentBusinessDate = today
    } else if (this.currentBusinessDate !== today) {
      this.handleDayRollover(this.currentBusinessDate, today)
      return
    }

    const session = storage.getCurrentSession(user.id)
    if (!session) {
      this.activeSecondsBuffer = 0
      this.emitState()
      return
    }

    // Verify session strictly belongs to current user
    if (session.employee_id !== user.id) {
      console.warn(`[ActivityTracker] Session owner mismatch (${session.employee_id} !== ${user.id}). Ignoring.`)
      this.activeSecondsBuffer = 0
      this.emitState()
      return
    }

    const settings = storage.getSettings()
    const idleSeconds = powerMonitor.getSystemIdleTime()
    const isIdle = idleSeconds >= settings.idleThresholdSeconds

    // Calculate real elapsed time delta with monotonic anti-tamper validation
    const now = Date.now()
    const nowHr = process.hrtime.bigint()
    const monotonicDeltaMs = Number(nowHr - this.lastHrTime) / 1_000_000
    this.lastHrTime = nowHr

    let deltaMs = this.lastTickTime ? (now - this.lastTickTime) : 1000
    this.lastTickTime = now

    // Anti-tampering: if system clock jumped or was manually altered, clamp to monotonic time
    if (Math.abs(deltaMs - monotonicDeltaMs) > 3000) {
      console.warn(`[ActivityTracker] System clock anomaly detected (wall: ${deltaMs}ms vs monotonic: ${Math.round(monotonicDeltaMs)}ms). Clamping to monotonic delta.`)
      const clockJumpSec = Math.round((deltaMs - monotonicDeltaMs) / 1000)
      if (clockJumpSec > 0) {
        session.suspended_seconds = Math.max(0, (session.suspended_seconds || 0) + clockJumpSec)
      }
      deltaMs = Math.min(3000, Math.max(0, monotonicDeltaMs))
    }
    deltaMs = Math.min(3000, Math.max(0, deltaMs))
    const deltaSec = deltaMs / 1000

    session.last_heartbeat = new Date(now).toISOString()

    // Calculate worked duration for current employee session excluding breaks and sleep
    const clockInTime = new Date(session.clock_in).getTime()

    let totalBreakMs = 0
    for (const b of session.breaks) {
      const start = new Date(b.start_time).getTime()
      const end = b.end_time ? new Date(b.end_time).getTime() : now
      totalBreakMs += Math.max(0, end - start)
    }

    const suspendedMs = (session.suspended_seconds || 0) * 1000
    const currentWorkedMs = Math.max(0, now - clockInTime - totalBreakMs - suspendedMs)
    session.worked_minutes = Math.floor(currentWorkedMs / 60000)

    const isWorking = session.status === 'Working' || session.status === 'working'
    let minuteRolledOver = false
    if (isWorking && !isIdle && !this.isSuspended && !this.isScreenLocked) {
      this.activeSecondsBuffer += deltaSec
      if (this.activeSecondsBuffer >= 60) {
        const addedMinutes = Math.floor(this.activeSecondsBuffer / 60)
        session.active_minutes += addedMinutes
        this.activeSecondsBuffer = this.activeSecondsBuffer % 60
        minuteRolledOver = true

        const interval: ActivityInterval = {
          id: crypto.randomUUID(),
          session_id: session.id,
          employee_id: user.id,
          start_time: new Date(now - 60000).toISOString(),
          end_time: new Date(now).toISOString(),
          active_seconds: 60,
          app_name: this.currentApp || 'Desktop Work',
          window_title: this.currentTitle || ''
        }
        storage.addActivityInterval(interval)
      }

      // Automatic 7-minute periodic screenshot capture (420 active working seconds)
      this.screenshotSecondsBuffer += deltaSec
      if (this.screenshotSecondsBuffer >= 420) {
        this.screenshotSecondsBuffer = 0
        screenshotService.captureAndSaveScreenshot(
          session,
          user,
          this.currentApp,
          this.currentTitle
        ).then(record => {
          if (record && this.window && !this.window.isDestroyed()) {
            this.window.webContents.send('screenshot:captured', record)
          }
        }).catch(err => {
          console.error('[ActivityTracker] Error capturing periodic screenshot:', err)
        })
      }
    }

    session.active_seconds_buffer = Math.round(this.activeSecondsBuffer)
    session.screenshot_seconds_buffer = Math.round(this.screenshotSecondsBuffer)
    storage.updateCurrentSession({
      worked_minutes: session.worked_minutes,
      active_minutes: session.active_minutes,
      suspended_seconds: session.suspended_seconds || 0,
      active_seconds_buffer: session.active_seconds_buffer,
      screenshot_seconds_buffer: session.screenshot_seconds_buffer,
      last_heartbeat: session.last_heartbeat
    }, user.id, minuteRolledOver)

    this.tickCounter += 1
    const idleChanged = isIdle !== this.lastEmittedIdle
    this.lastEmittedIdle = isIdle

    // Emit every second when active or on break so that live counters update smoothly, or on idle change or minute rollover
    if (isWorking || session.status === 'on_break' || idleChanged || minuteRolledOver || (this.tickCounter % 5 === 0)) {
      this.emitState()
    }
  }

  public getState(employeeId?: string): TrackingState {
    const user = storage.getCurrentUser()
    const empId = employeeId || user?.id

    if (!empId) {
      return {
        status: 'Not Clocked In',
        currentSession: null,
        todayWorkedMinutes: 0,
        todayActiveMinutes: 0,
        activeAppName: this.currentApp,
        isIdle: false,
        idleSeconds: 0,
        lastActivityTime: new Date().toISOString(),
        isOnline: true,
        lastSyncedAt: null,
        pendingSyncCount: 0
      }
    }

    const session = storage.getCurrentSession(empId)
    const settings = storage.getSettings()
    const idleSeconds = powerMonitor.getSystemIdleTime()
    const isIdle = idleSeconds >= settings.idleThresholdSeconds

    const todaySessions = storage.getTodaySessions(empId)
    const todayWorkedSeconds = calculateDailyWorkedSeconds(session, todaySessions)
    const todayActiveSeconds = calculateDailyActiveSeconds(session, todaySessions)
    const todayWorkedMinutes = Math.min(1440, Math.floor(todayWorkedSeconds / 60))
    const totalTodayActive = Math.min(1440, Math.floor(todayActiveSeconds / 60))

    let status: TrackingStatus = 'Not Clocked In'
    if (session && session.employee_id === empId && !session.clock_out && session.status !== 'completed' && session.status !== 'Completed') {
      const hasOpenBreak = session.breaks && session.breaks.some(b => b.end_time === null)
      status = hasOpenBreak ? 'on_break' : 'working'
    } else if (todaySessions.length > 0 && todaySessions.some(s => s.status === 'completed' || s.status === 'Completed' || s.clock_out !== null)) {
      status = 'Completed'
    }

    return {
      status,
      currentSession: session,
      todayWorkedMinutes,
      todayActiveMinutes: totalTodayActive,
      todayWorkedSeconds,
      todayActiveSeconds,
      todaySessions,
      activeAppName: this.currentApp,
      isIdle,
      idleSeconds,
      lastActivityTime: new Date().toISOString(),
      isOnline: true,
      lastSyncedAt: storage.getLastSynced(empId),
      pendingSyncCount: storage.getPendingQueue(empId).length
    }
  }

  public emitState() {
    if (this.window && !this.window.isDestroyed()) {
      const state = this.getState()
      this.window.webContents.send('tracking:state-update', state)
    }
  }

  // Session Control Actions strictly tied to employeeId
  public clockIn(employeeId: string, shouldEmit: boolean = true): TrackingSession {
    const user = storage.getCurrentUser()
    if (!user || user.id !== employeeId) {
      throw new Error(`Clock in failed: requested employee ${employeeId} does not match active authenticated user ${user?.id || 'none'}`)
    }

    const existing = storage.getCurrentSession(employeeId)
    if (existing && existing.status !== 'Completed' && existing.status !== 'completed' && !existing.clock_out) {
      if (shouldEmit) this.emitState()
      return existing
    }

    const today = storage.getTodayBusinessDate()
    const nowIso = new Date().toISOString()
    const newSession: TrackingSession = {
      id: crypto.randomUUID(),
      employee_id: employeeId,
      session_date: today,
      clock_in: nowIso,
      clock_out: null,
      status: 'working',
      worked_minutes: 0,
      active_minutes: 0,
      suspended_seconds: 0,
      active_seconds_buffer: 0,
      screenshot_seconds_buffer: this.screenshotSecondsBuffer,
      last_heartbeat: nowIso,
      breaks: []
    }

    this.lastTickTime = Date.now()
    this.lastHrTime = process.hrtime.bigint()
    this.currentBusinessDate = today
    storage.setCurrentSession(newSession, employeeId)
    this.activeSecondsBuffer = 0
    if (shouldEmit) {
      this.emitState()
    }
    return newSession
  }

  public takeBreak(employeeId?: string, reason?: string): TrackingSession | null {
    const user = storage.getCurrentUser()
    const empId = employeeId || user?.id
    if (!empId) return null

    const session = storage.getCurrentSession(empId)
    if (!session || session.employee_id !== empId) return null

    const isWorking = session.status === 'Working' || session.status === 'working'
    if (!isWorking) return null
    if (session.breaks.some(b => b.end_time === null)) return session

    const newBreak: BreakRecord = {
      id: crypto.randomUUID(),
      session_id: session.id,
      start_time: new Date().toISOString(),
      end_time: null,
      duration_minutes: 0,
      reason: reason || 'Break'
    }

    session.breaks.push(newBreak)
    session.status = 'on_break'
    storage.updateCurrentSession({
      status: 'on_break',
      breaks: session.breaks
    }, empId)

    this.activeSecondsBuffer = 0
    this.emitState()
    return session
  }

  public resumeBreak(employeeId?: string): TrackingSession | null {
    const user = storage.getCurrentUser()
    const empId = employeeId || user?.id
    if (!empId) return null

    const session = storage.getCurrentSession(empId)
    if (!session || session.employee_id !== empId) return null

    const isOnBreak = session.status === 'On Break' || session.status === 'on_break'
    if (!isOnBreak) return session

    const ongoingBreak = session.breaks.find(b => b.end_time === null)
    if (ongoingBreak) {
      const now = new Date().toISOString()
      ongoingBreak.end_time = now
      const startMs = new Date(ongoingBreak.start_time).getTime()
      const endMs = new Date(now).getTime()
      ongoingBreak.duration_minutes = Math.max(0, Math.floor((endMs - startMs) / 60000))
    }

    session.status = 'working'
    storage.updateCurrentSession({
      status: 'working',
      breaks: session.breaks
    }, empId)

    this.activeSecondsBuffer = 0
    this.emitState()
    return session
  }

  public clockOut(employeeId?: string): TrackingSession | null {
    const user = storage.getCurrentUser()
    const empId = employeeId || user?.id
    if (!empId) return null

    const session = storage.getCurrentSession(empId)
    if (!session || session.employee_id !== empId || session.status === 'Completed' || session.status === 'completed') return null

    const now = new Date()

    const ongoingBreak = session.breaks.find(b => b.end_time === null)
    if (ongoingBreak) {
      ongoingBreak.end_time = now.toISOString()
      const startMs = new Date(ongoingBreak.start_time).getTime()
      ongoingBreak.duration_minutes = Math.max(0, Math.floor((now.getTime() - startMs) / 60000))
    }

    session.clock_out = now.toISOString()
    session.status = 'completed'

    const clockInTime = new Date(session.clock_in).getTime()
    let totalBreakMs = 0
    for (const b of session.breaks) {
      if (b.end_time) {
        totalBreakMs += Math.max(0, new Date(b.end_time).getTime() - new Date(b.start_time).getTime())
      }
    }
    const suspendedMs = (session.suspended_seconds || 0) * 1000
    const finalWorkedMs = Math.max(0, now.getTime() - clockInTime - totalBreakMs - suspendedMs)
    session.worked_minutes = Math.floor(finalWorkedMs / 60000)

    storage.setCurrentSession(null, empId)
    const store = storage.getEmployeeData(empId)
    const idx = store.todaySessions.findIndex(s => s.id === session.id)
    if (idx !== -1) {
      store.todaySessions[idx] = session
    } else {
      store.todaySessions.push(session)
    }
    storage.saveStore()

    this.activeSecondsBuffer = 0
    this.screenshotSecondsBuffer = 0
    this.emitState()
    return session
  }

  /**
   * Handles Windows/system shutdown, logoff, or app quitting.
   * Immediately finalizes active session and flushes storage to disk
   * so both worked and active hours stop cleanly without phantom accumulation.
   */
  public handleSystemShutdown() {
    console.log('[ActivityTracker] Handling system shutdown: stopping tracker and finalizing session.')
    this.stop()

    const user = storage.getCurrentUser()
    if (!user) return

    const session = storage.getCurrentSession(user.id)
    if (!session || session.clock_out || session.status === 'completed' || session.status === 'Completed') {
      storage.flush()
      return
    }

    const now = new Date()
    const nowIso = now.toISOString()

    // Close any ongoing break
    const ongoingBreak = session.breaks?.find(b => b.end_time === null)
    if (ongoingBreak) {
      ongoingBreak.end_time = nowIso
      const startMs = new Date(ongoingBreak.start_time).getTime()
      ongoingBreak.duration_minutes = Math.max(0, Math.floor((now.getTime() - startMs) / 60000))
    }

    session.clock_out = nowIso
    session.status = 'completed'
    session.last_heartbeat = nowIso

    const clockInTime = new Date(session.clock_in).getTime()
    let totalBreakMs = 0
    for (const b of session.breaks || []) {
      if (b.end_time) {
        totalBreakMs += Math.max(0, new Date(b.end_time).getTime() - new Date(b.start_time).getTime())
      }
    }
    const suspendedMs = (session.suspended_seconds || 0) * 1000
    const finalWorkedMs = Math.max(0, now.getTime() - clockInTime - totalBreakMs - suspendedMs)
    session.worked_minutes = Math.floor(finalWorkedMs / 60000)

    storage.setCurrentSession(null, user.id)
    const store = storage.getEmployeeData(user.id)
    const idx = store.todaySessions.findIndex(s => s.id === session.id)
    if (idx !== -1) {
      store.todaySessions[idx] = session
    } else {
      store.todaySessions.push(session)
    }

    storage.enqueuePending({
      id: `session-${session.id}`,
      type: 'session',
      employee_id: user.id,
      data: session,
      createdAt: nowIso,
      retries: 0
    }, user.id)

    this.activeSecondsBuffer = 0
    this.screenshotSecondsBuffer = 0
    storage.flush()
  }

  /**
   * Handles day rollover at midnight (00:00:00 Asia/Kolkata).
   * Finalizes yesterday's session at the day boundary and resets
   * all daily metrics and session state for the new day.
   */
  public handleDayRollover(previousDay: string, newDay: string) {
    console.log(`[ActivityTracker] Day rollover detected (${previousDay} -> ${newDay}). Resetting day.`)
    const user = storage.getCurrentUser()
    if (user) {
      const store = storage.getEmployeeData(user.id)
      const session = store.currentSession
      if (session && !session.clock_out && session.status !== 'completed' && session.status !== 'Completed') {
        const { dayEndMs } = getKolkataDayBounds(previousDay)
        const closeIso = new Date(dayEndMs - 1).toISOString()

        const ongoingBreak = session.breaks?.find(b => b.end_time === null)
        if (ongoingBreak) {
          ongoingBreak.end_time = closeIso
          const startMs = new Date(ongoingBreak.start_time).getTime()
          ongoingBreak.duration_minutes = Math.max(0, Math.floor((dayEndMs - startMs) / 60000))
        }

        session.clock_out = closeIso
        session.status = 'completed'

        const clockInTime = new Date(session.clock_in).getTime()
        let totalBreakMs = 0
        for (const b of session.breaks || []) {
          if (b.end_time) {
            totalBreakMs += Math.max(0, new Date(b.end_time).getTime() - new Date(b.start_time).getTime())
          }
        }
        const suspendedMs = (session.suspended_seconds || 0) * 1000
        const finalWorkedMs = Math.max(0, dayEndMs - clockInTime - totalBreakMs - suspendedMs)
        session.worked_minutes = Math.floor(finalWorkedMs / 60000)

        store.currentSession = null
        const idx = store.todaySessions.findIndex(s => s.id === session.id)
        if (idx !== -1) {
          store.todaySessions[idx] = session
        } else {
          store.todaySessions.push(session)
        }

        storage.enqueuePending({
          id: `session-${session.id}`,
          type: 'session',
          employee_id: user.id,
          data: session,
          createdAt: closeIso,
          retries: 0
        }, user.id)

        storage.flush()
      }

      // Also ensure any open sessions in history belonging to previousDay are finalized
      if (Array.isArray(store.todaySessions)) {
        let changed = false
        for (const s of store.todaySessions) {
          if (s.session_date === previousDay && (!s.clock_out || s.status === 'working' || s.status === 'on_break')) {
            const { dayEndMs } = getKolkataDayBounds(previousDay)
            const closeIso = s.last_heartbeat || new Date(dayEndMs - 1).toISOString()
            s.clock_out = closeIso
            s.status = 'completed'
            const clockInTime = new Date(s.clock_in).getTime()
            const clockOutTime = new Date(closeIso).getTime()
            let totalBreakMs = 0
            if (Array.isArray(s.breaks)) {
              for (const b of s.breaks) {
                if (b.end_time === null) {
                  b.end_time = closeIso
                }
                if (b.end_time) {
                  totalBreakMs += Math.max(0, new Date(b.end_time).getTime() - new Date(b.start_time).getTime())
                }
              }
            }
            const suspendedMs = (s.suspended_seconds || 0) * 1000
            s.worked_minutes = Math.max(0, Math.floor((clockOutTime - clockInTime - totalBreakMs - suspendedMs) / 60000))
            storage.enqueuePending({
              id: `session-${s.id}`,
              type: 'session',
              employee_id: user.id,
              data: s,
              createdAt: closeIso,
              retries: 0
            }, user.id)
            changed = true
          }
        }
        if (changed) {
          storage.flush()
        }
      }
    }

    this.activeSecondsBuffer = 0
    this.screenshotSecondsBuffer = 0
    this.currentBusinessDate = newDay
    this.emitState()
  }
}

export const activityTracker = new ActivityTracker()
