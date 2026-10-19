import React, { useState } from 'react'
import { X, Bug, Check, AlertCircle } from 'lucide-react'
import type { UserProfile } from '../types'

interface BugReportModalProps {
  isOpen: boolean
  onClose: () => void
  user: UserProfile | null
}

export const BugReportModal: React.FC<BugReportModalProps> = ({ isOpen, onClose, user }) => {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !description.trim()) {
      setError('Please provide both a title and description.')
      return
    }

    setLoading(true)
    setError(null)
    try {
      if (window.electronAPI?.submitBugReport) {
        await window.electronAPI.submitBugReport({ title, description })
      }
      setSubmitted(true)
      setTimeout(() => {
        setSubmitted(false)
        setTitle('')
        setDescription('')
        onClose()
      }, 1800)
    } catch (err: any) {
      setError(err.message || 'Failed to submit bug report')
    } finally {
      setLoading(false)
    }
  }

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
            <Bug size={18} className="text-red-400" />
            <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              Send Bug Report
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

        {error && (
          <div className="flex items-center gap-2 p-2.5 mb-3 rounded-lg text-xs bg-red-500/15 text-red-400 border border-red-500/30">
            <AlertCircle size={14} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {submitted ? (
          <div className="py-8 flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center mb-2">
              <Check size={24} />
            </div>
            <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Report Submitted</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>Thank you for helping us improve TripleS.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3 text-xs">
            <div>
              <label
                className="block text-[11px] font-semibold uppercase tracking-wider mb-1"
                style={{ color: 'var(--text-secondary)' }}
              >
                Summary / Issue Title
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Brief summary of what happened"
                className="w-full px-3 py-2 rounded-lg border text-xs outline-none transition-all"
                style={{
                  backgroundColor: 'var(--bg-surface-elevated)',
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-primary)'
                }}
              />
            </div>

            <div>
              <label
                className="block text-[11px] font-semibold uppercase tracking-wider mb-1"
                style={{ color: 'var(--text-secondary)' }}
              >
                Details & Steps to Reproduce
              </label>
              <textarea
                required
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what occurred, steps to reproduce, or attach relevant logs..."
                className="w-full px-3 py-2 rounded-lg border text-xs outline-none transition-all resize-none"
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
                onClick={onClose}
                className="flex-1 py-2 rounded-lg border font-medium transition-colors hover:bg-white/5"
                style={{
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-secondary)'
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 py-2 rounded-lg font-bold transition-all active:scale-95 disabled:opacity-50"
                style={{
                  backgroundColor: 'var(--btn-primary-bg)',
                  color: 'var(--btn-primary-text)'
                }}
              >
                {loading ? 'Submitting...' : 'Submit Report'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
