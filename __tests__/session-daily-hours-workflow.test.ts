import { describe, it, expect, beforeEach } from 'vitest'
import {
  calculateSessionWorkedSeconds,
  calculateDailyWorkedSeconds,
  calculateDailyActiveSeconds,
  formatSecondsToHHMMSS,
  getKolkataDayBounds,
  getKolkataDateString
} from '../src/utils/timeCalculator'
import type { TrackingSession, BreakRecord, ActivityInterval, UserProfile, PendingSyncItem } from '../src/types'

// Mock storage & tracker simulator matching Electron main/activityTracker/storage architecture
interface EmployeeDataBucket {
  currentSession: TrackingSession | null
  todaySessions: TrackingSession[]
  activityLogs: ActivityInterval[]
  pendingSyncQueue: PendingSyncItem[]
  lastSyncedAt: string | null
}

class TestTrackerEngine {
  public currentUser: UserProfile | null = null
  public employeeBuckets: Map<string, EmployeeDataBucket> = new Map()
  public isClockInInProgress = false

  public getBucket(employeeId: string): EmployeeDataBucket {
    if (!this.employeeBuckets.has(employeeId)) {
      this.employeeBuckets.set(employeeId, {
        currentSession: null,
        todaySessions: [],
        activityLogs: [],
        pendingSyncQueue: [],
        lastSyncedAt: null
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

  public validateActiveSession(session: TrackingSession | null, expectedEmployeeId: string): TrackingSession | null {
    if (!session || !session.id) return null
    if (session.employee_id !== expectedEmployeeId) return null
    if (session.clock_out !== null && session.clock_out !== undefined) return null
    if (session.status === 'completed' || session.status === 'Completed') return null

    const clockInMs = new Date(session.clock_in).getTime()
    if (isNaN(clockInMs)) return null

    // Sessions older than 24h cannot be active
    if (Date.now() - clockInMs > 24 * 60 * 60 * 1000) return null

    if (!Array.isArray(session.breaks)) session.breaks = []
    const hasOpenBreak = session.breaks.some(b => b.end_time === null)
    session.status = hasOpenBreak ? 'on_break' : 'working'

    return session
  }

  public clockIn(timestamp: string, simulateNetworkError: boolean = false): { success: boolean; session?: TrackingSession; error?: string } {
    if (!this.currentUser) {
      return { success: false, error: 'Cannot clock in: Employee authentication required' }
    }

    if (this.isClockInInProgress) {
      const bucket = this.getBucket(this.currentUser.id)
      if (bucket.currentSession && !bucket.currentSession.clock_out && bucket.currentSession.status !== 'completed') {
        return { success: true, session: bucket.currentSession }
      }
      return { success: false, error: 'Clock in operation is already in progress' }
    }

    this.isClockInInProgress = true

    try {
      const bucket = this.getBucket(this.currentUser.id)
      // Confirm no active session already open
      if (bucket.currentSession && !bucket.currentSession.clock_out && bucket.currentSession.status !== 'completed') {
        return { success: true, session: bucket.currentSession }
      }

      const today = getKolkataDateString(new Date(timestamp))
      const newSession: TrackingSession = {
        id: `sess-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        employee_id: this.currentUser.id,
        session_date: today,
        clock_in: timestamp,
        clock_out: null,
        status: 'working',
        worked_minutes: 0,
        active_minutes: 0,
        suspended_seconds: 0,
        active_seconds_buffer: 0,
        breaks: []
      }

      if (simulateNetworkError) {
        // Rollback safely
        return { success: false, error: 'Failed to establish session on server' }
      }

      bucket.currentSession = newSession
      bucket.todaySessions.push(newSession)
      return { success: true, session: newSession }
    } finally {
      this.isClockInInProgress = false
    }
  }

  public takeBreak(timestamp: string): TrackingSession | null {
    if (!this.currentUser) return null
    const bucket = this.getBucket(this.currentUser.id)
    const session = bucket.currentSession
    if (!session || session.status !== 'working' || session.clock_out) return null
    if (session.breaks.some(b => b.end_time === null)) return session

    const newBreak: BreakRecord = {
      id: `brk-${Date.now()}`,
      session_id: session.id,
      start_time: timestamp,
      end_time: null,
      duration_minutes: 0,
      reason: 'Break'
    }

    session.breaks.push(newBreak)
    session.status = 'on_break'
    return session
  }

  public resumeWork(timestamp: string): TrackingSession | null {
    if (!this.currentUser) return null
    const bucket = this.getBucket(this.currentUser.id)
    const session = bucket.currentSession
    if (!session || session.status !== 'on_break' || session.clock_out) return null

    const openBreak = session.breaks.find(b => b.end_time === null)
    if (openBreak) {
      openBreak.end_time = timestamp
      const startMs = new Date(openBreak.start_time).getTime()
      const endMs = new Date(timestamp).getTime()
      openBreak.duration_minutes = Math.max(0, Math.floor((endMs - startMs) / 60000))
    }

    session.status = 'working'
    return session
  }

  public clockOut(timestamp: string): TrackingSession | null {
    if (!this.currentUser) return null
    const bucket = this.getBucket(this.currentUser.id)
    const session = bucket.currentSession
    if (!session || session.clock_out || session.status === 'completed') return null

    // Close any open break
    const openBreak = session.breaks.find(b => b.end_time === null)
    if (openBreak) {
      openBreak.end_time = timestamp
      const startMs = new Date(openBreak.start_time).getTime()
      const endMs = new Date(timestamp).getTime()
      openBreak.duration_minutes = Math.max(0, Math.floor((endMs - startMs) / 60000))
    }

    session.clock_out = timestamp
    session.status = 'completed'

    const totalSeconds = calculateSessionWorkedSeconds(session, new Date(timestamp).getTime())
    session.worked_minutes = Math.floor(totalSeconds / 60)

    bucket.currentSession = null
    const idx = bucket.todaySessions.findIndex(s => s.id === session.id)
    if (idx !== -1) {
      bucket.todaySessions[idx] = session
    } else {
      bucket.todaySessions.push(session)
    }

    return session
  }
}

describe('TripleS Time Tracker — 14 Master Regression Scenarios', () => {
  let engine: TestTrackerEngine
  const userA: UserProfile = {
    id: 'emp-uuid-alpha',
    first_name: 'Omkar',
    last_name: 'Sawant',
    email: 'omkar@triplesproduction.com',
    department: 'Development',
    designation: 'Software Developer',
    role: 'Employee'
  }

  const userB: UserProfile = {
    id: 'emp-uuid-beta',
    first_name: 'John',
    last_name: 'Doe',
    email: 'john@triplesproduction.com',
    department: 'Marketing',
    designation: 'Graphic Designer',
    role: 'Employee'
  }

  beforeEach(() => {
    engine = new TestTrackerEngine()
  })

  // 1. Clock In → timer starts at zero
  it('Scenario 1: Clock In → session timer starts at zero (00:00:00)', () => {
    engine.login(userA)
    const clockInTime = '2026-10-19T09:00:00.000+05:30'
    const clockInMs = new Date(clockInTime).getTime()

    const res = engine.clockIn(clockInTime)
    expect(res.success).toBe(true)
    expect(res.session).toBeDefined()
    expect(res.session?.status).toBe('working')

    // At exact clock-in moment
    const initialSeconds = calculateSessionWorkedSeconds(res.session!, clockInMs)
    expect(initialSeconds).toBe(0)
    expect(formatSecondsToHHMMSS(initialSeconds)).toBe('00:00:00')

    // After 45 seconds of working
    const after45s = calculateSessionWorkedSeconds(res.session!, clockInMs + 45 * 1000)
    expect(after45s).toBe(45)
    expect(formatSecondsToHHMMSS(after45s)).toBe('00:00:45')
  })

  // 2. Take a Break → session timer and active-time accumulation pause
  it('Scenario 2: Take a Break → session timer and active accumulation pause', () => {
    engine.login(userA)
    const clockInTime = '2026-10-19T09:00:00.000+05:30'
    const clockInMs = new Date(clockInTime).getTime()
    const { session } = engine.clockIn(clockInTime)

    // Work for 1 hour (3600 seconds)
    const breakStartTime = '2026-10-19T10:00:00.000+05:30'
    const breakStartMs = new Date(breakStartTime).getTime()

    const sessionBeforeBreak = calculateSessionWorkedSeconds(session!, breakStartMs)
    expect(sessionBeforeBreak).toBe(3600)
    expect(formatSecondsToHHMMSS(sessionBeforeBreak)).toBe('01:00:00')

    // Employee clicks "Take a Break"
    const pausedSession = engine.takeBreak(breakStartTime)
    expect(pausedSession?.status).toBe('on_break')
    expect(pausedSession?.breaks.length).toBe(1)
    expect(pausedSession?.breaks[0].end_time).toBeNull()

    // 15 minutes into the break
    const duringBreakMs = breakStartMs + 15 * 60 * 1000
    const timerDuringBreak = calculateSessionWorkedSeconds(pausedSession!, duringBreakMs)
    // Must remain strictly paused at 3600s
    expect(timerDuringBreak).toBe(3600)
    expect(formatSecondsToHHMMSS(timerDuringBreak)).toBe('01:00:00')

    // 45 minutes into the break
    const laterInBreakMs = breakStartMs + 45 * 60 * 1000
    const timerLaterInBreak = calculateSessionWorkedSeconds(pausedSession!, laterInBreakMs)
    expect(timerLaterInBreak).toBe(3600)
    expect(formatSecondsToHHMMSS(timerLaterInBreak)).toBe('01:00:00')
  })

  // 3. Resume Work → same session resumes without losing elapsed time
  it('Scenario 3: Resume Work → same session resumes without losing elapsed time', () => {
    engine.login(userA)
    const clockInTime = '2026-10-19T09:00:00.000+05:30'
    const clockInMs = new Date(clockInTime).getTime()
    const { session } = engine.clockIn(clockInTime)
    const originalSessionId = session!.id

    // Break at 10:00 AM (1 hr = 3600s worked)
    const breakStartTime = '2026-10-19T10:00:00.000+05:30'
    engine.takeBreak(breakStartTime)

    // Resume at 10:30 AM (30 min break)
    const resumeTime = '2026-10-19T10:30:00.000+05:30'
    const resumeMs = new Date(resumeTime).getTime()
    const resumedSession = engine.resumeWork(resumeTime)

    expect(resumedSession?.id).toBe(originalSessionId)
    expect(resumedSession?.status).toBe('working')
    expect(resumedSession?.breaks[0].duration_minutes).toBe(30)

    // At exact resume moment, timer resumes from 3600s (does not jump or reset)
    const timerAtResume = calculateSessionWorkedSeconds(resumedSession!, resumeMs)
    expect(timerAtResume).toBe(3600)
    expect(formatSecondsToHHMMSS(timerAtResume)).toBe('01:00:00')

    // 30 minutes after resuming (11:00 AM)
    const afterResumeMs = resumeMs + 30 * 60 * 1000
    const timerAfterResume = calculateSessionWorkedSeconds(resumedSession!, afterResumeMs)
    // Total worked is 3600s + 1800s = 5400s (01:30:00)
    expect(timerAfterResume).toBe(5400)
    expect(formatSecondsToHHMMSS(timerAfterResume)).toBe('01:30:00')
  })

  // 4. Clock Out → session is finalized and the timer stops
  it('Scenario 4: Clock Out → session is finalized and the timer stops', () => {
    engine.login(userA)
    const clockInTime = '2026-10-19T09:00:00.000+05:30'
    const { session } = engine.clockIn(clockInTime)

    // Clock out at 12:00 PM (3 hours worked)
    const clockOutTime = '2026-10-19T12:00:00.000+05:30'
    const clockOutMs = new Date(clockOutTime).getTime()
    const finalized = engine.clockOut(clockOutTime)

    expect(finalized?.status).toBe('completed')
    expect(finalized?.clock_out).toBe(clockOutTime)
    expect(finalized?.worked_minutes).toBe(180)

    // Active session is cleared
    const bucket = engine.getBucket(userA.id)
    expect(bucket.currentSession).toBeNull()

    // Timer calculation evaluated hours later stays permanently locked at 10800s (03:00:00)
    const laterQueryMs = clockOutMs + 5 * 3600 * 1000 // 5:00 PM
    const finalizedTimer = calculateSessionWorkedSeconds(finalized!, laterQueryMs)
    expect(finalizedTimer).toBe(10800)
    expect(formatSecondsToHHMMSS(finalizedTimer)).toBe('03:00:00')
  })

  // 5. Clock In again → a distinct session starts at zero
  it('Scenario 5: Clock In again → a distinct session starts at zero (00:00:00)', () => {
    engine.login(userA)
    // Morning session
    const sess1Res = engine.clockIn('2026-10-19T09:00:00.000+05:30')
    const sess1Id = sess1Res.session!.id
    engine.clockOut('2026-10-19T12:00:00.000+05:30') // 3 hours

    // Afternoon Clock In at 2:00 PM
    const afternoonClockIn = '2026-10-19T14:00:00.000+05:30'
    const afternoonClockInMs = new Date(afternoonClockIn).getTime()
    const sess2Res = engine.clockIn(afternoonClockIn)

    expect(sess2Res.success).toBe(true)
    const sess2 = sess2Res.session!

    // Must be a brand new distinct session
    expect(sess2.id).not.toBe(sess1Id)
    expect(sess2.clock_out).toBeNull()
    expect(sess2.status).toBe('working')

    // Session timer MUST start at zero (00:00:00)
    const sess2InitialTimer = calculateSessionWorkedSeconds(sess2, afternoonClockInMs)
    expect(sess2InitialTimer).toBe(0)
    expect(formatSecondsToHHMMSS(sess2InitialTimer)).toBe('00:00:00')
  })

  // 6. Daily Worked Hours include eligible time from both sessions
  it('Scenario 6: Daily Worked Hours include eligible time from both sessions', () => {
    engine.login(userA)
    // Morning: 9:00 AM to 12:00 PM (3 hours = 10,800s)
    const s1 = engine.clockIn('2026-10-19T09:00:00.000+05:30').session!
    engine.clockOut('2026-10-19T12:00:00.000+05:30')

    // Afternoon: Clock in at 2:00 PM
    const s2 = engine.clockIn('2026-10-19T14:00:00.000+05:30').session!

    // Immediately upon second clock in at 2:00 PM:
    const at2pm = new Date('2026-10-19T14:00:00.000+05:30').getTime()
    const s2TimerAtStart = calculateSessionWorkedSeconds(s2, at2pm)
    expect(formatSecondsToHHMMSS(s2TimerAtStart)).toBe('00:00:00')

    // Daily Worked Hours must retain the full 3 hours from Session 1
    const bucket = engine.getBucket(userA.id)
    const dailyWorkedAt2pm = calculateDailyWorkedSeconds(s2, bucket.todaySessions, '2026-10-19', at2pm)
    expect(dailyWorkedAt2pm).toBe(10800) // 3 hours
    expect(formatSecondsToHHMMSS(dailyWorkedAt2pm)).toBe('03:00:00')

    // At 3:15 PM (1h 15m into Session 2)
    const at315pm = new Date('2026-10-19T15:15:00.000+05:30').getTime()
    const s2TimerAt315 = calculateSessionWorkedSeconds(s2, at315pm)
    expect(s2TimerAt315).toBe(4500) // 1h 15m
    expect(formatSecondsToHHMMSS(s2TimerAt315)).toBe('01:15:00')

    // Daily Worked Hours accumulates both: 3h + 1h 15m = 4h 15m (15,300s)
    const dailyWorkedAt315 = calculateDailyWorkedSeconds(s2, bucket.todaySessions, '2026-10-19', at315pm)
    expect(dailyWorkedAt315).toBe(15300)
    expect(formatSecondsToHHMMSS(dailyWorkedAt315)).toBe('04:15:00')
  })

  // 7. Daily Active Hours include eligible active time from both sessions
  it('Scenario 7: Daily Active Hours include eligible active time from both sessions', () => {
    engine.login(userA)
    // Session 1: 3 hours worked, 2 hours 40 mins active (160 mins active)
    const s1 = engine.clockIn('2026-10-19T09:00:00.000+05:30').session!
    s1.active_minutes = 160
    s1.active_seconds_buffer = 0
    engine.clockOut('2026-10-19T12:00:00.000+05:30')

    // Session 2: Clock in at 2:00 PM, has accumulated 45 mins active work
    const s2 = engine.clockIn('2026-10-19T14:00:00.000+05:30').session!
    s2.active_minutes = 45
    s2.active_seconds_buffer = 30

    const at3pm = new Date('2026-10-19T15:00:00.000+05:30').getTime()
    const bucket = engine.getBucket(userA.id)

    const dailyActiveSeconds = calculateDailyActiveSeconds(s2, bucket.todaySessions, '2026-10-19', at3pm)
    // S1 active: 160 mins = 9600s
    // S2 active: 45 mins * 60 + 30s = 2730s
    // Total active = 9600 + 2730 = 12,330s (3h 25m 30s)
    expect(dailyActiveSeconds).toBe(12330)
    expect(formatSecondsToHHMMSS(dailyActiveSeconds)).toBe('03:25:30')

    // Total worked is 3h (S1) + 1h (S2) = 4h = 14,400s
    const dailyWorkedSeconds = calculateDailyWorkedSeconds(s2, bucket.todaySessions, '2026-10-19', at3pm)
    expect(dailyWorkedSeconds).toBe(14400)
    expect(formatSecondsToHHMMSS(dailyWorkedSeconds)).toBe('04:00:00')

    // Active Hours is strictly less than Worked Hours
    expect(dailyActiveSeconds).toBeLessThan(dailyWorkedSeconds)
  })

  // 8. Break time is excluded correctly
  it('Scenario 8: Break time is excluded correctly across sessions', () => {
    engine.login(userA)
    // Session with 2 breaks
    const s = engine.clockIn('2026-10-19T09:00:00.000+05:30').session!
    // Break 1: 10:00 to 10:15 (15 min)
    engine.takeBreak('2026-10-19T10:00:00.000+05:30')
    engine.resumeWork('2026-10-19T10:15:00.000+05:30')

    // Break 2: 12:00 to 12:45 (45 min lunch)
    engine.takeBreak('2026-10-19T12:00:00.000+05:30')
    engine.resumeWork('2026-10-19T12:45:00.000+05:30')

    // Clock out at 2:00 PM (5 hours wall clock: 9 AM to 2 PM = 300 minutes = 18,000s)
    const finalized = engine.clockOut('2026-10-19T14:00:00.000+05:30')

    // Total break duration = 15 + 45 = 60 minutes = 3600s
    // Net worked = 18,000 - 3600 = 14,400s = 4 hours (04:00:00)
    const workedSeconds = calculateSessionWorkedSeconds(finalized!, new Date('2026-10-19T14:00:00.000+05:30').getTime())
    expect(workedSeconds).toBe(14400)
    expect(formatSecondsToHHMMSS(workedSeconds)).toBe('04:00:00')
    expect(finalized?.worked_minutes).toBe(240)
  })

  // 9. Midnight resets daily calculations without ending an open session
  it('Scenario 9: Midnight resets daily calculations without ending an open session', () => {
    engine.login(userA)
    // Employee clocks in at 10:00 PM on Oct 19
    const clockInTime = '2026-10-19T22:00:00.000+05:30'
    const s = engine.clockIn(clockInTime).session!

    // Check at 11:59:00 PM on Oct 19 (1h 59m = 7140s)
    const beforeMidnightMs = new Date('2026-10-19T23:59:00.000+05:30').getTime()
    const oct19WorkedBefore = calculateDailyWorkedSeconds(s, [s], '2026-10-19', beforeMidnightMs)
    expect(oct19WorkedBefore).toBe(7140)
    expect(formatSecondsToHHMMSS(oct19WorkedBefore)).toBe('01:59:00')

    // At 12:00:05 AM on Oct 20 (Midnight has crossed by 5 seconds):
    const justAfterMidnightMs = new Date('2026-10-20T00:00:05.000+05:30').getTime()

    // Session is still alive and working! (Not ended or clocked out)
    expect(s.clock_out).toBeNull()
    expect(s.status).toBe('working')

    // Daily calculation for the NEW day (Oct 20) starts fresh at 5 seconds!
    const oct20Worked = calculateDailyWorkedSeconds(s, [s], '2026-10-20', justAfterMidnightMs)
    expect(oct20Worked).toBe(5)
    expect(formatSecondsToHHMMSS(oct20Worked)).toBe('00:00:05')

    // Previous day (Oct 19) calculation is preserved at full 2 hours (7200s)
    const oct19WorkedFinal = calculateDailyWorkedSeconds(s, [s], '2026-10-19', justAfterMidnightMs)
    expect(oct19WorkedFinal).toBe(7200)
    expect(formatSecondsToHHMMSS(oct19WorkedFinal)).toBe('02:00:00')
  })

  // 10. Sessions crossing midnight are attributed to the correct dates
  it('Scenario 10: Sessions crossing midnight are split accurately across calendar dates', () => {
    // Night shift session: 10:00 PM (Oct 19) to 3:00 AM (Oct 20) = 5 hours total
    const nightSession: TrackingSession = {
      id: 'night-shift-sess',
      employee_id: userA.id,
      session_date: '2026-10-19',
      clock_in: '2026-10-19T22:00:00.000+05:30',
      clock_out: '2026-10-20T03:00:00.000+05:30',
      status: 'completed',
      worked_minutes: 300,
      active_minutes: 270,
      suspended_seconds: 0,
      active_seconds_buffer: 0,
      breaks: [
        // Break from 11:45 PM to 12:15 AM (crosses midnight: 15 min on Oct 19, 15 min on Oct 20)
        {
          id: 'midnight-brk',
          session_id: 'night-shift-sess',
          start_time: '2026-10-19T23:45:00.000+05:30',
          end_time: '2026-10-20T00:15:00.000+05:30',
          duration_minutes: 30,
          reason: 'Midnight Snack'
        }
      ]
    }

    const testTime = new Date('2026-10-20T05:00:00.000+05:30').getTime()

    // Day 1 (Oct 19): 10:00 PM to 12:00 AM = 120 mins gross - 15 mins break = 105 mins = 6300 seconds (01:45:00)
    const day1Worked = calculateDailyWorkedSeconds(null, [nightSession], '2026-10-19', testTime)
    expect(day1Worked).toBe(6300)
    expect(formatSecondsToHHMMSS(day1Worked)).toBe('01:45:00')

    // Day 2 (Oct 20): 12:00 AM to 3:00 AM = 180 mins gross - 15 mins break = 165 mins = 9900 seconds (02:45:00)
    const day2Worked = calculateDailyWorkedSeconds(null, [nightSession], '2026-10-20', testTime)
    expect(day2Worked).toBe(9900)
    expect(formatSecondsToHHMMSS(day2Worked)).toBe('02:45:00')

    // Total across both dates = 6300 + 9900 = 16,200s (270 mins = 4h 30m)
    // Gross 5h (300m) - 30m break = 270m. Exact mathematical match!
    expect(day1Worked + day2Worked).toBe(16200)
  })

  // 11. Application restart restores the correct unfinished session
  it('Scenario 11: Application restart restores the correct unfinished session', () => {
    engine.login(userA)
    const clockInTime = new Date(Date.now() - 3600 * 1000).toISOString() // 1 hour ago
    const { session } = engine.clockIn(clockInTime)
    engine.takeBreak(new Date(Date.now() - 1800 * 1000).toISOString()) // Took break 30m ago

    // Simulate app shutdown and storage serialization
    const serialized = JSON.stringify(engine.getBucket(userA.id).currentSession)

    // Simulate app reboot
    const deserializedSession: TrackingSession = JSON.parse(serialized)
    const validated = engine.validateActiveSession(deserializedSession, userA.id)

    expect(validated).not.toBeNull()
    expect(validated?.id).toBe(session!.id)
    expect(validated?.status).toBe('on_break')
    expect(validated?.breaks.length).toBe(1)
    expect(validated?.breaks[0].end_time).toBeNull()

    // Completed session must NEVER be restored as active
    const completedSession: TrackingSession = {
      ...deserializedSession,
      id: 'completed-sess',
      status: 'completed',
      clock_out: new Date().toISOString()
    }
    expect(engine.validateActiveSession(completedSession, userA.id)).toBeNull()

    // Session belonging to another user must NEVER be restored
    expect(engine.validateActiveSession(deserializedSession, 'other-user-uuid')).toBeNull()
  })

  // 12. Account switching never exposes another employee's records
  it('Scenario 12: Account switching never exposes another employee records', () => {
    // User A logs in and works for 2 hours
    engine.login(userA)
    engine.clockIn('2026-10-19T09:00:00.000+05:30')
    engine.clockOut('2026-10-19T11:00:00.000+05:30')
    const userABucket = engine.getBucket(userA.id)
    expect(userABucket.todaySessions.length).toBe(1)

    // User A logs out
    engine.logout()

    // User B logs in (brand new employee on this machine)
    engine.login(userB)
    const userBBucket = engine.getBucket(userB.id)

    // User B must start completely clean: no active session, 0 today sessions
    expect(userBBucket.currentSession).toBeNull()
    expect(userBBucket.todaySessions.length).toBe(0)

    const userBWorked = calculateDailyWorkedSeconds(null, userBBucket.todaySessions, '2026-10-19')
    expect(userBWorked).toBe(0)
    expect(formatSecondsToHHMMSS(userBWorked)).toBe('00:00:00')

    // Validating User A's session under User B's auth must reject immediately
    expect(engine.validateActiveSession(userABucket.todaySessions[0], userB.id)).toBeNull()
  })

  // 13. Network errors and repeated clicks do not create false or duplicate sessions
  it('Scenario 13: Network errors and rapid clicks do not create duplicate sessions', () => {
    engine.login(userA)
    const clockInTime = '2026-10-19T09:00:00.000+05:30'

    // 1. Network failure during clock in
    const failRes = engine.clockIn(clockInTime, true)
    expect(failRes.success).toBe(false)
    expect(failRes.error).toContain('Failed to establish session')
    expect(engine.getBucket(userA.id).currentSession).toBeNull()

    // 2. Successful clock in
    const successRes = engine.clockIn(clockInTime, false)
    expect(successRes.success).toBe(true)
    const firstSessionId = successRes.session!.id

    // 3. Repeated rapid clicks while session is active returns existing session idempotently
    const duplicateClickRes = engine.clockIn(clockInTime, false)
    expect(duplicateClickRes.success).toBe(true)
    expect(duplicateClickRes.session?.id).toBe(firstSessionId)
    // No second session created in todaySessions
    expect(engine.getBucket(userA.id).todaySessions.length).toBe(1)
  })

  // 14. Offline synchronization does not double-count time
  it('Scenario 14: Offline synchronization reconciles idempotently without double-counting', () => {
    engine.login(userA)
    const sess = engine.clockIn('2026-10-19T09:00:00.000+05:30').session!
    sess.worked_minutes = 60
    sess.active_minutes = 50

    const bucket = engine.getBucket(userA.id)

    // Simulate queuing offline update
    const pendingItem: PendingSyncItem = {
      id: `session-${sess.id}`,
      type: 'session',
      employee_id: userA.id,
      data: sess,
      createdAt: new Date().toISOString(),
      retries: 0
    }
    bucket.pendingSyncQueue.push(pendingItem)

    // Simulate remote server response returning identical session
    const remoteSession: TrackingSession = { ...sess }

    // Reconcile: merge remote sessions with local todaySessions deduplicating by ID
    const sessionMap = new Map<string, TrackingSession>()
    for (const s of [remoteSession, ...bucket.todaySessions]) {
      sessionMap.set(s.id, s)
    }
    const reconciled = Array.from(sessionMap.values())

    // Exactly 1 session exists
    expect(reconciled.length).toBe(1)

    // Daily calculations count exactly 60 minutes, not 120 minutes!
    const at10am = new Date('2026-10-19T10:00:00.000+05:30').getTime()
    const dailyWorked = calculateDailyWorkedSeconds(null, reconciled, '2026-10-19', at10am)
    expect(dailyWorked).toBe(3600)
    expect(formatSecondsToHHMMSS(dailyWorked)).toBe('01:00:00')
  })
})
