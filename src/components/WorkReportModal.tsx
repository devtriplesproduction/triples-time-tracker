import React from 'react'
import { X, BarChart2, Clock, Activity, ExternalLink } from 'lucide-react'
import type { TrackingSession, UserProfile, AppSettings } from '../types'

interface WorkReportModalProps {
  isOpen: boolean
  onClose: () => void
  user: UserProfile | null
  workedMinutes: number
  activeMinutes: number
  todaySessions: TrackingSession[]
  settings: AppSettings
}

export const WorkReportModal: React.FC<WorkReportModalProps> = ({
  isOpen,
  onClose,
  user,
  workedMinutes,
  activeMinutes,
  todaySessions,
  settings
}) => {
  if (!isOpen) return null

  const formatHrsMins = (minutes: number) => {
    const hrs = Math.floor(minutes / 60)
    const mins = minutes % 60
    return `${hrs}h ${mins.toString().padStart(2, '0')}m`
  }

  const handleOpenERPReport = () => {
    const url = `${settings.apiUrl || 'http://localhost:3000'}/attendance`
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(url)
    } else {
      window.open(url, '_blank')
    }
  }

  const todayFormatted = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata'
  }).format(new Date())

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div
        className="w-full max-w-md rounded-2xl border p-5 shadow-2xl transition-all"
        style={{
          backgroundColor: '#1C2026',
          borderColor: 'var(--border-color)',
          color: 'var(--text-primary)'
        }}
      >
        <div className="flex items-center justify-between pb-3 border-b mb-4" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex items-center gap-2">
            <BarChart2 size={18} className="text-sky-400" />
            <div>
              <h3 className="text-sm font-bold">Daily Work Report</h3>
              <p className="text-[11px] text-slate-400">{todayFormatted} (Asia/Kolkata)</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-white/10"
            style={{ color: 'var(--text-muted)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Worked Hours & Active Hours Summary Cards */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div
            className="p-3 rounded-xl border flex items-center gap-3"
            style={{ backgroundColor: '#141619', borderColor: 'var(--border-color)' }}
          >
            <div className="w-8 h-8 rounded-lg bg-blue-500/15 text-blue-400 flex items-center justify-center shrink-0">
              <Clock size={16} />
            </div>
            <div>
              <span className="text-[10px] text-slate-400 font-medium block">Worked Hours</span>
              <span className="text-sm font-bold text-white">{formatHrsMins(workedMinutes)}</span>
            </div>
          </div>

          <div
            className="p-3 rounded-xl border flex items-center gap-3"
            style={{ backgroundColor: '#141619', borderColor: 'var(--border-color)' }}
          >
            <div className="w-8 h-8 rounded-lg bg-green-500/15 text-green-400 flex items-center justify-center shrink-0">
              <Activity size={16} />
            </div>
            <div>
              <span className="text-[10px] text-slate-400 font-medium block">Active Hours</span>
              <span className="text-sm font-bold text-white">{formatHrsMins(activeMinutes)}</span>
            </div>
          </div>
        </div>

        {/* Sessions list */}
        <div className="mb-4">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-2">
            Today's Sessions ({todaySessions.length})
          </span>
          <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
            {todaySessions.length === 0 ? (
              <p className="text-xs text-slate-500 italic py-2 text-center">No sessions recorded yet today.</p>
            ) : (
              todaySessions.map((s, idx) => {
                const inTime = new Date(s.clock_in).toLocaleTimeString('en-US', {
                  timeZone: 'Asia/Kolkata',
                  hour: '2-digit',
                  minute: '2-digit'
                })
                const outTime = s.clock_out
                  ? new Date(s.clock_out).toLocaleTimeString('en-US', {
                      timeZone: 'Asia/Kolkata',
                      hour: '2-digit',
                      minute: '2-digit'
                    })
                  : 'In Progress'

                return (
                  <div
                    key={s.id || idx}
                    className="p-2 rounded-lg border flex items-center justify-between text-xs"
                    style={{ backgroundColor: '#141619', borderColor: 'var(--border-color)' }}
                  >
                    <span className="text-slate-300">
                      Session {idx + 1}: {inTime} - {outTime}
                    </span>
                    <span className="font-semibold text-white">
                      {formatHrsMins(s.worked_minutes || 0)}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center gap-2 pt-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
          <button
            onClick={handleOpenERPReport}
            className="flex-1 py-2 px-3 rounded-lg border font-medium text-xs text-slate-200 hover:bg-white/5 flex items-center justify-center gap-1.5 transition-colors"
            style={{ borderColor: 'var(--border-color)' }}
          >
            <span>Open ERP Attendance</span>
            <ExternalLink size={13} />
          </button>
          <button
            onClick={onClose}
            className="py-2 px-4 rounded-lg font-bold text-xs text-white transition-all shadow-sm"
            style={{ backgroundColor: 'var(--btn-blue)' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
