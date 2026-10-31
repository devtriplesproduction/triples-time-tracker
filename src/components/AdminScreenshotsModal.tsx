import React, { useState, useEffect, useCallback } from 'react'
import {
  X,
  Camera,
  Calendar,
  User,
  Search,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Download,
  Trash2,
  Clock,
  Laptop,
  RefreshCw,
  AlertCircle
} from 'lucide-react'
import type { ScreenshotRecord, UserProfile } from '../types'

interface AdminScreenshotsModalProps {
  isOpen: boolean
  onClose: () => void
  currentUser: UserProfile | null
}

export const AdminScreenshotsModal: React.FC<AdminScreenshotsModalProps> = ({
  isOpen,
  onClose,
  currentUser
}) => {
  const [employees, setEmployees] = useState<UserProfile[]>([])
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('')
  const [searchEmployeeQuery, setSearchEmployeeQuery] = useState<string>('')

  // Date & Month filtering
  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date())

  const currentMonthStr = todayStr.slice(0, 7) // 'YYYY-MM'

  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr)
  const [selectedDate, setSelectedDate] = useState<string>(todayStr)
  const [filterMode, setFilterMode] = useState<'date' | 'month'>('date')

  const [screenshots, setScreenshots] = useState<ScreenshotRecord[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  // Lightbox state
  const [activeLightboxIndex, setActiveLightboxIndex] = useState<number | null>(null)
  const [isDeleting, setIsDeleting] = useState<boolean>(false)
  const [isCapturingNow, setIsCapturingNow] = useState<boolean>(false)

  // Load all employees on modal open
  useEffect(() => {
    if (!isOpen) return

    const fetchEmployees = async () => {
      try {
        if (window.electronAPI?.getAllEmployeesForAdmin) {
          const res = await window.electronAPI.getAllEmployeesForAdmin()
          if (res.success && res.employees.length > 0) {
            setEmployees(res.employees)
            if (!selectedEmployeeId) {
              const defaultEmp = currentUser?.id || res.employees[0].id
              setSelectedEmployeeId(defaultEmp)
            }
          } else if (currentUser) {
            setEmployees([currentUser])
            setSelectedEmployeeId(currentUser.id)
          }
        } else if (currentUser) {
          setEmployees([currentUser])
          setSelectedEmployeeId(currentUser.id)
        }
      } catch (err: any) {
        console.warn('Failed to load employees for screenshot view:', err)
        if (currentUser) {
          setEmployees([currentUser])
          setSelectedEmployeeId(currentUser.id)
        }
      }
    }

    fetchEmployees()
  }, [isOpen, currentUser])

  // Fetch screenshots when selected employee, date, or month changes
  const loadScreenshots = useCallback(async () => {
    if (!selectedEmployeeId || !window.electronAPI?.getScreenshots) return

    setLoading(true)
    setError(null)

    try {
      const params: any = {
        employeeId: selectedEmployeeId
      }

      if (filterMode === 'date') {
        params.sessionDate = selectedDate
      } else {
        params.month = selectedMonth
      }

      const res = await window.electronAPI.getScreenshots(params)
      if (res.success) {
        setScreenshots(res.screenshots || [])
      } else {
        setError(res.error || 'Failed to load screenshots')
        setScreenshots([])
      }
    } catch (err: any) {
      setError(err.message || 'Error querying screenshots')
      setScreenshots([])
    } finally {
      setLoading(false)
    }
  }, [selectedEmployeeId, filterMode, selectedDate, selectedMonth])

  useEffect(() => {
    if (isOpen && selectedEmployeeId) {
      loadScreenshots()
    }
  }, [isOpen, selectedEmployeeId, filterMode, selectedDate, selectedMonth, loadScreenshots])

  // Listen for live screenshots captured in background
  useEffect(() => {
    if (!isOpen || !window.electronAPI?.onScreenshotCaptured) return

    const unsubscribe = window.electronAPI.onScreenshotCaptured((newScreenshot) => {
      if (newScreenshot.employee_id === selectedEmployeeId) {
        setScreenshots((prev) => {
          if (prev.some((s) => s.id === newScreenshot.id)) return prev
          return [...prev, newScreenshot]
        })
      }
    })

    return () => {
      unsubscribe()
    }
  }, [isOpen, selectedEmployeeId])

  // Lightbox keyboard navigation
  useEffect(() => {
    if (activeLightboxIndex === null) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        setActiveLightboxIndex((prev) =>
          prev !== null && prev < screenshots.length - 1 ? prev + 1 : prev
        )
      } else if (e.key === 'ArrowLeft') {
        setActiveLightboxIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : prev))
      } else if (e.key === 'Escape') {
        setActiveLightboxIndex(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeLightboxIndex, screenshots.length])

  if (!isOpen) return null

  // Month generator for last 12 months
  const generatePastMonths = () => {
    const list: Array<{ value: string; label: string }> = []
    const d = new Date()
    for (let i = 0; i < 12; i++) {
      const monthDate = new Date(d.getFullYear(), d.getMonth() - i, 1)
      const val = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit'
      }).format(monthDate)
      const label = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: 'long'
      }).format(monthDate)
      list.push({ value: val, label })
    }
    return list
  }

  const pastMonths = generatePastMonths()

  const selectedEmployee = employees.find((e) => e.id === selectedEmployeeId) || currentUser

  const filteredEmployees = employees.filter((e) => {
    if (!searchEmployeeQuery.trim()) return true
    const q = searchEmployeeQuery.toLowerCase()
    const name = `${e.first_name} ${e.last_name || ''}`.toLowerCase()
    const dept = (e.department || '').toLowerCase()
    const desig = (e.designation || '').toLowerCase()
    return name.includes(q) || dept.includes(q) || desig.includes(q)
  })

  const handleDeleteActiveScreenshot = async () => {
    if (activeLightboxIndex === null || !screenshots[activeLightboxIndex]) return
    const target = screenshots[activeLightboxIndex]
    if (!confirm('Are you sure you want to delete this screenshot?')) return

    try {
      setIsDeleting(true)
      if (window.electronAPI?.deleteScreenshot) {
        await window.electronAPI.deleteScreenshot(target.id)
      }
      setScreenshots((prev) => prev.filter((s) => s.id !== target.id))
      setActiveLightboxIndex(null)
    } catch (err: any) {
      alert('Failed to delete screenshot: ' + err.message)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleCaptureNow = async () => {
    if (!window.electronAPI?.captureScreenshotNow) return
    setIsCapturingNow(true)
    try {
      const res = await window.electronAPI.captureScreenshotNow()
      if (res.success && res.screenshot) {
        if (res.screenshot.employee_id === selectedEmployeeId) {
          setScreenshots((prev) => [...prev, res.screenshot!])
        }
      } else {
        alert(res.error || 'Capture failed')
      }
    } finally {
      setIsCapturingNow(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-black/80 backdrop-blur-md animate-fade-in font-sans select-none">
      <div
        className="w-full max-w-5xl h-[88vh] rounded-2xl border flex flex-col overflow-hidden shadow-2xl transition-all"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-color)',
          color: 'var(--text-primary)'
        }}
      >
        {/* 1. Header Bar */}
        <div
          className="flex items-center justify-between px-5 py-3.5 border-b shrink-0"
          style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-surface-elevated)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center border shadow-sm"
              style={{
                backgroundColor: 'var(--btn-primary-bg)',
                color: 'var(--btn-primary-text)',
                borderColor: 'var(--border-color)'
              }}
            >
              <Camera size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold tracking-tight">Screenshots Inspection</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/15 text-blue-400 border border-blue-500/30">
                  Every 7 Minutes
                </span>
              </div>
              <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                Automated full-screen captures stored across months for all employees
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Quick manual capture for current user */}
            {selectedEmployeeId === currentUser?.id && (
              <button
                onClick={handleCaptureNow}
                disabled={isCapturingNow}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-colors hover:bg-white/10 disabled:opacity-50"
                style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                title="Capture screen immediately"
              >
                <Camera size={13} className={isCapturingNow ? 'animate-pulse' : ''} />
                <span>{isCapturingNow ? 'Capturing...' : 'Capture Now'}</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-white/10"
              style={{ color: 'var(--text-secondary)' }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* 2. Controls Toolbar: Employee Selector + Month / Date Filter */}
        <div
          className="p-3.5 border-b flex flex-wrap items-center justify-between gap-3 shrink-0 text-xs"
          style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-surface)' }}
        >
          {/* Employee Dropdown / Search */}
          <div className="flex items-center gap-2 flex-1 min-w-[280px]">
            <span className="font-semibold text-[11px] uppercase tracking-wider text-slate-400">
              Employee:
            </span>
            <div className="relative flex-1">
              <select
                value={selectedEmployeeId}
                onChange={(e) => setSelectedEmployeeId(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border text-xs outline-none transition-all cursor-pointer font-medium"
                style={{
                  backgroundColor: 'var(--bg-surface-elevated)',
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-primary)'
                }}
              >
                {filteredEmployees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.first_name} {emp.last_name || ''} ({emp.designation || emp.role || 'Employee'})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Filter Mode & Date/Month Selectors */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Toggle Date vs Month Mode */}
            <div
              className="flex items-center p-0.5 rounded-lg border"
              style={{ backgroundColor: 'var(--bg-surface-elevated)', borderColor: 'var(--border-color)' }}
            >
              <button
                onClick={() => setFilterMode('date')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                  filterMode === 'date' ? 'bg-white/15 text-white shadow-sm' : 'text-slate-400'
                }`}
              >
                Single Day
              </button>
              <button
                onClick={() => setFilterMode('month')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                  filterMode === 'month' ? 'bg-white/15 text-white shadow-sm' : 'text-slate-400'
                }`}
              >
                Full Month
              </button>
            </div>

            {filterMode === 'date' ? (
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="px-2.5 py-1 rounded-lg border text-xs outline-none"
                  style={{
                    backgroundColor: 'var(--bg-surface-elevated)',
                    borderColor: 'var(--border-color)',
                    color: 'var(--text-primary)'
                  }}
                />
                {selectedDate !== todayStr && (
                  <button
                    onClick={() => setSelectedDate(todayStr)}
                    className="px-2 py-1 rounded text-[11px] font-semibold border hover:bg-white/10"
                    style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
                  >
                    Today
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="px-3 py-1 rounded-lg border text-xs outline-none cursor-pointer"
                  style={{
                    backgroundColor: 'var(--bg-surface-elevated)',
                    borderColor: 'var(--border-color)',
                    color: 'var(--text-primary)'
                  }}
                >
                  {pastMonths.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              onClick={loadScreenshots}
              disabled={loading}
              className="p-1.5 rounded-lg border hover:bg-white/10 transition-colors"
              style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
              title="Refresh screenshots"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* 3. Sub-banner: Employee Details & Screenshot Statistics */}
        <div
          className="px-5 py-2.5 border-b flex items-center justify-between text-xs shrink-0"
          style={{ backgroundColor: 'var(--bg-surface-elevated)', borderColor: 'var(--border-color)' }}
        >
          <div className="flex items-center gap-2">
            <span className="font-bold text-white">
              {selectedEmployee?.first_name} {selectedEmployee?.last_name || ''}
            </span>
            <span className="text-slate-400">•</span>
            <span className="text-slate-400">{selectedEmployee?.designation || 'Employee'}</span>
            <span className="text-slate-400">•</span>
            <span className="text-slate-400">{selectedEmployee?.department || 'Department'}</span>
          </div>

          <div className="flex items-center gap-3 font-medium">
            <span className="text-slate-400">
              Total Captured:{' '}
              <strong className="text-white font-bold">{screenshots.length}</strong>
            </span>
            <span className="text-slate-400">•</span>
            <span className="text-slate-400">Cadence: ~7 mins</span>
          </div>
        </div>

        {/* 4. Gallery Grid Container */}
        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <div className="mb-4 p-3 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 text-xs flex items-center gap-2">
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2.5 py-16">
              <div className="w-6 h-6 border-2 border-slate-600 border-t-white rounded-full animate-spin" />
              <span className="text-xs">Fetching screenshots from database...</span>
            </div>
          ) : screenshots.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-16 text-slate-400">
              <Camera size={36} className="text-slate-600 mb-3" />
              <h4 className="text-sm font-bold text-white">No Screenshots Found</h4>
              <p className="text-xs text-slate-400 mt-1 max-w-sm">
                No automatic 7-minute screenshots were recorded for this employee during the selected{' '}
                {filterMode === 'date' ? `date (${selectedDate})` : `month (${selectedMonth})`}.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {screenshots.map((item, index) => {
                const timeStr = new Date(item.captured_at).toLocaleTimeString('en-US', {
                  timeZone: 'Asia/Kolkata',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit'
                })

                const dateStr = item.session_date

                const imgSrc = item.image_url || item.image_data || ''

                return (
                  <div
                    key={item.id}
                    onClick={() => setActiveLightboxIndex(index)}
                    className="group rounded-xl border overflow-hidden cursor-pointer transition-all hover:scale-[1.02] hover:shadow-xl relative flex flex-col"
                    style={{
                      backgroundColor: 'var(--bg-surface-elevated)',
                      borderColor: 'var(--border-color)'
                    }}
                  >
                    {/* Image Thumbnail */}
                    <div className="w-full aspect-video bg-black/40 overflow-hidden relative flex items-center justify-center">
                      {imgSrc ? (
                        <img
                          src={imgSrc}
                          alt={`Screenshot ${timeStr}`}
                          loading="lazy"
                          className="w-full h-full object-cover transition-transform group-hover:scale-105"
                        />
                      ) : (
                        <div className="text-slate-600 text-[11px] flex items-center gap-1">
                          <Camera size={14} />
                          <span>No Preview</span>
                        </div>
                      )}

                      {/* Hover Overlay with Maximize icon */}
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                        <div className="p-2 rounded-full bg-white/20 backdrop-blur-sm">
                          <Maximize2 size={16} />
                        </div>
                      </div>

                      {/* Time pill top-right */}
                      <div className="absolute top-1.5 right-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-black/75 text-white border border-white/10 backdrop-blur-sm">
                        {timeStr}
                      </div>
                    </div>

                    {/* Metadata Footer */}
                    <div className="p-2.5 flex flex-col gap-1 text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold truncate max-w-[140px] text-white" title={item.app_name || 'Desktop Work'}>
                          {item.app_name || 'Desktop Work'}
                        </span>
                        <span className="text-[10px] text-slate-400 shrink-0">
                          {Math.round((item.file_size_bytes || 0) / 1024)} KB
                        </span>
                      </div>

                      {item.window_title && (
                        <span
                          className="text-[10px] text-slate-400 truncate block"
                          title={item.window_title}
                        >
                          {item.window_title}
                        </span>
                      )}

                      {filterMode === 'month' && (
                        <span className="text-[9px] text-slate-500 font-mono mt-0.5">
                          {dateStr}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* 5. Lightbox Modal for High-Resolution Inspection */}
      {activeLightboxIndex !== null && screenshots[activeLightboxIndex] && (
        <div className="fixed inset-0 z-60 bg-black/95 flex flex-col justify-between p-4 animate-fade-in">
          {/* Top Info Bar */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 text-white shrink-0">
            <div className="flex items-center gap-3">
              <span className="font-bold text-sm">
                {selectedEmployee?.first_name} {selectedEmployee?.last_name || ''}
              </span>
              <span className="text-slate-400">•</span>
              <span className="text-xs font-mono text-emerald-400">
                {new Date(screenshots[activeLightboxIndex].captured_at).toLocaleTimeString('en-US', {
                  timeZone: 'Asia/Kolkata',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit'
                })}
              </span>
              <span className="text-slate-400">•</span>
              <span className="text-xs text-slate-300">
                {screenshots[activeLightboxIndex].session_date}
              </span>
              <span className="text-slate-400">•</span>
              <span className="text-xs text-sky-400 font-semibold truncate max-w-sm">
                {screenshots[activeLightboxIndex].app_name} — {screenshots[activeLightboxIndex].window_title || 'Desktop'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 mr-2">
                {activeLightboxIndex + 1} of {screenshots.length}
              </span>

              {/* Download */}
              {(screenshots[activeLightboxIndex].image_url || screenshots[activeLightboxIndex].image_data) && (
                <a
                  href={screenshots[activeLightboxIndex].image_url || screenshots[activeLightboxIndex].image_data!}
                  download={`screenshot-${selectedEmployee?.first_name}-${screenshots[activeLightboxIndex].captured_at}.jpg`}
                  className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-white"
                  title="Download full resolution screenshot"
                >
                  <Download size={16} />
                </a>
              )}

              {/* Delete */}
              <button
                onClick={handleDeleteActiveScreenshot}
                disabled={isDeleting}
                className="p-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors disabled:opacity-50"
                title="Delete screenshot"
              >
                <Trash2 size={16} />
              </button>

              {/* Close */}
              <button
                onClick={() => setActiveLightboxIndex(null)}
                className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-white ml-2"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Center Image Container with Previous / Next Arrows */}
          <div className="flex-1 flex items-center justify-between relative overflow-hidden py-3">
            {/* Prev Button */}
            <button
              onClick={() => setActiveLightboxIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : prev))}
              disabled={activeLightboxIndex === 0}
              className="absolute left-4 z-10 p-3 rounded-full bg-black/60 hover:bg-black/80 text-white border border-white/20 backdrop-blur-md transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={24} />
            </button>

            {/* High-Res Image Display */}
            <div className="w-full h-full flex items-center justify-center p-2">
              <img
                src={screenshots[activeLightboxIndex].image_url || screenshots[activeLightboxIndex].image_data || ''}
                alt="Full resolution capture"
                className="max-w-full max-h-[82vh] object-contain rounded-lg shadow-2xl border border-white/10"
              />
            </div>

            {/* Next Button */}
            <button
              onClick={() =>
                setActiveLightboxIndex((prev) =>
                  prev !== null && prev < screenshots.length - 1 ? prev + 1 : prev
                )
              }
              disabled={activeLightboxIndex === screenshots.length - 1}
              className="absolute right-4 z-10 p-3 rounded-full bg-black/60 hover:bg-black/80 text-white border border-white/20 backdrop-blur-md transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight size={24} />
            </button>
          </div>

          {/* Bottom Filmstrip / Thumbnails Slider */}
          <div className="h-16 flex items-center gap-2 overflow-x-auto px-4 py-1 border-t border-white/10 shrink-0">
            {screenshots.map((s, idx) => (
              <button
                key={s.id}
                onClick={() => setActiveLightboxIndex(idx)}
                className={`h-12 w-20 rounded-md overflow-hidden border-2 transition-all shrink-0 ${
                  activeLightboxIndex === idx ? 'border-blue-500 scale-105' : 'border-transparent opacity-60 hover:opacity-100'
                }`}
              >
                <img
                  src={s.image_url || s.image_data || ''}
                  alt="thumbnail"
                  className="w-full h-full object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

