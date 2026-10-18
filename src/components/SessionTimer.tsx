import React, { useEffect, useState } from 'react'
import type { TrackingSession, TrackingStatus } from '../types'

interface SessionTimerProps {
  currentSession: TrackingSession | null
  status: TrackingStatus
  todayWorkedMinutes: number
}

export const SessionTimer: React.FC<SessionTimerProps> = ({ currentSession, status, todayWorkedMinutes }) => {
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0)

  const isWorking = status === 'Working' || status === 'working'
  const isOnBreak = status === 'On Break' || status === 'on_break'

  useEffect(() => {
    const isSessionOnBreak = currentSession?.status === 'On Break' || currentSession?.status === 'on_break' || status === 'On Break' || status === 'on_break'

    const updateTimer = () => {
      if (!currentSession || currentSession.status === 'Completed' || currentSession.status === 'completed') {
        setElapsedSeconds(0)
        return
      }

      const clockIn = new Date(currentSession.clock_in).getTime()
      const now = Date.now()

      if (isSessionOnBreak) {
        // Freeze timer at the moment the break started!
        const openBreak = currentSession.breaks.find(b => b.end_time === null)
        const breakStartTime = openBreak ? new Date(openBreak.start_time).getTime() : now

        let closedBreaksMs = 0
        for (const b of currentSession.breaks) {
          if (b.end_time) {
            const start = new Date(b.start_time).getTime()
            const end = new Date(b.end_time).getTime()
            closedBreaksMs += Math.max(0, end - start)
          }
        }

        const suspendedMs = (currentSession.suspended_seconds || 0) * 1000
        const workedMs = Math.max(0, breakStartTime - clockIn - closedBreaksMs - suspendedMs)
        setElapsedSeconds(Math.floor(workedMs / 1000))
        return
      }

      let breakMs = 0
      for (const b of currentSession.breaks) {
        const start = new Date(b.start_time).getTime()
        const end = b.end_time ? new Date(b.end_time).getTime() : now
        breakMs += Math.max(0, end - start)
      }

      const suspendedMs = (currentSession.suspended_seconds || 0) * 1000
      const workedMs = Math.max(0, now - clockIn - breakMs - suspendedMs)
      setElapsedSeconds(Math.floor(workedMs / 1000))
    }

    updateTimer()
    if (!isSessionOnBreak) {
      const interval = setInterval(updateTimer, 1000)
      return () => clearInterval(interval)
    }
  }, [currentSession, status])

  // Format HH:MM:SS
  const formatTime = (totalSecs: number) => {
    const hrs = Math.floor(totalSecs / 3600)
    const mins = Math.floor((totalSecs % 3600) / 60)
    const secs = totalSecs % 60
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  // Ring circumference
  const radius = 86
  const strokeWidth = 6
  const circumference = 2 * Math.PI * radius
  // 8 hours standard workday target = 28800 seconds
  const progressRatio = Math.min(1, elapsedSeconds / 28800)
  const strokeDashoffset = circumference - (progressRatio > 0 ? progressRatio : 0.25) * circumference

  return (
    <div className="flex flex-col items-center justify-center my-4 relative">
      <div className="relative w-52 h-52 flex items-center justify-center">
        {/* SVG Circular Progress Gauge */}
        <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 200 200">
          {/* Background circle track */}
          <circle
            cx="100"
            cy="100"
            r={radius}
            fill="transparent"
            stroke="var(--border-color)"
            strokeWidth={strokeWidth}
            opacity="0.4"
          />
          {/* Active progress arc */}
          <circle
            cx="100"
            cy="100"
            r={radius}
            fill="transparent"
            stroke={isOnBreak ? 'var(--status-amber)' : 'var(--accent-blue)'}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-linear"
          />
        </svg>

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span 
            className="text-xs font-semibold tracking-wide uppercase mb-1"
            style={{ 
              color: isWorking 
                ? 'var(--accent-blue)' 
                : isOnBreak 
                ? 'var(--status-amber)' 
                : 'var(--text-muted)' 
            }}
          >
            {isWorking ? 'Working' : isOnBreak ? 'On Break' : 'Clocked Out'}
          </span>

          <span 
            className="text-3xl font-extrabold tracking-tight font-mono my-0.5"
            style={{ color: 'var(--text-primary)' }}
          >
            {formatTime(elapsedSeconds)}
          </span>

          <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
            {isOnBreak ? 'Session Paused' : "Today's Session"}
          </span>
        </div>
      </div>
    </div>
  )
}
