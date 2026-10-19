import React, { useState, useEffect } from 'react'
import type { TrackingSession, TrackingStatus, UserProfile } from '../types'
import { getKolkataGreeting } from '../utils/timeCalculator'

interface CenterGreetingProps {
  user: UserProfile | null
  status: TrackingStatus
  currentSession?: TrackingSession | null
}

export const CenterGreeting: React.FC<CenterGreetingProps> = React.memo(({ user, status, currentSession }) => {
  const [greetingText, setGreetingText] = useState<string>('')

  // Strictly validate active session ownership and non-terminated status
  const hasValidSession = Boolean(
    user &&
    currentSession &&
    currentSession.id &&
    currentSession.employee_id === user.id &&
    !currentSession.clock_out &&
    currentSession.status !== 'completed' &&
    currentSession.status !== 'Completed'
  )

  const isWorking = hasValidSession && (status === 'Working' || status === 'working' || currentSession?.status === 'working') && !currentSession?.breaks?.some(b => b.end_time === null)
  const isOnBreak = hasValidSession && (status === 'On Break' || status === 'on_break' || currentSession?.status === 'on_break' || Boolean(currentSession?.breaks?.some(b => b.end_time === null)))
  const isCompleted = (status === 'Completed' || status === 'completed') && !hasValidSession

  const fullName = user
    ? [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
    : null

  // Re-evaluate greeting periodically so it updates across 12:00 PM, 5:00 PM, 9:00 PM, and 5:00 AM automatically
  useEffect(() => {
    const updateGreeting = () => {
      const { fullGreeting } = getKolkataGreeting(Date.now(), fullName)
      setGreetingText((prev) => (prev === fullGreeting ? prev : fullGreeting))
    }

    updateGreeting()
    // Check every 10 seconds for period transitions
    const interval = setInterval(updateGreeting, 10000)
    return () => clearInterval(interval)
  }, [fullName])

  return (
    <div className="flex flex-col items-center justify-center text-center px-4 select-none">
      {/* Dynamic Greeting */}
      <h2
        className="text-xl font-bold tracking-normal font-sans mb-2.5"
        style={{ color: 'var(--text-primary)' }}
      >
        {greetingText}
      </h2>

      {/* Dynamic Work-Status Message */}
      <div className="text-sm font-medium tracking-wide">
        {isWorking ? (
          <span style={{ color: 'var(--status-green)' }}>
            You are currently <strong className="font-bold">working</strong>
          </span>
        ) : isOnBreak ? (
          <span style={{ color: 'var(--status-red)' }}>
            You are on a <strong className="font-bold">break now</strong>
          </span>
        ) : isCompleted ? (
          <span style={{ color: 'var(--text-secondary)' }}>
            Your work session has ended
          </span>
        ) : (
          <span style={{ color: 'var(--text-secondary)' }}>
            You are currently not working
          </span>
        )}
      </div>
    </div>
  )
})

