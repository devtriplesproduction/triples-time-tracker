const fs = require('fs')
const path = require('path')

const targetDir = path.resolve(__dirname, '../../TripleS-ERP/app/(erp)/time-tracking')
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true })
}

const pageContent = `'use client'

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
  CheckSquare,
  RefreshCw,
  ExternalLink
} from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { createClient } from '@/lib/supabase/client'

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

const INITIAL_EMPLOYEES: EmployeeReport[] = [
  {
    id: '3f1a7db7-0ebf-45a7-b5a9-f9a0a393c023',
    name: 'Omkar Sawant',
    department: 'Development',
    designation: 'Software Developer',
    status: 'Working',
    workedHours: '3h 15m',
    activeHours: '3h 02m',
    workedMinutes: 195,
    activeMinutes: 182,
    lastActivity: 'Active now',
    eodSynced: true,
    eodHours: 3.03,
    timeline: [
      { time: '09:00 AM', title: 'Clock In', subtitle: 'Work session started', status: 'start' },
      { time: '11:20 AM', title: 'Working', subtitle: 'Active on Visual Studio Code', status: 'active' },
      { time: '01:30 PM', title: 'Working', subtitle: 'Active on Chrome', status: 'active' },
      { time: '03:15 PM', title: 'Working', subtitle: 'Active on Postman', status: 'active' },
      { time: '05:50 PM', title: 'Currently Working', subtitle: 'Session in progress', status: 'current' },
    ],
    applications: [
      { name: 'Visual Studio Code', duration: '1h 45m', percent: 58 },
      { name: 'Google Chrome', duration: '55m', percent: 30 },
      { name: 'Postman', duration: '22m', percent: 12 },
    ]
  },
  {
    id: 'ca706582-629a-4630-9fbf-efa0ada8ba81',
    name: 'Amit Shaikh',
    department: 'Development',
    designation: 'Frontend Developer',
    status: 'Working',
    workedHours: '2h 45m',
    activeHours: '2h 20m',
    workedMinutes: 165,
    activeMinutes: 140,
    lastActivity: '12 mins ago',
    eodSynced: true,
    eodHours: 2.33,
    timeline: [
      { time: '09:30 AM', title: 'Clock In', subtitle: 'Work session started', status: 'start' },
      { time: '11:00 AM', title: 'Working', subtitle: 'Active on Figma', status: 'active' },
      { time: '01:15 PM', title: 'Working', subtitle: 'Active on Visual Studio Code', status: 'active' },
      { time: '02:45 PM', title: 'Currently Working', subtitle: 'Session in progress', status: 'current' },
    ],
    applications: [
      { name: 'Visual Studio Code', duration: '1h 20m', percent: 57 },
      { name: 'Figma', duration: '40m', percent: 29 },
      { name: 'Slack', duration: '20m', percent: 14 },
    ]
  },
  {
    id: 'ee284db8-bc2a-4ca6-b195-917e9dc5781c',
    name: 'Pooja Shinde',
    department: 'Design',
    designation: 'UI/UX Designer',
    status: 'Idle',
    workedHours: '1h 30m',
    activeHours: '1h 10m',
    workedMinutes: 90,
    activeMinutes: 70,
    lastActivity: '28 mins ago',
    eodSynced: false,
    timeline: [
      { time: '10:00 AM', title: 'Clock In', subtitle: 'Work session started', status: 'start' },
      { time: '11:10 AM', title: 'Idle', subtitle: 'Inactivity detected (28 mins)', status: 'idle' },
    ],
    applications: [
      { name: 'Figma', duration: '50m', percent: 71 },
      { name: 'Google Chrome', duration: '20m', percent: 29 },
    ]
  },
  {
    id: '6af63eb6-12a6-4809-97c6-ef0792eeab53',
    name: 'Rohit Kumbhar',
    department: 'Development',
    designation: 'Full-Stack Developer',
    status: 'Working',
    workedHours: '3h 10m',
    activeHours: '2h 55m',
    workedMinutes: 190,
    activeMinutes: 175,
    lastActivity: 'Active now',
    eodSynced: true,
    eodHours: 2.92,
    timeline: [
      { time: '09:05 AM', title: 'Clock In', subtitle: 'Work session started', status: 'start' },
      { time: '11:45 AM', title: 'Working', subtitle: 'Active on IntelliJ IDEA', status: 'active' },
      { time: '02:10 PM', title: 'Working', subtitle: 'Active on Docker Desktop', status: 'active' },
    ],
    applications: [
      { name: 'IntelliJ IDEA', duration: '1h 55m', percent: 66 },
      { name: 'Docker Desktop', duration: '35m', percent: 20 },
      { name: 'Google Chrome', duration: '25m', percent: 14 },
    ]
  },
  {
    id: 'ba210f01-f9f9-4fe2-8b8d-af9c7285884e',
    name: 'Neha Patil',
    department: 'Marketing',
    designation: 'Marketing Lead',
    status: 'Working',
    workedHours: '2h 30m',
    activeHours: '2h 10m',
    workedMinutes: 150,
    activeMinutes: 130,
    lastActivity: '15 mins ago',
    eodSynced: false,
    timeline: [
      { time: '09:45 AM', title: 'Clock In', subtitle: 'Work session started', status: 'start' },
      { time: '11:15 AM', title: 'Working', subtitle: 'Active on Notion', status: 'active' },
    ],
    applications: [
      { name: 'Notion', duration: '1h 20m', percent: 62 },
      { name: 'Google Chrome', duration: '50m', percent: 38 },
    ]
  },
  {
    id: 'user-sahil',
    name: 'Sahil More',
    department: 'Sales',
    designation: 'Account Executive',
    status: 'Offline',
    workedHours: '0h 00m',
    activeHours: '0h 00m',
    workedMinutes: 0,
    activeMinutes: 0,
    lastActivity: '-',
    eodSynced: false,
    timeline: [],
    applications: []
  },
  {
    id: 'be5f1a2b-63ae-4cfd-a2c3-75aba7992a78',
    name: 'Priya Jadhav',
    department: 'HR',
    designation: 'HR Executive',
    status: 'Working',
    workedHours: '2h 50m',
    activeHours: '2h 35m',
    workedMinutes: 170,
    activeMinutes: 155,
    lastActivity: '8 mins ago',
    eodSynced: true,
    eodHours: 2.58,
    timeline: [
      { time: '09:15 AM', title: 'Clock In', subtitle: 'Work session started', status: 'start' },
      { time: '11:00 AM', title: 'Working', subtitle: 'Active on TripleS ERP', status: 'active' },
    ],
    applications: [
      { name: 'TripleS ERP Web', duration: '1h 45m', percent: 68 },
      { name: 'Excel', duration: '50m', percent: 32 },
    ]
  }
]

const HOURLY_OVERVIEW = [
  { hour: '9 AM', worked: 3.5, active: 3.0 },
  { hour: '10 AM', worked: 4.8, active: 4.2 },
  { hour: '11 AM', worked: 6.8, active: 6.0 },
  { hour: '12 PM', worked: 4.2, active: 3.8 },
  { hour: '1 PM', worked: 5.5, active: 4.9 },
  { hour: '2 PM', worked: 5.2, active: 4.6 },
  { hour: '3 PM', worked: 7.2, active: 6.8 },
  { hour: '4 PM', worked: 6.5, active: 5.8 },
  { hour: '5 PM', worked: 8.5, active: 7.9 },
  { hour: '6 PM', worked: 7.0, active: 6.4 },
]

export default function TimeTrackingAdminPage() {
  const [employees, setEmployees] = useState<EmployeeReport[]>(INITIAL_EMPLOYEES)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedDept, setSelectedDept] = useState('All Departments')
  const [selectedDate, setSelectedDate] = useState('14 Oct 2026')
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeReport | null>(null)
  const [activeTab, setActiveTab] = useState<'timeline' | 'applications'>('timeline')
  const [loading, setLoading] = useState(false)

  // Fetch real data from server API or Supabase if available
  useEffect(() => {
    async function fetchReportData() {
      try {
        const res = await fetch(\`/api/time-tracking/admin/reports?department=\${selectedDept === 'All Departments' ? 'All' : selectedDept}&date=2026-10-14\`)
        if (res.ok) {
          const data = await res.json()
          if (data.success && data.employees) {
            // merge
            setEmployees(prev => {
              return prev.map(emp => {
                const updated = data.employees.find((e: any) => e.id === emp.id || e.name === emp.name)
                if (updated) {
                  return { ...emp, ...updated }
                }
                return emp
              })
            })
          }
        }
      } catch (e) {
        // use initial
      }
    }
    fetchReportData()
  }, [selectedDept])

  const filteredEmployees = employees.filter(emp => {
    const matchesSearch = emp.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          emp.designation.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesDept = selectedDept === 'All Departments' || emp.department === selectedDept
    return matchesSearch && matchesDept
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
    if (status === 'Idle' || status === 'On Break') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          Idle
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

  // If Detail View is open
  if (selectedEmployee) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto pb-12 animate-fade-in">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSelectedEmployee(null)}
            className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-lg hover:bg-muted"
          >
            <ArrowLeft size={16} />
            <span>Back</span>
          </button>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card text-xs font-medium">
            <Calendar size={14} className="text-muted-foreground" />
            <span>{selectedDate}</span>
            <ChevronDown size={14} className="text-muted-foreground" />
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
                Applications
              </button>
            </div>

            {/* EOD Sync Badge */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">EOD Integration:</span>
              {selectedEmployee.eodSynced ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                  <CheckCircle2 size={13} />
                  <span>Synced ({selectedEmployee.eodHours} hrs)</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">
                  <span>Pending EOD Sync</span>
                </span>
              )}
            </div>
          </div>

          {activeTab === 'timeline' ? (
            /* Activity Timeline */
            <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-border">
              {(selectedEmployee.timeline || []).map((event, idx) => (
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
            /* Applications Breakdown */
            <div className="space-y-4">
              {(selectedEmployee.applications || []).map((app, idx) => (
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
          )}
        </div>
      </div>
    )
  }

  // Main Admin Overview View
  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader
          title="Admin Panel (Inside TripleS ERP Web App)"
          subtitle="Manage employee time tracking and activity reports"
        />

        <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-card text-xs font-medium self-start sm:self-auto shadow-sm">
          <Calendar size={15} className="text-muted-foreground" />
          <span>{selectedDate}</span>
          <ChevronDown size={14} className="text-muted-foreground" />
        </div>
      </div>

      {/* Top 2 Cards: Total Employees & Currently Working */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Total Employees */}
        <div className="p-5 rounded-2xl border border-border bg-card shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center">
              <Users size={24} />
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground block">Total Employees</span>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-2xl font-extrabold text-foreground">24</span>
                <span className="text-xs font-bold text-emerald-500 flex items-center gap-0.5">
                  <TrendingUp size={12} />
                  <span>12%</span>
                </span>
              </div>
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
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-2xl font-extrabold text-foreground">18</span>
                <span className="text-xs font-bold text-emerald-500 flex items-center gap-0.5">
                  <TrendingUp size={12} />
                  <span>5%</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Work Hours Overview (Dual Bar Chart) */}
      <div className="p-6 rounded-2xl border border-border bg-card shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-foreground">Work Hours Overview</h3>
            <div className="flex items-center gap-4 mt-1.5 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                <span className="text-muted-foreground">Worked Hours</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="text-muted-foreground">Active Hours</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="text-xs font-medium px-3 py-1.5 rounded-lg border border-border bg-background text-foreground outline-none cursor-pointer"
            >
              <option value="All Departments">All Departments</option>
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
          <div className="h-56 flex items-end justify-between gap-2 sm:gap-4 border-b border-border pb-2">
            {HOURLY_OVERVIEW.map((item, idx) => {
              const maxH = 10
              const workedHeightPercent = (item.worked / maxH) * 100
              const activeHeightPercent = (item.active / maxH) * 100

              return (
                <div key={idx} className="flex-1 flex flex-col items-center gap-2 h-full justify-end group">
                  <div className="w-full flex items-end justify-center gap-1 h-full">
                    {/* Worked Hours bar (blue) */}
                    <div
                      className="w-2.5 sm:w-4 bg-blue-500 rounded-t-sm transition-all duration-300 group-hover:bg-blue-600 relative"
                      style={{ height: \`\${workedHeightPercent}%\` }}
                      title={\`\${item.hour} - Worked: \${item.worked}h\`}
                    />
                    {/* Active Hours bar (green) */}
                    <div
                      className="w-2.5 sm:w-4 bg-emerald-500 rounded-t-sm transition-all duration-300 group-hover:bg-emerald-600 relative"
                      style={{ height: \`\${activeHeightPercent}%\` }}
                      title={\`\${item.hour} - Active: \${item.active}h\`}
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
        <div>
          <h3 className="text-base font-bold text-foreground">Employee Time Reports</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            View and analyze individual employee activity
          </p>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <Search size={15} className="absolute left-3 top-2.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search employee name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-500 transition-all"
            />
          </div>

          <div className="flex items-center gap-2.5">
            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="text-xs font-medium px-3 py-2 rounded-xl border border-border bg-background text-foreground outline-none cursor-pointer"
            >
              <option value="All Departments">All Departments</option>
              <option value="Development">Development</option>
              <option value="Design">Design</option>
              <option value="Marketing">Marketing</option>
              <option value="Sales">Sales</option>
              <option value="HR">HR</option>
            </select>

            <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-background text-xs font-medium text-foreground">
              <Calendar size={14} className="text-muted-foreground" />
              <span>{selectedDate}</span>
            </div>
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
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredEmployees.map((emp) => (
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
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer Pagination */}
        <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
          <span>Showing 1-{filteredEmployees.length} of 24 employees</span>
          <div className="flex items-center gap-1">
            <button className="px-2.5 py-1 rounded border border-border hover:bg-muted disabled:opacity-40">&lt;</button>
            <button className="px-2.5 py-1 rounded bg-foreground text-background font-bold">1</button>
            <button className="px-2.5 py-1 rounded border border-border hover:bg-muted">2</button>
            <button className="px-2.5 py-1 rounded border border-border hover:bg-muted">3</button>
            <button className="px-2.5 py-1 rounded border border-border hover:bg-muted">&gt;</button>
          </div>
        </div>
      </div>
    </div>
  )
}
`

fs.writeFileSync(path.join(targetDir, 'page.tsx'), pageContent, 'utf8')
console.log('Successfully created Admin Time Tracking Page')
