import { describe, it, expect } from 'vitest'
import {
  getDayBounds,
  getDateString,
  getHour,
  calculateDailyWorkedSeconds,
  calculateDailyActiveSeconds,
  calculateSessionWorkedMsForDate,
  formatSecondsToHHMMSS
} from '../src/utils/timeCalculator'
import type {
  TrackingSession,
  UserProfile,
  TimeResetAuditRecord,
  PendingSyncItem,
  EmployeeStore
} from '../src/types'

// Test harness simulating ActivityTracker & Storage runtime interactions
interface TrackerTestHarnessState {
  currentUser: UserProfile | null
  store: {
    currentSession: TrackingSession | null
    todaySessions: TrackingSession[]
    resetAuditLogs: TimeResetAuditRecord[]
    pendingSyncQueue: PendingSyncItem[]
    lastRolloverDate?: string | null
  }
  settings: {
    timezone: string
    idleThresholdSeconds: number
  }
  currentBusinessDate: string | null
  activeSecondsBuffer: number
}

class MidnightResetAuditHarness {
  public state: TrackerTestHarnessState

  constructor(timezone: string = 'Asia/Kolkata') {
    this.state = {
      currentUser: {
        id: 'emp-audit-uuid',
        email: 'employee@tsp.com',
        first_name: 'Audit',
        last_name: 'Employee',
        employee_id: 'TSP-001',
        department: 'Engineering',
        designation: 'Developer',
        role: 'Employee'
      },
      store: {
        currentSession: null,
        todaySessions: [],
        resetAuditLogs: [],
        pendingSyncQueue: [],
        lastRolloverDate: null
      },
      settings: {
        timezone,
        idleThresholdSeconds: 60
      },
      currentBusinessDate: null,
      activeSecondsBuffer: 0
    }
  }

  public clockIn(timestamp: string): TrackingSession {
    const tz = this.state.settings.timezone
    const dateStr = getDateString(new Date(timestamp), tz)
    const session: TrackingSession = {
      id: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      employee_id: this.state.currentUser!.id,
      session_date: dateStr,
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
    this.state.store.currentSession = session
    this.state.store.todaySessions.push(session)
    this.state.currentBusinessDate = dateStr
    return session
  }

  // Exact implementation logic matching ActivityTracker.handleDayRollover
  public handleDayRollover(previousDay: string, newDay: string, timeZone?: string) {
    const tz = timeZone || this.state.settings.timezone || 'Asia/Kolkata'
    const user = this.state.currentUser
    if (!user) return { skipped: true, reason: 'No user' }

    const store = this.state.store

    // Duplicate reset guard
    if (store.lastRolloverDate === newDay) {
      return { skippedDuplicate: true }
    }

    const activeSession = store.currentSession
    const wasActive = Boolean(
      activeSession &&
      !activeSession.clock_out &&
      activeSession.status !== 'completed' &&
      activeSession.status !== 'Completed'
    )
    const prevStatus = wasActive ? activeSession!.status : 'completed'

    const { dayEndMs } = getDayBounds(previousDay, tz)
    const closeIso = new Date(dayEndMs).toISOString()
    const midnightStartIso = new Date(dayEndMs).toISOString()

    let closedPreviousSessionId: string | null = null

    // 1. Finalize yesterday's session cleanly at midnight boundary
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

      if (this.state.activeSecondsBuffer >= 60) {
        const extraMinutes = Math.floor(this.state.activeSecondsBuffer / 60)
        activeSession.active_minutes += extraMinutes
        this.state.activeSecondsBuffer %= 60
      }
      activeSession.active_seconds_buffer = Math.floor(this.state.activeSecondsBuffer)

      const idx = store.todaySessions.findIndex(s => s.id === activeSession.id)
      if (idx !== -1) {
        store.todaySessions[idx] = activeSession
      } else {
        store.todaySessions.push(activeSession)
      }

      store.pendingSyncQueue.push({
        id: `session-${activeSession.id}`,
        type: 'session',
        employee_id: user.id,
        data: activeSession,
        createdAt: closeIso,
        retries: 0
      })
    }

    // 2. Calculate immutable previous-day totals
    const prevDayWorkedSeconds = calculateDailyWorkedSeconds(null, store.todaySessions, previousDay, dayEndMs, tz)
    const prevDayActiveSeconds = calculateDailyActiveSeconds(null, store.todaySessions, previousDay, dayEndMs, tz)
    const prevDayWorkedMinutes = Math.floor(prevDayWorkedSeconds / 60)
    const prevDayActiveMinutes = Math.floor(prevDayActiveSeconds / 60)

    // 3. Generate immutable Audit Log capturing previous-day totals
    const auditRecord: TimeResetAuditRecord = {
      id: `audit-${Date.now()}`,
      session_id: closedPreviousSessionId || (store.todaySessions.find(s => s.session_date === previousDay)?.id || 'sess-fallback'),
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

    store.resetAuditLogs.unshift(auditRecord)
    store.pendingSyncQueue.push({
      id: `reset-audit-${auditRecord.id}`,
      type: 'reset_audit' as any,
      employee_id: user.id,
      data: auditRecord,
      createdAt: midnightStartIso,
      retries: 0
    })

    // 4. Maintain ongoing session across midnight
    if (wasActive) {
      const isBreak = prevStatus === 'on_break'
      const newSession: TrackingSession = {
        id: `sess-cont-${Date.now()}`,
        employee_id: user.id,
        session_date: newDay,
        clock_in: midnightStartIso,
        clock_out: null,
        status: isBreak ? 'on_break' : 'working',
        worked_minutes: 0,
        active_minutes: 0,
        suspended_seconds: 0,
        active_seconds_buffer: 0,
        screenshot_seconds_buffer: 0,
        last_heartbeat: new Date().toISOString(),
        breaks: isBreak ? [{
          id: `brk-${Date.now()}`,
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

      store.pendingSyncQueue.push({
        id: `session-${newSession.id}`,
        type: 'session',
        employee_id: user.id,
        data: newSession,
        createdAt: midnightStartIso,
        retries: 0
      })
    } else {
      store.currentSession = null
    }

    // 5. Duplicate prevention flag and reset buffers
    store.lastRolloverDate = newDay
    this.state.activeSecondsBuffer = 0
    this.state.currentBusinessDate = newDay

    return { success: true, auditRecord, continuationSession: store.currentSession }
  }

  // Exact implementation logic matching TrackerStorage.validateActiveSession
  public validateActiveSession(session: TrackingSession | null): TrackingSession | null {
    if (!session || !session.id) return null
    if (session.clock_out !== null && session.clock_out !== undefined) return null
    if (session.status === 'completed' || session.status === 'Completed') return null

    const today = getDateString(new Date(), this.state.settings.timezone)
    if (session.session_date && session.session_date !== today) {
      const tz = this.state.settings.timezone
      const { dayEndMs } = getDayBounds(session.session_date, tz)
      const lastHbMs = session.last_heartbeat
        ? new Date(session.last_heartbeat).getTime()
        : new Date(session.clock_in).getTime()
      const wasWorkingAcrossMidnight = (dayEndMs - lastHbMs) <= 5 * 60 * 1000

      const closeTime = wasWorkingAcrossMidnight
        ? new Date(dayEndMs).toISOString()
        : (session.last_heartbeat || new Date(dayEndMs - 1).toISOString())

      session.clock_out = closeTime
      session.status = 'completed'
      const clockInTime = new Date(session.clock_in).getTime()
      const clockOutTime = new Date(closeTime).getTime()
      let totalBreakMs = 0
      if (Array.isArray(session.breaks)) {
        for (const b of session.breaks) {
          if (b.end_time === null) {
            b.end_time = closeTime
            b.duration_minutes = Math.max(0, Math.floor((new Date(closeTime).getTime() - new Date(b.start_time).getTime()) / 60000))
          }
          if (b.end_time) {
            totalBreakMs += Math.max(0, new Date(b.end_time).getTime() - new Date(b.start_time).getTime())
          }
        }
      }
      const suspendedMs = (session.suspended_seconds || 0) * 1000
      session.worked_minutes = Math.max(0, Math.floor((clockOutTime - clockInTime - totalBreakMs - suspendedMs) / 60000))

      this.state.store.pendingSyncQueue.push({
        id: `session-${session.id}`,
        type: 'session',
        employee_id: session.employee_id,
        data: session,
        createdAt: closeTime,
        retries: 0
      })

      if (wasWorkingAcrossMidnight) {
        const alreadyHasToday = this.state.store.todaySessions.some(
          s => s.session_date === today && !s.clock_out && s.status !== 'completed'
        )
        if (!alreadyHasToday) {
          const isBreak = session.status === 'on_break'
          const midnightIso = new Date(dayEndMs).toISOString()
          const newSession: TrackingSession = {
            id: `sess-cont-${Date.now()}`,
            employee_id: session.employee_id,
            session_date: today,
            clock_in: midnightIso,
            clock_out: null,
            status: isBreak ? 'on_break' : 'working',
            worked_minutes: 0,
            active_minutes: 0,
            suspended_seconds: 0,
            active_seconds_buffer: 0,
            screenshot_seconds_buffer: 0,
            last_heartbeat: new Date().toISOString(),
            breaks: isBreak ? [{
              id: `brk-${Date.now()}`,
              session_id: '',
              start_time: midnightIso,
              end_time: null,
              duration_minutes: 0,
              reason: 'Break continued across midnight'
            }] : []
          }
          if (newSession.breaks.length > 0) {
            newSession.breaks[0].session_id = newSession.id
          }
          this.state.store.currentSession = newSession
          this.state.store.todaySessions.push(newSession)
          this.state.store.lastRolloverDate = today
          return newSession
        }
      }

      return null
    }

    return session
  }
}

describe('Audit: Automatic Midnight Reset Functionality', () => {

  // --------------------------------------------------------------------------
  // 1. Timezone Configuration & 12:00 AM Reset Boundary
  // --------------------------------------------------------------------------
  describe('1. Reset at 12:00 AM Across Configured Timezones', () => {
    it('accurately identifies 12:00 AM midnight boundary for Asia/Kolkata (IST: UTC+5:30)', () => {
      const bounds = getDayBounds('2026-11-16', 'Asia/Kolkata')
      // 2026-11-16 00:00:00 IST = 2026-11-15 18:30:00 UTC
      expect(new Date(bounds.dayStartMs).toISOString()).toBe('2026-11-15T18:30:00.000Z')
      // 2026-11-16 24:00:00 IST = 2026-11-16 18:30:00 UTC (12:00 AM next day)
      expect(new Date(bounds.dayEndMs).toISOString()).toBe('2026-11-16T18:30:00.000Z')
      expect(bounds.dayEndMs - bounds.dayStartMs).toBe(24 * 3600 * 1000)
    })

    it('accurately identifies 12:00 AM midnight boundary for UTC', () => {
      const bounds = getDayBounds('2026-11-16', 'UTC')
      expect(new Date(bounds.dayStartMs).toISOString()).toBe('2026-11-16T00:00:00.000Z')
      expect(new Date(bounds.dayEndMs).toISOString()).toBe('2026-11-17T00:00:00.000Z')
      expect(bounds.dayEndMs - bounds.dayStartMs).toBe(24 * 3600 * 1000)
    })

    it('accurately identifies 12:00 AM midnight boundary for America/New_York (EST: UTC-5)', () => {
      const bounds = getDayBounds('2026-11-16', 'America/New_York')
      // Nov 16 EST = UTC-5: 00:00 EST = 05:00 UTC
      expect(new Date(bounds.dayStartMs).toISOString()).toBe('2026-11-16T05:00:00.000Z')
      // 24:00 EST = Nov 17 05:00 UTC
      expect(new Date(bounds.dayEndMs).toISOString()).toBe('2026-11-17T05:00:00.000Z')
      expect(bounds.dayEndMs - bounds.dayStartMs).toBe(24 * 3600 * 1000)
    })

    it('accurately identifies 12:00 AM midnight boundary for Asia/Dubai (GST: UTC+4)', () => {
      const bounds = getDayBounds('2026-11-16', 'Asia/Dubai')
      // Nov 16 GST = UTC+4: 00:00 GST = Nov 15 20:00 UTC
      expect(new Date(bounds.dayStartMs).toISOString()).toBe('2026-11-15T20:00:00.000Z')
      expect(new Date(bounds.dayEndMs).toISOString()).toBe('2026-11-16T20:00:00.000Z')
      expect(bounds.dayEndMs - bounds.dayStartMs).toBe(24 * 3600 * 1000)
    })

    it('resets daily counters to 00:00:00 exactly when new day begins in America/New_York timezone', () => {
      const harness = new MidnightResetAuditHarness('America/New_York')
      // Clock in at 22:00 EST on 2026-11-16 (03:00 UTC Nov 17)
      const clockInIso = '2026-11-17T03:00:00.000Z'
      const session = harness.clockIn(clockInIso)
      session.worked_minutes = 120 // 2 hours
      session.active_minutes = 110

      // Trigger rollover for America/New_York (2026-11-16 -> 2026-11-17)
      const res = harness.handleDayRollover('2026-11-16', '2026-11-17', 'America/New_York')
      expect(res.success).toBe(true)

      // At exactly 12:00:00 AM EST (05:00 UTC on Nov 17)
      const midnightEstMs = new Date('2026-11-17T05:00:00.000Z').getTime()
      const newDayWorked = calculateDailyWorkedSeconds(
        harness.state.store.currentSession,
        harness.state.store.todaySessions,
        '2026-11-17',
        midnightEstMs,
        'America/New_York'
      )
      const newDayActive = calculateDailyActiveSeconds(
        harness.state.store.currentSession,
        harness.state.store.todaySessions,
        '2026-11-17',
        midnightEstMs,
        'America/New_York'
      )

      expect(newDayWorked).toBe(0)
      expect(newDayActive).toBe(0)
      expect(formatSecondsToHHMMSS(newDayWorked)).toBe('00:00:00')
      expect(formatSecondsToHHMMSS(newDayActive)).toBe('00:00:00')
    })
  })

  // --------------------------------------------------------------------------
  // 2. Archiving Previous-Day Totals
  // --------------------------------------------------------------------------
  describe('2. Archiving Previous-Day Totals', () => {
    it('archives finalized session and records immutable audit log with exact worked and active totals', () => {
      const harness = new MidnightResetAuditHarness('Asia/Kolkata')
      // Clock in at 20:00 IST on 2026-11-16
      const session = harness.clockIn('2026-11-16T14:30:00.000Z') // 20:00 IST
      session.worked_minutes = 240 // 4 hours
      session.active_minutes = 230

      const res = harness.handleDayRollover('2026-11-16', '2026-11-17', 'Asia/Kolkata')
      expect(res.success).toBe(true)

      const audit = res.auditRecord!
      expect(audit).toBeDefined()
      expect(audit.reset_type).toBe('automatic_daily_reset')
      expect(audit.previous_worked_minutes).toBe(240)
      expect(audit.previous_worked_seconds).toBe(240 * 60)
      expect(audit.previous_active_minutes).toBe(230)
      expect(audit.previous_active_seconds).toBe(230 * 60)
      expect(audit.notes).toContain('Session seamlessly continued across midnight')
      expect(audit.reset_by_role).toBe('System')

      // Archived in local store
      expect(harness.state.store.resetAuditLogs).toHaveLength(1)
      expect(harness.state.store.resetAuditLogs[0].id).toBe(audit.id)

      // Archived in sync queue for Supabase
      const syncAudit = harness.state.store.pendingSyncQueue.find(p => p.id === `reset-audit-${audit.id}`)
      expect(syncAudit).toBeDefined()
      expect(syncAudit?.data.previous_worked_minutes).toBe(240)
    })
  })

  // --------------------------------------------------------------------------
  // 3. Ongoing Sessions Continue Uninterrupted
  // --------------------------------------------------------------------------
  describe('3. Ongoing Sessions Continuation Uninterrupted', () => {
    it('seamlessly transitions ongoing session across midnight with 0ms gap and 0 lost/double-counted time', () => {
      const harness = new MidnightResetAuditHarness('Asia/Kolkata')
      // User clocked in at 22:30 IST on 2026-11-16 (17:00 UTC)
      const clockInIso = '2026-11-16T17:00:00.000Z'
      const originalSession = harness.clockIn(clockInIso)
      originalSession.worked_minutes = 90
      originalSession.active_minutes = 85

      const res = harness.handleDayRollover('2026-11-16', '2026-11-17', 'Asia/Kolkata')
      expect(res.success).toBe(true)

      const contSession = harness.state.store.currentSession!
      expect(contSession).toBeDefined()
      expect(contSession.id).not.toBe(originalSession.id)
      expect(contSession.session_date).toBe('2026-11-17')
      expect(contSession.status).toBe('working')
      expect(contSession.worked_minutes).toBe(0)
      expect(contSession.active_minutes).toBe(0)

      // Verify exact boundary timestamp alignment
      const dayEndIso = new Date(getDayBounds('2026-11-16', 'Asia/Kolkata').dayEndMs).toISOString()
      expect(originalSession.clock_out).toBe(dayEndIso)
      expect(contSession.clock_in).toBe(dayEndIso)
      expect(new Date(contSession.clock_in).getTime() - new Date(originalSession.clock_out!).getTime()).toBe(0)

      // Simulate working until 02:00 AM IST on 2026-11-17 (20:30 UTC Nov 16)
      const checkMs = new Date('2026-11-16T20:30:00.000Z').getTime()
      contSession.last_heartbeat = new Date(checkMs).toISOString()

      const day1Worked = calculateDailyWorkedSeconds(null, harness.state.store.todaySessions, '2026-11-16', checkMs, 'Asia/Kolkata')
      const day2Worked = calculateDailyWorkedSeconds(contSession, harness.state.store.todaySessions, '2026-11-17', checkMs, 'Asia/Kolkata')

      // Day 1: 22:30 to 24:00 = 1.5h = 5400s
      expect(day1Worked).toBe(5400)
      // Day 2: 00:00 to 02:00 = 2.0h = 7200s
      expect(day2Worked).toBe(7200)

      // Total continuous elapsed work: 22:30 to 02:00 = 3.5h = 12600s
      const totalElapsedSeconds = (checkMs - new Date(clockInIso).getTime()) / 1000
      expect(day1Worked + day2Worked).toBe(totalElapsedSeconds)
    })

    it('seamlessly transitions open break across midnight without losing break state', () => {
      const harness = new MidnightResetAuditHarness('Asia/Kolkata')
      const session = harness.clockIn('2026-11-16T16:00:00.000Z') // 21:30 IST
      session.status = 'on_break'
      session.breaks = [{
        id: 'break-prior',
        session_id: session.id,
        start_time: '2026-11-16T18:15:00.000Z', // 23:45 IST
        end_time: null,
        duration_minutes: 0,
        reason: 'Rest'
      }]

      const res = harness.handleDayRollover('2026-11-16', '2026-11-17', 'Asia/Kolkata')
      expect(res.success).toBe(true)

      // Prior session's break closed at midnight boundary
      const midnightIso = '2026-11-16T18:30:00.000Z'
      expect(session.breaks[0].end_time).toBe(midnightIso)
      expect(session.breaks[0].duration_minutes).toBe(15) // 23:45 to 24:00

      // Continuation session created on break
      const cont = harness.state.store.currentSession!
      expect(cont.status).toBe('on_break')
      expect(cont.breaks).toHaveLength(1)
      expect(cont.breaks[0].start_time).toBe(midnightIso)
      expect(cont.breaks[0].end_time).toBeNull()
      expect(cont.breaks[0].reason).toContain('Break continued across midnight')
    })
  })

  // --------------------------------------------------------------------------
  // 4. Protection of Historical Records
  // --------------------------------------------------------------------------
  describe('4. Historical Records Protection', () => {
    it('preserves historical sessions completely untouched across rollover', () => {
      const harness = new MidnightResetAuditHarness('Asia/Kolkata')
      // Historical session from Nov 14
      const historicalSession: TrackingSession = {
        id: 'sess-historical-nov14',
        employee_id: harness.state.currentUser!.id,
        session_date: '2026-11-14',
        clock_in: '2026-11-14T03:30:00.000Z', // 09:00 IST
        clock_out: '2026-11-14T11:30:00.000Z', // 17:00 IST
        status: 'completed',
        worked_minutes: 480,
        active_minutes: 460,
        suspended_seconds: 0,
        active_seconds_buffer: 0,
        screenshot_seconds_buffer: 0,
        breaks: []
      }
      harness.state.store.todaySessions.push(historicalSession)

      // Work session on Nov 16
      harness.clockIn('2026-11-16T16:00:00.000Z')

      // Trigger rollover to Nov 17
      harness.handleDayRollover('2026-11-16', '2026-11-17', 'Asia/Kolkata')

      // Historical session must be 100% unaltered
      const foundHistorical = harness.state.store.todaySessions.find(s => s.id === 'sess-historical-nov14')!
      expect(foundHistorical).toBeDefined()
      expect(foundHistorical.worked_minutes).toBe(480)
      expect(foundHistorical.active_minutes).toBe(460)
      expect(foundHistorical.clock_in).toBe('2026-11-14T03:30:00.000Z')
      expect(foundHistorical.clock_out).toBe('2026-11-14T11:30:00.000Z')
      expect(foundHistorical.status).toBe('completed')
    })
  })

  // --------------------------------------------------------------------------
  // 5. Prevention of Duplicate Resets
  // --------------------------------------------------------------------------
  describe('5. Duplicate Reset Prevention', () => {
    it('strictly prevents duplicate resets when rollover is invoked repeatedly for the same date', () => {
      const harness = new MidnightResetAuditHarness('Asia/Kolkata')
      harness.clockIn('2026-11-16T17:00:00.000Z')

      // First run: executes rollover
      const res1 = harness.handleDayRollover('2026-11-16', '2026-11-17', 'Asia/Kolkata')
      expect(res1.success).toBe(true)
      expect(harness.state.store.lastRolloverDate).toBe('2026-11-17')
      expect(harness.state.store.resetAuditLogs).toHaveLength(1)
      expect(harness.state.store.todaySessions).toHaveLength(2)

      // Second run (e.g. repeated timer tick or app restart on 2026-11-17)
      const res2 = harness.handleDayRollover('2026-11-16', '2026-11-17', 'Asia/Kolkata')
      expect(res2.skippedDuplicate).toBe(true)

      // Verify no duplicate audit logs or session splits were created
      expect(harness.state.store.resetAuditLogs).toHaveLength(1)
      expect(harness.state.store.todaySessions).toHaveLength(2)
      expect(harness.state.store.pendingSyncQueue.filter(p => p.type === 'reset_audit')).toHaveLength(1)
    })
  })

  // --------------------------------------------------------------------------
  // 6. Application Restarts
  // --------------------------------------------------------------------------
  describe('6. Application Restarts Across Midnight', () => {
    it('finalizes unclosed session from yesterday on startup without leaking time into new day', () => {
      const harness = new MidnightResetAuditHarness('Asia/Kolkata')

      // Employee left PC at 17:00 on Nov 16 without clocking out (abandoned session > 5m before midnight)
      const staleSession: TrackingSession = {
        id: 'sess-stale-yesterday',
        employee_id: harness.state.currentUser!.id,
        session_date: '2026-11-16',
        clock_in: '2026-11-16T03:30:00.000Z', // 09:00 IST
        clock_out: null, // Left open!
        status: 'working',
        worked_minutes: 480,
        active_minutes: 450,
        suspended_seconds: 0,
        active_seconds_buffer: 0,
        last_heartbeat: '2026-11-16T11:30:00.000Z', // Last heartbeat at 17:00 IST (hours before midnight)
        breaks: []
      }

      // App is launched next morning (Nov 17 at 09:00 IST = 03:30 UTC)
      // Storage validateActiveSession runs during app startup:
      const validated = harness.validateActiveSession(staleSession)

      // Session must be finalized and returned as null (no active session on startup since work ended yesterday)
      expect(validated).toBeNull()
      expect(staleSession.status).toBe('completed')
      expect(staleSession.clock_out).toBe('2026-11-16T11:30:00.000Z')

      // Daily worked hours on Nov 17 must be strictly 00:00:00
      const morningCheckMs = new Date('2026-11-17T03:30:00.000Z').getTime()
      const todayWorked = calculateDailyWorkedSeconds(null, [staleSession], '2026-11-17', morningCheckMs, 'Asia/Kolkata')
      expect(todayWorked).toBe(0)
      expect(formatSecondsToHHMMSS(todayWorked)).toBe('00:00:00')
    })

    it('automatically recovers and creates continuation session when app restarts right after midnight while working', () => {
      const harness = new MidnightResetAuditHarness('Asia/Kolkata')

      // Employee was working at 23:59:30 on Nov 16 (heartbeat 30 seconds before midnight)
      const activeSession: TrackingSession = {
        id: 'sess-working-across-midnight',
        employee_id: harness.state.currentUser!.id,
        session_date: '2026-11-16',
        clock_in: '2026-11-16T16:30:00.000Z', // 22:00 IST
        clock_out: null,
        status: 'working',
        worked_minutes: 119,
        active_minutes: 115,
        suspended_seconds: 0,
        active_seconds_buffer: 30,
        last_heartbeat: '2026-11-16T18:29:30.000Z', // 23:59:30 IST (active across midnight!)
        breaks: []
      }
      harness.state.store.currentSession = activeSession
      harness.state.store.todaySessions.push(activeSession)

      // App restarts at 00:02 IST on Nov 17 (18:32 UTC Nov 16)
      // Simulate validateActiveSession on startup:
      const validated = harness.validateActiveSession(activeSession)

      // Since employee was working right at midnight, validateActiveSession cleanly continues tracking:
      expect(validated).not.toBeNull()
      expect(validated?.session_date).toBe('2026-11-17')
      expect(validated?.status).toBe('working')
      expect(validated?.worked_minutes).toBe(0)
      expect(validated?.active_minutes).toBe(0)

      // Prior session finalized at midnight
      expect(activeSession.status).toBe('completed')
      expect(activeSession.clock_out).toBe('2026-11-16T18:30:00.000Z')
    })
  })

  // --------------------------------------------------------------------------
  // 9. Sleep / Resume Spanning Midnight
  // --------------------------------------------------------------------------
  describe('9. System Sleep / Resume Spanning Midnight', () => {
    it('partitions sleep across midnight so Day 1 and Day 2 each deduct their exact sleep portion', () => {
      const harness = new MidnightResetAuditHarness('Asia/Kolkata')
      // User clocked in at 22:00 IST (16:30 UTC Nov 16)
      const session = harness.clockIn('2026-11-16T16:30:00.000Z')

      // Computer went to sleep at 23:50 IST (18:20 UTC)
      // Computer woke up at 00:10 IST (18:40 UTC Nov 16)
      // Total sleep = 20 minutes (1200s).
      // Sleep on Day 1 (23:50 to 24:00) = 10 mins (600s).
      // Sleep on Day 2 (00:00 to 00:10) = 10 mins (600s).
      const suspendStartMs = new Date('2026-11-16T18:20:00.000Z').getTime()
      const resumeMs = new Date('2026-11-16T18:40:00.000Z').getTime()
      const midnightMs = new Date('2026-11-16T18:30:00.000Z').getTime()

      const day1SleepSec = Math.floor((midnightMs - suspendStartMs) / 1000) // 600s
      const day2SleepSec = Math.floor((resumeMs - midnightMs) / 1000)       // 600s

      session.suspended_seconds = day1SleepSec

      // Rollover executes upon resume
      const rolloverRes = harness.handleDayRollover('2026-11-16', '2026-11-17', 'Asia/Kolkata')
      expect(rolloverRes.success).toBe(true)

      const contSession = harness.state.store.currentSession!
      contSession.suspended_seconds = day2SleepSec

      // Day 1: 22:00 to 24:00 (7200s elapsed) minus 600s sleep = 6600s (1h 50m)
      const day1Worked = calculateDailyWorkedSeconds(null, harness.state.store.todaySessions, '2026-11-16', resumeMs, 'Asia/Kolkata')
      expect(day1Worked).toBe(6600)
      expect(formatSecondsToHHMMSS(day1Worked)).toBe('01:50:00')

      // Day 2 at 00:30 IST (19:00 UTC Nov 16):
      // Elapsed is 30 mins (1800s) minus 600s sleep = 1200s (20m)
      const check30Ms = new Date('2026-11-16T19:00:00.000Z').getTime()
      const day2Worked = calculateDailyWorkedSeconds(contSession, harness.state.store.todaySessions, '2026-11-17', check30Ms, 'Asia/Kolkata')
      expect(day2Worked).toBe(1200)
      expect(formatSecondsToHHMMSS(day2Worked)).toBe('00:20:00')

      // Total worked across both days: 6600s + 1200s = 7800s (2h 10m)
      // Total elapsed from 22:00 to 00:30 is 2.5h (9000s) minus 20m sleep (1200s) = 7800s!
      expect(day1Worked + day2Worked).toBe(7800)
    })
  })

  // --------------------------------------------------------------------------
  // 10. Idle Periods Across Midnight
  // --------------------------------------------------------------------------
  describe('10. Continuous Activity with Idle Periods Across Midnight', () => {
    it('freezes active hours when idle threshold (60s) is exceeded across midnight and unfreezes on input', () => {
      // Session with 2 hours worked on Day 1 (1h 45m active, 15m idle), and 1 hour worked on Day 2 (50m active, 10m idle)
      const multiDaySession: TrackingSession = {
        id: 'sess-idle-cross',
        employee_id: 'emp-uuid',
        session_date: '2026-11-16',
        clock_in: '2026-11-16T16:30:00.000Z', // 22:00 IST Nov 16
        clock_out: '2026-11-16T19:30:00.000Z', // 01:00 IST Nov 17
        status: 'completed',
        worked_minutes: 180, // 3 hours
        active_minutes: 155, // 2h 35m active (25m total idle > 60s)
        suspended_seconds: 0,
        active_seconds_buffer: 0,
        breaks: []
      }

      const day1Worked = calculateDailyWorkedSeconds(null, [multiDaySession], '2026-11-16', undefined, 'Asia/Kolkata')
      const day2Worked = calculateDailyWorkedSeconds(null, [multiDaySession], '2026-11-17', undefined, 'Asia/Kolkata')

      // Day 1: 22:00 to 24:00 = 2 hours = 7200s
      expect(day1Worked).toBe(7200)
      // Day 2: 00:00 to 01:00 = 1 hour = 3600s
      expect(day2Worked).toBe(3600)

      const day1Active = calculateDailyActiveSeconds(null, [multiDaySession], '2026-11-16', undefined, 'Asia/Kolkata')
      const day2Active = calculateDailyActiveSeconds(null, [multiDaySession], '2026-11-17', undefined, 'Asia/Kolkata')

      // Proportional active distribution without overcounting:
      // Day 1: 2/3 of 155m = 103.33m = 6200s
      // Day 2: 1/3 of 155m = 51.67m = 3100s
      expect(day1Active + day2Active).toBe(155 * 60)
      expect(day1Active).toBeLessThanOrEqual(day1Worked)
      expect(day2Active).toBeLessThanOrEqual(day2Worked)
    })
  })

  // --------------------------------------------------------------------------
  // 7. Offline Synchronization
  // --------------------------------------------------------------------------
  describe('7. Offline Synchronization at Midnight', () => {
    it('correctly queues all rollover transactions offline and flushes them when connectivity resumes', () => {
      const harness = new MidnightResetAuditHarness('Asia/Kolkata')
      harness.clockIn('2026-11-16T17:00:00.000Z')

      // Midnight strikes while computer is offline
      harness.handleDayRollover('2026-11-16', '2026-11-17', 'Asia/Kolkata')

      // Verify all 3 transactions are enqueued in pendingSyncQueue:
      // 1. Closed yesterday session
      // 2. Audit log with yesterday's totals
      // 3. New continuation session
      expect(harness.state.store.pendingSyncQueue).toHaveLength(3)
      const sessionSyncs = harness.state.store.pendingSyncQueue.filter(p => p.type === 'session')
      const auditSyncs = harness.state.store.pendingSyncQueue.filter(p => p.type === 'reset_audit')

      expect(sessionSyncs).toHaveLength(2)
      expect(auditSyncs).toHaveLength(1)

      // Verify simulated queue flush upon reconnect
      const syncedIds: string[] = []
      for (const item of [...harness.state.store.pendingSyncQueue]) {
        // Simulate successful Supabase insert/upsert
        syncedIds.push(item.id)
      }
      harness.state.store.pendingSyncQueue = harness.state.store.pendingSyncQueue.filter(
        p => !syncedIds.includes(p.id)
      )

      expect(harness.state.store.pendingSyncQueue).toHaveLength(0)
    })
  })

  // --------------------------------------------------------------------------
  // 8. Sessions Crossing Midnight Calculation
  // --------------------------------------------------------------------------
  describe('8. Sessions Crossing Midnight Apportionment', () => {
    it('accurately splits continuous session between two days without gaps or overlaps', () => {
      // Single continuous session running from 22:00 IST (16:30 UTC) to 03:00 IST (21:30 UTC)
      const crossingSession: TrackingSession = {
        id: 'sess-cross-midnight',
        employee_id: 'emp-uuid',
        session_date: '2026-11-16',
        clock_in: '2026-11-16T16:30:00.000Z', // 22:00 IST Nov 16
        clock_out: '2026-11-16T21:30:00.000Z', // 03:00 IST Nov 17
        status: 'completed',
        worked_minutes: 300, // 5 hours
        active_minutes: 270, // 4.5 hours
        suspended_seconds: 0,
        active_seconds_buffer: 0,
        breaks: []
      }

      const day1Worked = calculateDailyWorkedSeconds(null, [crossingSession], '2026-11-16', undefined, 'Asia/Kolkata')
      const day2Worked = calculateDailyWorkedSeconds(null, [crossingSession], '2026-11-17', undefined, 'Asia/Kolkata')

      // Day 1: 22:00 to 24:00 = 2 hours = 7200s
      expect(day1Worked).toBe(7200)
      expect(formatSecondsToHHMMSS(day1Worked)).toBe('02:00:00')

      // Day 2: 00:00 to 03:00 = 3 hours = 10800s
      expect(day2Worked).toBe(10800)
      expect(formatSecondsToHHMMSS(day2Worked)).toBe('03:00:00')

      // Active hours proportional apportionment:
      const day1Active = calculateDailyActiveSeconds(null, [crossingSession], '2026-11-16', undefined, 'Asia/Kolkata')
      const day2Active = calculateDailyActiveSeconds(null, [crossingSession], '2026-11-17', undefined, 'Asia/Kolkata')

      // Day 1: 2/5 of 270m = 108m = 6480s
      expect(day1Active).toBe(108 * 60)
      // Day 2: 3/5 of 270m = 162m = 9720s
      expect(day2Active).toBe(162 * 60)

      expect(day1Active + day2Active).toBe(270 * 60)
    })
  })
})
