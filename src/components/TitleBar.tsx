import React from 'react'
import { Minus, Square, X, Activity } from 'lucide-react'
import type { TrackingStatus } from '../types'

interface TitleBarProps {
  status: TrackingStatus
  theme: 'dark' | 'light'
}

export const TitleBar: React.FC<TitleBarProps> = ({ status }) => {
  const handleMinimize = () => window.electronAPI?.minimizeWindow()
  const handleMaximize = () => window.electronAPI?.maximizeWindow()
  const handleClose = () => window.electronAPI?.closeWindow()

  const isWorking = status === 'Working' || status === 'working'
  const isOnBreak = status === 'On Break' || status === 'on_break'

  return (
    <div className="titlebar-drag flex items-center justify-between px-3 py-2 border-b select-none"
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderColor: 'var(--border-color)',
        height: '42px'
      }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-full flex items-center justify-center font-bold text-xs bg-blue-500 text-white">
          T
        </div>
        <span className="font-semibold text-xs tracking-wide" style={{ color: 'var(--text-primary)' }}>
          TripleS Time Tracker
        </span>
      </div>

      {/* Status Pill & Controls */}
      <div className="flex items-center gap-3 no-drag">
        {/* Status Pill */}
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium"
          style={{
            backgroundColor: isWorking 
              ? 'rgba(16, 185, 129, 0.12)' 
              : isOnBreak 
              ? 'rgba(245, 158, 11, 0.12)' 
              : 'rgba(148, 163, 184, 0.12)',
            color: isWorking 
              ? 'var(--status-green)' 
              : isOnBreak 
              ? 'var(--status-amber)' 
              : 'var(--text-muted)'
          }}
        >
          <span 
            className={`w-1.5 h-1.5 rounded-full ${isWorking ? 'animate-pulse-dot' : ''}`}
            style={{
              backgroundColor: isWorking 
                ? 'var(--status-green)' 
                : isOnBreak 
                ? 'var(--status-amber)' 
                : 'var(--text-muted)'
            }}
          />
          <span>{isWorking ? 'Tracking Active' : isOnBreak ? 'On Break' : 'Offline'}</span>
        </div>

        {/* Window Controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleMinimize}
            className="w-7 h-7 rounded flex items-center justify-center transition-colors hover:bg-slate-500/10"
            style={{ color: 'var(--text-muted)' }}
            title="Minimize"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={handleMaximize}
            className="w-7 h-7 rounded flex items-center justify-center transition-colors hover:bg-slate-500/10"
            style={{ color: 'var(--text-muted)' }}
            title="Maximize"
          >
            <Square size={12} />
          </button>
          <button
            onClick={handleClose}
            className="w-7 h-7 rounded flex items-center justify-center transition-colors hover:bg-red-500 hover:text-white"
            style={{ color: 'var(--text-muted)' }}
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
