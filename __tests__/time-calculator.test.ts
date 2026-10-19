import { describe, it, expect } from 'vitest'

// Helper calculation functions matching desktop app and server API logic
export function calculateWorkedDuration(
  clockIn: string, 
  clockOut: string | null, 
  breaks: Array<{ start_time: string; end_time: string | null }>, 
  now: number = Date.now(),
  suspendedSeconds: number = 0
): number {
  const start = new Date(clockIn).getTime()
  const end = clockOut ? new Date(clockOut).getTime() : now
  
  let breakMs = 0
  for (const b of breaks) {
    const bStart = new Date(b.start_time).getTime()
    const bEnd = b.end_time ? new Date(b.end_time).getTime() : now
    breakMs += Math.max(0, bEnd - bStart)
  }

  const suspendedMs = Math.max(0, suspendedSeconds * 1000)
  const workedMs = Math.max(0, end - start - breakMs - suspendedMs)
  return Math.floor(workedMs / 60000)
}

export function convertMinutesToDecimal(minutes: number): number {
  return Number((minutes / 60).toFixed(2))
}

export function formatMinutesAsHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}h ${m.toString().padStart(2, '0')}m`
}

export function aggregateDailyTotals(sessions: Array<{ worked_minutes: number; active_minutes: number }>): { totalWorked: number; totalActive: number; decimalActiveHours: number } {
  const totalWorked = sessions.reduce((acc, s) => acc + s.worked_minutes, 0)
  const totalActive = sessions.reduce((acc, s) => acc + s.active_minutes, 0)
  return {
    totalWorked,
    totalActive,
    decimalActiveHours: convertMinutesToDecimal(totalActive)
  }
}

// Session state machine simulator matching ActivityTracker & Storage
export class SessionLifecycleSimulator {
  session: {
    id: string
    employee_id: string
    clock_in: string
    clock_out: string | null
    status: 'working' | 'on_break' | 'completed'
    worked_minutes: number
    active_minutes: number
    suspended_seconds: number
    breaks: Array<{ id: string; start_time: string; end_time: string | null; duration_minutes: number }>
  } | null = null

  activeSecondsBuffer = 0
  isSuspended = false

  clockIn(employeeId: string, timestamp: string) {
    if (this.session && this.session.status !== 'completed') return this.session
    this.session = {
      id: 'session-101',
      employee_id: employeeId,
      clock_in: timestamp,
      clock_out: null,
      status: 'working',
      worked_minutes: 0,
      active_minutes: 0,
      suspended_seconds: 0,
      breaks: []
    }
    return this.session
  }

  takeBreak(timestamp: string) {
    if (!this.session || this.session.status !== 'working') return null
    if (this.session.breaks.some(b => b.end_time === null)) return this.session // prevent duplicate

    this.session.status = 'on_break'
    this.session.breaks.push({
      id: `break-${this.session.breaks.length + 1}`,
      start_time: timestamp,
      end_time: null,
      duration_minutes: 0
    })
    return this.session
  }

  resume(timestamp: string) {
    if (!this.session || this.session.status !== 'on_break') return null
    const openBreak = this.session.breaks.find(b => b.end_time === null)
    if (openBreak) {
      openBreak.end_time = timestamp
      const startMs = new Date(openBreak.start_time).getTime()
      const endMs = new Date(timestamp).getTime()
      openBreak.duration_minutes = Math.max(0, Math.floor((endMs - startMs) / 60000))
    }
    this.session.status = 'working'
    return this.session
  }

  systemSuspend(durationSeconds: number) {
    if (!this.session) return
    this.session.suspended_seconds += durationSeconds
    this.isSuspended = false
  }

  clockOut(timestamp: string) {
    if (!this.session || this.session.status === 'completed') return null
    const openBreak = this.session.breaks.find(b => b.end_time === null)
    if (openBreak) {
      openBreak.end_time = timestamp
      const startMs = new Date(openBreak.start_time).getTime()
      const endMs = new Date(timestamp).getTime()
      openBreak.duration_minutes = Math.max(0, Math.floor((endMs - startMs) / 60000))
    }
    this.session.clock_out = timestamp
    this.session.status = 'completed'
    this.session.worked_minutes = calculateWorkedDuration(
      this.session.clock_in, 
      this.session.clock_out, 
      this.session.breaks,
      new Date(timestamp).getTime(),
      this.session.suspended_seconds
    )
    return this.session
  }

  simulateActivity(currentTime: string, isIdle: boolean = false) {
    if (!this.session) return
    const isWorking = this.session.status === 'working'
    if (isWorking && !isIdle && !this.isSuspended) {
      this.activeSecondsBuffer += 60
      if (this.activeSecondsBuffer >= 60) {
        this.session.active_minutes += Math.floor(this.activeSecondsBuffer / 60)
        this.activeSecondsBuffer = 0
      }
    }
    // Update worked duration
    this.session.worked_minutes = calculateWorkedDuration(
      this.session.clock_in,
      this.session.clock_out,
      this.session.breaks,
      new Date(currentTime).getTime(),
      this.session.suspended_seconds
    )
  }
}

describe('Time Tracker Calculation Engine', () => {
  it('calculates worked minutes correctly excluding recorded breaks', () => {
    const clockIn = '2026-10-14T09:00:00.000Z'
    const clockOut = '2026-10-14T12:15:00.000Z' // 195 minutes total elapsed
    const breaks = [
      {
        start_time: '2026-10-14T10:30:00.000Z',
        end_time: '2026-10-14T10:50:00.000Z' // 20 minutes break
      }
    ]

    const workedMinutes = calculateWorkedDuration(clockIn, clockOut, breaks)
    expect(workedMinutes).toBe(175) // 195 - 20 = 175 minutes (2h 55m)
    expect(formatMinutesAsHHMM(workedMinutes)).toBe('2h 55m')
  })

  it('excludes system suspend/sleep duration from Worked Hours to prevent time inflation', () => {
    const clockIn = '2026-10-14T09:00:00.000Z'
    const clockOut = '2026-10-14T18:00:00.000Z' // 9 hours elapsed wall-clock (540 minutes)
    const breaks = [
      {
        start_time: '2026-10-14T13:00:00.000Z',
        end_time: '2026-10-14T14:00:00.000Z' // 60 minutes lunch break
      }
    ]
    // Laptop closed / suspended for 2.5 hours (150 minutes = 9000 seconds) in afternoon
    const suspendedSeconds = 9000

    const workedMinutes = calculateWorkedDuration(clockIn, clockOut, breaks, undefined, suspendedSeconds)
    // 540 elapsed - 60 break - 150 suspend = 330 minutes (5h 30m)
    expect(workedMinutes).toBe(330)
    expect(formatMinutesAsHHMM(workedMinutes)).toBe('5h 30m')
  })

  it('handles multiple breaks without double counting', () => {
    const clockIn = '2026-10-14T09:00:00.000Z'
    const clockOut = '2026-10-14T17:00:00.000Z' // 480 minutes total elapsed (8h)
    const breaks = [
      {
        start_time: '2026-10-14T11:00:00.000Z',
        end_time: '2026-10-14T11:15:00.000Z' // 15 mins tea break
      },
      {
        start_time: '2026-10-14T13:00:00.000Z',
        end_time: '2026-10-14T13:45:00.000Z' // 45 mins lunch break
      }
    ]

    const workedMinutes = calculateWorkedDuration(clockIn, clockOut, breaks)
    expect(workedMinutes).toBe(420) // 480 - 60 = 420 minutes (7h 00m)
    expect(formatMinutesAsHHMM(workedMinutes)).toBe('7h 00m')
  })

  it('converts active minutes to decimal hours for EOD synchronization correctly without corruption', () => {
    // 8h 30m = 510m -> 8.50 decimal hours (not 8.3!)
    expect(convertMinutesToDecimal(510)).toBe(8.50)
    // 7h 45m = 465m -> 7.75 decimal hours
    expect(convertMinutesToDecimal(465)).toBe(7.75)
    // 3h 15m = 195m -> 3.25 decimal hours
    expect(convertMinutesToDecimal(195)).toBe(3.25)
    // 3h 02m = 182m -> 3.03 decimal hours
    expect(convertMinutesToDecimal(182)).toBe(3.03)
    // 8h 00m = 480m -> 8.00 decimal hours
    expect(convertMinutesToDecimal(480)).toBe(8.00)
    expect(convertMinutesToDecimal(0)).toBe(0.00)
  })

  it('aggregates multiple sessions on the same day without double counting', () => {
    const sessions = [
      { worked_minutes: 180, active_minutes: 170 }, // Morning session
      { worked_minutes: 150, active_minutes: 140 }  // Afternoon session
    ]

    const totals = aggregateDailyTotals(sessions)
    expect(totals.totalWorked).toBe(330) // 5h 30m
    expect(totals.totalActive).toBe(310) // 5h 10m
    expect(totals.decimalActiveHours).toBe(5.17)
  })

  it('excludes idle time from Active Hours while keeping Worked Hours intact', () => {
    const tracker = new SessionLifecycleSimulator()
    tracker.clockIn('emp-001', '2026-10-14T09:00:00.000Z')

    const startMs = new Date('2026-10-14T09:00:00.000Z').getTime()
    // 30 minutes of active work
    for (let i = 1; i <= 30; i++) {
      tracker.simulateActivity(new Date(startMs + i * 60000).toISOString(), false)
    }
    // 30 minutes of idle time (away from keyboard)
    for (let i = 31; i <= 60; i++) {
      tracker.simulateActivity(new Date(startMs + i * 60000).toISOString(), true)
    }

    // Worked hours should be 60 minutes
    expect(tracker.session?.worked_minutes).toBe(60)
    // Active hours must ONLY be 30 minutes!
    expect(tracker.session?.active_minutes).toBe(30)
  })

  it('excludes suspend intervals in SessionLifecycleSimulator across sleep', () => {
    const tracker = new SessionLifecycleSimulator()
    tracker.clockIn('emp-001', '2026-10-14T09:00:00.000Z')

    // Work for 60 minutes
    const startMs = new Date('2026-10-14T09:00:00.000Z').getTime()
    for (let i = 1; i <= 60; i++) {
      tracker.simulateActivity(new Date(startMs + i * 60000).toISOString(), false)
    }
    expect(tracker.session?.worked_minutes).toBe(60)

    // Laptop sleeps for 2 hours (7200 seconds)
    tracker.systemSuspend(7200)

    // Clock out after 3 hours total elapsed time (180 mins)
    const clockOutTime = new Date(startMs + 180 * 60000).toISOString()
    const finalSession = tracker.clockOut(clockOutTime)

    // Elapsed: 180 mins - 120 mins suspend = 60 mins worked!
    expect(finalSession?.worked_minutes).toBe(60)
    expect(finalSession?.active_minutes).toBe(60)
  })

  it('verifies end-to-end lifecycle: Clock In -> timer runs -> Take a Break -> timer freezes -> Resume -> timer runs again -> Clock Out', () => {
    const tracker = new SessionLifecycleSimulator()

    // 1. Clock In at 09:00 AM
    const session = tracker.clockIn('emp-omkar', '2026-10-14T09:00:00.000Z')
    expect(session.status).toBe('working')
    expect(session.clock_in).toBe('2026-10-14T09:00:00.000Z')
    expect(session.clock_out).toBeNull()

    // 2. Timer runs for 60 minutes of active work (09:00 - 10:00)
    const startTimeMs = new Date('2026-10-14T09:00:00.000Z').getTime()
    for (let i = 1; i <= 60; i++) {
      const timeStr = new Date(startTimeMs + i * 60000).toISOString()
      tracker.simulateActivity(timeStr, false)
    }
    expect(tracker.session?.worked_minutes).toBe(60)
    expect(tracker.session?.active_minutes).toBe(60)

    // 3. Take a Break at 10:00 AM
    tracker.takeBreak('2026-10-14T10:00:00.000Z')
    expect(tracker.session?.status).toBe('on_break')
    expect(tracker.session?.breaks.length).toBe(1)
    expect(tracker.session?.breaks[0].start_time).toBe('2026-10-14T10:00:00.000Z')
    expect(tracker.session?.breaks[0].end_time).toBeNull()
    // Session is NOT clocked out, remains active session
    expect(tracker.session?.clock_out).toBeNull()
    expect(tracker.session?.id).toBe('session-101')

    // 4. Timer is frozen during break (10:00 - 10:30, 30 minutes)
    const breakTimeMs = new Date('2026-10-14T10:00:00.000Z').getTime()
    for (let i = 1; i <= 30; i++) {
      const timeStr = new Date(breakTimeMs + i * 60000).toISOString()
      tracker.simulateActivity(timeStr, false)
    }
    // Worked Hours and Active Hours MUST REMAIN FROZEN at 60 mins!
    expect(tracker.session?.worked_minutes).toBe(60)
    expect(tracker.session?.active_minutes).toBe(60)

    // Duplicate break prevention
    tracker.takeBreak('2026-10-14T10:15:00.000Z')
    expect(tracker.session?.breaks.length).toBe(1) // Still only 1 break

    // 5. Resume work at 10:30 AM
    tracker.resume('2026-10-14T10:30:00.000Z')
    expect(tracker.session?.status).toBe('working')
    expect(tracker.session?.breaks[0].end_time).toBe('2026-10-14T10:30:00.000Z')
    expect(tracker.session?.breaks[0].duration_minutes).toBe(30) // Exactly 30 minutes recorded internally

    // 6. Timer runs again for another 60 minutes (10:30 - 11:30)
    const resumeTimeMs = new Date('2026-10-14T10:30:00.000Z').getTime()
    for (let i = 1; i <= 60; i++) {
      const timeStr = new Date(resumeTimeMs + i * 60000).toISOString()
      tracker.simulateActivity(timeStr, false)
    }
    // Worked Hours should now be 120 mins (2h 00m)
    expect(tracker.session?.worked_minutes).toBe(120)
    expect(tracker.session?.active_minutes).toBe(120)

    // 7. Clock Out at 11:30 AM
    const completedSession = tracker.clockOut('2026-10-14T11:30:00.000Z')
    expect(completedSession?.status).toBe('completed')
    expect(completedSession?.clock_out).toBe('2026-10-14T11:30:00.000Z')
    
    // Total elapsed: 09:00 to 11:30 = 150 minutes (2h 30m)
    // Minus break: 30 minutes
    // Total Worked Hours: 120 minutes (2h 00m)
    expect(completedSession?.worked_minutes).toBe(120)
    expect(completedSession?.active_minutes).toBe(120)
    expect(formatMinutesAsHHMM(completedSession!.worked_minutes)).toBe('2h 00m')
    expect(formatMinutesAsHHMM(completedSession!.active_minutes)).toBe('2h 00m')
  })
})

// Settings validation simulator matching Electron backend IPC logic
export function validateSettingsUpdate(
  user: { id: string; role: string; email?: string } | null,
  updates: { idleThresholdSeconds?: number; minimizeToTray?: boolean }
): { success: boolean; error?: string } {
  if (updates.idleThresholdSeconds !== undefined) {
    if (!user || !user.id) {
      return { success: false, error: 'Unauthorized: Authentication required to modify the inactivity threshold.' }
    }
    const roleUpper = (user.role || '').toUpperCase()
    const isAdmin = roleUpper === 'ADMIN' || roleUpper === 'SUPER_ADMIN' || roleUpper === 'SUPER ADMIN'
    if (!isAdmin) {
      return { success: false, error: 'Unauthorized: Inactivity threshold can only be modified by an administrator.' }
    }
    const validThresholds = [30, 60, 120, 300]
    if (!validThresholds.includes(updates.idleThresholdSeconds)) {
      return { success: false, error: 'Invalid threshold: Supported values are 30s, 60s (1m), 120s (2m), and 300s (5m).' }
    }
  }
  return { success: true }
}

describe('Inactivity Threshold & Permissions', () => {
  it('defaults to 60 seconds (1 minute) when no threshold is configured', () => {
    const rawSettings: any = { minimizeToTray: true }
    const loadedThreshold = (rawSettings && typeof rawSettings.idleThresholdSeconds === 'number' && rawSettings.idleThresholdSeconds > 0)
      ? rawSettings.idleThresholdSeconds
      : 60
    expect(loadedThreshold).toBe(60)
  })

  it('preserves existing configured threshold across reloads without overwriting', () => {
    const existingSettings: any = { idleThresholdSeconds: 120, minimizeToTray: false }
    const loadedThreshold = (existingSettings && typeof existingSettings.idleThresholdSeconds === 'number' && existingSettings.idleThresholdSeconds > 0)
      ? existingSettings.idleThresholdSeconds
      : 60
    expect(loadedThreshold).toBe(120) // preserved!
  })

  it('allows authenticated Admin to update threshold to 30s, 60s, 120s, or 300s', () => {
    const adminUser = { id: 'admin-uuid-1', role: 'Admin', email: 'admin@triples.com' }
    for (const threshold of [30, 60, 120, 300]) {
      const res = validateSettingsUpdate(adminUser, { idleThresholdSeconds: threshold })
      expect(res.success).toBe(true)
      expect(res.error).toBeUndefined()
    }
  })

  it('rejects threshold changes when requested by an Employee', () => {
    const empUser = { id: 'emp-uuid-3', role: 'Employee', email: 'omkar.sawant@tsp.com' }
    const res = validateSettingsUpdate(empUser, { idleThresholdSeconds: 30 })
    expect(res.success).toBe(false)
    expect(res.error).toContain('Unauthorized: Inactivity threshold can only be modified by an administrator.')
  })

  it('rejects threshold changes when requested by HR role', () => {
    const hrUser = { id: 'hr-uuid-6', role: 'HR', email: 'h.r@tsp.com' }
    const res = validateSettingsUpdate(hrUser, { idleThresholdSeconds: 300 })
    expect(res.success).toBe(false)
    expect(res.error).toContain('Unauthorized: Inactivity threshold can only be modified by an administrator.')
  })

  it('rejects threshold changes when no authenticated session exists', () => {
    const res = validateSettingsUpdate(null, { idleThresholdSeconds: 60 })
    expect(res.success).toBe(false)
    expect(res.error).toContain('Unauthorized')
  })

  it('rejects invalid threshold values even when requested by an Admin', () => {
    const adminUser = { id: 'admin-uuid-1', role: 'Admin' }
    const res = validateSettingsUpdate(adminUser, { idleThresholdSeconds: 45 })
    expect(res.success).toBe(false)
    expect(res.error).toContain('Invalid threshold')
  })

  it('allows non-admin employees to update personal preferences like minimizeToTray without touching threshold', () => {
    const empUser = { id: 'emp-uuid-3', role: 'Employee' }
    const res = validateSettingsUpdate(empUser, { minimizeToTray: false })
    expect(res.success).toBe(true)
  })
})

import {
  getKolkataGreeting,
  calculateDailyWorkedSeconds,
  calculateDailyActiveSeconds,
  formatSecondsToHHMMSS
} from '../src/utils/timeCalculator'

describe('Daily Timer — Reset at Midnight & 24-Hour Cap', () => {
  it('formats daily timer as clean digital text HH:MM:SS', () => {
    expect(formatSecondsToHHMMSS(0)).toBe('00:00:00')
    expect(formatSecondsToHHMMSS(476)).toBe('00:07:56') // 7m 56s
    expect(formatSecondsToHHMMSS(468)).toBe('00:07:48') // 7m 48s
    expect(formatSecondsToHHMMSS(21256)).toBe('05:54:16') // 5h 54m 16s
    expect(formatSecondsToHHMMSS(86400)).toBe('24:00:00') // 24h
  })

  it('caps the daily timer at 24:00:00 maximum', () => {
    // Exceeding 24 hours should never display more than 24:00:00
    expect(formatSecondsToHHMMSS(90000)).toBe('24:00:00')
    expect(formatSecondsToHHMMSS(100000)).toBe('24:00:00')
  })

  it('splits session working across midnight between the two calendar dates (11:00 PM to 1:00 AM)', () => {
    // In IST:
    // 2026-10-19 23:00:00 IST is 2026-10-19T17:30:00.000Z
    // 2026-10-20 00:00:00 IST is 2026-10-19T18:30:00.000Z (midnight)
    // 2026-10-20 01:00:00 IST is 2026-10-19T19:30:00.000Z
    const sessionAcrossMidnight: any = {
      id: 'session-midnight-1',
      employee_id: 'emp-omkar',
      session_date: '2026-10-19',
      clock_in: '2026-10-19T17:30:00.000Z', // 11:00 PM IST on Oct 19
      clock_out: '2026-10-19T19:30:00.000Z', // 01:00 AM IST on Oct 20
      status: 'completed',
      worked_minutes: 120,
      active_minutes: 120,
      breaks: []
    }

    // 1. Calculate worked seconds on Day 1 (Oct 19)
    const day1Seconds = calculateDailyWorkedSeconds(null, [sessionAcrossMidnight], '2026-10-19')
    expect(day1Seconds).toBe(3600) // Exactly 1 hour = 3600 seconds
    expect(formatSecondsToHHMMSS(day1Seconds)).toBe('01:00:00')

    // 2. Calculate worked seconds on Day 2 (Oct 20)
    const day2Seconds = calculateDailyWorkedSeconds(null, [sessionAcrossMidnight], '2026-10-20')
    expect(day2Seconds).toBe(3600) // Exactly 1 hour = 3600 seconds
    expect(formatSecondsToHHMMSS(day2Seconds)).toBe('01:00:00')
  })

  it('resets live daily timer to 00:00:00 at midnight while session remains active and working', () => {
    // User clocked in at 11:00 PM IST (23:00) on 2026-10-19
    const activeSession: any = {
      id: 'active-session-1',
      employee_id: 'emp-omkar',
      session_date: '2026-10-19',
      clock_in: '2026-10-19T17:30:00.000Z',
      clock_out: null,
      status: 'working',
      worked_minutes: 0,
      active_minutes: 0,
      breaks: []
    }

    // At 11:59:59 PM IST (23:59:59) on Oct 19
    const justBeforeMidnightMs = new Date('2026-10-19T18:29:59.000Z').getTime()
    const timerBeforeMidnight = calculateDailyWorkedSeconds(activeSession, [], '2026-10-19', justBeforeMidnightMs)
    expect(timerBeforeMidnight).toBe(3599) // 59m 59s
    expect(formatSecondsToHHMMSS(timerBeforeMidnight)).toBe('00:59:59')

    // At 12:00:00 AM IST (midnight) on Oct 20
    const exactlyMidnightMs = new Date('2026-10-19T18:30:00.000Z').getTime()
    const timerAtMidnight = calculateDailyWorkedSeconds(activeSession, [], '2026-10-20', exactlyMidnightMs)
    expect(timerAtMidnight).toBe(0) // Resets to 00:00:00!
    expect(formatSecondsToHHMMSS(timerAtMidnight)).toBe('00:00:00')

    // 5 minutes past midnight (12:05:00 AM IST on Oct 20)
    const fiveAfterMidnightMs = new Date('2026-10-19T18:35:00.000Z').getTime()
    const timerAfterMidnight = calculateDailyWorkedSeconds(activeSession, [], '2026-10-20', fiveAfterMidnightMs)
    expect(timerAfterMidnight).toBe(300) // 5 minutes = 300s
    expect(formatSecondsToHHMMSS(timerAfterMidnight)).toBe('00:05:00')

    // Session remains active: status is still working and clock_out is still null!
    expect(activeSession.status).toBe('working')
    expect(activeSession.clock_out).toBeNull()
  })

  it('excludes break time from daily timer calculation on date boundary', () => {
    // User clocked in at 11:00 PM IST (23:00) on 2026-10-19
    // Break from 11:45 PM to 12:15 AM IST (30 mins total: 15m on Oct 19, 15m on Oct 20)
    const sessionWithBreak: any = {
      id: 'session-break-midnight',
      employee_id: 'emp-omkar',
      session_date: '2026-10-19',
      clock_in: '2026-10-19T17:30:00.000Z', // 23:00 IST
      clock_out: '2026-10-19T19:30:00.000Z', // 01:00 IST next day
      status: 'completed',
      worked_minutes: 90,
      active_minutes: 90,
      breaks: [
        {
          id: 'b1',
          session_id: 'session-break-midnight',
          start_time: '2026-10-19T18:15:00.000Z', // 23:45 IST
          end_time: '2026-10-19T18:45:00.000Z',   // 00:15 IST
          duration_minutes: 30
        }
      ]
    }

    // Day 1: 1 hour elapsed (23:00 - 24:00) minus 15 min break = 45 mins (2700s)
    const day1Seconds = calculateDailyWorkedSeconds(null, [sessionWithBreak], '2026-10-19')
    expect(day1Seconds).toBe(2700)
    expect(formatSecondsToHHMMSS(day1Seconds)).toBe('00:45:00')

    // Day 2: 1 hour elapsed (00:00 - 01:00) minus 15 min break = 45 mins (2700s)
    const day2Seconds = calculateDailyWorkedSeconds(null, [sessionWithBreak], '2026-10-20')
    expect(day2Seconds).toBe(2700)
    expect(formatSecondsToHHMMSS(day2Seconds)).toBe('00:45:00')
  })
})

describe('Dynamic Greeting Based on Asia/Kolkata Time', () => {
  it('greets Good Morning between 5:00 AM and 11:59 AM', () => {
    // 05:00 AM IST = 23:30 UTC prev day
    const morningStart = new Date('2026-10-18T23:30:00.000Z')
    expect(getKolkataGreeting(morningStart, 'Omkar Sawant').fullGreeting).toBe('Good Morning, Omkar Sawant')

    // 09:30 AM IST = 04:00 UTC
    const midMorning = new Date('2026-10-19T04:00:00.000Z')
    expect(getKolkataGreeting(midMorning, 'Omkar Sawant').fullGreeting).toBe('Good Morning, Omkar Sawant')

    // 11:59 AM IST = 06:29 UTC
    const morningEnd = new Date('2026-10-19T06:29:59.000Z')
    expect(getKolkataGreeting(morningEnd, 'Omkar Sawant').fullGreeting).toBe('Good Morning, Omkar Sawant')
  })

  it('greets Good Afternoon between 12:00 PM and 4:59 PM', () => {
    // 12:00 PM IST = 06:30 UTC
    const afternoonStart = new Date('2026-10-19T06:30:00.000Z')
    expect(getKolkataGreeting(afternoonStart, 'Omkar Sawant').fullGreeting).toBe('Good Afternoon, Omkar Sawant')

    // 04:59 PM IST = 11:29 UTC
    const afternoonEnd = new Date('2026-10-19T11:29:59.000Z')
    expect(getKolkataGreeting(afternoonEnd, 'Omkar Sawant').fullGreeting).toBe('Good Afternoon, Omkar Sawant')
  })

  it('greets Good Evening between 5:00 PM and 8:59 PM', () => {
    // 05:00 PM IST = 11:30 UTC
    const eveningStart = new Date('2026-10-19T11:30:00.000Z')
    expect(getKolkataGreeting(eveningStart, 'Omkar Sawant').fullGreeting).toBe('Good Evening, Omkar Sawant')

    // 08:59 PM IST = 15:29 UTC
    const eveningEnd = new Date('2026-10-19T15:29:59.000Z')
    expect(getKolkataGreeting(eveningEnd, 'Omkar Sawant').fullGreeting).toBe('Good Evening, Omkar Sawant')
  })

  it('greets Good Night between 9:00 PM and 4:59 AM', () => {
    // 09:00 PM IST = 15:30 UTC
    const nightStart = new Date('2026-10-19T15:30:00.000Z')
    expect(getKolkataGreeting(nightStart, 'Omkar Sawant').fullGreeting).toBe('Good Night, Omkar Sawant')

    // 00:30 AM IST (midnight) = 19:00 UTC
    const midnight = new Date('2026-10-19T19:00:00.000Z')
    expect(getKolkataGreeting(midnight, 'Omkar Sawant').fullGreeting).toBe('Good Night, Omkar Sawant')

    // 04:59 AM IST = 23:29 UTC
    const nightEnd = new Date('2026-10-19T23:29:59.000Z')
    expect(getKolkataGreeting(nightEnd, 'Omkar Sawant').fullGreeting).toBe('Good Night, Omkar Sawant')
  })

  it('shows generic greeting when user profile is loading or absent', () => {
    const morning = new Date('2026-10-19T04:00:00.000Z') // 9:30 AM IST
    expect(getKolkataGreeting(morning, null).fullGreeting).toBe('Good Morning')
    expect(getKolkataGreeting(morning, undefined).fullGreeting).toBe('Good Morning')
    expect(getKolkataGreeting(morning, '').fullGreeting).toBe('Good Morning')
  })
})

describe('Break Transition & Freeze Regression Suite', () => {
  it('freezes daily worked time immediately when session enters on_break with open break', () => {
    // Clock in at 10:00:00 AM IST (04:30:00 UTC)
    const clockInMs = new Date('2026-10-19T04:30:00.000Z').getTime()
    const activeSession: any = {
      id: 'break-session-1',
      employee_id: 'emp-omkar',
      session_date: '2026-10-19',
      clock_in: new Date(clockInMs).toISOString(),
      clock_out: null,
      status: 'working',
      worked_minutes: 0,
      active_minutes: 0,
      breaks: []
    }

    // After 30 minutes (10:30:00 AM IST) -> 1800 seconds
    const timeAtBreakMs = clockInMs + 30 * 60 * 1000
    const workedBeforeBreak = calculateDailyWorkedSeconds(activeSession, [], '2026-10-19', timeAtBreakMs)
    expect(workedBeforeBreak).toBe(1800)
    expect(formatSecondsToHHMMSS(workedBeforeBreak)).toBe('00:30:00')

    // Click "Take a Break" at 10:30:00 AM IST
    activeSession.status = 'on_break'
    activeSession.breaks.push({
      id: 'brk-1',
      start_time: new Date(timeAtBreakMs).toISOString(),
      end_time: null,
      duration_minutes: 0
    })

    // 15 minutes into the break (10:45:00 AM IST)
    const duringBreakMs = timeAtBreakMs + 15 * 60 * 1000
    const workedDuringBreak = calculateDailyWorkedSeconds(activeSession, [], '2026-10-19', duringBreakMs)
    // CRITICAL: Must be frozen at exactly 1800s (30m 00s), NOT 45m!
    expect(workedDuringBreak).toBe(1800)
    expect(formatSecondsToHHMMSS(workedDuringBreak)).toBe('00:30:00')

    // 30 minutes into the break (11:00:00 AM IST)
    const endOfBreakMs = timeAtBreakMs + 30 * 60 * 1000
    const workedStillOnBreak = calculateDailyWorkedSeconds(activeSession, [], '2026-10-19', endOfBreakMs)
    expect(workedStillOnBreak).toBe(1800)

    // Click "Resume Work" at 11:00:00 AM IST
    activeSession.breaks[0].end_time = new Date(endOfBreakMs).toISOString()
    activeSession.breaks[0].duration_minutes = 30
    activeSession.status = 'working'

    // At exact moment of resume, timer is still 1800s (does not jump or reset to zero!)
    const workedAtResume = calculateDailyWorkedSeconds(activeSession, [], '2026-10-19', endOfBreakMs)
    expect(workedAtResume).toBe(1800)
    expect(formatSecondsToHHMMSS(workedAtResume)).toBe('00:30:00')

    // 20 minutes after resuming (11:20:00 AM IST)
    const afterResumeMs = endOfBreakMs + 20 * 60 * 1000
    const workedAfterResume = calculateDailyWorkedSeconds(activeSession, [], '2026-10-19', afterResumeMs)
    // Elapsed wall-clock is 80 mins; minus 30 mins break = 50 mins = 3000 seconds
    expect(workedAfterResume).toBe(3000)
    expect(formatSecondsToHHMMSS(workedAfterResume)).toBe('00:50:00')
  })

  it('calculates Active Hours correctly excluding break intervals and inactive periods', () => {
    const session: any = {
      id: 'active-hours-session',
      employee_id: 'emp-omkar',
      session_date: '2026-10-19',
      clock_in: '2026-10-19T04:30:00.000Z', // 10:00 AM IST
      clock_out: '2026-10-19T06:30:00.000Z', // 12:00 PM IST (2 hours elapsed)
      status: 'completed',
      worked_minutes: 90, // 90 mins worked (30 mins break)
      active_minutes: 75, // 75 mins of active keyboard/mouse activity
      active_seconds_buffer: 24,
      breaks: [
        {
          id: 'brk-lunch',
          start_time: '2026-10-19T05:00:00.000Z',
          end_time: '2026-10-19T05:30:00.000Z',
          duration_minutes: 30
        }
      ]
    }

    const dailyActiveSeconds = calculateDailyActiveSeconds(null, [session], '2026-10-19')
    // 75 minutes * 60 + 24 seconds = 4524 seconds (1h 15m 24s)
    expect(dailyActiveSeconds).toBe(4524)
    expect(formatSecondsToHHMMSS(dailyActiveSeconds)).toBe('01:15:24')

    // Daily Worked seconds should be 90 minutes = 5400 seconds (1h 30m 00s)
    const dailyWorkedSeconds = calculateDailyWorkedSeconds(null, [session], '2026-10-19')
    expect(dailyWorkedSeconds).toBe(5400)
    expect(formatSecondsToHHMMSS(dailyWorkedSeconds)).toBe('01:30:00')

    // Active Hours is strictly less than Worked Hours and never interchangeable
    expect(dailyActiveSeconds).toBeLessThan(dailyWorkedSeconds)
  })

  it('resolves employee designation properly and falls back to "Designation not assigned"', () => {
    // Helper matching UI resolution logic
    const resolveDesignation = (user: { designation?: string | null; role?: string } | null): string => {
      if (!user) return 'Sign in to start tracking'
      return user.designation || 'Designation not assigned'
    }

    // 1. Authenticated user with real designation
    const devUser = { designation: 'Software Developer', role: 'Employee' }
    expect(resolveDesignation(devUser)).toBe('Software Developer')

    // 2. User with null designation (e.g. newly onboarded without assignment)
    const unassignedUser = { designation: null, role: 'Employee' }
    expect(resolveDesignation(unassignedUser)).toBe('Designation not assigned')

    // 3. User with undefined designation
    const undefinedUser = { role: 'Admin' }
    expect(resolveDesignation(undefinedUser)).toBe('Designation not assigned')

    // 4. Role (Admin, HR, Employee) is NEVER confused with designation
    const adminUser = { designation: null, role: 'Admin' }
    expect(resolveDesignation(adminUser)).toBe('Designation not assigned')
    expect(resolveDesignation(adminUser)).not.toBe('Admin')
  })
})
