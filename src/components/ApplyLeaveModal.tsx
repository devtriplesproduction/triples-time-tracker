import React, { useState } from 'react'
import { X, Calendar, ExternalLink, Check, AlertCircle } from 'lucide-react'
import type { UserProfile, AppSettings } from '../types'

interface ApplyLeaveModalProps {
  isOpen: boolean
  onClose: () => void
  user: UserProfile | null
  settings: AppSettings
}

export const ApplyLeaveModal: React.FC<ApplyLeaveModalProps> = ({
  isOpen,
  onClose,
  user,
  settings
}) => {
  const [leaveType, setLeaveType] = useState('Casual Leave')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const handleOpenERPLeave = () => {
    const baseUrl = settings.apiUrl && settings.apiUrl !== 'http://localhost:3000'
      ? settings.apiUrl
      : 'https://erp.triplesproduction.com'
    const url = `${baseUrl}/leave`
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(url)
    } else {
      window.open(url, '_blank')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!startDate || !reason.trim()) {
      setError('Please select date and provide reason.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      if (window.electronAPI?.applyLeave) {
        const res = await window.electronAPI.applyLeave({
          leaveType,
          startDate,
          endDate: endDate || startDate,
          reason: reason.trim()
        })
        if (res && !res.success) {
          setError(res.error || 'Failed to submit leave application')
          return
        }
      }
      setSubmitted(true)
      setTimeout(() => {
        setSubmitted(false)
        setStartDate('')
        setEndDate('')
        setReason('')
        onClose()
      }, 1800)
    } catch (err: any) {
      setError(err.message || 'Failed to submit leave application')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
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
            <Calendar size={18} className="text-emerald-500" />
            <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Apply for Leave</h3>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover-surface"
            style={{ color: 'var(--text-secondary)' }}
          >
            <X size={16} />
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-2.5 mb-3 rounded-lg text-xs bg-red-500/15 text-red-400 border border-red-500/30">
            <AlertCircle size={14} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {submitted ? (
          <div className="py-8 flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center mb-2">
              <Check size={24} />
            </div>
            <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Leave Request Submitted</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>Sent to your manager for approval.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3 text-xs">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                Leave Type
              </label>
              <select
                value={leaveType}
                onChange={(e) => setLeaveType(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border text-xs outline-none transition-all focus:border-blue-500"
                style={{
                  backgroundColor: 'var(--bg-surface-elevated)',
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-primary)'
                }}
              >
                <option value="Casual Leave">Casual Leave (CL)</option>
                <option value="Sick Leave">Sick Leave (SL)</option>
                <option value="Earned Leave">Earned Leave (EL)</option>
                <option value="Half Day">Half Day</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                  Start Date
                </label>
                <input
                  type="date"
                  required
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border text-xs outline-none transition-all focus:border-blue-500"
                  style={{
                    backgroundColor: 'var(--bg-surface-elevated)',
                    borderColor: 'var(--border-color)',
                    color: 'var(--text-primary)'
                  }}
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                  End Date
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border text-xs outline-none transition-all focus:border-blue-500"
                  style={{
                    backgroundColor: 'var(--bg-surface-elevated)',
                    borderColor: 'var(--border-color)',
                    color: 'var(--text-primary)'
                  }}
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                Reason
              </label>
              <textarea
                required
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Brief reason for leave request..."
                className="w-full px-3 py-2 rounded-lg border text-xs outline-none transition-all focus:border-blue-500 resize-none"
                style={{
                  backgroundColor: 'var(--bg-surface-elevated)',
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-primary)'
                }}
              />
            </div>

            <div className="pt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={handleOpenERPLeave}
                className="flex-1 py-2 rounded-lg border font-medium hover-surface flex items-center justify-center gap-1 transition-colors text-[11px]"
                style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
              >
                <span>ERP Portal</span>
                <ExternalLink size={12} />
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 py-2 rounded-lg font-bold transition-all active:scale-95 disabled:opacity-50 text-xs"
                style={{ backgroundColor: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
              >
                {loading ? 'Submitting...' : 'Apply Leave'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
