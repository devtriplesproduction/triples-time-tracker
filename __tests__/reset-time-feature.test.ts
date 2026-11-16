import { describe, it, expect, beforeEach } from 'vitest'
import {
  calculateSessionWorkedSeconds,
  calculateDailyWorkedSeconds,
  calculateDailyActiveSeconds,
  formatSecondsToHHMMSS,
  getKolkataDateString,
  getDayBounds
} from '../src/utils/timeCalculator'
import type {
  TrackingSession,
  UserProfile,
  TimeResetAuditRecord,
  ResetTimeParams,
  PendingSyncItem
} from '../src/types'

interface EmployeeDataBucket {
  currentSession: TrackingSession | null
  todaySessions: TrackingSession[]
  resetAuditLogs: TimeResetAuditRecord[]
  pendingSyncQueue: PendingSyncItem[]
  lastRolloverDate?: string | null
}

class TestTrackerEngineWithReset {
  public currentUser: UserProfile | null = null
  public employeeBuckets: Map<string, EmployeeDataBucket> = new Map()
  public isResetInProgress = false

  public getBucket(employeeId: string): EmployeeDataBucket {
    if (!this.employeeBuckets.has(employeeId)) {
      this.employeeBuckets.set(employeeId, {
        currentSession: null,
        todaySessions: [],
        resetAuditLogs: [],
        pendingSyncQueue: [],
        lastRolloverDate: null
      })
    }
    return this.employeeBuckets.get(employeeId)!
  }

  public login(user: UserProfile) {
    this.currentUser = user
    this.getBucket(user.id)
  }

  public logout() {
    this.currentUser = null
  }

  public clockIn(timestamp: string): TrackingSession {
    if (!this.currentUser) throw new Error('Not logged in')
    const bucket = this.getBucket(this.currentUser.id)
    const today = getKolkataDateString(new Date(timestamp))
    const session: TrackingSession = {
      id: `sess-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      employee_id: this.currentUser.id,
      session_date: today,
      clock_in: timestamp,
      clock_out: null,
      status: 'working',
      worked_minutes: 0,
      active_minutes: 0,
      suspended_seconds: 0,
      active_seconds_buffer: 0,
      screenshot_seconds_buffer: 0,
      last_heartbeat: timestamp,
      breaks: []
    }
    bucket.currentSession = session
    bucket.todaySessions.push(session)
    return session
  }

  public handleDayRollover(previousDay: string, newDay: string, timeZone: string = 'Asia/Kolkata') {
    if (!this.currentUser) return null
    const bucket = this.getBucket(this.currentUser.id)

    // Prevent duplicate resets for the same day transition
    if (bucket.lastRolloverDate === newDay) {
      return { skippedDuplicate: true }
    }

    const activeSession = bucket.currentSession
    const wasActive = Boolean(
      activeSession &&
      !activeSession.clock_out &&
      activeSession.status !== 'completed' &&
      activeSession.status !== 'Completed'
    )
    const prevStatus = wasActive ? activeSession!.status : 'completed'

    const { dayEndMs } = getDayBounds(previousDay, timeZone)
    const closeIso = new Date(dayEndMs).toISOString()
    const midnightStartIso = new Date(dayEndMs).toISOString()

    let closedPreviousSessionId: string | null = null

    // 1. If an active session was ongoing across midnight, finalize yesterday's portion cleanly at midnight boundary
    if (wasActive && activeSession) {
      closedPreviousSessionId = activeSession.id

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

      const idx = bucket.todaySessions.findIndex(s => s.id === activeSession.id)
      if (idx !== -1) {
        bucket.todaySessions[idx] = activeSession
      } else {
        bucket.todaySessions.push(activeSession)
      }

      bucket.pendingSyncQueue.push({
        id: `session-${activeSession.id}`,
        type: 'session',
        employee_id: this.currentUser.id,
        data: activeSession,
        createdAt: closeIso,
        retries: 0
      })
    }

    // 2. Calculate immutable previous-day totals
    const prevDayWorkedSeconds = calculateDailyWorkedSeconds(null, bucket.todaySessions, previousDay, dayEndMs, timeZone)
    const prevDayActiveSeconds = calculateDailyActiveSeconds(null, bucket.todaySessions, previousDay, dayEndMs, timeZone)
    const prevDayWorkedMinutes = Math.floor(prevDayWorkedSeconds / 60)
    const prevDayActiveMinutes = Math.floor(prevDayActiveSeconds / 60)

    // 3. Generate immutable Audit Log capturing previous-day totals
    const auditRecord: TimeResetAuditRecord = {
      id: `audit-rollover-${Date.now()}`,
      session_id: closedPreviousSessionId || (bucket.todaySessions.find(s => s.session_date === previousDay)?.id || 'sess-none'),
      employee_id: this.currentUser.id,
      employee_email: this.currentUser.email,
      employee_name: [this.currentUser.first_name, this.currentUser.last_name].filter(Boolean).join(' ') || 'Employee',
      reset_type: 'automatic_daily_reset',
      previous_clock_in: (activeSession && wasActive) ? activeSession.clock_in : `${previousDay}T00:00:00.000Z`,
      previous_worked_minutes: prevDayWorkedMinutes,
      previous_worked_seconds: prevDayWorkedSeconds,
      previous_active_minutes: prevDayActiveMinutes,
      previous_active_seconds: prevDayActiveSeconds,
      previous_status: prevStatus as any,
      reason: `Automatic midnight reset at 12:00 AM (${timeZone})`,
      notes: wasActive
        ? `Session seamlessly continued across midnight. Prior day (${previousDay}) finalized: ${formatSecondsToHHMMSS(prevDayWorkedSeconds)} worked, ${formatSecondsToHHMMSS(prevDayActiveSeconds)} active.`
        : `Daily reset completed at midnight. Prior day (${previousDay}) totals archived: ${formatSecondsToHHMMSS(prevDayWorkedSeconds)} worked, ${formatSecondsToHHMMSS(prevDayActiveSeconds)} active.`,
      reset_by: this.currentUser.id,
      reset_by_role: 'System',
      created_at: midnightStartIso
    }

    bucket.resetAuditLogs.unshift(auditRecord)
    bucket.pendingSyncQueue.push({
      id: `reset-audit-${auditRecord.id}`,
      type: 'reset_audit' as any,
      employee_id: this.currentUser.id,
      data: auditRecord,
      createdAt: midnightStartIso,
      retries: 0
    })

    // 4. Maintain ongoing session across midnight without losing or double-counting time
    let newContinuationSession: TrackingSession | null = null
    if (wasActive) {
      const isBreak = prevStatus === 'on_break'
      newContinuationSession = {
        id: `sess-cont-${Date.now()}`,
        employee_id: this.currentUser.id,
        session_date: newDay,
        clock_in: midnightStartIso,
        clock_out: null,
        status: isBreak ? 'on_break' : 'working',
        worked_minutes: 0,
        active_minutes: 0,
        suspended_seconds: 0,
        active_seconds_buffer: 0,
        screenshot_seconds_buffer: 0,
        last_heartbeat: midnightStartIso,
        breaks: isBreak ? [{
          id: `break-cont-${Date.now()}`,
          session_id: '',
          start_time: midnightStartIso,
          end_time: null,
          duration_minutes: 0,
          reason: 'Break continued across midnight'
        }] : []
      }
      if (newContinuationSession.breaks.length > 0) {
        newContinuationSession.breaks[0].session_id = newContinuationSession.id
      }
      bucket.currentSession = newContinuationSession
      bucket.todaySessions.push(newContinuationSession)

      bucket.pendingSyncQueue.push({
        id: `session-${newContinuationSession.id}`,
        type: 'session',
        employee_id: this.currentUser.id,
        data: newContinuationSession,
        createdAt: midnightStartIso,
        retries: 0
      })
    } else {
      bucket.currentSession = null
    }

    bucket.lastRolloverDate = newDay

    return {
      success: true,
      auditRecord,
      newSession: newContinuationSession,
      previousDayTotals: {
        workedSeconds: prevDayWorkedSeconds,
        activeSeconds: prevDayActiveSeconds
      }
    }
  }

  public resetTime(params: ResetTimeParams, nowIso: string = new Date().toISOString()): {
    success: boolean
    session?: TrackingSession | null
    auditRecord?: TimeResetAuditRecord
    error?: string
  } {
    if (!this.currentUser) {
      return { success: false, error: 'Authentication required: Please sign in to reset time' }
    }

    if (this.isResetInProgress) {
      return { success: false, error: 'Reset operation is already in progress' }
    }

    this.isResetInProgress = true

    try {
      // 1. Accidental Reset Protection: Explicit keyword verification
      if (!params.confirmationText || params.confirmationText.trim() !== 'RESET') {
        return {
          success: false,
          error: 'Confirmation failed: You must type RESET in uppercase to confirm resetting time.'
        }
      }

      // 2. Audit Logging requirement: Reason is mandatory
      if (!params.reason || !params.reason.trim()) {
        return {
          success: false,
          error: 'A reason is mandatory for audit logging before resetting time.'
        }
      }

      const validResetTypes = ['restart_session', 'discard_session']
      const resetType = params.resetType || 'restart_session'
      if (!validResetTypes.includes(resetType)) {
        return { success: false, error: 'Invalid reset type specified.' }
      }

      const bucket = this.getBucket(this.currentUser.id)
      const currentSession = bucket.currentSession

      // 3. Active Session Check
      if (!currentSession || !currentSession.id || currentSession.employee_id !== this.currentUser.id) {
        return { success: false, error: 'No active session found to reset. Historical completed sessions cannot be reset.' }
      }

      if (currentSession.clock_out || currentSession.status === 'completed' || currentSession.status === 'Completed') {
        return { success: false, error: 'Cannot reset an already completed session.' }
      }

      // 4. Capture accurate pre-reset metrics for audit log
      const nowMs = new Date(nowIso).getTime()
      const previousWorkedSeconds = Math.max(
        (currentSession.worked_minutes || 0) * 60,
        calculateSessionWorkedSeconds(currentSession, nowMs)
      )
      const previousActiveSeconds = (currentSession.active_minutes * 60) + (currentSession.active_seconds_buffer || 0)

      const auditRecord: TimeResetAuditRecord = {
        id: `audit-${Date.now()}`,
        session_id: currentSession.id,
        employee_id: this.currentUser.id,
        employee_email: this.currentUser.email,
        employee_name: [this.currentUser.first_name, this.currentUser.last_name].filter(Boolean).join(' '),
        reset_type: resetType,
        previous_clock_in: currentSession.clock_in,
        previous_worked_minutes: currentSession.worked_minutes,
        previous_worked_seconds: previousWorkedSeconds,
        previous_active_minutes: currentSession.active_minutes,
        previous_active_seconds: previousActiveSeconds,
        previous_status: currentSession.status,
        reason: params.reason.trim(),
        notes: params.notes ? params.notes.trim().slice(0, 500) : undefined,
        reset_by: this.currentUser.id,
        reset_by_role: this.currentUser.role || 'Employee',
        created_at: nowIso
      }

      // Store audit record in employee bucket
      bucket.resetAuditLogs.unshift(auditRecord)

      // Enqueue to offline/database pending queue
      bucket.pendingSyncQueue.push({
        id: `reset-audit-${auditRecord.id}`,
        type: 'reset_audit' as any,
        employee_id: this.currentUser.id,
        data: auditRecord,
        createdAt: nowIso,
        retries: 0
      })

      // 5. Execute session reset
      if (resetType === 'restart_session') {
        currentSession.clock_in = nowIso
        currentSession.clock_out = null
        currentSession.status = 'working'
        currentSession.worked_minutes = 0
        currentSession.active_minutes = 0
        currentSession.suspended_seconds = 0
        currentSession.active_seconds_buffer = 0
        currentSession.screenshot_seconds_buffer = 0
        currentSession.last_heartbeat = nowIso
        currentSession.breaks = []

        bucket.currentSession = currentSession
        const idx = bucket.todaySessions.findIndex(s => s.id === currentSession.id)
        if (idx !== -1) {
          bucket.todaySessions[idx] = currentSession
        }

        bucket.pendingSyncQueue.push({
          id: `session-${currentSession.id}`,
          type: 'session',
          employee_id: this.currentUser.id,
          data: currentSession,
          createdAt: nowIso,
          retries: 0
        })

        return {
          success: true,
          session: currentSession,
          auditRecord
        }
      } else {
        // Discard session: set clock_out = clock_in and remove from todaySessions
        currentSession.clock_out = currentSession.clock_in
        currentSession.status = 'completed'
        currentSession.worked_minutes = 0
        currentSession.active_minutes = 0
        currentSession.suspended_seconds = 0
        currentSession.active_seconds_buffer = 0
        currentSession.screenshot_seconds_buffer = 0
        currentSession.last_heartbeat = currentSession.clock_in
        currentSession.breaks = []

        bucket.currentSession = null
        bucket.todaySessions = bucket.todaySessions.filter(s => s.id !== currentSession.id)

        bucket.pendingSyncQueue.push({
          id: `session-discard-${currentSession.id}`,
          type: 'session',
          employee_id: this.currentUser.id,
          data: currentSession,
          createdAt: nowIso,
          retries: 0
        })

        return {
          success: true,
          session: null,
          auditRecord
        }
      }
    } finally {
      this.isResetInProgress = false
    }
  }
}

describe('Reset Time Feature - Security, Confirmation, Accurate Reset, Audit, and History Protection', () => {
  let engine: TestTrackerEngineWithReset
  const employeeAlice: UserProfile = {
    id: 'emp-alice-uuid',
    email: 'alice@triplesproduction.com',
    first_name: 'Alice',
    last_name: 'Roy',
    employee_id: 'EMP-001',
    department: 'Post Production',
    designation: 'Lead Colorist',
    role: 'Employee'
  }

  const employeeBob: UserProfile = {
    id: 'emp-bob-uuid',
    email: 'bob@triplesproduction.com',
    first_name: 'Bob',
    last_name: 'Sen',
    employee_id: 'EMP-002',
    department: 'Sound',
    designation: 'Sound Designer',
    role: 'Employee'
  }

  beforeEach(() => {
    engine = new TestTrackerEngineWithReset()
  })

  describe('Accidental Reset Protection', () => {
    it('rejects reset if confirmation text does not match "RESET"', () => {
      engine.login(employeeAlice)
      engine.clockIn('2026-11-16T10:00:00.000+05:30')

      const resLower = engine.resetTime({
        resetType: 'restart_session',
        reason: 'Accidental clock-in',
        confirmationText: 'reset' // lowercase
      })
      expect(resLower.success).toBe(false)
      expect(resLower.error).toContain('You must type RESET in uppercase')

      const resEmpty = engine.resetTime({
        resetType: 'restart_session',
        reason: 'Accidental clock-in',
        confirmationText: ''
      })
      expect(resEmpty.success).toBe(false)
      expect(resEmpty.error).toContain('You must type RESET in uppercase')

      const resWrong = engine.resetTime({
        resetType: 'restart_session',
        reason: 'Accidental clock-in',
        confirmationText: 'CONFIRM'
      })
      expect(resWrong.success).toBe(false)
      expect(resWrong.error).toContain('You must type RESET in uppercase')
    })

    it('rejects reset if reason is missing or empty', () => {
      engine.login(employeeAlice)
      engine.clockIn('2026-11-16T10:00:00.000+05:30')

      const res = engine.resetTime({
        resetType: 'restart_session',
        reason: '   ',
        confirmationText: 'RESET'
      })
      expect(res.success).toBe(false)
      expect(res.error).toContain('reason is mandatory')
    })

    it('rejects reset if user is not authenticated', () => {
      // Not logged in
      const res = engine.resetTime({
        resetType: 'restart_session',
        reason: 'Accidental clock-in',
        confirmationText: 'RESET'
      })
      expect(res.success).toBe(false)
      expect(res.error).toContain('Authentication required')
    })

    it('rejects reset if no active session exists (Not Clocked In)', () => {
      engine.login(employeeAlice)
      // Alice is not clocked in
      const res = engine.resetTime({
        resetType: 'restart_session',
        reason: 'Accidental clock-in',
        confirmationText: 'RESET'
      })
      expect(res.success).toBe(false)
      expect(res.error).toContain('No active session found to reset')
    })

    it('rejects reset if current session is already completed / clocked out', () => {
      engine.login(employeeAlice)
      const session = engine.clockIn('2026-11-16T10:00:00.000+05:30')
      session.clock_out = '2026-11-16T12:00:00.000+05:30'
      session.status = 'completed'

      const res = engine.resetTime({
        resetType: 'restart_session',
        reason: 'Accidental clock-in',
        confirmationText: 'RESET'
      })
      expect(res.success).toBe(false)
      expect(res.error).toContain('Cannot reset an already completed session')
    })
  })

  describe('Accurate Session Reset - Restart Session Mode', () => {
    it('accurately restarts session: resets clock_in to now, zeros counters, and clears breaks', () => {
      engine.login(employeeAlice)
      // Alice clocked in at 09:00:00 IST
      const session = engine.clockIn('2026-11-16T09:00:00.000+05:30')
      session.worked_minutes = 60
      session.active_minutes = 50
      session.suspended_seconds = 120
      session.active_seconds_buffer = 30
      session.breaks = [
        {
          id: 'b-1',
          session_id: session.id,
          start_time: '2026-11-16T09:30:00.000+05:30',
          end_time: '2026-11-16T09:40:00.000+05:30',
          duration_minutes: 10
        }
      ]

      // At 10:15:00 IST (75 mins after clock-in), Alice performs Restart Session
      const resetTimeIso = '2026-11-16T10:15:00.000+05:30'
      const res = engine.resetTime({
        resetType: 'restart_session',
        reason: 'Testing / calibration',
        notes: 'Restarting timer fresh from 10:15',
        confirmationText: 'RESET'
      }, resetTimeIso)

      expect(res.success).toBe(true)
      expect(res.session).toBeDefined()
      const updated = res.session!

      // Clock in must be reset to the exact moment of reset
      expect(updated.clock_in).toBe(resetTimeIso)
      expect(updated.clock_out).toBeNull()
      expect(updated.status).toBe('working')
      expect(updated.worked_minutes).toBe(0)
      expect(updated.active_minutes).toBe(0)
      expect(updated.suspended_seconds).toBe(0)
      expect(updated.active_seconds_buffer).toBe(0)
      expect(updated.breaks).toHaveLength(0)

      // At 10:15:00 (moment of reset), worked seconds must be 0
      const currentMs = new Date(resetTimeIso).getTime()
      const workedSec = calculateSessionWorkedSeconds(updated, currentMs)
      expect(workedSec).toBe(0)
      expect(formatSecondsToHHMMSS(workedSec)).toBe('00:00:00')

      // 5 minutes later (10:20:00), worked time is exactly 5 minutes (300s), NOT 80 minutes
      const fiveMinsLaterMs = currentMs + 5 * 60 * 1000
      const fiveMinsWorkedSec = calculateSessionWorkedSeconds(updated, fiveMinsLaterMs)
      expect(fiveMinsWorkedSec).toBe(300)
      expect(formatSecondsToHHMMSS(fiveMinsWorkedSec)).toBe('00:05:00')
    })
  })

  describe('Accurate Session Reset - Discard Session Mode', () => {
    it('accurately discards active session: sets currentSession to null and zeroes duration', () => {
      engine.login(employeeAlice)
      const session = engine.clockIn('2026-11-16T09:00:00.000+05:30')
      session.worked_minutes = 45

      const resetTimeIso = '2026-11-16T09:45:00.000+05:30'
      const res = engine.resetTime({
        resetType: 'discard_session',
        reason: 'Accidental clock-in by mistake',
        confirmationText: 'RESET'
      }, resetTimeIso)

      expect(res.success).toBe(true)
      expect(res.session).toBeNull()

      const bucket = engine.getBucket(employeeAlice.id)
      expect(bucket.currentSession).toBeNull()

      // The discarded session must contribute 0 seconds to daily worked time
      const nowMs = new Date('2026-11-16T10:00:00.000+05:30').getTime()
      const dailyWorked = calculateDailyWorkedSeconds(null, bucket.todaySessions, '2026-11-16', nowMs)
      expect(dailyWorked).toBe(0)
    })
  })

  describe('Protection of Historical Records', () => {
    it('preserves earlier completed sessions from the same day without any modification or loss', () => {
      engine.login(employeeAlice)
      const bucket = engine.getBucket(employeeAlice.id)

      // Session 1: Alice worked from 09:00 to 11:00 (2 hours = 120 min) and clocked out
      const session1: TrackingSession = {
        id: 'sess-completed-1',
        employee_id: employeeAlice.id,
        session_date: '2026-11-16',
        clock_in: '2026-11-16T09:00:00.000+05:30',
        clock_out: '2026-11-16T11:00:00.000+05:30',
        status: 'completed',
        worked_minutes: 120,
        active_minutes: 110,
        suspended_seconds: 0,
        active_seconds_buffer: 0,
        breaks: []
      }
      bucket.todaySessions.push(session1)

      // Session 2: Alice clocked in at 13:00, worked until 13:30 (30 min)
      const session2 = engine.clockIn('2026-11-16T13:00:00.000+05:30')
      session2.worked_minutes = 30
      session2.active_minutes = 25
      session2.last_heartbeat = '2026-11-16T13:30:00.000+05:30'

      // Before reset: Alice has 2 hours (Session 1) + 30 min (Session 2) = 150 min (9000s)
      const checkMs = new Date('2026-11-16T13:30:00.000+05:30').getTime()
      const beforeResetDailySec = calculateDailyWorkedSeconds(session2, bucket.todaySessions, '2026-11-16', checkMs)
      expect(beforeResetDailySec).toBe(150 * 60)

      // Alice resets Session 2 (Restart Session at 13:30)
      const resetRes = engine.resetTime({
        resetType: 'restart_session',
        reason: 'Incorrect time tracking',
        confirmationText: 'RESET'
      }, '2026-11-16T13:30:00.000+05:30')

      expect(resetRes.success).toBe(true)

      // VERIFICATION:
      // 1. Session 1 is 100% untouched!
      const storedSess1 = bucket.todaySessions.find(s => s.id === 'sess-completed-1')!
      expect(storedSess1.clock_in).toBe('2026-11-16T09:00:00.000+05:30')
      expect(storedSess1.clock_out).toBe('2026-11-16T11:00:00.000+05:30')
      expect(storedSess1.worked_minutes).toBe(120)
      expect(storedSess1.active_minutes).toBe(110)

      // 2. Daily worked time at 13:30 is exactly 120 minutes (7200s from Session 1), NOT 0 and NOT 150
      const afterResetDailySec = calculateDailyWorkedSeconds(resetRes.session!, bucket.todaySessions, '2026-11-16', checkMs)
      expect(afterResetDailySec).toBe(120 * 60)
      expect(formatSecondsToHHMMSS(afterResetDailySec)).toBe('02:00:00')
    })

    it('preserves prior days historical records untouched when discarding a session', () => {
      engine.login(employeeAlice)
      const bucket = engine.getBucket(employeeAlice.id)

      // Yesterday's session (2026-11-15): 8 hours worked
      const yesterdaySession: TrackingSession = {
        id: 'sess-yesterday',
        employee_id: employeeAlice.id,
        session_date: '2026-11-15',
        clock_in: '2026-11-15T09:00:00.000+05:30',
        clock_out: '2026-11-15T17:00:00.000+05:30',
        status: 'completed',
        worked_minutes: 480,
        active_minutes: 450,
        suspended_seconds: 0,
        active_seconds_buffer: 0,
        breaks: []
      }
      bucket.todaySessions.push(yesterdaySession)

      // Today (2026-11-16): Clocked in at 09:00 by mistake
      const todaySession = engine.clockIn('2026-11-16T09:00:00.000+05:30')

      // Discard today's active session
      const res = engine.resetTime({
        resetType: 'discard_session',
        reason: 'Accidental clock in on day off',
        confirmationText: 'RESET'
      }, '2026-11-16T09:10:00.000+05:30')

      expect(res.success).toBe(true)

      // Yesterday's session remains completely intact
      const storedYesterday = bucket.todaySessions.find(s => s.id === 'sess-yesterday')!
      expect(storedYesterday.worked_minutes).toBe(480)
      expect(storedYesterday.active_minutes).toBe(450)
      expect(storedYesterday.status).toBe('completed')
    })
  })

  describe('Audit Logging & Database Synchronization', () => {
    it('creates a detailed audit log recording pre-reset metrics, reason, employee info, and timestamp', () => {
      engine.login(employeeAlice)
      const session = engine.clockIn('2026-11-16T09:00:00.000+05:30')
      session.worked_minutes = 50
      session.active_minutes = 45

      const resetTimeIso = '2026-11-16T09:50:00.000+05:30'
      session.last_heartbeat = resetTimeIso
      const res = engine.resetTime({
        resetType: 'restart_session',
        reason: 'Left timer running while away from computer',
        notes: 'Away from desk from 09:15 to 09:50',
        confirmationText: 'RESET'
      }, resetTimeIso)

      expect(res.success).toBe(true)
      const audit = res.auditRecord!
      expect(audit).toBeDefined()
      expect(audit.session_id).toBe(session.id)
      expect(audit.employee_id).toBe(employeeAlice.id)
      expect(audit.employee_email).toBe('alice@triplesproduction.com')
      expect(audit.employee_name).toBe('Alice Roy')
      expect(audit.reset_type).toBe('restart_session')
      expect(audit.previous_clock_in).toBe('2026-11-16T09:00:00.000+05:30')
      expect(audit.previous_worked_minutes).toBe(50)
      expect(audit.previous_worked_seconds).toBe(50 * 60)
      expect(audit.previous_active_minutes).toBe(45)
      expect(audit.reason).toBe('Left timer running while away from computer')
      expect(audit.notes).toBe('Away from desk from 09:15 to 09:50')
      expect(audit.reset_by).toBe(employeeAlice.id)
      expect(audit.reset_by_role).toBe('Employee')
      expect(audit.created_at).toBe(resetTimeIso)

      // Audit record stored in employee bucket
      const bucket = engine.getBucket(employeeAlice.id)
      expect(bucket.resetAuditLogs).toHaveLength(1)
      expect(bucket.resetAuditLogs[0].id).toBe(audit.id)

      // Database sync queue contains the audit log
      const pendingAudit = bucket.pendingSyncQueue.find(p => p.id === `reset-audit-${audit.id}`)
      expect(pendingAudit).toBeDefined()
      expect(pendingAudit?.type).toBe('reset_audit')
    })

    it('enqueues reset session to database synchronization queue', () => {
      engine.login(employeeAlice)
      const session = engine.clockIn('2026-11-16T09:00:00.000+05:30')

      engine.resetTime({
        resetType: 'restart_session',
        reason: 'System clock discrepancy',
        confirmationText: 'RESET'
      }, '2026-11-16T09:30:00.000+05:30')

      const bucket = engine.getBucket(employeeAlice.id)
      const sessionSyncItem = bucket.pendingSyncQueue.find(p => p.id === `session-${session.id}`)
      expect(sessionSyncItem).toBeDefined()
      expect(sessionSyncItem?.data.worked_minutes).toBe(0)
      expect(sessionSyncItem?.data.clock_in).toBe('2026-11-16T09:30:00.000+05:30')
    })
  })

  describe('Cross-Employee Isolation', () => {
    it('ensures resetting Alice session does not affect Bob session, queue, or audit logs', () => {
      // 1. Bob clocks in and works
      engine.login(employeeBob)
      const bobSession = engine.clockIn('2026-11-16T08:00:00.000+05:30')
      bobSession.worked_minutes = 120

      // 2. Alice logs in, clocks in, and resets her session
      engine.login(employeeAlice)
      const aliceSession = engine.clockIn('2026-11-16T10:00:00.000+05:30')
      aliceSession.worked_minutes = 20

      const aliceResetRes = engine.resetTime({
        resetType: 'restart_session',
        reason: 'Testing calibration',
        confirmationText: 'RESET'
      }, '2026-11-16T10:20:00.000+05:30')

      expect(aliceResetRes.success).toBe(true)

      // 3. Inspect Bob bucket
      const bobBucket = engine.getBucket(employeeBob.id)
      expect(bobBucket.currentSession?.id).toBe(bobSession.id)
      expect(bobBucket.currentSession?.worked_minutes).toBe(120)
      expect(bobBucket.currentSession?.clock_in).toBe('2026-11-16T08:00:00.000+05:30')
      expect(bobBucket.resetAuditLogs).toHaveLength(0) // Bob has no reset logs
    })
  })

  describe('Automatic Daily Time Reset at 12:00 AM Midnight', () => {
    it('automatically resets daily Worked Hours and Active Hours to 00:00:00 at 12:00 AM midnight', () => {
      engine.login(employeeAlice)
      const bucket = engine.getBucket(employeeAlice.id)

      // Alice clocks in at 22:00 (10:00 PM) on 2026-11-16 in Asia/Kolkata
      const session = engine.clockIn('2026-11-16T22:00:00.000+05:30')
      session.worked_minutes = 120 // 2 hours worked before midnight
      session.active_minutes = 110

      // Midnight rollover arrives (2026-11-16 -> 2026-11-17)
      const rolloverRes = engine.handleDayRollover('2026-11-16', '2026-11-17', 'Asia/Kolkata')
      expect(rolloverRes?.success).toBe(true)

      // Daily Worked & Active seconds for the new day (2026-11-17) at 00:00:00
      const midnightMs = new Date('2026-11-17T00:00:00.000+05:30').getTime()
      const newDayWorkedSec = calculateDailyWorkedSeconds(
        bucket.currentSession,
        bucket.todaySessions,
        '2026-11-17',
        midnightMs,
        'Asia/Kolkata'
      )
      const newDayActiveSec = calculateDailyActiveSeconds(
        bucket.currentSession,
        bucket.todaySessions,
        '2026-11-17',
        midnightMs,
        'Asia/Kolkata'
      )

      expect(newDayWorkedSec).toBe(0)
      expect(newDayActiveSec).toBe(0)
      expect(formatSecondsToHHMMSS(newDayWorkedSec)).toBe('00:00:00')
      expect(formatSecondsToHHMMSS(newDayActiveSec)).toBe('00:00:00')

      // Previous day's worked seconds are cleanly finalized at 7200 seconds (2 hours)
      const prevDayWorkedSec = calculateDailyWorkedSeconds(
        null,
        bucket.todaySessions,
        '2026-11-16',
        midnightMs,
        'Asia/Kolkata'
      )
      expect(prevDayWorkedSec).toBe(120 * 60)
      expect(formatSecondsToHHMMSS(prevDayWorkedSec)).toBe('02:00:00')
    })

    it('captures and preserves previous-day totals in immutable audit log', () => {
      engine.login(employeeAlice)
      const bucket = engine.getBucket(employeeAlice.id)

      const session = engine.clockIn('2026-11-16T20:00:00.000+05:30')
      session.worked_minutes = 240 // 4 hours
      session.active_minutes = 220

      const rolloverRes = engine.handleDayRollover('2026-11-16', '2026-11-17', 'Asia/Kolkata')
      expect(rolloverRes?.success).toBe(true)

      const audit = rolloverRes!.auditRecord!
      expect(audit).toBeDefined()
      expect(audit.reset_type).toBe('automatic_daily_reset')
      expect(audit.employee_id).toBe(employeeAlice.id)
      expect(audit.employee_email).toBe('alice@triplesproduction.com')
      expect(audit.previous_worked_seconds).toBe(240 * 60)
      expect(audit.previous_worked_minutes).toBe(240)
      expect(audit.reset_by_role).toBe('System')
      expect(audit.reason).toContain('Automatic midnight reset at 12:00 AM (Asia/Kolkata)')
      expect(audit.notes).toContain('Session seamlessly continued across midnight')

      // Verify audit log is permanently stored in bucket
      expect(bucket.resetAuditLogs).toHaveLength(1)
      expect(bucket.resetAuditLogs[0].id).toBe(audit.id)

      // Verify audit log is in the database sync queue
      const queuedAudit = bucket.pendingSyncQueue.find(p => p.id === `reset-audit-${audit.id}`)
      expect(queuedAudit).toBeDefined()
      expect(queuedAudit?.type).toBe('reset_audit')
    })

    it('maintains ongoing sessions across midnight without losing or double-counting time', () => {
      engine.login(employeeAlice)
      const bucket = engine.getBucket(employeeAlice.id)

      // Alice clocked in at 22:30 (10:30 PM) on 2026-11-16
      const startMs = new Date('2026-11-16T22:30:00.000+05:30').getTime()
      const originalSession = engine.clockIn('2026-11-16T22:30:00.000+05:30')
      originalSession.worked_minutes = 90 // 1.5 hours

      // Trigger midnight rollover
      const rolloverRes = engine.handleDayRollover('2026-11-16', '2026-11-17', 'Asia/Kolkata')
      expect(rolloverRes?.success).toBe(true)

      const continuationSession = bucket.currentSession
      expect(continuationSession).not.toBeNull()
      expect(continuationSession?.id).not.toBe(originalSession.id)
      expect(continuationSession?.session_date).toBe('2026-11-17')
      expect(continuationSession?.status).toBe('working')
      expect(continuationSession?.worked_minutes).toBe(0)

      // Check boundary timestamps:
      // Original session closes at midnight boundary (dayEndMs)
      const origCloseMs = new Date(originalSession.clock_out!).getTime()
      // Continuation session opens at midnight boundary (dayEndMs)
      const contStartMs = new Date(continuationSession!.clock_in).getTime()
      expect(contStartMs - origCloseMs).toBe(0) // Exact continuous boundary split, 0 lost time and 0 double-counting

      // Alice works until 01:30 AM on 2026-11-17 (1.5 hours after midnight)
      const checkMs = new Date('2026-11-17T01:30:00.000+05:30').getTime()
      continuationSession!.last_heartbeat = new Date(checkMs).toISOString()

      const day1Worked = calculateDailyWorkedSeconds(null, bucket.todaySessions, '2026-11-16', checkMs, 'Asia/Kolkata')
      const day2Worked = calculateDailyWorkedSeconds(continuationSession, bucket.todaySessions, '2026-11-17', checkMs, 'Asia/Kolkata')

      // Day 1: 22:30 to 24:00 = 90 mins = 5400s
      expect(day1Worked).toBe(90 * 60)

      // Day 2: 00:00 to 01:30 = 90 mins = 5400s
      expect(day2Worked).toBe(90 * 60)

      // Total continuous elapsed work: 22:30 to 01:30 = 3 hours = 10800s
      const totalElapsedSeconds = (checkMs - startMs) / 1000
      expect(day1Worked + day2Worked).toBe(totalElapsedSeconds)
    })

    it('preserves break status across midnight seamlessly', () => {
      engine.login(employeeAlice)
      const bucket = engine.getBucket(employeeAlice.id)

      // Alice is on break across midnight
      const session = engine.clockIn('2026-11-16T21:00:00.000+05:30')
      session.status = 'on_break'
      session.breaks = [{
        id: 'break-1',
        session_id: session.id,
        start_time: '2026-11-16T23:45:00.000+05:30',
        end_time: null,
        duration_minutes: 0,
        reason: 'Rest'
      }]

      const rolloverRes = engine.handleDayRollover('2026-11-16', '2026-11-17', 'Asia/Kolkata')
      expect(rolloverRes?.success).toBe(true)

      // Prior session's break finalized at midnight boundary
      const priorBreak = session.breaks[0]
      expect(priorBreak.end_time).not.toBeNull()
      expect(priorBreak.duration_minutes).toBe(15) // 23:45 to 24:00

      // Continuation session maintains break status
      const contSession = bucket.currentSession
      expect(contSession?.status).toBe('on_break')
      expect(contSession?.breaks).toHaveLength(1)
      expect(contSession?.breaks[0].start_time).toContain('2026-11-16T18:30:00.000Z') // 00:00:00 IST
      expect(contSession?.breaks[0].end_time).toBeNull()
    })

    it('prevents duplicate resets for the same calendar date transition', () => {
      engine.login(employeeAlice)
      const bucket = engine.getBucket(employeeAlice.id)

      engine.clockIn('2026-11-16T23:00:00.000+05:30')

      // First rollover run
      const res1 = engine.handleDayRollover('2026-11-16', '2026-11-17', 'Asia/Kolkata')
      expect(res1?.success).toBe(true)
      expect(bucket.resetAuditLogs).toHaveLength(1)
      expect(bucket.todaySessions).toHaveLength(2)

      // Repeated rollover invocation (e.g. repeated tick or app restart)
      const res2 = engine.handleDayRollover('2026-11-16', '2026-11-17', 'Asia/Kolkata')
      expect(res2?.skippedDuplicate).toBe(true)
      expect(bucket.resetAuditLogs).toHaveLength(1) // Still exactly 1 audit log
      expect(bucket.todaySessions).toHaveLength(2) // Still exactly 2 sessions
    })

    it('preserves historical sessions completely unaltered', () => {
      engine.login(employeeAlice)
      const bucket = engine.getBucket(employeeAlice.id)

      // Past session from 2026-11-15
      const pastSession: TrackingSession = {
        id: 'sess-past-nov15',
        employee_id: employeeAlice.id,
        session_date: '2026-11-15',
        clock_in: '2026-11-15T09:00:00.000+05:30',
        clock_out: '2026-11-15T17:00:00.000+05:30',
        status: 'completed',
        worked_minutes: 480,
        active_minutes: 450,
        suspended_seconds: 0,
        active_seconds_buffer: 0,
        screenshot_seconds_buffer: 0,
        breaks: []
      }
      bucket.todaySessions.push(pastSession)

      // Today's session (2026-11-16)
      engine.clockIn('2026-11-16T22:00:00.000+05:30')

      // Rollover to 2026-11-17
      engine.handleDayRollover('2026-11-16', '2026-11-17', 'Asia/Kolkata')

      // Past session remains completely unchanged
      const pastFromStore = bucket.todaySessions.find(s => s.id === 'sess-past-nov15')!
      expect(pastFromStore.worked_minutes).toBe(480)
      expect(pastFromStore.active_minutes).toBe(450)
      expect(pastFromStore.clock_in).toBe('2026-11-15T09:00:00.000+05:30')
      expect(pastFromStore.clock_out).toBe('2026-11-15T17:00:00.000+05:30')
      expect(pastFromStore.status).toBe('completed')
    })

    it('requires no employee confirmation or manual action', () => {
      engine.login(employeeAlice)
      engine.clockIn('2026-11-16T23:30:00.000+05:30')

      // Autonomous trigger without any parameters or user confirmation
      const res = engine.handleDayRollover('2026-11-16', '2026-11-17', 'Asia/Kolkata')
      expect(res?.success).toBe(true)
      expect(res?.auditRecord?.reset_by_role).toBe('System')
    })
  })
})
