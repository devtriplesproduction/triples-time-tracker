import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  calculateDailyWorkedSeconds,
  calculateDailyActiveSeconds,
  calculateSessionWorkedSeconds,
  calculateSessionWorkedMsForDate,
  formatSecondsToHHMMSS,
  getDayBounds,
  getDateString
} from '../src/utils/timeCalculator'
import type {
  TrackingSession,
  TrackingState,
  BreakRecord,
  ActivityInterval,
  UserProfile,
  PendingSyncItem
} from '../src/types'

/**
 * Accurate Activity Accumulator Simulator
 * Mirrors the exact logic in ActivityTracker.tick() for unit and integration testing.
 */
class ActivityAccumulatorEngine {
  public lastTickTime: number = 0
  public lastHrTime: bigint = 0n
  public activeSecondsBuffer: number = 0
  public activeRemainderMs: number = 0
  public screenshotSecondsBuffer: number = 0
  public isSuspended: boolean = false
  public isScreenLocked: boolean = false
  public lastEmittedIdle: boolean = false
  public lastIdleSeconds: number = 0
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
  }

  public tick(
    now: number,
    idleSeconds: number,
    monotonicDeltaOverrideMs?: number,
    thresholdSec: number = 60
  ): {
    deltaMs: number
    activeDeltaMs: number
    isIdle: boolean
    workedSeconds: number
    activeSeconds: number
  } {
    const session = this.currentSession!
    const isIdle = idleSeconds >= thresholdSec

    // Screen lock & suspend auto-correction when active user input is detected
    if (idleSeconds < thresholdSec) {
      if (this.isScreenLocked) this.isScreenLocked = false
      if (this.isSuspended) this.isSuspended = false
    }

    const monotonicDeltaMs = monotonicDeltaOverrideMs !== undefined
      ? monotonicDeltaOverrideMs
      : (this.lastTickTime ? now - this.lastTickTime : 1000)

    const intervalStart = this.lastTickTime || (now - 1000)
    let deltaMs = this.lastTickTime ? Math.max(0, now - this.lastTickTime) : 1000
    this.lastTickTime = now

    const isWorking = session.status === 'Working' || session.status === 'working'
    const isOnBreak = session.status === 'On Break' || session.status === 'on_break' ||
      (session.breaks && session.breaks.some(b => b.end_time === null))

    // Anti-tamper / Suspend detection
    if (Math.abs(deltaMs - monotonicDeltaMs) > 3000) {
      const clockJumpSec = Math.round((deltaMs - monotonicDeltaMs) / 1000)
      if (clockJumpSec > 0 && !isOnBreak) {
        session.suspended_seconds = Math.max(0, (session.suspended_seconds || 0) + clockJumpSec)
      }
      deltaMs = Math.max(0, monotonicDeltaMs)
    }

    session.last_heartbeat = new Date(now).toISOString()

    // Calculate worked duration
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
        }
      }
    }

    session.active_seconds_buffer = Math.floor(this.activeSecondsBuffer)
    this.lastEmittedIdle = isIdle
    this.lastIdleSeconds = idleSeconds

    const totalWorkedSec = Math.floor(currentWorkedMs / 1000)
    const totalActiveSec = session.active_minutes * 60 + session.active_seconds_buffer

    return {
      deltaMs,
      activeDeltaMs,
      isIdle,
      workedSeconds: totalWorkedSec,
      activeSeconds: totalActiveSec
    }
  }

  public onResume(suspendDurationSec: number) {
    if (this.currentSession) {
      const hasOpenBreak = Array.isArray(this.currentSession.breaks) &&
        this.currentSession.breaks.some(b => b.end_time === null)
      if (!hasOpenBreak) {
        this.currentSession.suspended_seconds = (this.currentSession.suspended_seconds || 0) + suspendDurationSec
      }
    }
    this.isSuspended = false
    this.lastTickTime = Date.now()
    this.lastHrTime = process.hrtime.bigint()
  }
}

describe('Audit: Worked Hours and Active Hours Calculations', () => {
  const employeeId = 'emp-audit-uuid'
  const sessionDate = '2026-11-17'
  const baseTime = new Date('2026-11-17T09:00:00.000+05:30').getTime()

  let mockSession: TrackingSession
  let engine: ActivityAccumulatorEngine

  beforeEach(() => {
    mockSession = {
      id: 'sess-audit-01',
      employee_id: employeeId,
      session_date: sessionDate,
      clock_in: new Date(baseTime).toISOString(),
      clock_out: null,
      status: 'working',
      worked_minutes: 0,
      active_minutes: 0,
      suspended_seconds: 0,
      active_seconds_buffer: 0,
      screenshot_seconds_buffer: 0,
      last_heartbeat: new Date(baseTime).toISOString(),
      breaks: []
    }
    engine = new ActivityAccumulatorEngine()
    engine.init(mockSession, baseTime)
  })

  // 1. Continuous Activity
  describe('1. Continuous Activity & Monotonic Cadence', () => {
    it('accurately accumulates active hours alongside worked hours with zero skips or drift over 1800s (30 mins)', () => {
      const totalSeconds = 1800
      let lastWorked = 0
      let lastActive = 0

      for (let s = 1; s <= totalSeconds; s++) {
        const currentTime = baseTime + s * 1000
        // Continuous input: user types every 2 seconds
        const idleSec = s % 2 === 0 ? 0 : 1
        const res = engine.tick(currentTime, idleSec)

        expect(res.workedSeconds).toBe(s)
        expect(res.activeSeconds).toBe(s)
        expect(res.workedSeconds - lastWorked).toBe(1)
        expect(res.activeSeconds - lastActive).toBe(1)

        lastWorked = res.workedSeconds
        lastActive = res.activeSeconds
      }

      expect(mockSession.worked_minutes).toBe(30)
      expect(mockSession.active_minutes).toBe(30)
      expect(mockSession.active_seconds_buffer).toBe(0)
      expect(formatSecondsToHHMMSS(lastWorked)).toBe('00:30:00')
      expect(formatSecondsToHHMMSS(lastActive)).toBe('00:30:00')
    })

    it('does not artificially clamp delayed ticks (>3000ms) when user was continuously active', () => {
      // Simulate 5 ticks arriving with 4000ms delay each (e.g. system load/backgrounding)
      let currentTime = baseTime
      for (let tick = 1; tick <= 5; tick++) {
        currentTime += 4000
        // User was active 1 second ago
        const res = engine.tick(currentTime, 1, 4000)
        expect(res.deltaMs).toBe(4000)
        expect(res.activeDeltaMs).toBe(4000)
      }

      // Total 20 seconds elapsed and all 20 seconds captured as active
      expect(engine.currentSession?.active_seconds_buffer).toBe(20)
      expect(calculateDailyWorkedSeconds(mockSession, [mockSession], sessionDate, currentTime)).toBe(20)
      expect(calculateDailyActiveSeconds(mockSession, [mockSession], sessionDate, currentTime)).toBe(20)
    })
  })

  // 2. Idle Threshold & Transitions
  describe('2. 60-Second Idle Threshold & Accurate Transitions', () => {
    it('preserves the 60-second idle threshold: freezes at 60s and resumes accurately upon input return', () => {
      let currentTime = baseTime

      // Phase A: Active for 100 seconds
      for (let s = 1; s <= 100; s++) {
        currentTime += 1000
        engine.tick(currentTime, 0)
      }
      expect(mockSession.active_minutes).toBe(1)
      expect(mockSession.active_seconds_buffer).toBe(40)
      expect(mockSession.active_minutes * 60 + mockSession.active_seconds_buffer).toBe(100)

      // Phase B: User walks away. Inactive for 180 seconds.
      // Seconds 1 to 59: idleSec increases from 1 to 59 (active continues accumulating)
      // Second 60: idleSec = 60 -> becomes idle! Active freezes at 100 + 59 = 159s
      for (let s = 1; s <= 180; s++) {
        currentTime += 1000
        engine.tick(currentTime, s)
      }

      // At end of idle period: Worked = 280s, Active = exactly 160s (100 + 60s threshold)
      const workedSec = calculateDailyWorkedSeconds(mockSession, [mockSession], sessionDate, currentTime)
      const activeSec = calculateDailyActiveSeconds(mockSession, [mockSession], sessionDate, currentTime)

      expect(workedSec).toBe(280)
      expect(activeSec).toBe(160)
      expect(formatSecondsToHHMMSS(workedSec)).toBe('00:04:40')
      expect(formatSecondsToHHMMSS(activeSec)).toBe('00:02:40')

      // Phase C: User returns at next second (idleSec drops to 0)
      currentTime += 1000
      const returnRes = engine.tick(currentTime, 0)
      expect(returnRes.isIdle).toBe(false)
      expect(returnRes.activeSeconds).toBe(161)

      // Work for another 60 seconds
      for (let s = 1; s <= 60; s++) {
        currentTime += 1000
        engine.tick(currentTime, 0)
      }

      const finalActive = calculateDailyActiveSeconds(mockSession, [mockSession], sessionDate, currentTime)
      expect(finalActive).toBe(221) // 160 + 1 + 60 = 221
    })

    it('handles intra-tick idle-to-active transition without missing input time', () => {
      // User was idle for 300s. Previous tick was idle.
      // Next tick occurs 2000ms later. User pressed key 500ms ago (idleSec = 0.5s).
      let currentTime = baseTime + 300 * 1000
      engine.lastEmittedIdle = true
      engine.lastTickTime = currentTime
      engine.lastIdleSeconds = 300

      // Tick 2 seconds later, user typed 0.5s ago
      currentTime += 2000
      const res = engine.tick(currentTime, 0.5, 2000)

      // Out of the 2000ms delta, 1500ms was idle, 500ms was active
      expect(res.activeDeltaMs).toBe(500)
      expect(engine.activeRemainderMs).toBe(500)
    })
  })

  // 3. Screen Lock Recovery
  describe('3. Screen Lock Recovery & Stuck Flag Prevention', () => {
    it('autocorrects isScreenLocked when user input is actively detected', () => {
      let currentTime = baseTime + 1000
      // Screen lock event set isScreenLocked = true
      engine.isScreenLocked = true

      // User presses key on desktop (idleSec = 0)
      const res = engine.tick(currentTime, 0)

      // isScreenLocked must be autocorrected to false and active time must accumulate
      expect(engine.isScreenLocked).toBe(false)
      expect(res.activeDeltaMs).toBe(1000)
      expect(res.activeSeconds).toBe(1)
    })
  })

  // 4. Breaks
  describe('4. Breaks: Freezing, Buffer Preservation & No Suspend Double-Counting', () => {
    it('freezes both worked and active hours during breaks and preserves exact seconds buffer', () => {
      let currentTime = baseTime

      // Work 45 seconds (buffer = 45s, active_minutes = 0)
      for (let s = 1; s <= 45; s++) {
        currentTime += 1000
        engine.tick(currentTime, 0)
      }
      expect(engine.activeSecondsBuffer).toBe(45)

      // Take break for 600 seconds (10 minutes)
      const breakStartIso = new Date(currentTime).toISOString()
      mockSession.status = 'on_break'
      mockSession.breaks.push({
        id: 'break-audit-01',
        session_id: mockSession.id,
        start_time: breakStartIso,
        end_time: null,
        duration_minutes: 0,
        reason: 'Lunch'
      })

      for (let b = 1; b <= 600; b++) {
        currentTime += 1000
        const worked = calculateSessionWorkedSeconds(mockSession, currentTime)
        const active = calculateDailyActiveSeconds(mockSession, [mockSession], sessionDate, currentTime)
        expect(worked).toBe(45)
        expect(active).toBe(45)
      }

      // Resume work
      const breakEndIso = new Date(currentTime).toISOString()
      mockSession.breaks[0].end_time = breakEndIso
      mockSession.breaks[0].duration_minutes = 10
      mockSession.status = 'working'
      engine.lastTickTime = currentTime
      engine.lastHrTime = BigInt(currentTime) * 1_000_000n

      expect(engine.activeSecondsBuffer).toBe(45)

      // Work another 30 seconds -> 45 + 30 = 75s (1m 15s)
      for (let w = 1; w <= 30; w++) {
        currentTime += 1000
        engine.tick(currentTime, 0)
      }

      expect(mockSession.active_minutes).toBe(1)
      expect(mockSession.active_seconds_buffer).toBe(15)
      expect(calculateDailyWorkedSeconds(mockSession, [mockSession], sessionDate, currentTime)).toBe(75)
      expect(calculateDailyActiveSeconds(mockSession, [mockSession], sessionDate, currentTime)).toBe(75)
    })

    it('does not deduct sleep from worked duration when system sleeps DURING a break', () => {
      let currentTime = baseTime + 3600 * 1000 // 1 hour of work
      mockSession.worked_minutes = 60

      // Start break
      mockSession.status = 'on_break'
      mockSession.breaks.push({
        id: 'break-during-sleep',
        session_id: mockSession.id,
        start_time: new Date(currentTime).toISOString(),
        end_time: null,
        duration_minutes: 0,
        reason: 'Break'
      })

      // Laptop sleeps for 30 minutes during the break
      const sleepDurationSec = 1800
      engine.onResume(sleepDurationSec)

      // Because open break is active, suspended_seconds must NOT be added
      expect(mockSession.suspended_seconds).toBe(0)

      // Worked hours before break remains strictly 1 hour (3600s)
      const worked = calculateSessionWorkedSeconds(mockSession, currentTime + sleepDurationSec * 1000)
      expect(worked).toBe(3600)
    })
  })

  // 5. Sleep & Resume (No Double Counting)
  describe('5. System Suspend / Resume Without Double-Counting', () => {
    it('excludes sleep duration exactly once from worked hours and prevents double-counting in tick loop', () => {
      let currentTime = baseTime

      // Work 1 hour (3600s)
      for (let s = 1; s <= 3600; s++) {
        currentTime += 1000
        engine.tick(currentTime, 0)
      }
      expect(mockSession.worked_minutes).toBe(60)
      expect(mockSession.active_minutes).toBe(60)

      // Computer goes to sleep for 2 hours (7200 seconds)
      const sleepDurationMs = 7200 * 1000
      const resumeTime = currentTime + sleepDurationMs

      // powerMonitor 'resume' event fires: adds 7200s to suspended_seconds and resets monotonic anchors
      mockSession.suspended_seconds = (mockSession.suspended_seconds || 0) + 7200
      engine.lastTickTime = resumeTime
      engine.lastHrTime = BigInt(resumeTime) * 1_000_000n

      // First tick runs immediately after resume (1000ms later)
      currentTime = resumeTime + 1000
      const tickRes = engine.tick(currentTime, 0)

      // suspended_seconds must remain 7200s (NOT 14400s!)
      expect(mockSession.suspended_seconds).toBe(7200)

      // Worked Hours must be 3601 seconds (1 hour + 1 second), NOT 0 or negative!
      const totalWorked = calculateSessionWorkedSeconds(mockSession, currentTime)
      expect(totalWorked).toBe(3601)
      expect(tickRes.workedSeconds).toBe(3601)
      expect(tickRes.activeSeconds).toBe(3601)
      expect(formatSecondsToHHMMSS(totalWorked)).toBe('01:00:01')
    })
  })

  // 6. Clock-out and Shutdown Buffer Preservation
  describe('6. Active Buffer Preservation on Clock-out and System Shutdown', () => {
    it('preserves exact seconds buffer into session on clock-out', () => {
      let currentTime = baseTime
      // Work 125 seconds: active_minutes = 2, active_seconds_buffer = 5
      for (let s = 1; s <= 125; s++) {
        currentTime += 1000
        engine.tick(currentTime, 0)
      }

      // Simulate clockOut
      if (engine.activeSecondsBuffer >= 60) {
        mockSession.active_minutes += Math.floor(engine.activeSecondsBuffer / 60)
        engine.activeSecondsBuffer %= 60
      }
      mockSession.active_seconds_buffer = Math.floor(engine.activeSecondsBuffer)
      mockSession.clock_out = new Date(currentTime).toISOString()
      mockSession.status = 'completed'

      expect(mockSession.active_minutes).toBe(2)
      expect(mockSession.active_seconds_buffer).toBe(5)

      // calculateDailyActiveSeconds must report all 125 seconds
      const dailyActive = calculateDailyActiveSeconds(null, [mockSession], sessionDate, currentTime)
      expect(dailyActive).toBe(125)
      expect(formatSecondsToHHMMSS(dailyActive)).toBe('00:02:05')
    })
  })

  // 7. Across-Midnight Sessions & Date Rollover
  describe('7. Across-Midnight Sessions & Partitioning', () => {
    it('accurately partitions active hours when session crosses midnight without skipping previous day', () => {
      // Session starts at 22:00:00 on Day 1 (2026-11-16) and runs until 02:00:00 on Day 2 (2026-11-17)
      // Total duration = 4 hours (2 hours on Day 1, 2 hours on Day 2).
      // Active minutes = 240 minutes (all active).
      const clockIn = '2026-11-16T22:00:00.000+05:30'
      const clockOut = '2026-11-17T02:00:00.000+05:30'
      const evalMs = new Date(clockOut).getTime()

      const overnightSession: TrackingSession = {
        id: 'sess-overnight',
        employee_id: employeeId,
        session_date: '2026-11-16', // Starts on Day 1
        clock_in: clockIn,
        clock_out: clockOut,
        status: 'completed',
        worked_minutes: 240,
        active_minutes: 240,
        suspended_seconds: 0,
        active_seconds_buffer: 0,
        breaks: []
      }

      // On Day 1 (2026-11-16): exactly 2 hours (7200s)
      const day1Worked = calculateDailyWorkedSeconds(null, [overnightSession], '2026-11-16', evalMs)
      const day1Active = calculateDailyActiveSeconds(null, [overnightSession], '2026-11-16', evalMs)
      expect(day1Worked).toBe(7200)
      expect(day1Active).toBe(7200)
      expect(formatSecondsToHHMMSS(day1Worked)).toBe('02:00:00')
      expect(formatSecondsToHHMMSS(day1Active)).toBe('02:00:00')

      // On Day 2 (2026-11-17): exactly 2 hours (7200s) — NOT 0s!
      const day2Worked = calculateDailyWorkedSeconds(null, [overnightSession], '2026-11-17', evalMs)
      const day2Active = calculateDailyActiveSeconds(null, [overnightSession], '2026-11-17', evalMs)
      expect(day2Worked).toBe(7200)
      expect(day2Active).toBe(7200)
      expect(formatSecondsToHHMMSS(day2Worked)).toBe('02:00:00')
      expect(formatSecondsToHHMMSS(day2Active)).toBe('02:00:00')
    })
  })

  // 8. Long-Running Multi-Hour Mixed Shift Simulation
  describe('8. Long-Running 8-Hour Mixed Shift Verification', () => {
    it('simulates an 8-hour shift with work, breaks, idle periods, and verifies exact active <= worked guarantee', () => {
      let currentTime = baseTime

      // 1. 2 hours of continuous active work (7200s)
      for (let s = 1; s <= 7200; s++) {
        currentTime += 1000
        engine.tick(currentTime, s % 3 === 0 ? 0 : 1)
      }
      expect(engine.tick(currentTime, 0).workedSeconds).toBe(7200)
      expect(engine.tick(currentTime, 0).activeSeconds).toBe(7200)

      // 2. 15-minute coffee break (900s)
      const breakStart = new Date(currentTime).toISOString()
      mockSession.status = 'on_break'
      mockSession.breaks.push({
        id: 'coffee-break',
        session_id: mockSession.id,
        start_time: breakStart,
        end_time: null,
        duration_minutes: 0,
        reason: 'Coffee'
      })
      currentTime += 900 * 1000
      mockSession.breaks[0].end_time = new Date(currentTime).toISOString()
      mockSession.breaks[0].duration_minutes = 15
      mockSession.status = 'working'
      engine.lastTickTime = currentTime
      engine.lastHrTime = BigInt(currentTime) * 1_000_000n

      // 3. 1.5 hours of active work (5400s)
      for (let s = 1; s <= 5400; s++) {
        currentTime += 1000
        engine.tick(currentTime, 0)
      }

      // 4. 20-minute idle period (1200s without keyboard/mouse)
      // Active hours accumulates 60s under threshold, then freezes for 1140s
      for (let s = 1; s <= 1200; s++) {
        currentTime += 1000
        engine.tick(currentTime, s)
      }

      // 5. 30 minutes of active work to finish shift (1800s)
      for (let s = 1; s <= 1800; s++) {
        currentTime += 1000
        engine.tick(currentTime, 0)
      }

      const finalWorked = calculateDailyWorkedSeconds(mockSession, [mockSession], sessionDate, currentTime)
      const finalActive = calculateDailyActiveSeconds(mockSession, [mockSession], sessionDate, currentTime)

      // Total elapsed from 09:00: 7200 + 900 (break) + 5400 + 1200 (idle) + 1800 = 16,500s (4h 35m)
      // Worked Hours (excludes 900s break): 16,500 - 900 = 15,600s (4h 20m 00s)
      expect(finalWorked).toBe(15600)
      expect(formatSecondsToHHMMSS(finalWorked)).toBe('04:20:00')

      // Active Hours: 7200 (phase 1) + 5400 (phase 3) + 60 (idle grace) + 1800 (phase 5) = 14,460s (4h 01m 00s)
      expect(finalActive).toBe(14460)
      expect(formatSecondsToHHMMSS(finalActive)).toBe('04:01:00')

      // Fundamental metric invariant: Active Hours must NEVER exceed Worked Hours
      expect(finalActive).toBeLessThanOrEqual(finalWorked)
    })
  })
})
