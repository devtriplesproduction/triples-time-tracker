import React from 'react'
import { X, HelpCircle, Mail } from 'lucide-react'

interface HelpModalProps {
  isOpen: boolean
  onClose: () => void
}

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in font-sans">
      <div
        className="w-full max-w-sm rounded-2xl border p-5 shadow-2xl transition-all"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-color)',
          color: 'var(--text-primary)'
        }}
      >
        <div className="flex items-center justify-between pb-3 border-b mb-4" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex items-center gap-2">
            <HelpCircle size={18} style={{ color: 'var(--text-secondary)' }} />
            <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              Help & Support
            </h3>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-white/10"
            style={{ color: 'var(--text-secondary)' }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3.5 text-xs">
          <div
            className="p-3 rounded-xl border"
            style={{
              backgroundColor: 'var(--bg-surface-elevated)',
              borderColor: 'var(--border-color)'
            }}
          >
            <span className="font-semibold block mb-1" style={{ color: 'var(--text-primary)' }}>
              TripleS Time Tracker
            </span>
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Tracks your daily working hours with automated idle detection, midnight reset (Asia/Kolkata), and break management.
            </p>
          </div>

          <div className="space-y-2">
            <span
              className="text-[11px] font-semibold uppercase tracking-wider block"
              style={{ color: 'var(--text-secondary)' }}
            >
              Quick Guide
            </span>
            <div className="text-[11px] space-y-1.5 pl-1" style={{ color: 'var(--text-secondary)' }}>
              <p>• <strong className="text-white">Clock In:</strong> Start your daily tracking session.</p>
              <p>• <strong className="text-white">Take a Break:</strong> Immediately stops worked timer and active hours.</p>
              <p>• <strong className="text-white">Resume Work:</strong> Resumes worked timer from previous duration.</p>
              <p>• <strong className="text-white">Midnight Reset:</strong> The daily display resets to 00:00:00 without interrupting your active session.</p>
            </div>
          </div>

          <div
            className="p-2.5 rounded-xl border flex items-center gap-2.5 text-[11px]"
            style={{
              backgroundColor: 'var(--bg-surface-elevated)',
              borderColor: 'var(--border-color)'
            }}
          >
            <Mail size={15} style={{ color: 'var(--text-secondary)' }} className="shrink-0" />
            <div className="truncate">
              <span className="block text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                Support & Contact:
              </span>
              <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                support@tsp.com
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-lg font-bold text-xs transition-all shadow-sm mt-2"
            style={{
              backgroundColor: 'var(--btn-primary-bg)',
              color: 'var(--btn-primary-text)'
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
