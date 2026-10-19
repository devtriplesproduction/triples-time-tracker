import React from 'react'
import { Minus, Square, X, Sun, Moon } from 'lucide-react'
import type { TrackingStatus } from '../types'

interface TitleBarProps {
  status: TrackingStatus
  theme: 'dark' | 'light'
  onToggleTheme?: () => void
}

export const TitleBar: React.FC<TitleBarProps> = ({ theme, onToggleTheme }) => {
  const handleMinimize = () => window.electronAPI?.minimizeWindow()
  const handleMaximize = () => window.electronAPI?.maximizeWindow()
  const handleClose = () => window.electronAPI?.closeWindow()

  return (
    <div
      className="titlebar-drag flex items-center justify-between px-3 select-none relative font-sans"
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderColor: 'var(--border-color)',
        height: '34px',
        borderBottom: '1px solid var(--border-color)'
      }}
    >
      {/* Brand / App Title */}
      <div className="flex items-center gap-2">
        <span
          className="text-xs font-semibold tracking-wide"
          style={{ color: 'var(--text-secondary)' }}
        >
          TripleS Time Tracker
        </span>
      </div>

      {/* Window Controls on Right */}
      <div className="flex items-center gap-1 no-drag">
        {onToggleTheme && (
          <button
            onClick={onToggleTheme}
            className="w-7 h-7 rounded flex items-center justify-center transition-colors hover:bg-white/10"
            style={{ color: 'var(--text-secondary)' }}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
          </button>
        )}

        <button
          onClick={handleMinimize}
          className="w-7 h-7 rounded flex items-center justify-center transition-colors hover:bg-white/10"
          style={{ color: 'var(--text-secondary)' }}
          title="Minimize"
        >
          <Minus size={13} />
        </button>

        <button
          onClick={handleMaximize}
          className="w-7 h-7 rounded flex items-center justify-center transition-colors hover:bg-white/10"
          style={{ color: 'var(--text-secondary)' }}
          title="Maximize"
        >
          <Square size={11} />
        </button>

        <button
          onClick={handleClose}
          className="w-7 h-7 rounded flex items-center justify-center transition-colors hover:bg-red-500 hover:text-white"
          style={{ color: 'var(--text-secondary)' }}
          title="Close"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  )
}
