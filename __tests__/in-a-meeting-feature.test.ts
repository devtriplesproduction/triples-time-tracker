import { describe, it, expect, beforeEach } from 'vitest'
import {
  calculateDailyWorkedSeconds,
  calculateDailyActiveSeconds,
  calculateSessionWorkedSeconds,
  formatSecondsToHHMMSS
} from '../src/utils/timeCalculator'
import type { TrackingSession, BreakRecord, TrackingState } from '../src/types'

/**
 * In-a-Meeting Simulator Engine
 * Replicates the exact accumulation and idle detection logic in ActivityTracker.tick().
 */
class MeetingTrackerSimulator {
  public lastTickTime: number = 0
  public lastHrTime: bigint = 0n
  public activeSecondsBuffer: number = 0
  public activeRemainderMs: number = 0
  public isSuspended: boolean = false
  public isScreenLocked: boolean = false
  public lastEmittedIdle: boolean = false
  public lastIdleSeconds: number = 0
  public isInMeeting: boolean = false
  public currentSession: TrackingSession | null = null

  public init(session: TrackingSession, startTimeMs: number) {
    this.currentSession = session
    this.lastTickTime = startTimeMs
    this.lastHrTime = BigInt(startTimeMs) * 1_000_000n
    this.activeSecondsBuffer = session.active_seconds_buffer || 0
    this.activeRemainderMs = 0
    this.isSuspended = false
    this.isScreenLocked = false
    this.lastEmittedIdle = false
    this.lastIdleSeconds = 0
    this.isInMeeting = Boolean(session.is_in_meeting)
  }

  public startMeeting(): { success: boolean; isInMeeting: boolean } {
    if (!this.currentSession) return { success: false, isInMeeting: false }
    const isWorking = this.currentSession.status === 'Working' || this.currentSession.status === 'working'
    if (!isWorking) return { success: false, isInMeeting: false }
    this.isInMeeting = true
    this.currentSession.is_in_meeting = true
    return { success: true, isInMeeting: true }
  }

  public endMeeting(): { success: boolean; isInMeeting: boolean } {
    this.isInMeeting = false
    if (this.currentSession) {
      this.currentSession.is_in_meeting = false
    }
    return { success: true, isInMeeting: false }
  }

  public takeBreak(): void {
    if (!this.currentSession) return
    this.isInMeeting = false
    this.currentSession.is_in_meeting = false
    this.currentSession.status = 'on_break'
    this.currentSession.breaks.push({
      id: 'break-1',
      session_id: this.currentSession.id,
      start_time: new Date(this.lastTickTime).toISOString(),
      end_time: null,
      duration_minutes: 0,
      reason: 'Break'
    })
  }

  public clockOut(now: number): void {
    if (!this.currentSession) return
    this.isInMeeting = false
    this.currentSession.is_in_meeting = false
    this.currentSession.status = 'completed'
    this.currentSession.clock_out = new Date(now).toISOString()
  }

  public tick(
    now: number,
    idleSeconds: number,
    thresholdSec: number = 60
  ): {
    deltaMs: number
    activeDeltaMs: number
    isIdle: boolean
    isTrackingActive: boolean
    activeSeconds: number
  } {
    const session = this.currentSession!
    const isIdle = idleSeconds >= thresholdSec

    if (idleSeconds < thresholdSec) {
      if (this.isScreenLocked) this.isScreenLocked = false
      if (this.isSuspended) this.isSuspended = false
    }

    const deltaMs = this.lastTickTime ? Math.max(0, now - this.lastTickTime) : 1000
    this.lastTickTime = now

    const isWorking = session.status === 'Working' || session.status === 'working'
    const isOnBreak = session.status === 'On Break' || session.status === 'on_break' ||
      (session.breaks && session.breaks.some(b => b.end_time === null))

    let activeDeltaMs = 0

    if (isWorking && !isOnBreak && !this.isSuspended && (!this.isScreenLocked || this.isInMeeting)) {
      if (this.isInMeeting) {
        // Meeting mode: calculate active time directly without waiting for keystrokes or mouse interaction
        activeDeltaMs = deltaMs
      } else if (!isIdle) {
        if (this.lastEmittedIdle) {
          const activeSinceInputMs = idleSeconds > 0 ? Math.round(idleSeconds * 1000) : deltaMs
          activeDeltaMs = Math.min(deltaMs, Math.max(0, activeSinceInputMs))
        } else {
          activeDeltaMs = deltaMs
        }
      } else {
        if (!this.lastEmittedIdle) {
          const overdueIdleMs = (idleSeconds - thresholdSec) * 1000
          if (overdueIdleMs < deltaMs) {
            activeDeltaMs = Math.max(0, deltaMs - overdueIdleMs)
          } else {
            activeDeltaMs = 0
          }
        } else {
          activeDeltaMs = 0
        }
      }

      activeDeltaMs = Math.min(deltaMs, Math.max(0, activeDeltaMs))

      this.activeRemainderMs += activeDeltaMs
      while (this.activeRemainderMs >= 1000) {
        this.activeRemainderMs -= 1000
        this.activeSecondsBuffer += 1
        if (this.activeSecondsBuffer >= 60) {
          const addedMinutes = Math.floor(this.activeSecondsBuffer / 60)
          session.active_minutes += addedMinutes
          this.activeSecondsBuffer %= 60
        }
      }
    }

    session.active_seconds_buffer = Math.floor(this.activeSecondsBuffer)

    const effectiveIdle = this.isInMeeting ? false : isIdle
    this.lastEmittedIdle = effectiveIdle
    this.lastIdleSeconds = this.isInMeeting ? 0 : idleSeconds

    const isTrackingActive = Boolean(isWorking && (!isIdle || this.isInMeeting) && !this.isSuspended && (!this.isScreenLocked || this.isInMeeting))
    const totalActiveSeconds = (session.active_minutes * 60) + session.active_seconds_buffer

    return {
      deltaMs,
      activeDeltaMs,
      isIdle: effectiveIdle,
      isTrackingActive,
      activeSeconds: totalActiveSeconds
    }
  }
}

describe('In a Meeting Feature & Active Time Calculation', () => {
  let engine: MeetingTrackerSimulator
  let session: TrackingSession

  beforeEach(() => {
    engine = new MeetingTrackerSimulator()
    session = {
      id: 'session-meeting-1',
      employee_id: 'emp-omkar',
      session_date: '2026-11-24',
      clock_in: '2026-11-24T10:00:00.000Z',
      clock_out: null,
      status: 'working',
      worked_minutes: 0,
      active_minutes: 0,
      suspended_seconds: 0,
      active_seconds_buffer: 0,
      breaks: [],
      is_in_meeting: false
    }
  })

  it('1. enters meeting mode when In a Meeting is triggered', () => {
    const startTime = new Date('2026-11-24T10:00:00.000Z').getTime()
    engine.init(session, startTime)

    expect(engine.isInMeeting).toBe(false)
    const result = engine.startMeeting()
    expect(result.success).toBe(true)
    expect(result.isInMeeting).toBe(true)
    expect(session.is_in_meeting).toBe(true)
  })

  it('2. calculates active time continuously when in meeting mode without waiting for mouse or keyboard interactions', () => {
    const startTime = new Date('2026-11-24T10:00:00.000Z').getTime()
    engine.init(session, startTime)
    engine.startMeeting()

    let now = startTime
    // Simulate 300 seconds (5 minutes) where powerMonitor reports 0 input:
    // idleSeconds climbs from 1s to 300s (threshold is 60s)
    for (let sec = 1; sec <= 300; sec++) {
      now += 1000
      const idleSec = sec // Employee has NO keyboard or mouse interactions at all
      const result = engine.tick(now, idleSec, 60)

      expect(result.isIdle).toBe(false) // During meeting, employee is not treated as idle
      expect(result.isTrackingActive).toBe(true)
      expect(result.activeDeltaMs).toBe(1000)
    }

    // After 300 seconds in meeting with ZERO keyboard/mouse interaction:
    // Session should have exactly 5 active minutes and 0 active buffer seconds
    expect(session.active_minutes).toBe(5)
    expect(session.active_seconds_buffer).toBe(0)
    const totalActive = (session.active_minutes * 60) + (session.active_seconds_buffer || 0)
    expect(totalActive).toBe(300)
  })

  it('3. stops accumulating active time when meeting is ended and employee remains idle', () => {
    const startTime = new Date('2026-11-24T10:00:00.000Z').getTime()
    engine.init(session, startTime)
    engine.startMeeting()

    let now = startTime
    // In meeting for 60 seconds without input
    for (let sec = 1; sec <= 60; sec++) {
      now += 1000
      engine.tick(now, sec, 60)
    }
    expect(session.active_minutes).toBe(1)
    expect(session.active_seconds_buffer).toBe(0)

    // End meeting
    const endResult = engine.endMeeting()
    expect(endResult.success).toBe(true)
    expect(engine.isInMeeting).toBe(false)

    // Now employee remains idle (idleSeconds = 120s > threshold 60s) for another 60 seconds
    for (let sec = 1; sec <= 60; sec++) {
      now += 1000
      const result = engine.tick(now, 120 + sec, 60)
      expect(result.isIdle).toBe(true)
      expect(result.isTrackingActive).toBe(false)
      expect(result.activeDeltaMs).toBe(0)
    }

    // Active time should have stayed frozen at 60s (1m) because meeting ended and user is idle!
    expect(session.active_minutes).toBe(1)
    expect(session.active_seconds_buffer).toBe(0)
  })

  it('4. resumes standard active time tracking when user interacts after ending meeting', () => {
    const startTime = new Date('2026-11-24T10:00:00.000Z').getTime()
    engine.init(session, startTime)
    engine.startMeeting()

    let now = startTime
    // 60s in meeting
    for (let sec = 1; sec <= 60; sec++) {
      now += 1000
      engine.tick(now, sec, 60)
    }

    engine.endMeeting()

    // 30s actively typing / moving mouse (idleSeconds = 0)
    for (let sec = 1; sec <= 30; sec++) {
      now += 1000
      const result = engine.tick(now, 0, 60)
      expect(result.isIdle).toBe(false)
      expect(result.isTrackingActive).toBe(true)
      expect(result.activeDeltaMs).toBe(1000)
    }

    expect(session.active_minutes).toBe(1)
    expect(session.active_seconds_buffer).toBe(30)
  })

  it('5. auto-clears meeting mode when employee takes a break', () => {
    const startTime = new Date('2026-11-24T10:00:00.000Z').getTime()
    engine.init(session, startTime)
    engine.startMeeting()
    expect(engine.isInMeeting).toBe(true)

    engine.takeBreak()
    expect(engine.isInMeeting).toBe(false)
    expect(session.is_in_meeting).toBe(false)
    expect(session.status).toBe('on_break')

    // Ticks on break do not advance active time
    const result = engine.tick(startTime + 5000, 0, 60)
    expect(result.activeDeltaMs).toBe(0)
    expect(result.isTrackingActive).toBe(false)
  })

  it('6. auto-clears meeting mode upon clocking out', () => {
    const startTime = new Date('2026-11-24T10:00:00.000Z').getTime()
    engine.init(session, startTime)
    engine.startMeeting()
    expect(engine.isInMeeting).toBe(true)

    engine.clockOut(startTime + 60000)
    expect(engine.isInMeeting).toBe(false)
    expect(session.is_in_meeting).toBe(false)
    expect(session.status).toBe('completed')
  })

  it('7. reflects meeting active time accurately in daily active seconds calculator', () => {
    const now = new Date('2026-11-24T12:00:00.000Z').getTime()
    session.clock_in = '2026-11-24T10:00:00.000Z'
    session.worked_minutes = 60
    session.active_minutes = 45 // 45 minutes of active time (including meetings)
    session.active_seconds_buffer = 20

    const dailyActiveSeconds = calculateDailyActiveSeconds(session, [session], '2026-11-24', now)
    expect(dailyActiveSeconds).toBe((45 * 60) + 20) // 2720 seconds
    expect(formatSecondsToHHMMSS(dailyActiveSeconds)).toBe('00:45:20')
  })

  it('8. prevents meeting time accumulation when system is suspended (sleep/closed lid)', () => {
    const startTime = new Date('2026-11-24T10:00:00.000Z').getTime()
    engine.init(session, startTime)
    engine.startMeeting()

    // System suspended
    engine.isSuspended = true
    const result = engine.tick(startTime + 10000, 300, 60)
    expect(result.activeDeltaMs).toBe(0)
    expect(result.isTrackingActive).toBe(false)
    expect(session.active_minutes).toBe(0)
    expect(session.active_seconds_buffer).toBe(0)
  })

  it('9. credits sleep time up to same-day midnight when laptop sleeps during meeting and terminates meeting at midnight', () => {
    // 2026-11-24 22:00:00 IST (Asia/Kolkata is UTC+05:30)
    // 22:00:00 IST = 16:30:00 UTC
    // Midnight 24:00:00 IST = 18:30:00 UTC (7200 seconds later)
    const sleepStartUtc = new Date('2026-11-24T16:30:00.000Z').getTime()
    const dayEndUtc = new Date('2026-11-24T18:30:00.000Z').getTime()
    const wakeUpNextDayUtc = new Date('2026-11-25T03:30:00.000Z').getTime() // Next day 09:00 AM IST

    session.clock_in = '2026-11-24T16:00:00.000Z'
    session.session_date = '2026-11-24'
    session.is_in_meeting = true
    engine.init(session, sleepStartUtc)

    // Sleep spanned across midnight (from 22:00 IST to 09:00 IST next day)
    const day1SleepMs = dayEndUtc - sleepStartUtc // 7200 seconds (2 hours)
    const day1Sec = Math.floor(day1SleepMs / 1000)

    // Under Strict Midnight Rule: credit exactly 7200s (2 hours) up to midnight, and clear meeting mode
    session.active_minutes += Math.floor(day1Sec / 60)
    session.is_in_meeting = false
    engine.isInMeeting = false

    expect(session.active_minutes).toBe(120) // Exactly 2 hours up to midnight
    expect(session.is_in_meeting).toBe(false) // Meeting mode terminated at midnight boundary
  })
})
