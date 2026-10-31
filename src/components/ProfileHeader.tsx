import React from 'react'
import type { UserProfile } from '../types'
import { LogIn } from 'lucide-react'

interface ProfileHeaderProps {
  user: UserProfile | null
  onOpenLogin?: () => void
}

export const ProfileHeader: React.FC<ProfileHeaderProps> = ({ user, onOpenLogin }) => {
  const getInitials = () => {
    if (!user) return '?'
    const first = user.first_name?.[0] || ''
    const last = user.last_name?.[0] || ''
    return `${first}${last}`.toUpperCase() || '?'
  }

  const getFormattedDate = () => {
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Kolkata'
    }
    return new Intl.DateTimeFormat('en-GB', options).format(new Date())
  }

  const name = user 
    ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Employee'
    : 'Not Signed In'
  const designation = user 
    ? (user.designation || user.department || 'Active Employee')
    : 'Sign in with ERP credentials'

  return (
    <div className="flex items-center justify-between px-6 pt-5 pb-2">
      {/* Profile info */}
      <div 
        className={`flex items-center gap-3 ${!user ? 'cursor-pointer group' : ''}`}
        onClick={() => {
          if (!user && onOpenLogin) onOpenLogin()
        }}
      >
        <div 
          className="w-11 h-11 rounded-full flex items-center justify-center font-bold text-sm shadow-sm transition-transform group-hover:scale-105"
          style={{
            backgroundColor: user ? 'var(--accent-blue)' : '#64748b',
            color: '#FFFFFF'
          }}
        >
          {user ? getInitials() : <LogIn size={18} />}
        </div>
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              {name}
            </h2>
            {!user && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-500 border border-blue-500/30">
                Sign In
              </span>
            )}
          </div>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {designation}
          </span>
        </div>
      </div>

      {/* Date */}
      <div className="text-right">
        <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
          {getFormattedDate()}
        </span>
      </div>
    </div>
  )
}

