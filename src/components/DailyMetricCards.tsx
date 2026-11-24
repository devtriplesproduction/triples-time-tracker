import React, { useEffect, useRef, useState } from 'react'
import type { TrackingSession, TrackingStatus } from '../types'
import {
  calculateDailyWorkedSeconds,
  calculateDailyActiveSeconds,
  formatSecondsToHHMMSS
} from '../utils/timeCalculator'

interface DailyMetricCardsProps {
  currentSession: TrackingSession | null
  todaySessions?: TrackingSession[]
  status: TrackingStatus
  backendWorkedSeconds?: number
  backendActiveSeconds?: number
  serverTimestamp?: number
  isTrackingActive?: boolean
  isIdle?: boolean
  isInMeeting?: boolean
}

export const DailyMetricCards: React.FC<DailyMetricCardsProps> = React.memo(({
  currentSession,
  todaySessions = [],
  status,
  backendWorkedSeconds,
  backendActiveSeconds,
  serverTimestamp,
  isTrackingActive,
  isIdle,
  isInMeeting
}) => {
  const [displayedWorkedSeconds, setDisplayedWorkedSeconds] = useState<number>(() => backendWorkedSeconds ?? 0)
  const [displayedActiveSeconds, setDisplayedActiveSeconds] = useState<number>(() => backendActiveSeconds ?? 0)

  const isWorking = (status === 'working' || status === 'Working') && !currentSession?.breaks?.some(b => b.end_time === null)
  const activelyTracking = isTrackingActive !== undefined
    ? isTrackingActive
    : Boolean(isWorking && (!isIdle || isInMeeting))

  const baselineRef = useRef<{
    serverTimestamp: number
    workedSeconds: number
    activeSeconds: number
    isWorking: boolean
    isTrackingActive: boolean
    sessionId: string | null
    status: TrackingStatus
  }>({
    serverTimestamp: serverTimestamp || Date.now(),
    workedSeconds: backendWorkedSeconds ?? 0,
    activeSeconds: backendActiveSeconds ?? 0,
    isWorking,
    isTrackingActive: activelyTracking,
    sessionId: currentSession?.id || null,
    status
  })

  // Synchronize baseline with latest authoritative backend snapshot
  useEffect(() => {
    const prevSessionId = baselineRef.current.sessionId
    const currentSessionId = currentSession?.id || null

    baselineRef.current = {
      serverTimestamp: serverTimestamp || Date.now(),
      workedSeconds: backendWorkedSeconds ?? 0,
      activeSeconds: backendActiveSeconds ?? 0,
      isWorking,
      isTrackingActive: activelyTracking,
      sessionId: currentSessionId,
      status
    }

    // Immediately reset counters if session changed or was discarded/restarted
    if (prevSessionId !== currentSessionId || (backendWorkedSeconds === 0 && displayedWorkedSeconds > 60)) {
      setDisplayedWorkedSeconds(backendWorkedSeconds ?? 0)
      setDisplayedActiveSeconds(backendActiveSeconds ?? 0)
    }
  }, [backendWorkedSeconds, backendActiveSeconds, serverTimestamp, status, isWorking, activelyTracking, currentSession?.id])

  // High-precision synchronization loop (every 100ms) for strictly monotonic single-second cadence
  useEffect(() => {
    // In web preview mode (without Electron backend stream), compute locally
    if (backendWorkedSeconds === undefined) {
      const updateMetrics = () => {
        const now = Date.now()
        setDisplayedWorkedSeconds(calculateDailyWorkedSeconds(currentSession, todaySessions, undefined, now))
        setDisplayedActiveSeconds(calculateDailyActiveSeconds(currentSession, todaySessions, undefined, now))
      }
      updateMetrics()
      const interval = setInterval(updateMetrics, 1000)
      return () => clearInterval(interval)
    }

    // Desktop mode: Authoritative backend baseline + high-precision elapsed interpolation
    const updateInterpolation = () => {
      const now = Date.now()
      const base = baselineRef.current

      // If not clocked in or completed, freeze at baseline
      if (!base.sessionId || (base.status !== 'working' && base.status !== 'Working' && base.status !== 'on_break' && base.status !== 'On Break')) {
        setDisplayedWorkedSeconds(base.workedSeconds)
        setDisplayedActiveSeconds(base.activeSeconds)
        return
      }

      // Elapsed seconds since the backend snapshot was captured
      const elapsedSec = Math.max(0, Math.floor((now - base.serverTimestamp) / 1000))

      // Worked hours advances only if currently working (freezes on break)
      const targetWorked = base.isWorking ? (base.workedSeconds + elapsedSec) : base.workedSeconds

      // Active hours advances only if actively tracking (freezes when idle or on break)
      const targetActive = base.isTrackingActive ? (base.activeSeconds + elapsedSec) : base.activeSeconds

      setDisplayedWorkedSeconds((prev) => {
        // Allow downward reset on day rollover or explicit session reset
        if (targetWorked < prev && (prev - targetWorked) > 60) {
          return targetWorked
        }
        return Math.max(prev, targetWorked)
      })

      setDisplayedActiveSeconds((prev) => {
        // Allow downward reset on day rollover or explicit session reset
        if (targetActive < prev && (prev - targetActive) > 60) {
          return targetActive
        }
        return Math.max(prev, targetActive)
      })
    }

    updateInterpolation()
    const interval = setInterval(updateInterpolation, 100)
    return () => clearInterval(interval)
  }, [backendWorkedSeconds, backendActiveSeconds, currentSession, todaySessions])

  return (
    <div className="w-full max-w-md px-6 select-none font-sans">
      <div className="grid grid-cols-2 gap-3.5">
        {/* Worked Hours Card */}
        <div
          className="p-4 rounded-xl border flex flex-col items-center justify-center text-center transition-all shadow-sm"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-color)'
          }}
        >
          <span
            className="text-[11px] font-bold uppercase tracking-widest mb-1.5"
            style={{ color: 'var(--text-secondary)' }}
          >
            WORKED HOURS
          </span>
          <span
            className="text-xl font-extrabold font-mono tracking-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            {formatSecondsToHHMMSS(displayedWorkedSeconds)}
          </span>
        </div>

        {/* Active Hours Card */}
        <div
          className="p-4 rounded-xl border flex flex-col items-center justify-center text-center transition-all shadow-sm"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-color)'
          }}
        >
          <span
            className="text-[11px] font-bold uppercase tracking-widest mb-1.5"
            style={{ color: 'var(--text-secondary)' }}
          >
            ACTIVE HOURS
          </span>
          <span
            className="text-xl font-extrabold font-mono tracking-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            {formatSecondsToHHMMSS(displayedActiveSeconds)}
          </span>
        </div>
      </div>
    </div>
  )
})
