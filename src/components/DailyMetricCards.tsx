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
  status
}) => {
  const [workedSeconds, setWorkedSeconds] = useState<number>(0)
  const [activeSeconds, setActiveSeconds] = useState<number>(0)

  const currentSessionRef = useRef(currentSession)
  const todaySessionsRef = useRef(todaySessions)
  const statusRef = useRef(status)

  useEffect(() => {
    currentSessionRef.current = currentSession
    todaySessionsRef.current = todaySessions
    statusRef.current = status
  }, [currentSession, todaySessions, status])

  // Single stable interval across the component lifecycle
  useEffect(() => {
    const updateMetrics = () => {
      const now = Date.now()
      const wSec = calculateDailyWorkedSeconds(
        currentSessionRef.current,
        todaySessionsRef.current,
        undefined,
        now
      )
      const aSec = calculateDailyActiveSeconds(
        currentSessionRef.current,
        todaySessionsRef.current,
        undefined,
        now
      )
      setWorkedSeconds((prev) => (prev === wSec ? prev : wSec))
      setActiveSeconds((prev) => (prev === aSec ? prev : aSec))
    }

    updateMetrics()
    const interval = setInterval(updateMetrics, 1000)
    return () => clearInterval(interval)
  }, [])

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
