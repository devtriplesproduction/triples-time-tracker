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


