import { app, powerMonitor, BrowserWindow } from 'electron'
import { execFile } from 'child_process'
import path from 'path'
import fs from 'fs'
import { storage } from './storage'
import { screenshotService } from './screenshot-service'
import type { TrackingState, TrackingStatus, ActivityInterval, TrackingSession, BreakRecord, UserProfile, TimeResetAuditRecord } from '../src/types'
import { calculateDailyWorkedSeconds, calculateDailyActiveSeconds, calculateSessionWorkedSeconds, getKolkataDayBounds, getDayBounds, getDateString, formatSecondsToHHMMSS } from '../src/utils/timeCalculator'

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
  private activeRemainderMs: number = 0
  private isSuspended: boolean = false
  private isScreenLocked: boolean = false
  private suspendStartTime: number | null = null
  private isDetectingApp: boolean = false
  private tickCounter: number = 0
  private lastEmittedIdle: boolean = false
  private lastIdleSeconds: number = 0
  private screenshotSecondsBuffer: number = 0
  private pendingContinuationSuspendedSeconds: number = 0
  private onMinuteRolledOverCallbacks: Array<() => void> = []

  constructor() {
    this.currentBusinessDate = storage.getTodayBusinessDate()
    this.setupPowerMonitor()
  }

  public onMinuteRolledOver(cb: () => void) {
    this.onMinuteRolledOverCallbacks.push(cb)
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

  public syncBuffersFromSession(session: TrackingSession | null) {
    if (session && (session.status === 'working' || session.status === 'Working' || session.status === 'on_break' || session.status === 'On Break')) {
      if (typeof session.active_seconds_buffer === 'number' && session.active_seconds_buffer >= 0) {
        this.activeSecondsBuffer = session.active_seconds_buffer
      }
      if (typeof session.screenshot_seconds_buffer === 'number' && session.screenshot_seconds_buffer >= 0) {
        this.screenshotSecondsBuffer = session.screenshot_seconds_buffer
      }
    }
  }

  private setupPowerMonitor() {
    powerMonitor.on('suspend', () => {
      console.log('[ActivityTracker:State] PowerMonitor: system suspended.')
      this.isSuspended = true
      this.suspendStartTime = Date.now()
      this.emitState()
    })

    powerMonitor.on('resume', () => {
      console.log('[ActivityTracker:State] PowerMonitor: system resumed.')
      if (this.suspendStartTime) {
        const user = storage.getCurrentUser()
        const session = user ? storage.getCurrentSession(user.id) : null
        if (session && user) {
          const hasOpenBreak = Array.isArray(session.breaks) && session.breaks.some(b => b.end_time === null)
          if (!hasOpenBreak) {
            const now = Date.now()
            const tz = storage.getSettings().timezone || 'Asia/Kolkata'
            const sessionDay = session.session_date || getDateString(new Date(session.clock_in), tz)
            const { dayEndMs } = getDayBounds(sessionDay, tz)

            // If suspend spanned across the midnight boundary of the session's date:
            if (this.suspendStartTime < dayEndMs && now > dayEndMs) {
              const day1SuspendedMs = Math.max(0, dayEndMs - this.suspendStartTime)
              const day2SuspendedMs = Math.max(0, now - dayEndMs)
              const day1Sec = Math.floor(day1SuspendedMs / 1000)
              const day2Sec = Math.floor(day2SuspendedMs / 1000)

              session.suspended_seconds = (session.suspended_seconds || 0) + day1Sec
              this.pendingContinuationSuspendedSeconds = (this.pendingContinuationSuspendedSeconds || 0) + day2Sec
              console.log(`[ActivityTracker:State] Sleep spanned midnight. Day 1 suspended: ${day1Sec}s, Day 2 suspended: ${day2Sec}s.`)
            } else {
              const suspendedDurationMs = Math.max(0, now - this.suspendStartTime)
              const addedSuspendedSec = Math.floor(suspendedDurationMs / 1000)
              session.suspended_seconds = (session.suspended_seconds || 0) + addedSuspendedSec
              console.log(`[ActivityTracker:State] Excluded ${addedSuspendedSec}s of sleep from employee ${user.id} worked duration. Total suspended: ${session.suspended_seconds}s.`)
            }
            storage.updateCurrentSession({ suspended_seconds: session.suspended_seconds }, user.id, true)
          }
        }
        this.suspendStartTime = null
      }
      this.isSuspended = false
      // Synchronize monotonic timers to prevent double-counting in tick()
      this.lastTickTime = Date.now()
      this.lastHrTime = process.hrtime.bigint()
      this.lastInputCheckTime = Date.now()
      this.emitState()
    })

    powerMonitor.on('lock-screen', () => {
      console.log('[ActivityTracker:State] PowerMonitor: screen locked.')
      this.isScreenLocked = true
      this.emitState()
    })

    powerMonitor.on('unlock-screen', () => {
      console.log('[ActivityTracker:State] PowerMonitor: screen unlocked.')
      this.isScreenLocked = false
      this.lastTickTime = Date.now()
      this.lastHrTime = process.hrtime.bigint()
      this.lastInputCheckTime = Date.now()
      this.emitState()
    })

    powerMonitor.on('shutdown', () => {
      console.log('[ActivityTracker:State] PowerMonitor: system shutdown received.')
      this.handleSystemShutdown()
    })
  }

  public start() {
    if (this.timer) clearTimeout(this.timer)
    if (this.appDetectTimer) clearInterval(this.appDetectTimer)

    this.lastTickTime = Date.now()
    this.lastHrTime = process.hrtime.bigint()
    const tz = storage.getSettings().timezone || 'Asia/Kolkata'
    const today = getDateString(new Date(), tz)
    this.currentBusinessDate = today

    const user = storage.getCurrentUser()
    if (user && user.id) {
      const store = storage.getEmployeeData(user.id)
      const rawSession = store.currentSession
      // If an unclosed session from prior date exists upon startup, execute rollover cleanly
      if (
        rawSession &&
        rawSession.session_date &&
        rawSession.session_date !== today &&
        !rawSession.clock_out &&
        rawSession.status !== 'completed' &&
        rawSession.status !== 'Completed'
      ) {
        console.log(`[ActivityTracker] Active session from prior day (${rawSession.session_date}) detected on startup. Executing automatic rollover to ${today}.`)
        this.handleDayRollover(rawSession.session_date, today, tz)
      }
    }

    const session = user ? storage.getCurrentSession(user.id) : null
    if (session) {
      this.activeSecondsBuffer = session.active_seconds_buffer || 0
      this.screenshotSecondsBuffer = session.screenshot_seconds_buffer || 0
    } else {
      this.activeSecondsBuffer = 0
      this.screenshotSecondsBuffer = 0
    }
    this.activeRemainderMs = 0

    // High-precision self-correcting timer loop scheduling ticks on exact 1000ms boundaries
    let nextTickTime = Date.now() + 1000
    const scheduleNextTick = () => {
      const now = Date.now()
      const delay = Math.max(0, nextTickTime - now)
      this.timer = setTimeout(() => {
        nextTickTime += 1000
        // If we fell way behind (e.g. system sleep/suspend), reset nextTickTime
        if (Date.now() - nextTickTime > 2000) {
          nextTickTime = Date.now() + 1000
        }
        this.tick()
        scheduleNextTick()
      }, delay)
    }
    scheduleNextTick()

    // Check foreground application every 15 seconds (optimized for reduced CPU overhead)
    this.appDetectTimer = setInterval(() => this.detectForegroundApp(), 15000)
    this.detectForegroundApp()
  }

  public stop() {
    if (this.timer) clearTimeout(this.timer)
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
    this.activeRemainderMs = 0
    this.emitState()
  }

  public onUserLogout() {
    this.activeSecondsBuffer = 0
    this.activeRemainderMs = 0
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

    // Performance Optimization: Skip spawning process when user is idle / away
    const settings = storage.getSettings()
    const idleSeconds = powerMonitor.getSystemIdleTime()
    if (idleSeconds >= settings.idleThresholdSeconds) {
      return
    }

    // Performance Optimization: Concurrency guard preventing overlapping processes
    if (this.isDetectingApp) {
      return
    }

    try {
      const exePath = app.isPackaged
        ? path.join(process.resourcesPath, 'scripts', 'get-active-window.exe')
        : path.join(__dirname, '../scripts/get-active-window.exe')

      const ps1Path = app.isPackaged
        ? path.join(process.resourcesPath, 'scripts', 'get-active-window.ps1')
        : path.join(__dirname, '../scripts/get-active-window.ps1')

      this.isDetectingApp = true

      // High-performance path: execute pre-compiled C# native binary (~170ms, zero compiler overhead)
      if (fs.existsSync(exePath)) {
        execFile(exePath, [], { timeout: 1500 }, (error, stdout) => {
          this.isDetectingApp = false
          if (!error && stdout) {
            try {
              const parsed = JSON.parse(stdout.trim())
              if (parsed.ProcessName && parsed.ProcessName !== 'Unknown') {
                this.currentApp = parsed.ProcessName
                this.currentTitle = (parsed.Title || '').slice(0, 255)
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        })
      } else if (fs.existsSync(ps1Path)) {
        // Fallback: PowerShell script
        execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1Path], { timeout: 3500 }, (error, stdout) => {
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
      } else {
        this.isDetectingApp = false
      }
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

    // 1. Day Rollover check at the beginning of tick using configured timezone
    const tz = storage.getSettings().timezone || 'Asia/Kolkata'
    const today = getDateString(new Date(), tz)
    if (!this.currentBusinessDate) {
      this.currentBusinessDate = today
    } else if (this.currentBusinessDate !== today) {
      this.handleDayRollover(this.currentBusinessDate, today, tz)
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
    const thresholdSec = settings.idleThresholdSeconds || 60
    const idleSeconds = powerMonitor.getSystemIdleTime()
    const isIdle = idleSeconds >= thresholdSec

    // If active user input is detected, autocorrect screen lock or suspend flags if they were stuck
    if (idleSeconds < thresholdSec) {
      if (this.isScreenLocked) {
        console.log(`[ActivityTracker:Input] Input detected (idle: ${idleSeconds}s < ${thresholdSec}s) while screen was flagged locked. Autocorrecting isScreenLocked to false.`)
        this.isScreenLocked = false
      }
      if (this.isSuspended) {
        console.log(`[ActivityTracker:Input] Input detected (idle: ${idleSeconds}s < ${thresholdSec}s) while system was flagged suspended. Autocorrecting isSuspended to false.`)
        this.isSuspended = false
      }
    }

    // Calculate real elapsed time delta with monotonic anti-tamper validation
    const now = Date.now()
    const nowHr = process.hrtime.bigint()
    const monotonicDeltaMs = Number(nowHr - this.lastHrTime) / 1_000_000
    this.lastHrTime = nowHr

    const intervalStart = this.lastTickTime || (now - 1000)
    let deltaMs = this.lastTickTime ? Math.max(0, now - this.lastTickTime) : 1000
    this.lastTickTime = now

    const isWorking = session.status === 'Working' || session.status === 'working'
    const isOnBreak = session.status === 'On Break' || session.status === 'on_break' || (session.breaks && session.breaks.some(b => b.end_time === null))

    // Anti-tampering / Suspend detection: if system clock jumped or PC woke from sleep without suspend event
    if (Math.abs(deltaMs - monotonicDeltaMs) > 3000) {
      const clockJumpSec = Math.round((deltaMs - monotonicDeltaMs) / 1000)
      console.warn(`[ActivityTracker:Tick] System clock anomaly/sleep detected (wall: ${deltaMs}ms vs monotonic: ${Math.round(monotonicDeltaMs)}ms, jump: ${clockJumpSec}s).`)
      // Only allocate clock jump to suspended_seconds if positive and NOT already on break
      if (clockJumpSec > 0 && !isOnBreak) {
        session.suspended_seconds = Math.max(0, (session.suspended_seconds || 0) + clockJumpSec)
        console.log(`[ActivityTracker:Tick] Excluded ${clockJumpSec}s of sleep from employee worked duration. Total suspended: ${session.suspended_seconds}s.`)
      }
      deltaMs = Math.max(0, monotonicDeltaMs)
    }

    session.last_heartbeat = new Date(now).toISOString()

    // Calculate worked duration for current employee session excluding breaks and sleep
    const clockInTime = new Date(session.clock_in).getTime()

    let totalBreakMs = 0
    for (const b of session.breaks || []) {
      const start = new Date(b.start_time).getTime()
      const end = b.end_time ? new Date(b.end_time).getTime() : now
      totalBreakMs += Math.max(0, end - start)
    }

    const suspendedMs = (session.suspended_seconds || 0) * 1000
    const currentWorkedMs = Math.max(0, now - clockInTime - totalBreakMs - suspendedMs)
    session.worked_minutes = Math.floor(currentWorkedMs / 60000)

    // Accurate Active Time Accumulation during [intervalStart, now]
    let minuteRolledOver = false
    let activeDeltaMs = 0

    if (isWorking && !isOnBreak && !this.isSuspended && !this.isScreenLocked) {
      if (!isIdle) {
        if (this.lastEmittedIdle) {
          // Transition from Idle -> Active: user resumed activity
          const activeSinceInputMs = idleSeconds > 0 ? Math.round(idleSeconds * 1000) : deltaMs
          activeDeltaMs = Math.min(deltaMs, Math.max(0, activeSinceInputMs))
        } else {
          // Continuously active
          activeDeltaMs = deltaMs
        }
      } else {
        // User is currently idle (idleSeconds >= thresholdSec)
        if (!this.lastEmittedIdle) {
          // Transition from Active -> Idle: portion before crossing threshold was active
          const overdueIdleMs = (idleSeconds - thresholdSec) * 1000
          if (overdueIdleMs < deltaMs) {
            activeDeltaMs = Math.max(0, deltaMs - overdueIdleMs)
          } else {
            activeDeltaMs = 0
          }
        } else {
          // Continuously idle
          activeDeltaMs = 0
        }
      }

      // Bound active delta to physical elapsed deltaMs
      activeDeltaMs = Math.min(deltaMs, Math.max(0, activeDeltaMs))

      this.activeRemainderMs += activeDeltaMs
      while (this.activeRemainderMs >= 1000) {
        this.activeRemainderMs -= 1000
        this.activeSecondsBuffer += 1
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
      }

      // Automatic 7-minute periodic screenshot capture (420 active working seconds)
      const activeDeltaSec = activeDeltaMs / 1000
      this.screenshotSecondsBuffer += activeDeltaSec
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

    session.active_seconds_buffer = Math.floor(this.activeSecondsBuffer)
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
    const wasIdle = this.lastEmittedIdle
    this.lastEmittedIdle = isIdle
    this.lastIdleSeconds = idleSeconds

    // Diagnostic logging
    if (idleChanged) {
      console.log(`[ActivityTracker:Idle] Idle transition: isIdle=${isIdle} (idleSeconds=${idleSeconds}s, threshold=${thresholdSec}s, transition=${wasIdle ? 'Idle->Active' : 'Active->Idle'}).`)
    }
    if (minuteRolledOver) {
      console.log(`[ActivityTracker:Accumulator] Minute rollover: worked=${session.worked_minutes}m, active=${session.active_minutes}m (buffer: ${session.active_seconds_buffer}s), suspended=${session.suspended_seconds}s.`)
      for (const cb of this.onMinuteRolledOverCallbacks) {
        try { cb() } catch (err) { console.warn('[ActivityTracker] minuteRolledOver callback error:', err) }
      }
    }
    if (this.tickCounter % 60 === 0) {
      console.log(`[ActivityTracker:Tick] Diagnostic checkpoint #${this.tickCounter}: status=${session.status}, idle=${idleSeconds}s (${isIdle ? 'IDLE' : 'ACTIVE'}), deltaMs=${Math.round(deltaMs)}ms, activeDeltaMs=${Math.round(activeDeltaMs)}ms, worked=${session.worked_minutes}m, active=${session.active_minutes}m:${session.active_seconds_buffer}s.`)
    }

    // Emit every second when active or on break so that live counters update smoothly, or on idle change or minute rollover
    if (isWorking || isOnBreak || idleChanged || minuteRolledOver || (this.tickCounter % 5 === 0)) {
      this.emitState()
    }
  }

  public getState(employeeId?: string): TrackingState {
    const user = storage.getCurrentUser()
    const empId = employeeId || user?.id
    const serverTimestamp = Date.now()

    if (!empId) {
      return {
        status: 'Not Clocked In',
        currentSession: null,
        todayWorkedMinutes: 0,
        todayActiveMinutes: 0,
        todayWorkedSeconds: 0,
        todayActiveSeconds: 0,
        activeAppName: this.currentApp,
        isIdle: false,
        idleSeconds: 0,
        lastActivityTime: new Date(serverTimestamp).toISOString(),
        isOnline: true,
        lastSyncedAt: null,
        pendingSyncCount: 0,
        serverTimestamp,
        sessionClockInMs: null,
        totalBreakMs: 0,
        suspendedMs: 0,
        isTrackingActive: false
      }
    }

    const session = storage.getCurrentSession(empId)
    const settings = storage.getSettings()
    const idleSeconds = powerMonitor.getSystemIdleTime()
    const isIdle = idleSeconds >= settings.idleThresholdSeconds

    const todaySessions = storage.getTodaySessions(empId)
    const tz = settings.timezone || 'Asia/Kolkata'
    const todayWorkedSeconds = calculateDailyWorkedSeconds(session, todaySessions, undefined, serverTimestamp, tz)
    const todayActiveSeconds = calculateDailyActiveSeconds(session, todaySessions, undefined, serverTimestamp, tz)
    const todayWorkedMinutes = Math.min(1440, Math.floor(todayWorkedSeconds / 60))
    const totalTodayActive = Math.min(1440, Math.floor(todayActiveSeconds / 60))

    let status: TrackingStatus = 'Not Clocked In'
    if (session && session.employee_id === empId && !session.clock_out && session.status !== 'completed' && session.status !== 'Completed') {
      const hasOpenBreak = session.breaks && session.breaks.some(b => b.end_time === null)
      status = hasOpenBreak ? 'on_break' : 'working'
    } else if (todaySessions.length > 0 && todaySessions.some(s => s.status === 'completed' || s.status === 'Completed' || s.clock_out !== null)) {
      status = 'Completed'
    }

    const isWorking = status === 'working'
    const isTrackingActive = Boolean(isWorking && !isIdle && !this.isSuspended && !this.isScreenLocked)

    let totalBreakMs = 0
    if (session && Array.isArray(session.breaks)) {
      for (const b of session.breaks) {
        const start = new Date(b.start_time).getTime()
        const end = b.end_time ? new Date(b.end_time).getTime() : serverTimestamp
        totalBreakMs += Math.max(0, end - start)
      }
    }
    const suspendedMs = session ? (session.suspended_seconds || 0) * 1000 : 0
    const sessionClockInMs = session && session.clock_in ? new Date(session.clock_in).getTime() : null

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
      lastActivityTime: new Date(serverTimestamp).toISOString(),
      isOnline: true,
      lastSyncedAt: storage.getLastSynced(empId),
      pendingSyncCount: storage.getPendingQueue(empId).length,
      serverTimestamp,
      sessionClockInMs,
      totalBreakMs,
      suspendedMs,
      isTrackingActive
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
    this.activeSecondsBuffer = 0
    this.activeRemainderMs = 0
    this.isSuspended = false
    this.isScreenLocked = false
    storage.setCurrentSession(newSession, employeeId)
    console.log(`[ActivityTracker:State] Employee ${employeeId} clocked in at ${nowIso}. Session ID: ${newSession.id}`)
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
      breaks: session.breaks,
      active_seconds_buffer: Math.round(this.activeSecondsBuffer)
    }, empId, true)

    console.log(`[ActivityTracker:State] Employee ${empId} took break: ${newBreak.reason}. Active buffer preserved at ${this.activeSecondsBuffer}s.`)
    // Preserve activeSecondsBuffer across break transitions
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
    this.lastTickTime = Date.now()
    this.lastHrTime = process.hrtime.bigint()

    storage.updateCurrentSession({
      status: 'working',
      breaks: session.breaks,
      active_seconds_buffer: Math.round(this.activeSecondsBuffer)
    }, empId, true)

    console.log(`[ActivityTracker:State] Employee ${empId} resumed work from break. Active buffer preserved at ${this.activeSecondsBuffer}s.`)
    // Preserve activeSecondsBuffer across break transitions
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

    // Roll over any full minutes remaining in activeSecondsBuffer
    if (this.activeSecondsBuffer >= 60) {
      const extraMinutes = Math.floor(this.activeSecondsBuffer / 60)
      session.active_minutes += extraMinutes
      this.activeSecondsBuffer %= 60
    }
    session.active_seconds_buffer = Math.floor(this.activeSecondsBuffer)
    session.clock_out = now.toISOString()
    session.status = 'completed'
    session.last_heartbeat = now.toISOString()

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

    console.log(`[ActivityTracker:State] Employee ${empId} clocked out. Final worked=${session.worked_minutes}m, active=${session.active_minutes}m:${session.active_seconds_buffer}s, breaks=${totalBreakMs / 1000}s, suspended=${session.suspended_seconds}s.`)

    this.activeSecondsBuffer = 0
    this.activeRemainderMs = 0
    this.screenshotSecondsBuffer = 0
    this.emitState()
    return session
  }

  public resetTime(
    employeeId: string,
    resetType: 'restart_session' | 'discard_session'
  ): {
    session: TrackingSession | null
    previousSession: TrackingSession
    previousWorkedSeconds: number
    previousActiveSeconds: number
  } {
    const user = storage.getCurrentUser()
    const empId = employeeId || user?.id
    if (!empId) {
      throw new Error('Authentication required to reset session')
    }

    const currentSession = storage.getCurrentSession(empId)
    if (!currentSession || currentSession.employee_id !== empId) {
      throw new Error('No active session found to reset')
    }

    const now = Date.now()
    const previousWorkedSeconds = Math.max(
      (currentSession.worked_minutes || 0) * 60,
      calculateSessionWorkedSeconds(currentSession, now)
    )
    const previousActiveSeconds = (currentSession.active_minutes || 0) * 60 + (this.activeSecondsBuffer || 0)

    // Reset in-memory buffers and monotonic timers
    this.activeSecondsBuffer = 0
    this.activeRemainderMs = 0
    this.screenshotSecondsBuffer = 0
    this.lastTickTime = Date.now()
    this.lastHrTime = process.hrtime.bigint()

    const result = storage.resetCurrentSession(empId, resetType)
    if (!result) {
      throw new Error('Failed to reset session in storage')
    }

    this.emitState()

    return {
      session: result.session,
      previousSession: result.previousSession,
      previousWorkedSeconds,
      previousActiveSeconds
    }
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

    // Roll over any full minutes remaining in activeSecondsBuffer
    if (this.activeSecondsBuffer >= 60) {
      const extraMinutes = Math.floor(this.activeSecondsBuffer / 60)
      session.active_minutes += extraMinutes
      this.activeSecondsBuffer %= 60
    }
    session.active_seconds_buffer = Math.floor(this.activeSecondsBuffer)

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

    console.log(`[ActivityTracker:State] System shutdown finalized session ${session.id}: worked=${session.worked_minutes}m, active=${session.active_minutes}m:${session.active_seconds_buffer}s.`)

    this.activeSecondsBuffer = 0
    this.activeRemainderMs = 0
    this.screenshotSecondsBuffer = 0
    storage.flush()
  }

  /**
   * Handles automatic day rollover at midnight (12:00 AM) in each employee's configured timezone.
   * - Finalizes yesterday's active session at midnight boundary.
   * - Archives previous-day totals into an immutable local & remote audit log.
   * - Automatically maintains ongoing sessions across midnight starting at 00:00:00 with zero loss or double-counting.
   * - Resets daily Worked Hours and Active Hours to 00:00:00.
   * - Prevents duplicate resets for the same calendar date.
   */
  public handleDayRollover(previousDay: string, newDay: string, timeZone?: string) {
    const tz = timeZone || storage.getSettings().timezone || 'Asia/Kolkata'
    console.log(`[ActivityTracker] Automatic midnight rollover detected (${previousDay} -> ${newDay}) in timezone ${tz}.`)

    const user = storage.getCurrentUser()
    if (!user || !user.id) {
      this.currentBusinessDate = newDay
      this.emitState()
      return
    }

    const store = storage.getEmployeeData(user.id)

    // Prevent duplicate resets for the same day transition
    if (store.lastRolloverDate === newDay) {
      console.log(`[ActivityTracker] Rollover to ${newDay} already processed for employee ${user.id}. Skipping duplicate reset.`)
      this.currentBusinessDate = newDay
      return
    }

    const activeSession = store.currentSession || (Array.isArray(store.todaySessions)
      ? store.todaySessions.find(s => s.session_date === previousDay && !s.clock_out && s.status !== 'completed' && s.status !== 'Completed')
      : null)
    const wasActive = Boolean(
      activeSession &&
      !activeSession.clock_out &&
      activeSession.status !== 'completed' &&
      activeSession.status !== 'Completed'
    )
    const prevStatus = wasActive ? activeSession!.status : 'completed'

    const { dayEndMs } = getDayBounds(previousDay, tz)
    const lastHbMs = activeSession?.last_heartbeat
      ? new Date(activeSession.last_heartbeat).getTime()
      : (activeSession ? new Date(activeSession.clock_in).getTime() : 0)
    // If the computer was shut down or offline > 5 minutes before midnight, the work session stopped before midnight
    const isStaleBeforeMidnight = wasActive && ((dayEndMs - lastHbMs) > 5 * 60 * 1000)
    const shouldContinueAcrossMidnight = wasActive && !isStaleBeforeMidnight

    const closeIso = isStaleBeforeMidnight && activeSession?.last_heartbeat
      ? activeSession.last_heartbeat
      : new Date(dayEndMs).toISOString()
    const midnightStartIso = new Date(dayEndMs).toISOString()

    let closedPreviousSessionId: string | null = null

    // 1. If an active session was ongoing across midnight, finalize yesterday's portion cleanly at midnight boundary
    if (wasActive && activeSession) {
      closedPreviousSessionId = activeSession.id

      // Close any open break at midnight boundary
      if (Array.isArray(activeSession.breaks)) {
        for (const b of activeSession.breaks) {
          if (b.end_time === null) {
            b.end_time = closeIso
            const bStart = new Date(b.start_time).getTime()
            b.duration_minutes = Math.max(0, Math.floor((dayEndMs - bStart) / 60000))
          }
        }
      }

      activeSession.clock_out = closeIso
      activeSession.status = 'completed'
      activeSession.last_heartbeat = closeIso

      const clockInTime = new Date(activeSession.clock_in).getTime()
      let totalBreakMs = 0
      for (const b of activeSession.breaks || []) {
        if (b.end_time) {
          totalBreakMs += Math.max(0, new Date(b.end_time).getTime() - new Date(b.start_time).getTime())
        }
      }
      const suspendedMs = (activeSession.suspended_seconds || 0) * 1000
      const finalWorkedMs = Math.max(0, dayEndMs - clockInTime - totalBreakMs - suspendedMs)
      activeSession.worked_minutes = Math.floor(finalWorkedMs / 60000)

      if (this.activeSecondsBuffer >= 60) {
        const extraMinutes = Math.floor(this.activeSecondsBuffer / 60)
        activeSession.active_minutes += extraMinutes
        this.activeSecondsBuffer %= 60
      }
      activeSession.active_seconds_buffer = Math.floor(this.activeSecondsBuffer)

      // Update in todaySessions
      const idx = store.todaySessions.findIndex(s => s.id === activeSession.id)
      if (idx !== -1) {
        store.todaySessions[idx] = activeSession
      } else {
        store.todaySessions.push(activeSession)
      }

      // Enqueue closed previous day session for database sync
      storage.enqueuePending({
        id: `session-${activeSession.id}`,
        type: 'session',
        employee_id: user.id,
        data: activeSession,
        createdAt: closeIso,
        retries: 0
      }, user.id)
    }

    // Also finalize any other unclosed sessions in todaySessions that belonged to previousDay
    if (Array.isArray(store.todaySessions)) {
      for (const s of store.todaySessions) {
        if (s.session_date === previousDay && (!s.clock_out || s.status === 'working' || s.status === 'on_break')) {
          s.clock_out = closeIso
          s.status = 'completed'
          s.last_heartbeat = closeIso
          const cIn = new Date(s.clock_in).getTime()
          const cOut = new Date(closeIso).getTime()
          s.worked_minutes = Math.max(0, Math.floor((cOut - cIn) / 60000))
          storage.enqueuePending({
            id: `session-${s.id}`,
            type: 'session',
            employee_id: user.id,
            data: s,
            createdAt: closeIso,
            retries: 0
          }, user.id)
        }
      }
    }

    // 2. Calculate immutable previous-day totals
    const prevDayWorkedSeconds = calculateDailyWorkedSeconds(null, store.todaySessions, previousDay, dayEndMs, tz)
    const prevDayActiveSeconds = calculateDailyActiveSeconds(null, store.todaySessions, previousDay, dayEndMs, tz)
    const prevDayWorkedMinutes = Math.floor(prevDayWorkedSeconds / 60)
    const prevDayActiveMinutes = Math.floor(prevDayActiveSeconds / 60)

    // 3. Generate immutable Audit Log capturing previous-day totals
    const auditRecord: TimeResetAuditRecord = {
      id: crypto.randomUUID(),
      session_id: closedPreviousSessionId || (store.todaySessions.find(s => s.session_date === previousDay)?.id || crypto.randomUUID()),
      employee_id: user.id,
      employee_email: user.email,
      employee_name: [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Employee',
      reset_type: 'automatic_daily_reset',
      previous_clock_in: (activeSession && wasActive) ? activeSession.clock_in : `${previousDay}T00:00:00.000Z`,
      previous_worked_minutes: prevDayWorkedMinutes,
      previous_worked_seconds: prevDayWorkedSeconds,
      previous_active_minutes: prevDayActiveMinutes,
      previous_active_seconds: prevDayActiveSeconds,
      previous_status: prevStatus as any,
      reason: `Automatic midnight reset at 12:00 AM (${tz})`,
      notes: wasActive
        ? `Session seamlessly continued across midnight. Prior day (${previousDay}) finalized: ${formatSecondsToHHMMSS(prevDayWorkedSeconds)} worked, ${formatSecondsToHHMMSS(prevDayActiveSeconds)} active.`
        : `Daily reset completed at midnight. Prior day (${previousDay}) totals archived: ${formatSecondsToHHMMSS(prevDayWorkedSeconds)} worked, ${formatSecondsToHHMMSS(prevDayActiveSeconds)} active.`,
      reset_by: user.id,
      reset_by_role: 'System',
      created_at: midnightStartIso
    }

    // Store in local audit logs
    storage.addResetAuditLog(auditRecord, user.id)

    // Enqueue to offline synchronization queue
    storage.enqueuePending({
      id: `reset-audit-${auditRecord.id}`,
      type: 'reset_audit' as any,
      employee_id: user.id,
      data: auditRecord,
      createdAt: midnightStartIso,
      retries: 0
    }, user.id)

    // 4. Maintain ongoing session across midnight without losing or double-counting time
    if (shouldContinueAcrossMidnight) {
      const isBreak = prevStatus === 'on_break'
      const newSession: TrackingSession = {
        id: crypto.randomUUID(),
        employee_id: user.id,
        session_date: newDay,
        clock_in: midnightStartIso,
        clock_out: null,
        status: isBreak ? 'on_break' : 'working',
        worked_minutes: 0,
        active_minutes: 0,
        suspended_seconds: this.pendingContinuationSuspendedSeconds || 0,
        active_seconds_buffer: 0,
        screenshot_seconds_buffer: 0,
        last_heartbeat: new Date().toISOString(),
        breaks: isBreak ? [{
          id: crypto.randomUUID(),
          session_id: '',
          start_time: midnightStartIso,
          end_time: null,
          duration_minutes: 0,
          reason: 'Break continued across midnight'
        }] : []
      }
      if (newSession.breaks.length > 0) {
        newSession.breaks[0].session_id = newSession.id
      }

      store.currentSession = newSession
      store.todaySessions.push(newSession)

      storage.enqueuePending({
        id: `session-${newSession.id}`,
        type: 'session',
        employee_id: user.id,
        data: newSession,
        createdAt: midnightStartIso,
        retries: 0
      }, user.id)
      this.pendingContinuationSuspendedSeconds = 0
    } else {
      store.currentSession = null
      this.pendingContinuationSuspendedSeconds = 0
    }

    // 5. Mark duplicate prevention flag and reset buffers
    store.lastRolloverDate = newDay
    this.activeSecondsBuffer = 0
    this.activeRemainderMs = 0
    this.screenshotSecondsBuffer = 0
    this.currentBusinessDate = newDay
    this.lastTickTime = Date.now()
    this.lastHrTime = process.hrtime.bigint()

    storage.flush()
    this.emitState()
  }
}

export const activityTracker = new ActivityTracker()
