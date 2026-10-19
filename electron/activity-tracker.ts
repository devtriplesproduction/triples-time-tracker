import { app, powerMonitor, BrowserWindow } from 'electron'
import { execFile } from 'child_process'
import path from 'path'
import fs from 'fs'
import { storage } from './storage'
import type { TrackingState, TrackingStatus, ActivityInterval, TrackingSession, BreakRecord, UserProfile } from '../src/types'
import { calculateDailyWorkedSeconds, calculateDailyActiveSeconds } from '../src/utils/timeCalculator'

class ActivityTracker {
  private timer: NodeJS.Timeout | null = null
  private appDetectTimer: NodeJS.Timeout | null = null
  private window: BrowserWindow | null = null
  private currentApp: string = 'Desktop Work'
  private currentTitle: string = ''
  private lastInputCheckTime: number = Date.now()
  private activeSecondsBuffer: number = 0
  private isSuspended: boolean = false
  private isScreenLocked: boolean = false
  private suspendStartTime: number | null = null
  private isDetectingApp: boolean = false
  private tickCounter: number = 0
  private lastEmittedIdle: boolean = false

  constructor() {
    this.setupPowerMonitor()
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
  }

  public start() {
    if (this.timer) clearInterval(this.timer)
    if (this.appDetectTimer) clearInterval(this.appDetectTimer)

    const user = storage.getCurrentUser()
    const session = user ? storage.getCurrentSession(user.id) : null
    if (session && session.active_seconds_buffer) {
      this.activeSecondsBuffer = session.active_seconds_buffer
    } else {
      this.activeSecondsBuffer = 0
    }

    // Tick every 1 second for active timer updates
    this.timer = setInterval(() => this.tick(), 1000)

    // Check foreground application every 10 seconds
    this.appDetectTimer = setInterval(() => this.detectForegroundApp(), 10000)
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
    } else {
      this.activeSecondsBuffer = 0
    }
    this.emitState()
  }

  public onUserLogout() {
    this.activeSecondsBuffer = 0
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

    // Calculate worked duration for current employee session excluding breaks and sleep
    const now = Date.now()
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
      this.activeSecondsBuffer += 1
      if (this.activeSecondsBuffer >= 60) {
        session.active_minutes += 1
        this.activeSecondsBuffer = 0
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
    }

    session.active_seconds_buffer = this.activeSecondsBuffer
    storage.updateCurrentSession({
      worked_minutes: session.worked_minutes,
      active_minutes: session.active_minutes,
      suspended_seconds: session.suspended_seconds || 0,
      active_seconds_buffer: this.activeSecondsBuffer
    }, user.id, minuteRolledOver)

    this.tickCounter += 1
    const idleChanged = isIdle !== this.lastEmittedIdle
    this.lastEmittedIdle = isIdle

    // Emit immediately when idle state changes, active minute completes, or periodically every 5 ticks
    if (idleChanged || minuteRolledOver || (this.tickCounter % 5 === 0)) {
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
    const allSessions = storage.getAllSessions ? storage.getAllSessions(empId) : todaySessions
    const todayWorkedSeconds = calculateDailyWorkedSeconds(session, allSessions)
    const todayActiveSeconds = calculateDailyActiveSeconds(session, allSessions)
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
    const newSession: TrackingSession = {
      id: crypto.randomUUID(),
      employee_id: employeeId,
      session_date: today,
      clock_in: new Date().toISOString(),
      clock_out: null,
      status: 'working',
      worked_minutes: 0,
      active_minutes: 0,
      suspended_seconds: 0,
      active_seconds_buffer: 0,
      breaks: []
    }

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
    this.emitState()
    return session
  }
}

export const activityTracker = new ActivityTracker()
