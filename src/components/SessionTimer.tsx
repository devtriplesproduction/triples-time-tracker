import React, { useEffect, useState } from 'react'
import type { TrackingSession, TrackingStatus } from '../types'
import { calculateSessionWorkedSeconds, formatSecondsToHHMMSS } from '../utils/timeCalculator'

interface SessionTimerProps {
  currentSession: TrackingSession | null
  status: TrackingStatus
  className?: string
}

/**
 * Digital text timer displaying the current session's elapsed working time.
 * - Starts at 00:00:00 on Clock In.
 * - Increments while working.
 * - Freezes during breaks.
 * - Resumes seamlessly on Resume Work.
 * - Stops on Clock Out.
 */
export const SessionTimer: React.FC<SessionTimerProps> = ({ currentSession, status, className }) => {
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0)

  useEffect(() => {
    const update = () => {
      const seconds = calculateSessionWorkedSeconds(currentSession, Date.now())
      setElapsedSeconds(seconds)
    }

    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [currentSession, status])

  return (
    <span className={`font-mono text-sm font-semibold tracking-wider ${className || 'text-slate-200'}`}>
      {formatSecondsToHHMMSS(elapsedSeconds)}
    </span>
  )
}

