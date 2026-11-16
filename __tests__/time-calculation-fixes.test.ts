import { describe, it, expect } from 'vitest'
import {
  getDayBounds,
  getDateString,
  getHour,
  getGreeting,
  calculateSessionWorkedSeconds,
  calculateSessionWorkedMsForDate,
  calculateDailyWorkedSeconds,
  calculateDailyActiveSeconds,
  formatSecondsToHHMMSS,
  DEFAULT_TIMEZONE
} from '../src/utils/timeCalculator'
import type { TrackingSession, BreakRecord } from '../src/types'

describe('Time Tracking Enhancements & Discrepancy Fixes', () => {
  const employeeId = 'emp-fixes-uuid'

  describe('1. Crash-Related Time Inflation Prevention', () => {
    it('freezes worked time at last_heartbeat when app/PC crashed or terminated abruptly on the SAME day', () => {
      // Employee clocks in at 09:00:00.
      // Works for 90 minutes until 10:30:00 (last heartbeat is recorded at 10:30:00).
      // System or app crashes at 10:30:00 without clean clock_out.
      // Now it is 14:30:00 (4 hours later).
      const clockIn = '2026-11-16T09:00:00.000+05:30'
      const crashHeartbeat = '2026-11-16T10:30:00.000+05:30'
      const nowMs = new Date('2026-11-16T14:30:00.000+05:30').getTime()

      const crashedSession: TrackingSession = {
        id: 'sess-crashed-same-day',
        employee_id: employeeId,
        session_date: '2026-11-16',
        clock_in: clockIn,
        clock_out: null, // Left open due to crash
        status: 'working',
        worked_minutes: 90,
        active_minutes: 85,
        suspended_seconds: 0,
        active_seconds_buffer: 0,
        last_heartbeat: crashHeartbeat,
        breaks: []
      }

      // calculateSessionWorkedSeconds must freeze at last_heartbeat (90 mins = 5400s), NOT 5.5 hours (19800s)
      const sessionSeconds = calculateSessionWorkedSeconds(crashedSession, nowMs)
      expect(sessionSeconds).toBe(90 * 60)
      expect(formatSecondsToHHMMSS(sessionSeconds)).toBe('01:30:00')

      // calculateDailyWorkedSeconds must also freeze at 90 minutes
      const dailySeconds = calculateDailyWorkedSeconds(crashedSession, [crashedSession], '2026-11-16', nowMs)
      expect(dailySeconds).toBe(90 * 60)
      expect(formatSecondsToHHMMSS(dailySeconds)).toBe('01:30:00')
    })

    it('does NOT freeze worked time when session is actively heartbeating (< 5m)', () => {
      const nowMs = new Date('2026-11-16T10:00:00.000+05:30').getTime()
      const recentHeartbeat = new Date(nowMs - 1000).toISOString() // 1 second ago

      const activeSession: TrackingSession = {
        id: 'sess-active-running',
        employee_id: employeeId,
        session_date: '2026-11-16',
        clock_in: '2026-11-16T09:00:00.000+05:30', // 1 hour ago
        clock_out: null,
        status: 'working',
        worked_minutes: 60,
        active_minutes: 55,
        suspended_seconds: 0,
        active_seconds_buffer: 0,
        last_heartbeat: recentHeartbeat,
        breaks: []
      }

      const workedSeconds = calculateSessionWorkedSeconds(activeSession, nowMs)
      expect(workedSeconds).toBe(3600)
      expect(formatSecondsToHHMMSS(workedSeconds)).toBe('01:00:00')
    })
  })

  describe('2. Employee-Specific Timezones Support', () => {
    it('accurately computes day bounds for America/New_York (EST)', () => {
      // 2026-11-16 in America/New_York (EST is UTC-5)
      // Midnight in New York is 05:00:00 UTC on the same day.
      const bounds = getDayBounds('2026-11-16', 'America/New_York')
      const startUtc = new Date(bounds.dayStartMs).toISOString()
      expect(startUtc).toBe('2026-11-16T05:00:00.000Z')
      expect(bounds.dayEndMs - bounds.dayStartMs).toBe(24 * 60 * 60 * 1000)
    })

    it('accurately computes day bounds for UTC', () => {
      const bounds = getDayBounds('2026-11-16', 'UTC')
      const startUtc = new Date(bounds.dayStartMs).toISOString()
      expect(startUtc).toBe('2026-11-16T00:00:00.000Z')
    })

    it('accurately computes day bounds for Asia/Kolkata (IST)', () => {
      const bounds = getDayBounds('2026-11-16', 'Asia/Kolkata')
      const startUtc = new Date(bounds.dayStartMs).toISOString()
      // 00:00:00 IST is 18:30:00 UTC previous day
      expect(startUtc).toBe('2026-11-15T18:30:00.000Z')
    })

    it('formats date string correctly for different timezones', () => {
      // At 2026-11-15 20:00:00 UTC:
      // In New York (UTC-5), it is 2026-11-15 15:00:00 -> Date is 2026-11-15
      // In Kolkata (UTC+5:30), it is 2026-11-16 01:30:00 -> Date is 2026-11-16
      const instant = new Date('2026-11-15T20:00:00.000Z')
      expect(getDateString(instant, 'America/New_York')).toBe('2026-11-15')
      expect(getDateString(instant, 'Asia/Kolkata')).toBe('2026-11-16')
    })

    it('calculates worked time for an employee working in America/New_York without Kolkata boundary cuts', () => {
      // New York employee working from 14:00 to 18:00 EST on 2026-11-16.
      // (14:00 EST = 19:00 UTC = 00:30 IST next day).
      // Under Kolkata time, this would cross midnight and get split/corrupted.
      // Under America/New_York timezone, it belongs 100% to 2026-11-16.
      const clockInIso = '2026-11-16T14:00:00-05:00'
      const clockOutIso = '2026-11-16T18:00:00-05:00'
      const evalMs = new Date('2026-11-16T18:00:00-05:00').getTime()

      const nySession: TrackingSession = {
        id: 'sess-ny',
        employee_id: employeeId,
        session_date: '2026-11-16',
        clock_in: clockInIso,
        clock_out: clockOutIso,
        status: 'completed',
        worked_minutes: 240, // 4 hours
        active_minutes: 220,
        suspended_seconds: 0,
        active_seconds_buffer: 0,
        breaks: []
      }

      const workedMs = calculateSessionWorkedMsForDate(nySession, '2026-11-16', evalMs, 'America/New_York')
      expect(workedMs).toBe(4 * 60 * 60 * 1000)

      const dailySec = calculateDailyWorkedSeconds(null, [nySession], '2026-11-16', evalMs, 'America/New_York')
      expect(dailySec).toBe(4 * 3600)
      expect(formatSecondsToHHMMSS(dailySec)).toBe('04:00:00')
    })
  })

  describe('3. Break Buffer Preservation & Active Seconds Consistency', () => {
    it('aggregates active seconds with buffers correctly', () => {
      const sessionWithBuffer: TrackingSession = {
        id: 'sess-buffer',
        employee_id: employeeId,
        session_date: '2026-11-16',
        clock_in: '2026-11-16T09:00:00.000+05:30',
        clock_out: '2026-11-16T10:00:00.000+05:30',
        status: 'completed',
        worked_minutes: 60,
        active_minutes: 45,
        active_seconds_buffer: 35, // 35 seconds accumulated before break
        suspended_seconds: 0,
        breaks: []
      }

      const nowMs = new Date('2026-11-16T10:00:00.000+05:30').getTime()
      const totalActiveSec = calculateDailyActiveSeconds(null, [sessionWithBuffer], '2026-11-16', nowMs)
      // 45 minutes * 60 = 2700s + 35s buffer = 2735s
      expect(totalActiveSec).toBe(45 * 60 + 35)
      expect(formatSecondsToHHMMSS(totalActiveSec)).toBe('00:45:35')
    })
  })

  describe('4. 60-Second (1 Minute) Default Idle Threshold', () => {
    it('stops active time accumulation when idle for 60s or more, and resumes when activity returns', () => {
      let activeSecondsBuffer = 0
      let activeMinutes = 0
      const idleThresholdSeconds = 60

      const tick = (idleSeconds: number, deltaSec: number = 1) => {
        const isIdle = idleSeconds >= idleThresholdSeconds
        if (!isIdle) {
          activeSecondsBuffer += deltaSec
          if (activeSecondsBuffer >= 60) {
            activeMinutes += Math.floor(activeSecondsBuffer / 60)
            activeSecondsBuffer %= 60
          }
        }
      }

      // User actively works for 50 seconds (idleSeconds = 0)
      for (let i = 0; i < 50; i++) tick(0)
      expect(activeSecondsBuffer).toBe(50)
      expect(activeMinutes).toBe(0)

      // User goes idle: idleSeconds increases from 1 to 59
      for (let s = 1; s < 60; s++) tick(s)
      expect(activeMinutes).toBe(1) // 50 + 10 = 60s -> rolled over 1 minute
      expect(activeSecondsBuffer).toBe(49)

      // At second 60, 61, 62, 63, 64, 65: idle >= 60, active tracking stops
      for (let s = 60; s <= 65; s++) tick(s)
      expect(activeMinutes).toBe(1)
      expect(activeSecondsBuffer).toBe(49) // Frozen!

      // Activity returns: idleSeconds drops back to 0
      tick(0)
      expect(activeSecondsBuffer).toBe(50) // Resumed!
    })
  })
})
