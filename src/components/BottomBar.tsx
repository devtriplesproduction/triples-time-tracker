import React from 'react'
import { Settings, Moon, Sun, AlertTriangle } from 'lucide-react'

interface BottomBarProps {
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  onOpenSettings: () => void
  pendingSyncCount?: number
  isOnline?: boolean
}

export const BottomBar: React.FC<BottomBarProps> = ({
  theme,
  onToggleTheme,
  onOpenSettings,
  pendingSyncCount = 0,
  isOnline = true
}) => {
  return (
    <div 
      className="flex items-center justify-between px-6 py-3 border-t mt-auto text-xs"
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderColor: 'var(--border-color)'
      }}
    >
      {/* Settings & Theme */}
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-1.5 font-medium transition-colors hover:text-blue-500"
          style={{ color: 'var(--text-muted)' }}
          title="Open Settings"
        >
          <Settings size={14} />
          <span>Settings</span>
        </button>

        <button
          onClick={onToggleTheme}
          className="p-1 rounded transition-colors hover:bg-slate-500/10"
          style={{ color: 'var(--text-muted)' }}
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>

      {/* Sync / Offline status & App running status */}
      <div className="flex items-center gap-3">
        {pendingSyncCount > 0 ? (
          <div 
            className="flex items-center gap-1.5 font-semibold text-amber-500 text-[11px] bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20"
            title="Unsynchronized activity records safely buffered locally. Will auto-sync when network connects."
          >
            <AlertTriangle size={12} className="animate-pulse" />
            <span>{pendingSyncCount} pending sync</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 font-medium" style={{ color: 'var(--text-muted)' }}>
            <span 
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: isOnline ? 'var(--status-green)' : '#f59e0b' }}
            />
            <span className="text-[11px]">{isOnline ? 'Synced' : 'Offline'}</span>
          </div>
        )}

        <div className="flex items-center gap-1.5 font-medium" style={{ color: 'var(--text-muted)' }}>
          <span 
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: 'var(--status-green)' }}
          />
          <span className="text-[11px]">Running</span>
        </div>
      </div>
    </div>
  )
}

