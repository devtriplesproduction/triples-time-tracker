import React from 'react'
import { BarChart2, Calendar } from 'lucide-react'

interface BottomActionCardsProps {
  onViewReport: () => void
  onApplyLeave: () => void
  onNeedHelp: () => void
}

export const BottomActionCards: React.FC<BottomActionCardsProps> = ({
  onViewReport,
  onApplyLeave,
  onNeedHelp
}) => {
  return (
    <div className="relative px-6 pb-6 pt-2 select-none">
      {/* Two centered horizontal action buttons */}
      <div className="flex items-center justify-center gap-4">
        {/* View your work report */}
        <button
          onClick={onViewReport}
          className="flex items-center gap-2.5 px-6 py-3.5 rounded-xl border transition-all hover:bg-white/5 active:scale-95 shadow-sm"
          style={{
            backgroundColor: '#1C2026',
            borderColor: 'var(--border-color)',
            color: '#F1F5F9'
          }}
        >
          <BarChart2 size={18} className="text-sky-400" />
          <span className="text-sm font-semibold tracking-wide">
            View your work report
          </span>
        </button>

        {/* Apply leave */}
        <button
          onClick={onApplyLeave}
          className="flex items-center gap-2.5 px-6 py-3.5 rounded-xl border transition-all hover:bg-white/5 active:scale-95 shadow-sm"
          style={{
            backgroundColor: '#1C2026',
            borderColor: 'var(--border-color)',
            color: '#F1F5F9'
          }}
        >
          <Calendar size={18} className="text-emerald-400" />
          <span className="text-sm font-semibold tracking-wide">
            Apply leave
          </span>
        </button>
      </div>

      {/* Floating / positioned 'Need help ?' button at bottom-right */}
      <div className="absolute right-5 bottom-4">
        <button
          onClick={onNeedHelp}
          className="px-4 py-2 rounded-full font-bold text-xs text-white transition-transform active:scale-95 shadow-lg flex items-center justify-center"
          style={{
            backgroundColor: 'var(--btn-blue)'
          }}
        >
          Need help ?
        </button>
      </div>
    </div>
  )
}
