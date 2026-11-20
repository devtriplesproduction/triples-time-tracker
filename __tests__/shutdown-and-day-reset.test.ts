import { describe, it, expect } from 'vitest'
import {
  calculateSessionWorkedSeconds,
  calculateDailyWorkedSeconds,
  calculateDailyActiveSeconds,
  formatSecondsToHHMMSS,
  getKolkataDayBounds,
  getKolkataDateString
} from '../src/utils/timeCalculator'
import type { TrackingSession, BreakRecord } from '../src/types'

describe('Shutdown, Day-End Reset, and Accurate Time Tracking', () => {
  const employeeId = 'emp-test-uuid'

  it('accurately calculates worked and active hours without accumulating time when PC is shut down', () => {
    // Scenario: Employee clocks in at 09:00:00 IST on 2026-11-10.
    // Employee works for 2 hours (until 11:00:00 IST).
    // PC is shut down from 11:00:00 IST to 14:00:00 IST (3 hours offline).
    const clockInIso = '2026-11-10T09:00:00.000+05:30'
    const shutdownIso = '2026-11-10T11:00:00.000+05:30'

    const session: TrackingSession = {
      id: 'sess-1',
      employee_id: employeeId,
      session_date: '2026-11-10',
      clock_in: clockInIso,
      clock_out: shutdownIso, // Finalized on shutdown
      status: 'completed',
      worked_minutes: 120, // 2 hours
      active_minutes: 120,
      suspended_seconds: 0,
      active_seconds_buffer: 0,
      last_heartbeat: shutdownIso,
      breaks: []
    }

    // At 14:00:00 IST (after 3h PC shutdown), worked and active hours must remain 2 hours (7200s), NOT 5 hours
    const restartMs = new Date('2026-11-10T14:00:00.000+05:30').getTime()
    const workedSec = calculateDailyWorkedSeconds(null, [session], '2026-11-10', restartMs)
    const activeSec = calculateDailyActiveSeconds(null, [session], '2026-11-10', restartMs)

    expect(workedSec).toBe(120 * 60)
    expect(activeSec).toBe(120 * 60)
    expect(formatSecondsToHHMMSS(workedSec)).toBe('02:00:00')
    expect(formatSecondsToHHMMSS(activeSec)).toBe('02:00:00')
  })

  it('excludes quick reboot downtime from worked duration via suspended_seconds', () => {
    // Scenario: Employee starts at 09:00:00, works until 10:00:00.
    // Employee reboots computer: offline from 10:00:00 to 10:03:00 (180s downtime).
    // Tracking resumes at 10:03:00 and continues to 10:30:00.
    const clockInIso = '2026-11-10T09:00:00.000+05:30'
    const rebootDowntimeSeconds = 180

    const session: TrackingSession = {
      id: 'sess-reboot',
      employee_id: employeeId,
      session_date: '2026-11-10',
      clock_in: clockInIso,
      clock_out: null,
      status: 'working',
      worked_minutes: 87, // 90 min elapsed - 3 min downtime
      active_minutes: 87,
      suspended_seconds: rebootDowntimeSeconds, // Reboot duration excluded
      active_seconds_buffer: 0,
      last_heartbeat: '2026-11-10T10:30:00.000+05:30',
      breaks: []
    }

    const currentMs = new Date('2026-11-10T10:30:00.000+05:30').getTime()
    const sessionWorkedSec = calculateSessionWorkedSeconds(session, currentMs)
    // Elapsed is 90 mins (5400s), minus 180s = 5220s (1h 27m 00s)
    expect(sessionWorkedSec).toBe(5220)
    expect(formatSecondsToHHMMSS(sessionWorkedSec)).toBe('01:27:00')
  })

  it('resets time to 00:00:00 after day end (new calendar day in Asia/Kolkata)', () => {
    // Yesterday: 2026-11-09. User worked 8 hours and completed session.
    const yesterdaySession: TrackingSession = {
      id: 'sess-yesterday',
      employee_id: employeeId,
      session_date: '2026-11-09',
      clock_in: '2026-11-09T09:00:00.000+05:30',
      clock_out: '2026-11-09T17:00:00.000+05:30',
      status: 'completed',
      worked_minutes: 480,
      active_minutes: 450,
      suspended_seconds: 0,
      active_seconds_buffer: 0,
      breaks: []
    }

    // Today: 2026-11-10. Morning 09:30:00 IST.
    const todayMs = new Date('2026-11-10T09:30:00.000+05:30').getTime()

    // Querying daily metrics for today (2026-11-10):
    const todayWorkedSec = calculateDailyWorkedSeconds(null, [yesterdaySession], '2026-11-10', todayMs)
    const todayActiveSec = calculateDailyActiveSeconds(null, [yesterdaySession], '2026-11-10', todayMs)

    expect(todayWorkedSec).toBe(0)
    expect(todayActiveSec).toBe(0)
    expect(formatSecondsToHHMMSS(todayWorkedSec)).toBe('00:00:00')
    expect(formatSecondsToHHMMSS(todayActiveSec)).toBe('00:00:00')
  })

  it('finalizes open sessions at day boundary so they do not leak into next day', () => {
    // If a session was started yesterday and left running until 23:59:59.999
    const yesterdayDayBounds = getKolkataDayBounds('2026-11-09')
    const finalizedYesterdaySession: TrackingSession = {
      id: 'sess-midnight-rollover',
      employee_id: employeeId,
      session_date: '2026-11-09',
      clock_in: '2026-11-09T22:00:00.000+05:30',
      clock_out: new Date(yesterdayDayBounds.dayEndMs - 1).toISOString(), // 23:59:59.999
      status: 'completed',
      worked_minutes: 120, // 2 hours worked yesterday
      active_minutes: 120,
      suspended_seconds: 0,
      active_seconds_buffer: 0,
      breaks: []
    }

    // On the new day: 2026-11-10
    const todayMs = new Date('2026-11-10T00:05:00.000+05:30').getTime()
    const todayWorked = calculateDailyWorkedSeconds(null, [finalizedYesterdaySession], '2026-11-10', todayMs)
    const todayActive = calculateDailyActiveSeconds(null, [finalizedYesterdaySession], '2026-11-10', todayMs)

    expect(todayWorked).toBe(0)
    expect(todayActive).toBe(0)
    expect(formatSecondsToHHMMSS(todayWorked)).toBe('00:00:00')
    expect(formatSecondsToHHMMSS(todayActive)).toBe('00:00:00')
  })

  it('freezes worked and active hours during breaks', () => {
    const clockInIso = '2026-11-10T10:00:00.000+05:30'
    const breakStartIso = '2026-11-10T10:30:00.000+05:30'

    const breakRecord: BreakRecord = {
      id: 'break-1',
      session_id: 'sess-break',
      start_time: breakStartIso,
      end_time: null, // Open break
      duration_minutes: 0,
      reason: 'Coffee Break'
    }

    const session: TrackingSession = {
      id: 'sess-break',
      employee_id: employeeId,
      session_date: '2026-11-10',
      clock_in: clockInIso,
      clock_out: null,
      status: 'on_break',
      worked_minutes: 30,
      active_minutes: 30,
      suspended_seconds: 0,
      active_seconds_buffer: 0,
      breaks: [breakRecord]
    }

    // 15 minutes later during break (10:45:00)
    const midBreakMs = new Date('2026-11-10T10:45:00.000+05:30').getTime()
    const workedSec = calculateSessionWorkedSeconds(session, midBreakMs)
    // Worked duration must be frozen at 30 minutes (1800s), NOT 45 minutes
    expect(workedSec).toBe(30 * 60)
    expect(formatSecondsToHHMMSS(workedSec)).toBe('00:30:00')
  })

  it('unclosed session from yesterday with shutdown/gap does NOT leak into new day', () => {
    // Yesterday: employee worked from 10:00 AM to 18:00 PM, then closed laptop without clicking Clock Out.
    const unclosedYesterdaySession: TrackingSession = {
      id: 'sess-unclosed-yesterday',
      employee_id: employeeId,
      session_date: '2026-11-09',
      clock_in: '2026-11-09T10:00:00.000+05:30',
      clock_out: null, // Left open!
      status: 'working',
      worked_minutes: 480,
      active_minutes: 450,
      suspended_seconds: 0,
      active_seconds_buffer: 0,
      last_heartbeat: '2026-11-09T18:00:00.000+05:30', // Last activity at 6 PM yesterday
      breaks: []
    }

    // Today at 9:30 AM (less than 24h since clock-in, but last heartbeat was yesterday)
    const todayMorningMs = new Date('2026-11-10T09:30:00.000+05:30').getTime()

    // Querying daily metrics for today (2026-11-10):
    const todayWorked = calculateDailyWorkedSeconds(unclosedYesterdaySession, [unclosedYesterdaySession], '2026-11-10', todayMorningMs)
    const todayActive = calculateDailyActiveSeconds(unclosedYesterdaySession, [unclosedYesterdaySession], '2026-11-10', todayMorningMs)

    // MUST be 00:00:00, NOT 9.5 hours!
    expect(todayWorked).toBe(0)
    expect(todayActive).toBe(0)
    expect(formatSecondsToHHMMSS(todayWorked)).toBe('00:00:00')
    expect(formatSecondsToHHMMSS(todayActive)).toBe('00:00:00')
  })

  it('keeps application session tracking continuously beyond 8 hours 32 minutes without auto-closing', () => {
    // Scenario: Employee clocks in at 09:00:00 IST and works past 8 hours 32 minutes (512 minutes).
    // The application and session must remain active, continuously accumulating worked seconds.
    const clockInIso = '2026-11-10T09:00:00.000+05:30'
    const clockInMs = new Date(clockInIso).getTime()
    const elapsedMinutes = 512 // 8 hours 32 minutes
    const testNowMs = clockInMs + elapsedMinutes * 60 * 1000

    const session: TrackingSession = {
      id: 'sess-long-shift',
      employee_id: employeeId,
      session_date: '2026-11-10',
      clock_in: clockInIso,
      clock_out: null, // Still working! Must not be auto-closed!
      status: 'working',
      worked_minutes: elapsedMinutes,
      active_minutes: elapsedMinutes - 10,
      suspended_seconds: 0,
      active_seconds_buffer: 0,
      last_heartbeat: new Date(testNowMs).toISOString(),
      breaks: []
    }

    const calculatedWorked = calculateSessionWorkedSeconds(session, testNowMs)
    expect(calculatedWorked).toBe(512 * 60)
    expect(formatSecondsToHHMMSS(calculatedWorked)).toBe('08:32:00')
    expect(session.clock_out).toBeNull()
    expect(session.status).toBe('working')

    // At 8 hours 35 minutes (515 minutes), tracking continues seamlessly
    const testLaterMs = clockInMs + 515 * 60 * 1000
    const calculatedLater = calculateSessionWorkedSeconds(session, testLaterMs)
    expect(calculatedLater).toBe(515 * 60)
    expect(formatSecondsToHHMMSS(calculatedLater)).toBe('08:35:00')
  })

  it('simulates window close interceptor: hides window to tray and does not quit application', () => {
    let isQuitting = false
    let isWindowHidden = false
    let isAppQuit = false

    const mockEvent = {
      defaultPrevented: false,
      preventDefault: () => {
        mockEvent.defaultPrevented = true
      }
    }

    const handleWindowClose = (event: typeof mockEvent) => {
      if (!isQuitting) {
        event.preventDefault()
        isWindowHidden = true
        return
      }
      isAppQuit = true
    }

    // User clicks X on window
    handleWindowClose(mockEvent)

    expect(mockEvent.defaultPrevented).toBe(true)
    expect(isWindowHidden).toBe(true)
    expect(isAppQuit).toBe(false)

    // Only explicit user quit allows exit
    isQuitting = true
    const quitEvent = { defaultPrevented: false, preventDefault: () => {} }
    handleWindowClose(quitEvent)
    expect(isAppQuit).toBe(true)
  })
})

