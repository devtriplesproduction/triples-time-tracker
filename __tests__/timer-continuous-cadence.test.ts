import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  calculateDailyWorkedSeconds,
  calculateDailyActiveSeconds,
  formatSecondsToHHMMSS
} from '../src/utils/timeCalculator'
import type { TrackingSession, TrackingStatus, TrackingState } from '../src/types'

describe('Authoritative Timer & Continuous 10-Minute Cadence Verification', () => {
  const employeeId = 'emp-cadence-001'
  const sessionDate = '2026-11-16'
  const baseTime = new Date('2026-11-16T09:00:00.000+05:30').getTime()

  let mockSession: TrackingSession

  beforeEach(() => {
    mockSession = {
      id: 'session-cadence-01',
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
  })

  it('verifies continuous 10-minute (600 seconds) uninterrupted active tracking without any skips or jumps', () => {
    const totalSeconds = 600 // 10 minutes
    const displayedWorked: number[] = []
    const displayedActive: number[] = []
    const formattedWorked: string[] = []
    const formattedActive: string[] = []

    let activeSecondsBuffer = 0
    let activeRemainderMs = 0

    // Initial state at t = 0
    displayedWorked.push(calculateDailyWorkedSeconds(mockSession, [mockSession], sessionDate, baseTime))
    displayedActive.push(calculateDailyActiveSeconds(mockSession, [mockSession], sessionDate, baseTime))
    formattedWorked.push(formatSecondsToHHMMSS(displayedWorked[0]))
    formattedActive.push(formatSecondsToHHMMSS(displayedActive[0]))

    expect(displayedWorked[0]).toBe(0)
    expect(displayedActive[0]).toBe(0)
    expect(formattedWorked[0]).toBe('00:00:00')
    expect(formattedActive[0]).toBe('00:00:00')

    // Simulate 600 consecutive seconds (10 minutes)
    for (let second = 1; second <= totalSeconds; second++) {
      const currentMs = baseTime + second * 1000
      mockSession.last_heartbeat = new Date(currentMs).toISOString()

      // Backend discrete 1000ms active time accumulation
      activeRemainderMs += 1000
      while (activeRemainderMs >= 1000) {
        activeRemainderMs -= 1000
        activeSecondsBuffer += 1
        if (activeSecondsBuffer >= 60) {
          mockSession.active_minutes += Math.floor(activeSecondsBuffer / 60)
          activeSecondsBuffer = activeSecondsBuffer % 60
        }
      }
      mockSession.active_seconds_buffer = activeSecondsBuffer

      const workedSec = calculateDailyWorkedSeconds(mockSession, [mockSession], sessionDate, currentMs)
      const activeSec = calculateDailyActiveSeconds(mockSession, [mockSession], sessionDate, currentMs)

      displayedWorked.push(workedSec)
      displayedActive.push(activeSec)
      formattedWorked.push(formatSecondsToHHMMSS(workedSec))
      formattedActive.push(formatSecondsToHHMMSS(activeSec))

      // Strict per-second verification: S_t === S_{t-1} + 1
      const prevWorked = displayedWorked[second - 1]
      const prevActive = displayedActive[second - 1]

      expect(workedSec - prevWorked).toBe(1)
      expect(activeSec - prevActive).toBe(1)
      expect(workedSec).toBe(second)
      expect(activeSec).toBe(second)
    }

    // Verify 10-minute culmination
    expect(displayedWorked.length).toBe(601)
    expect(displayedActive.length).toBe(601)
    expect(displayedWorked[600]).toBe(600)
    expect(displayedActive[600]).toBe(600)
    expect(formattedWorked[600]).toBe('00:10:00')
    expect(formattedActive[600]).toBe('00:10:00')

    // Verification across every single second of the 600 seconds
    for (let i = 1; i <= totalSeconds; i++) {
      // 1. Zero 3-second jumps
      const jumpWorked = displayedWorked[i] - displayedWorked[i - 1]
      const jumpActive = displayedActive[i] - displayedActive[i - 1]
      expect(jumpWorked).toBeLessThanOrEqual(1)
      expect(jumpActive).toBeLessThanOrEqual(1)

      // 2. Zero skipped seconds
      expect(jumpWorked).toBeGreaterThan(0)
      expect(jumpActive).toBeGreaterThan(0)

      // 3. Zero duplicate increments
      expect(displayedWorked[i]).not.toBe(displayedWorked[i - 1])
      expect(displayedActive[i]).not.toBe(displayedActive[i - 1])
    }
  })

  it('verifies frontend high-precision interpolation eliminates jumps and skips during irregular/delayed IPC broadcasts over 600 seconds', () => {
    const totalSeconds = 600
    const displayedWorkedHistory: number[] = []
    const displayedActiveHistory: number[] = []

    // Simulate backend state
    let backendWorkedSeconds = 0
    let backendActiveSeconds = 0
    let backendServerTimestamp = baseTime
    let backendActiveSecondsBuffer = 0
    let backendActiveRemainderMs = 0

    // Frontend interpolator state
    let frontendBaseline = {
      serverTimestamp: baseTime,
      workedSeconds: 0,
      activeSeconds: 0,
      isWorking: true,
      isTrackingActive: true
    }
    let prevDisplayedWorked = 0
    let prevDisplayedActive = 0

    // Random IPC delivery delay schedule (e.g. packets arrive at varying intervals between 1s and 3s)
    let nextIpcEmitAt = baseTime + 1000

    // We evaluate the frontend display at a 100ms animation loop rate for 600 seconds (6000 frames)
    const frameRateMs = 100
    const totalFrames = (totalSeconds * 1000) / frameRateMs

    for (let frame = 1; frame <= totalFrames; frame++) {
      const now = baseTime + frame * frameRateMs

      // Backend ticks once per second
      if (now >= backendServerTimestamp + 1000) {
        backendServerTimestamp += 1000
        mockSession.last_heartbeat = new Date(backendServerTimestamp).toISOString()
        backendActiveRemainderMs += 1000
        while (backendActiveRemainderMs >= 1000) {
          backendActiveRemainderMs -= 1000
          backendActiveSecondsBuffer += 1
          if (backendActiveSecondsBuffer >= 60) {
            mockSession.active_minutes += 1
            backendActiveSecondsBuffer -= 60
          }
        }
        mockSession.active_seconds_buffer = backendActiveSecondsBuffer
        backendWorkedSeconds = calculateDailyWorkedSeconds(mockSession, [mockSession], sessionDate, backendServerTimestamp)
        backendActiveSeconds = calculateDailyActiveSeconds(mockSession, [mockSession], sessionDate, backendServerTimestamp)
      }

      // Simulate IPC broadcast arriving (sometimes delayed by 1 to 3 seconds)
      if (now >= nextIpcEmitAt) {
        // IPC payload arrives at frontend
        frontendBaseline = {
          serverTimestamp: backendServerTimestamp,
          workedSeconds: backendWorkedSeconds,
          activeSeconds: backendActiveSeconds,
          isWorking: true,
          isTrackingActive: true
        }
        // Next IPC packet delayed with realistic jitter between 800ms and 2800ms
        const jitterMs = 1000 + Math.floor(((frame * 37) % 1800))
        nextIpcEmitAt = now + jitterMs
      }

      // Frontend high-precision elapsed-time calculation
      const elapsedSec = Math.max(0, Math.floor((now - frontendBaseline.serverTimestamp) / 1000))
      const targetWorked = frontendBaseline.isWorking ? (frontendBaseline.workedSeconds + elapsedSec) : frontendBaseline.workedSeconds
      const targetActive = frontendBaseline.isTrackingActive ? (frontendBaseline.activeSeconds + elapsedSec) : frontendBaseline.activeSeconds

      const currentDisplayedWorked = Math.max(prevDisplayedWorked, targetWorked)
      const currentDisplayedActive = Math.max(prevDisplayedActive, targetActive)

      prevDisplayedWorked = currentDisplayedWorked
      prevDisplayedActive = currentDisplayedActive

      // Sample on exact integer second boundaries
      if (frame % 10 === 0) {
        displayedWorkedHistory.push(currentDisplayedWorked)
        displayedActiveHistory.push(currentDisplayedActive)
      }
    }

    expect(displayedWorkedHistory.length).toBe(totalSeconds)
    expect(displayedActiveHistory.length).toBe(totalSeconds)

    // Verify every single second sampled: strictly monotonic, exactly +1, zero jumps
    for (let s = 1; s < totalSeconds; s++) {
      const deltaWorked = displayedWorkedHistory[s] - displayedWorkedHistory[s - 1]
      const deltaActive = displayedActiveHistory[s] - displayedActiveHistory[s - 1]

      // Must increment by exactly 1 each second
      expect(deltaWorked).toBe(1)
      expect(deltaActive).toBe(1)
      expect(displayedWorkedHistory[s]).toBe(s + 1)
      expect(displayedActiveHistory[s]).toBe(s + 1)
    }

    expect(displayedWorkedHistory[totalSeconds - 1]).toBe(totalSeconds)
    expect(displayedActiveHistory[totalSeconds - 1]).toBe(totalSeconds)
    expect(formatSecondsToHHMMSS(displayedWorkedHistory[totalSeconds - 1])).toBe('00:10:00')
    expect(formatSecondsToHHMMSS(displayedActiveHistory[totalSeconds - 1])).toBe('00:10:00')
  })

  it('verifies 60-second idle threshold: Active Hours freezes after 1 min idle while Worked Hours advances continuously', () => {
    // Phase 1: 120s of active work
    // Phase 2: 180s of idle (no keyboard/mouse input)
    // Phase 3: 300s of active work resumed
    const activeSecondsWorked: number[] = []
    const activeSecondsActive: number[] = []

    let activeSecondsBuffer = 0
    let activeRemainderMs = 0

    let currentMs = baseTime

    // Phase 1: Active 120s
    for (let s = 1; s <= 120; s++) {
      currentMs += 1000
      mockSession.last_heartbeat = new Date(currentMs).toISOString()
      activeRemainderMs += 1000
      while (activeRemainderMs >= 1000) {
        activeRemainderMs -= 1000
        activeSecondsBuffer += 1
        if (activeSecondsBuffer >= 60) {
          mockSession.active_minutes += 1
          activeSecondsBuffer -= 60
        }
      }
      mockSession.active_seconds_buffer = activeSecondsBuffer

      const worked = calculateDailyWorkedSeconds(mockSession, [mockSession], sessionDate, currentMs)
      const active = calculateDailyActiveSeconds(mockSession, [mockSession], sessionDate, currentMs)
      activeSecondsWorked.push(worked)
      activeSecondsActive.push(active)
    }

    expect(activeSecondsWorked[119]).toBe(120)
    expect(activeSecondsActive[119]).toBe(120)

    // Phase 2: User is idle for 180 seconds.
    // Under 60s idle threshold:
    // First 59 seconds idle time < 60s: continues tracking.
    // At idle second 60: isIdle becomes true, Active tracking freezes!
    for (let idleSec = 1; idleSec <= 180; idleSec++) {
      currentMs += 1000
      mockSession.last_heartbeat = new Date(currentMs).toISOString()
      const isIdle = idleSec >= 60

      if (!isIdle) {
        activeRemainderMs += 1000
        while (activeRemainderMs >= 1000) {
          activeRemainderMs -= 1000
          activeSecondsBuffer += 1
          if (activeSecondsBuffer >= 60) {
            mockSession.active_minutes += 1
            activeSecondsBuffer -= 60
          }
        }
        mockSession.active_seconds_buffer = activeSecondsBuffer
      }

      const worked = calculateDailyWorkedSeconds(mockSession, [mockSession], sessionDate, currentMs)
      const active = calculateDailyActiveSeconds(mockSession, [mockSession], sessionDate, currentMs)
      activeSecondsWorked.push(worked)
      activeSecondsActive.push(active)
    }

    // At end of Phase 2 (t = 300s):
    // Worked Hours progressed continuously to 300s (5 minutes)
    expect(activeSecondsWorked[activeSecondsWorked.length - 1]).toBe(300)
    expect(formatSecondsToHHMMSS(activeSecondsWorked[activeSecondsWorked.length - 1])).toBe('00:05:00')

    // Active Hours stopped after 1 minute of idle (120s + 59s = 179s)
    const frozenActive = activeSecondsActive[activeSecondsActive.length - 1]
    expect(frozenActive).toBe(179)
    // Verify it stayed frozen throughout remaining 120 seconds of idle
    for (let check = 180; check < 300; check++) {
      expect(activeSecondsActive[check]).toBe(179)
    }

    // Phase 3: User returns, active work resumes for 300s
    for (let s = 1; s <= 300; s++) {
      currentMs += 1000
      mockSession.last_heartbeat = new Date(currentMs).toISOString()
      activeRemainderMs += 1000
      while (activeRemainderMs >= 1000) {
        activeRemainderMs -= 1000
        activeSecondsBuffer += 1
        if (activeSecondsBuffer >= 60) {
          mockSession.active_minutes += 1
          activeSecondsBuffer -= 60
        }
      }
      mockSession.active_seconds_buffer = activeSecondsBuffer

      const worked = calculateDailyWorkedSeconds(mockSession, [mockSession], sessionDate, currentMs)
      const active = calculateDailyActiveSeconds(mockSession, [mockSession], sessionDate, currentMs)
      activeSecondsWorked.push(worked)
      activeSecondsActive.push(active)
    }

    // Total 600 seconds elapsed (10 minutes)
    expect(activeSecondsWorked.length).toBe(600)
    expect(activeSecondsWorked[599]).toBe(600)
    expect(formatSecondsToHHMMSS(activeSecondsWorked[599])).toBe('00:10:00')

    // Active Hours progressed smoothly by exactly 300 seconds without jumps: 179 + 300 = 479
    expect(activeSecondsActive[599]).toBe(479)
    expect(formatSecondsToHHMMSS(activeSecondsActive[599])).toBe('00:07:59')
  })

  it('verifies break buffer preservation: active seconds buffer is preserved across take break and resume break', () => {
    // Work 45 seconds (buffer = 45, active_minutes = 0)
    let currentMs = baseTime + 45 * 1000
    mockSession.active_seconds_buffer = 45
    expect(calculateDailyActiveSeconds(mockSession, [mockSession], sessionDate, currentMs)).toBe(45)

    // Take break at t = 45s for 120s
    const breakStartIso = new Date(currentMs).toISOString()
    mockSession.status = 'on_break'
    mockSession.breaks.push({
      id: 'break-cadence-01',
      session_id: mockSession.id,
      start_time: breakStartIso,
      end_time: null,
      duration_minutes: 0,
      reason: 'Coffee Break'
    })

    // During break, both Worked and Active remain strictly frozen at 45s
    for (let b = 1; b <= 120; b++) {
      currentMs += 1000
      const worked = calculateDailyWorkedSeconds(mockSession, [mockSession], sessionDate, currentMs)
      const active = calculateDailyActiveSeconds(mockSession, [mockSession], sessionDate, currentMs)
      expect(worked).toBe(45)
      expect(active).toBe(45)
    }

    // Resume break
    const breakEndIso = new Date(currentMs).toISOString()
    mockSession.breaks[0].end_time = breakEndIso
    mockSession.breaks[0].duration_minutes = 2
    mockSession.status = 'working'

    // Buffer remains preserved at 45 seconds
    expect(mockSession.active_seconds_buffer).toBe(45)

    // Work another 20 seconds: buffer reaches 65 -> rolls over to active_minutes = 1, buffer = 5!
    for (let w = 1; w <= 20; w++) {
      currentMs += 1000
      mockSession.active_seconds_buffer += 1
      if (mockSession.active_seconds_buffer >= 60) {
        mockSession.active_minutes += 1
        mockSession.active_seconds_buffer -= 60
      }
    }

    expect(mockSession.active_minutes).toBe(1)
    expect(mockSession.active_seconds_buffer).toBe(5)
    expect(calculateDailyActiveSeconds(mockSession, [mockSession], sessionDate, currentMs)).toBe(65)
    expect(calculateDailyWorkedSeconds(mockSession, [mockSession], sessionDate, currentMs)).toBe(65)
    expect(formatSecondsToHHMMSS(65)).toBe('00:01:05')
  })
})
