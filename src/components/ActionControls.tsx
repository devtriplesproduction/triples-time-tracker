import React, { useState } from 'react'
import { Play, Square, Pause, Coffee } from 'lucide-react'
import type { TrackingStatus } from '../types'

interface ActionControlsProps {
  status: TrackingStatus
  onClockIn: () => Promise<void>
  onTakeBreak: () => Promise<void>
  onResume: () => Promise<void>
  onClockOut: () => Promise<void>
}

export const ActionControls: React.FC<ActionControlsProps> = ({
  status,
  onClockIn,
  onTakeBreak,
  onResume,
  onClockOut
}) => {
  const [loading, setLoading] = useState(false)

  const handleAction = async (fn: () => Promise<void>) => {
    try {
      setLoading(true)
      await fn()
    } finally {
      setLoading(false)
    }
  }

  const isWorking = status === 'Working' || status === 'working'
  const isOnBreak = status === 'On Break' || status === 'on_break'
  const isClockedOut = status === 'Not Clocked In' || status === 'Completed' || status === 'completed'

  return (
    <div className="px-6 my-4">
      {isClockedOut ? (
        /* Clock In / Start Session */
        <button
          onClick={() => handleAction(onClockIn)}
          disabled={loading}
          className="w-full py-3.5 px-4 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-2.5 transition-all shadow-md active:scale-[0.98] disabled:opacity-50"
          style={{
            backgroundColor: 'var(--status-green)'
          }}
        >
          <Play size={18} fill="currentColor" />
          <span>Clock In / Start Session</span>
        </button>
      ) : (
        /* Active Controls: Take Break / Resume & Clock Out */
        <div className="grid grid-cols-2 gap-3">
          {/* Take Break or Resume */}
          {isWorking ? (
            <button
              onClick={() => handleAction(onTakeBreak)}
              disabled={loading}
              className="py-3 px-4 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-2 transition-all shadow-md active:scale-[0.98] disabled:opacity-50"
              style={{
                backgroundColor: 'var(--accent-blue)'
              }}
            >
              <Pause size={16} fill="currentColor" />
              <span>Take a Break</span>
            </button>
          ) : (
            <button
              onClick={() => handleAction(onResume)}
              disabled={loading}
              className="py-3 px-4 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-2 transition-all shadow-md active:scale-[0.98] disabled:opacity-50"
              style={{
                backgroundColor: 'var(--accent-blue)'
              }}
            >
              <Play size={16} fill="currentColor" />
              <span>Resume</span>
            </button>
          )}

          {/* Clock Out */}
          <button
            onClick={() => handleAction(onClockOut)}
            disabled={loading}
            className="py-3 px-4 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-2 transition-all shadow-md active:scale-[0.98] disabled:opacity-50"
            style={{
              backgroundColor: 'var(--status-red)'
            }}
          >
            <Square size={14} fill="currentColor" />
            <span>Clock Out</span>
          </button>
        </div>
      )}
    </div>
  )
}
