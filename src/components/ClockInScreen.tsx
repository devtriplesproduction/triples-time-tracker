import React, { useState, useEffect } from 'react'
import type { UserProfile } from '../types'
import { getKolkataGreeting } from '../utils/timeCalculator'

interface ClockInScreenProps {
  user: UserProfile | null
  subtitle?: string
  loading?: boolean
  onClockIn: () => Promise<void>
  onOpenLogin: () => void
}

export const ClockInScreen: React.FC<ClockInScreenProps> = React.memo(({
  user,
  subtitle = 'Yet to start work for today!',
  loading = false,
  onClockIn,
  onOpenLogin
}) => {
  const [greeting, setGreeting] = useState<string>('')

  const fullName = user
    ? [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || 'Employee'
    : null

  // Keep greeting synchronized with Asia/Kolkata timezone periods
  useEffect(() => {
    const updateGreeting = () => {
      const { fullGreeting } = getKolkataGreeting(Date.now(), fullName)
      setGreeting((prev) => (prev === fullGreeting ? prev : fullGreeting))
    }

    updateGreeting()
    // Re-evaluate every 10s to smoothly transition across 12 PM, 5 PM, 9 PM, 5 AM IST
    const interval = setInterval(updateGreeting, 10000)
    return () => clearInterval(interval)
  }, [fullName])

  const handleClick = async () => {
    if (!user) {
      onOpenLogin()
      return
    }
    if (loading) return
    await onClockIn()
  }

  return (
    <div className="flex-1 flex flex-col justify-center items-center text-center px-4 select-none font-sans animate-fade-in">
      {/* 1. Dynamic Greeting (e.g., "Good Afternoon, Omkar Sawant") */}
      <h1
        className="text-2xl md:text-[26px] font-bold tracking-tight mb-3"
        style={{ color: 'var(--text-primary)' }}
      >
        {greeting}
      </h1>

      {/* 2. Subtitle (e.g., "Yet to start work for today!") */}
      <p
        className="text-sm md:text-[15px] font-medium mb-7"
        style={{ color: 'var(--text-secondary)' }}
      >
        {subtitle}
      </p>

      {/* 3. Prominent Blue Clock In Button (#1677FF, ~185 × 48px) */}
      <button
        id="clock-in-btn"
        onClick={handleClick}
        disabled={loading}
        className="w-[185px] h-[48px] rounded-lg font-semibold text-base text-white shadow-md transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer border-0"
        style={{
          backgroundColor: '#1677FF'
        }}
        onMouseEnter={(e) => {
          if (!loading) e.currentTarget.style.backgroundColor = '#4096FF'
        }}
        onMouseLeave={(e) => {
          if (!loading) e.currentTarget.style.backgroundColor = '#1677FF'
        }}
      >
        {loading ? 'Starting...' : 'Clock In'}
      </button>
    </div>
  )
})
