const fs = require('fs');
const path = require('path');

const erpBase = path.resolve(__dirname, '../../TripleS-ERP');

// 1. Ensure components/time-tracking directory exists
const compDir = path.join(erpBase, 'components/time-tracking');
if (!fs.existsSync(compDir)) {
  fs.mkdirSync(compDir, { recursive: true });
}

// 2. Client Dashboard Component: TimeTrackingAdminDashboard.tsx
const clientCompContent = `'use client'

import React, { useState, useEffect } from 'react'
import {
  Clock,
  Activity,
  Users,
  Search,
  Calendar,
  ChevronDown,
  ArrowLeft,
  MoreVertical,
  CheckCircle2,
  TrendingUp,
  Laptop,
  RefreshCw,
  AlertCircle
} from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'

interface EmployeeReport {
  id: string
  name: string
  department: string
  designation: string
  status: 'Working' | 'Idle' | 'Offline' | 'On Break'
  workedHours: string
  activeHours: string
  workedMinutes: number
  activeMinutes: number
  lastActivity: string
  timeline?: Array<{ time: string; title: string; subtitle: string; status: string }>
  applications?: Array<{ name: string; duration: string; percent: number }>
  eodSynced?: boolean
  eodHours?: number
}

interface OverviewData {
  totalEmployees: number
  currentlyWorking: number
  totalWorkedMinutes: number
  totalActiveMinutes: number
  hourlyData: Array<{ hour: string; worked: number; active: number }>
}

export function TimeTrackingAdminDashboard() {
  const getTodayIST = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date())

  const [selectedDate, setSelectedDate] = useState<string>(getTodayIST())
  const [selectedDept, setSelectedDept] = useState<string>('All')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [employees, setEmployees] = useState<EmployeeReport[]>([])
  const [overview, setOverview] = useState<OverviewData>({
    totalEmployees: 0,
    currentlyWorking: 0,
    totalWorkedMinutes: 0,
    totalActiveMinutes: 0,
    hourlyData: []
  })
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeReport | null>(null)
  const [activeTab, setActiveTab] = useState<'timeline' | 'applications'>('timeline')
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const fetchReports = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(\`/api/time-tracking/admin/reports?department=\${encodeURIComponent(selectedDept)}&date=\${encodeURIComponent(selectedDate)}\`)
      if (!res.ok) {
        if (res.status === 403) {
          setError('Access Denied: Only Admin users are authorized to view time tracking analytics.')
          return
        }
        const errJson = await res.json().catch(() => ({}))
        throw new Error(errJson.error || \`Server returned HTTP \${res.status}\`)
      }
      const data = await res.json()
      if (data.success) {
        setEmployees(data.employees || [])
        setOverview(data.overview || {
          totalEmployees: 0,
          currentlyWorking: 0,
          totalWorkedMinutes: 0,
          totalActiveMinutes: 0,
          hourlyData: []
        })
      } else {
        throw new Error(data.error || 'Failed to load report data')
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred while fetching tracking reports')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchReports()
  }, [selectedDate, selectedDept])

  const filteredEmployees = employees.filter(emp => {
    const matchesSearch = emp.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          emp.designation.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          emp.department.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesSearch
  })

  const getStatusBadge = (status: string) => {
    if (status === 'Working') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Working
        </span>
      )
    }
    if (status === 'On Break' || status === 'Idle') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          {status === 'On Break' ? 'On Break' : 'Idle'}
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-zinc-500/10 text-zinc-500 border border-zinc-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
        Offline
      </span>
    )
  }

  const formatMins = (mins: number) => {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return \`\${h}h \${m.toString().padStart(2, '0')}m\`
  }

  // Employee Detail Drilldown View
  if (selectedEmployee) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto pb-12 animate-fade-in">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSelectedEmployee(null)}
            className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-lg hover:bg-muted"
          >
            <ArrowLeft size={16} />
            <span>Back to Dashboard</span>
          </button>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card text-xs font-medium">
            <Calendar size={14} className="text-muted-foreground" />
            <span>{selectedDate}</span>
          </div>
        </div>

        {/* Employee Header Card */}
        <div className="p-6 rounded-2xl border border-border bg-card shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-blue-600 text-white font-bold text-lg flex items-center justify-center shadow-md">
              {selectedEmployee.name.split(' ').map(n => n[0]).join('')}
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold tracking-tight text-foreground">{selectedEmployee.name}</h1>
                {getStatusBadge(selectedEmployee.status)}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                {selectedEmployee.designation} • {selectedEmployee.department}
              </p>
            </div>
          </div>

          {/* Metric Pills */}
          <div className="flex items-center gap-4 w-full sm:w-auto">
            <div className="flex-1 sm:flex-initial flex items-center gap-3 p-3 rounded-xl border border-border bg-muted/30">
              <div className="w-9 h-9 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center">
                <Clock size={18} />
              </div>
              <div>
                <span className="text-[11px] font-medium text-muted-foreground block">Worked Hours</span>
                <span className="text-base font-bold text-foreground">{selectedEmployee.workedHours}</span>
              </div>
            </div>

            <div className="flex-1 sm:flex-initial flex items-center gap-3 p-3 rounded-xl border border-border bg-muted/30">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
                <Activity size={18} />
              </div>
              <div>
                <span className="text-[11px] font-medium text-muted-foreground block">Active Hours</span>
                <span className="text-base font-bold text-foreground">{selectedEmployee.activeHours}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs: Activity Timeline vs Applications */}
        <div className="border border-border rounded-2xl bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-border pb-4 mb-6">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveTab('timeline')}
                className={\`px-4 py-2 rounded-xl text-sm font-semibold transition-all \${
                  activeTab === 'timeline'
                    ? 'bg-foreground text-background shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }\`}
              >
                Activity Timeline
              </button>
              <button
                onClick={() => setActiveTab('applications')}
                className={\`px-4 py-2 rounded-xl text-sm font-semibold transition-all \${
                  activeTab === 'applications'
                    ? 'bg-foreground text-background shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }\`}
              >
                Applications Breakdown
              </button>
            </div>

            {/* EOD Sync Badge */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">EOD Sync Status:</span>
              {selectedEmployee.eodSynced ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                  <CheckCircle2 size={13} />
                  <span>Session Completed ({selectedEmployee.eodHours}h active)</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">
                  <span>Tracking in progress / Pending</span>
                </span>
              )}
            </div>
          </div>

          {activeTab === 'timeline' ? (
            /* Real Activity Timeline */
            selectedEmployee.timeline && selectedEmployee.timeline.length > 0 ? (
              <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-border">
                {selectedEmployee.timeline.map((event, idx) => (
                  <div key={idx} className="relative flex items-start gap-4">
                    <div className="absolute -left-6 top-1 w-3.5 h-3.5 rounded-full bg-blue-500 border-2 border-card" />
                    <span className="text-xs font-mono font-bold text-muted-foreground shrink-0 w-20 pt-0.5">
                      {event.time}
                    </span>
                    <div>
                      <h4 className="text-sm font-semibold text-foreground">{event.title}</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">{event.subtitle}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                No activity events recorded for this employee on {selectedDate}.
              </p>
            )
          ) : (
            /* Real Applications Breakdown */
            selectedEmployee.applications && selectedEmployee.applications.length > 0 ? (
              <div className="space-y-4">
                {selectedEmployee.applications.map((app, idx) => (
                  <div key={idx} className="p-4 rounded-xl border border-border bg-muted/20 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 font-semibold text-foreground">
                        <Laptop size={16} className="text-blue-500" />
                        <span>{app.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground font-mono">{app.duration}</span>
                        <span className="text-xs font-bold text-foreground">{app.percent}%</span>
                      </div>
                    </div>
                    <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all duration-500"
                        style={{ width: \`\${app.percent}%\` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                No application usage logged for this employee on {selectedDate}.
              </p>
            )
          )}
        </div>
      </div>
    )
  }

  // Main Dashboard View
  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader
          title="Time Tracking & Activity Analytics"
          subtitle="Real-time employee desktop time tracking and verified activity intervals (Admin Only)"
        />

        <div className="flex items-center gap-3">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 rounded-xl border border-border bg-card text-xs font-medium text-foreground outline-none cursor-pointer shadow-sm"
          />

          <button
            onClick={fetchReports}
            disabled={loading}
            className="p-2 rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive flex items-center gap-3 text-sm">
          <AlertCircle size={18} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Top Overview Cards: Real Aggregations */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Active Employees */}
        <div className="p-5 rounded-2xl border border-border bg-card shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center">
              <Users size={24} />
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground block">Active Staff</span>
              <span className="text-2xl font-extrabold text-foreground mt-0.5 block">{overview.totalEmployees}</span>
            </div>
          </div>
        </div>

        {/* Currently Working */}
        <div className="p-5 rounded-2xl border border-border bg-card shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
              <Activity size={24} />
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground block">Currently Working</span>
              <span className="text-2xl font-extrabold text-foreground mt-0.5 block">{overview.currentlyWorking}</span>
            </div>
          </div>
        </div>

        {/* Total Worked Hours Today */}
        <div className="p-5 rounded-2xl border border-border bg-card shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center">
              <Clock size={24} />
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground block">Total Worked Hours</span>
              <span className="text-2xl font-extrabold text-foreground mt-0.5 block">{formatMins(overview.totalWorkedMinutes)}</span>
            </div>
          </div>
        </div>

        {/* Total Active Hours Today */}
        <div className="p-5 rounded-2xl border border-border bg-card shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
              <Activity size={24} />
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground block">Total Active Hours</span>
              <span className="text-2xl font-extrabold text-foreground mt-0.5 block">{formatMins(overview.totalActiveMinutes)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Real Hourly Active Distribution */}
      <div className="p-6 rounded-2xl border border-border bg-card shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-foreground">Hourly Active Timeline ({selectedDate})</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Accumulated active hours across all employees per business hour
            </p>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="text-xs font-medium px-3 py-1.5 rounded-lg border border-border bg-background text-foreground outline-none cursor-pointer"
            >
              <option value="All">All Departments</option>
              <option value="Development">Development</option>
              <option value="Design">Design</option>
              <option value="Marketing">Marketing</option>
              <option value="Sales">Sales</option>
              <option value="HR">HR</option>
            </select>
          </div>
        </div>

        {/* Bar Chart Visualization */}
        <div className="pt-4">
          <div className="h-48 flex items-end justify-between gap-2 sm:gap-4 border-b border-border pb-2">
            {(overview.hourlyData || []).map((item, idx) => {
              const maxVal = Math.max(1, ...overview.hourlyData.map(h => h.active))
              const heightPercent = Math.min(100, (item.active / maxVal) * 100)

              return (
                <div key={idx} className="flex-1 flex flex-col items-center gap-2 h-full justify-end group">
                  <div className="w-full flex items-end justify-center h-full">
                    <div
                      className="w-3 sm:w-6 bg-emerald-500/80 hover:bg-emerald-500 rounded-t-sm transition-all duration-300 relative"
                      style={{ height: \`\${heightPercent > 0 ? heightPercent : 4}%\` }}
                      title={\`\${item.hour}: \${item.active} hrs active\`}
                    />
                  </div>
                  <span className="text-[11px] font-medium text-muted-foreground shrink-0">{item.hour}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Employee Time Reports Section */}
      <div className="p-6 rounded-2xl border border-border bg-card shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-foreground">Employee Time Reports</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Verified daily tracking sessions and breakdown by employee
            </p>
          </div>

          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <Search size={15} className="absolute left-3 top-2.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search employee, designation, dept..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-500 transition-all"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/40 text-muted-foreground font-semibold border-b border-border">
              <tr>
                <th className="py-3 px-4">Employee</th>
                <th className="py-3 px-4">Department</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Worked Hours</th>
                <th className="py-3 px-4">Active Hours</th>
                <th className="py-3 px-4">Last Activity</th>
                <th className="py-3 px-4 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredEmployees.length > 0 ? (
                filteredEmployees.map((emp) => (
                  <tr
                    key={emp.id}
                    onClick={() => setSelectedEmployee(emp)}
                    className="hover:bg-muted/30 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-600/10 text-blue-600 font-bold flex items-center justify-center shrink-0">
                          {emp.name.split(' ').map(n => n[0]).join('')}
                        </div>
                        <span className="font-semibold text-foreground">{emp.name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">{emp.department}</td>
                    <td className="py-3 px-4">{getStatusBadge(emp.status)}</td>
                    <td className="py-3 px-4 font-mono font-medium text-foreground">{emp.workedHours}</td>
                    <td className="py-3 px-4 font-mono font-medium text-foreground">{emp.activeHours}</td>
                    <td className="py-3 px-4 text-muted-foreground">{emp.lastActivity}</td>
                    <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setSelectedEmployee(emp)}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        title="View Details"
                      >
                        <MoreVertical size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground">
                    {loading ? 'Loading tracking reports...' : 'No tracking sessions found for the selected criteria.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
`;
fs.writeFileSync(path.join(compDir, 'TimeTrackingAdminDashboard.tsx'), clientCompContent, 'utf8');
console.log('Successfully created components/time-tracking/TimeTrackingAdminDashboard.tsx');

// 3. Server Page Wrapper: app/(erp)/time-tracking/page.tsx
const pagePath = path.join(erpBase, 'app/(erp)/time-tracking/page.tsx');
const pageContent = `import { requireRole } from '@/lib/auth'
import { TimeTrackingAdminDashboard } from '@/components/time-tracking/TimeTrackingAdminDashboard'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function TimeTrackingPage() {
  // STRICT SERVER-SIDE ROLE ENFORCEMENT: Only Admin role can access
  await requireRole('/time-tracking')
  return <TimeTrackingAdminDashboard />
}
`;
fs.writeFileSync(pagePath, pageContent, 'utf8');
console.log('Successfully updated app/(erp)/time-tracking/page.tsx (Server Guard with requireRole)');
