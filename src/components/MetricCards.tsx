import React from 'react'
import { Clock, Activity } from 'lucide-react'

interface MetricCardsProps {
  workedMinutes: number
  activeMinutes: number
}

export const MetricCards: React.FC<MetricCardsProps> = ({ workedMinutes, activeMinutes }) => {
  const formatHoursMinutes = (totalMinutes: number) => {
    const hrs = Math.floor(totalMinutes / 60)
    const mins = totalMinutes % 60
    return `${hrs}h ${mins.toString().padStart(2, '0')}m`
  }

  return (
    <div className="grid grid-cols-2 gap-3 px-6 my-2">
      {/* Worked Hours Card */}
      <div 
        className="flex items-center gap-3 p-3.5 rounded-xl border transition-all"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-color)',
          boxShadow: 'var(--shadow-sm)'
        }}
      >
        <div 
          className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
          style={{
            backgroundColor: 'rgba(59, 130, 246, 0.15)',
            color: 'var(--accent-blue)'
          }}
        >
          <Clock size={20} />
        </div>
        <div className="flex flex-col">
          <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
            Worked Hours
          </span>
          <span className="text-base font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            {formatHoursMinutes(workedMinutes)}
          </span>
        </div>
      </div>

      {/* Active Hours Card */}
      <div 
        className="flex items-center gap-3 p-3.5 rounded-xl border transition-all"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-color)',
          boxShadow: 'var(--shadow-sm)'
        }}
      >
        <div 
          className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
          style={{
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            color: 'var(--status-green)'
          }}
        >
          <Activity size={20} />
        </div>
        <div className="flex flex-col">
          <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
            Active Hours
          </span>
          <span className="text-base font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            {formatHoursMinutes(activeMinutes)}
          </span>
        </div>
      </div>
    </div>
  )
}
