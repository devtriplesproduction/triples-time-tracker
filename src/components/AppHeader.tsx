import React, { useState, useRef, useEffect } from 'react'
import { Bug, LogOut, Settings as SettingsIcon, Camera } from 'lucide-react'
import type { UserProfile } from '../types'
import logoImg from '../assets/logo.png'

interface AppHeaderProps {
  user: UserProfile | null
  onOpenBugReport: () => void
  onOpenSettings: () => void
  onSignOut: () => void
  onOpenLogin: () => void
  onOpenScreenshots?: () => void
}

export const AppHeader: React.FC<AppHeaderProps> = React.memo(({
  user,
  onOpenBugReport,
  onOpenSettings,
  onSignOut,
  onOpenLogin,
  onOpenScreenshots
}) => {
  const [isAvatarMenuOpen, setIsAvatarMenuOpen] = useState(false)
  const avatarRef = useRef<HTMLDivElement>(null)

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (avatarRef.current && !avatarRef.current.contains(event.target as Node)) {
        setIsAvatarMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const initial = user?.first_name ? user.first_name[0].toUpperCase() : '?'

  return (
    <div
      className="flex items-center justify-between px-6 py-3 select-none relative font-sans"
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-color)',
        minHeight: '52px'
      }}
    >
      {/* Brand on Left */}
      <div className="flex items-center gap-2.5">
        <img
          src={logoImg}
          alt="TripleS Production"
          className="w-8 h-8 rounded-full object-contain shrink-0 border shadow-sm select-none"
          style={{
            borderColor: 'var(--border-color)',
            backgroundColor: '#000000'
          }}
        />
        <h1
          className="text-sm font-extrabold tracking-wider uppercase font-sans"
          style={{ color: 'var(--text-primary)' }}
        >
          TRIPLES PRODUCTION
        </h1>
      </div>

      {/* Right Controls: User Profile Menu (Team selector completely removed) */}
      <div className="flex items-center gap-2">
        <div className="relative" ref={avatarRef}>
          <button
            onClick={() => {
              if (!user) {
                onOpenLogin()
              } else {
                setIsAvatarMenuOpen((prev) => !prev)
              }
            }}
            className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs transition-transform active:scale-95 border shadow-sm"
            style={{
              backgroundColor: 'var(--bg-surface-elevated)',
              borderColor: 'var(--border-color)',
              color: 'var(--text-primary)'
            }}
            title={user ? `${user.first_name} ${user.last_name || ''}` : 'Click to Sign In'}
          >
            {initial}
          </button>

          {/* Profile Dropdown Menu */}
          {isAvatarMenuOpen && (
            <div
              className="absolute right-0 mt-2 w-48 rounded-xl shadow-2xl border py-1.5 z-40 animate-fade-in font-sans"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-color)',
                color: 'var(--text-primary)'
              }}
            >
              {user && (
                <div
                  className="px-3.5 py-2 border-b mb-1"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <span className="text-xs font-bold block truncate" style={{ color: 'var(--text-primary)' }}>
                    {user.first_name} {user.last_name || ''}
                  </span>
                  <span className="text-[11px] block truncate" style={{ color: 'var(--text-secondary)' }}>
                    {user.designation || 'Designation not assigned'}
                  </span>
                </div>
              )}

              {/* Send bug report */}
              <button
                onClick={() => {
                  setIsAvatarMenuOpen(false)
                  onOpenBugReport()
                }}
                className="w-full px-3.5 py-2 text-left text-xs hover:bg-white/5 flex items-center gap-2 transition-colors"
                style={{ color: 'var(--text-secondary)' }}
              >
                <Bug size={14} />
                <span>Send bug report</span>
              </button>

              {/* Screenshots Inspection (Admin / HR) */}
              {user && (user.role === 'Admin' || (user.role as any) === 'Super Admin' || user.role === 'HR') && onOpenScreenshots && (
                <button
                  onClick={() => {
                    setIsAvatarMenuOpen(false)
                    onOpenScreenshots()
                  }}
                  className="w-full px-3.5 py-2 text-left text-xs hover:bg-white/5 flex items-center gap-2 transition-colors text-sky-400 font-medium"
                >
                  <Camera size={14} />
                  <span>Screenshots Inspection</span>
                </button>
              )}

              {/* Tracker Settings */}
              <button
                onClick={() => {
                  setIsAvatarMenuOpen(false)
                  onOpenSettings()
                }}
                className="w-full px-3.5 py-2 text-left text-xs hover:bg-white/5 flex items-center gap-2 transition-colors"
                style={{ color: 'var(--text-secondary)' }}
              >
                <SettingsIcon size={14} />
                <span>Settings</span>
              </button>

              <div className="my-1 border-t" style={{ borderColor: 'var(--border-color)' }} />

              {/* Sign Out */}
              <button
                onClick={() => {
                  setIsAvatarMenuOpen(false)
                  onSignOut()
                }}
                className="w-full px-3.5 py-2 text-left text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 flex items-center gap-2 transition-colors font-semibold"
              >
                <LogOut size={14} />
                <span>Sign Out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
