import React, { useEffect, useState, useRef } from 'react'
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
}

export const DailyMetricCards: React.FC<DailyMetricCardsProps> = React.memo(({
  currentSession,
  todaySessions = [],
  status,
  backendWorkedSeconds,
  backendActiveSeconds
}) => {
  const [workedSeconds, setWorkedSeconds] = useState<number>(() => backendWorkedSeconds ?? 0)
  const [activeSeconds, setActiveSeconds] = useState<number>(() => backendActiveSeconds ?? 0)

  // Immediately synchronize when backend authoritative seconds update
  useEffect(() => {
    if (backendWorkedSeconds !== undefined) {
      setWorkedSeconds(backendWorkedSeconds)
    }
  }, [backendWorkedSeconds])

  useEffect(() => {
    if (backendActiveSeconds !== undefined) {
      setActiveSeconds(backendActiveSeconds)
    }
  }, [backendActiveSeconds])

  // Continuous real-time smooth display
  useEffect(() => {
    const isWorking = status === 'working' || status === 'Working'

    // If running in browser mode without Electron backend stream
    if (backendWorkedSeconds === undefined) {
      const updateMetrics = () => {
        const now = Date.now()
        setWorkedSeconds(calculateDailyWorkedSeconds(currentSession, todaySessions, undefined, now))
        setActiveSeconds(calculateDailyActiveSeconds(currentSession, todaySessions, undefined, now))
      }
      updateMetrics()
      const interval = setInterval(updateMetrics, 1000)
      return () => clearInterval(interval)
    }

    // In desktop mode: smoothly advance seconds locally between 1-second backend ticks
    if (isWorking) {
      const interval = setInterval(() => {
        setWorkedSeconds((prev) => prev + 1)
        setActiveSeconds((prev) => prev + 1)
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [status, backendWorkedSeconds, currentSession, todaySessions])

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
            {formatSecondsToHHMMSS(workedSeconds)}
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
            {formatSecondsToHHMMSS(activeSeconds)}
          </span>
        </div>
      </div>
    </div>
  )
})
