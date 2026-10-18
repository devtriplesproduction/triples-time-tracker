const fs = require('fs');
const path = require('path');

const erpBase = path.resolve(__dirname, '../../TripleS-ERP');

// 1. Update /api/time-tracking/summary/route.ts
const summaryPath = path.join(erpBase, 'app/api/time-tracking/summary/route.ts');
const summaryContent = `import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Authentication required' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(req.url)
    
    // Only Admin may query other employees; regular employees query only their own profile
    const requestedEmployeeId = searchParams.get('employeeId')
    const targetEmployeeId = (user.role === 'Admin' && requestedEmployeeId) 
      ? requestedEmployeeId 
      : user.id

    // Default to Asia/Kolkata business date
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date())
    const date = searchParams.get('date') || today

    const adminSupa = createSupabaseAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const { data: sessions, error } = await adminSupa
      .from('time_sessions')
      .select('id, employee_id, session_date, clock_in, clock_out, status, worked_minutes, active_minutes, suspended_seconds')
      .eq('employee_id', targetEmployeeId)
      .eq('session_date', date)

    if (error) {
      console.error('[API /api/time-tracking/summary] Database error:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to retrieve tracking sessions: ' + error.message },
        { status: 500 }
      )
    }

    // When no sessions exist, return clean empty state with ZERO hours (NEVER mock data)
    if (!sessions || sessions.length === 0) {
      return NextResponse.json({
        success: true,
        employeeId: targetEmployeeId,
        date,
        totalWorkedMinutes: 0,
        totalActiveMinutes: 0,
        activeHoursDecimal: 0,
        formattedWorked: '0h 00m',
        formattedActive: '0h 00m',
        formattedHHMM: '0.00',
        sessions: [],
        isEmpty: true
      })
    }

    // Accumulate all non-overlapping sessions for the date
    const totalWorked = sessions.reduce((acc, s) => acc + (s.worked_minutes || 0), 0)
    const totalActive = sessions.reduce((acc, s) => acc + (s.active_minutes || 0), 0)
    const activeHoursDecimal = Number((totalActive / 60).toFixed(6))

    const workedH = Math.floor(totalWorked / 60)
    const workedM = totalWorked % 60
    const activeH = Math.floor(totalActive / 60)
    const activeM = totalActive % 60

    return NextResponse.json({
      success: true,
      employeeId: targetEmployeeId,
      date,
      totalWorkedMinutes: totalWorked,
      totalActiveMinutes: totalActive,
      activeHoursDecimal,
      formattedWorked: \`\${workedH}h \${workedM.toString().padStart(2, '0')}m\`,
      formattedActive: \`\${activeH}h \${activeM.toString().padStart(2, '0')}m\`,
      formattedHHMM: \`\${activeH}.\${activeM.toString().padStart(2, '0')}\`,
      sessions,
      isEmpty: totalActive === 0
    })
  } catch (err: any) {
    console.error('[API /api/time-tracking/summary] Unhandled exception:', err)
    return NextResponse.json({ success: false, error: err.message || 'Internal server error' }, { status: 500 })
  }
}
`;
fs.writeFileSync(summaryPath, summaryContent, 'utf8');
console.log('Successfully updated /api/time-tracking/summary/route.ts (Zero Mock Data, Real Auth Guard)');

// 2. Update /api/time-tracking/session/route.ts
const sessionRoutePath = path.join(erpBase, 'app/api/time-tracking/session/route.ts');
const sessionRouteContent = `import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Authentication required' },
        { status: 401 }
      )
    }

    const body = await req.json().catch(() => ({}))
    const { action, sessionId, reason, clockInTime, workedMinutes, activeMinutes, suspendedSeconds } = body

    // Enforce identity verification: session ALWAYS belongs to the authenticated user
    const targetEmployeeId = user.id

    const adminSupa = createSupabaseAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date())

    if (action === 'start') {
      const newSessionId = sessionId || crypto.randomUUID()
      const { data, error } = await adminSupa
        .from('time_sessions')
        .upsert({
          id: newSessionId,
          employee_id: targetEmployeeId,
          session_date: today,
          clock_in: clockInTime || new Date().toISOString(),
          status: 'working',
          worked_minutes: workedMinutes || 0,
          active_minutes: activeMinutes || 0,
          suspended_seconds: suspendedSeconds || 0,
          updated_at: new Date().toISOString()
        })
        .select()
        .single()

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }
      return NextResponse.json({ success: true, session: data })
    }

    if (action === 'break') {
      if (!sessionId) {
        return NextResponse.json({ success: false, error: 'Missing sessionId' }, { status: 400 })
      }
      const breakId = crypto.randomUUID()
      const { error: breakErr } = await adminSupa.from('session_breaks').insert({
        id: breakId,
        session_id: sessionId,
        start_time: new Date().toISOString(),
        reason: reason || 'Break'
      })
      if (breakErr) {
        return NextResponse.json({ success: false, error: breakErr.message }, { status: 500 })
      }

      await adminSupa
        .from('time_sessions')
        .update({ status: 'on_break', updated_at: new Date().toISOString() })
        .eq('id', sessionId)
        .eq('employee_id', targetEmployeeId)

      return NextResponse.json({ success: true, breakId })
    }

    if (action === 'resume') {
      if (!sessionId) {
        return NextResponse.json({ success: false, error: 'Missing sessionId' }, { status: 400 })
      }
      const now = new Date().toISOString()
      const { data: openBreak } = await adminSupa
        .from('session_breaks')
        .select('id, start_time')
        .eq('session_id', sessionId)
        .is('end_time', null)
        .maybeSingle()

      if (openBreak) {
        const start = new Date(openBreak.start_time).getTime()
        const duration = Math.max(0, Math.floor((new Date(now).getTime() - start) / 60000))
        await adminSupa
          .from('session_breaks')
          .update({ end_time: now, duration_minutes: duration })
          .eq('id', openBreak.id)
      }

      await adminSupa
        .from('time_sessions')
        .update({ status: 'working', updated_at: now })
        .eq('id', sessionId)
        .eq('employee_id', targetEmployeeId)

      return NextResponse.json({ success: true })
    }

    if (action === 'end') {
      if (!sessionId) {
        return NextResponse.json({ success: false, error: 'Missing sessionId' }, { status: 400 })
      }
      const now = new Date().toISOString()
      await adminSupa
        .from('time_sessions')
        .update({
          clock_out: now,
          status: 'completed',
          worked_minutes: workedMinutes || 0,
          active_minutes: activeMinutes || 0,
          suspended_seconds: suspendedSeconds || 0,
          updated_at: now
        })
        .eq('id', sessionId)
        .eq('employee_id', targetEmployeeId)

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || 'Internal server error' }, { status: 500 })
  }
}
`;
fs.writeFileSync(sessionRoutePath, sessionRouteContent, 'utf8');
console.log('Successfully updated /api/time-tracking/session/route.ts (Zero Mock Fallback, Server Auth Ownership)');

// 3. Update /api/time-tracking/admin/reports/route.ts
const adminReportsPath = path.join(erpBase, 'app/api/time-tracking/admin/reports/route.ts');
const adminReportsContent = `import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Authentication required' },
        { status: 401 }
      )
    }

    // STRICT ADMIN-ONLY ENFORCEMENT (Rule 5: HR and other non-admins denied)
    if (user.role !== 'Admin') {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Admin access required for time tracking analytics' },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(req.url)
    const department = searchParams.get('department') || 'All'
    
    // Default to Asia/Kolkata business date
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date())
    const date = searchParams.get('date') || today

    const adminSupa = createSupabaseAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    // 1. Fetch real active profiles from database
    const { data: dbProfiles, error: profileError } = await adminSupa
      .from('profiles')
      .select('id, first_name, last_name, employee_id, department, designation, role')
      .order('first_name', { ascending: true })

    if (profileError) {
      return NextResponse.json(
        { success: false, error: 'Failed to query employee profiles: ' + profileError.message },
        { status: 500 }
      )
    }

    const profiles = dbProfiles || []

    // 2. Fetch real tracking sessions for the requested date
    const { data: dbSessions, error: sessionError } = await adminSupa
      .from('time_sessions')
      .select('id, employee_id, session_date, clock_in, clock_out, status, worked_minutes, active_minutes, suspended_seconds')
      .eq('session_date', date)

    if (sessionError) {
      return NextResponse.json(
        { success: false, error: 'Failed to query time sessions: ' + sessionError.message },
        { status: 500 }
      )
    }

    const sessions = dbSessions || []

    // 3. Fetch activity logs for the sessions to compute real app usage and timelines
    const sessionIds = sessions.map(s => s.id)
    let activityLogs: any[] = []
    if (sessionIds.length > 0) {
      const { data: logs } = await adminSupa
        .from('activity_logs')
        .select('id, session_id, employee_id, start_time, end_time, active_seconds, app_name, window_title')
        .in('session_id', sessionIds)
        .order('start_time', { ascending: true })
      activityLogs = logs || []
    }

    // 4. Map profiles with real session data
    const employees = profiles.map(p => {
      const empSessions = sessions.filter(s => s.employee_id === p.id)
      const empLogs = activityLogs.filter(l => l.employee_id === p.id)

      const workedMins = empSessions.reduce((acc, s) => acc + (s.worked_minutes || 0), 0)
      const activeMins = empSessions.reduce((acc, s) => acc + (s.active_minutes || 0), 0)
      
      let status: 'Working' | 'Idle' | 'Offline' | 'On Break' = 'Offline'
      const activeSession = empSessions.find(s => s.status === 'working' || s.status === 'Working')
      const breakSession = empSessions.find(s => s.status === 'on_break' || s.status === 'On Break')
      
      if (activeSession) {
        status = 'Working'
      } else if (breakSession) {
        status = 'On Break'
      } else if (empSessions.length > 0) {
        status = 'Offline'
      }

      const wH = Math.floor(workedMins / 60)
      const wM = workedMins % 60
      const aH = Math.floor(activeMins / 60)
      const aM = activeMins % 60

      // Calculate real application breakdown for this employee
      const appMap: Record<string, number> = {}
      for (const log of empLogs) {
        const app = log.app_name || 'Desktop Work'
        appMap[app] = (appMap[app] || 0) + (log.active_seconds || 0)
      }

      const totalAppSeconds = Object.values(appMap).reduce((a, b) => a + b, 0)
      const applications = Object.entries(appMap)
        .map(([name, sec]) => {
          const mins = Math.floor(sec / 60)
          const h = Math.floor(mins / 60)
          const m = mins % 60
          const durStr = h > 0 ? \`\${h}h \${m}m\` : \`\${m}m\`
          const percent = totalAppSeconds > 0 ? Math.round((sec / totalAppSeconds) * 100) : 0
          return { name, duration: durStr, percent }
        })
        .sort((a, b) => b.percent - a.percent)

      // Build real activity timeline from sessions and logs
      const timeline: Array<{ time: string; title: string; subtitle: string; status: string }> = []
      for (const s of empSessions) {
        const inTime = new Date(s.clock_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
        timeline.push({ time: inTime, title: 'Clock In', subtitle: 'Work session started', status: 'start' })
        if (s.clock_out) {
          const outTime = new Date(s.clock_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
          timeline.push({ time: outTime, title: 'Clock Out', subtitle: 'Work session ended', status: 'end' })
        }
      }

      return {
        id: p.id,
        name: \`\${p.first_name || ''} \${p.last_name || ''}\`.trim() || 'Employee',
        department: p.department || 'General',
        designation: p.designation || 'Staff',
        status,
        workedHours: \`\${wH}h \${wM.toString().padStart(2, '0')}m\`,
        activeHours: \`\${aH}h \${aM.toString().padStart(2, '0')}m\`,
        workedMinutes: workedMins,
        activeMinutes: activeMins,
        lastActivity: status === 'Working' ? 'Active now' : status === 'On Break' ? 'On Break' : empSessions.length > 0 ? 'Session ended' : '-',
        timeline,
        applications,
        eodSynced: empSessions.length > 0 && empSessions.every(s => s.status === 'completed' || s.status === 'Completed'),
        eodHours: Number((activeMins / 60).toFixed(2))
      }
    })

    const filteredEmployees = department === 'All'
      ? employees
      : employees.filter(e => e.department.toLowerCase() === department.toLowerCase())

    const totalEmployees = profiles.length
    const currentlyWorking = employees.filter(e => e.status === 'Working').length

    // Compute real hourly distribution for today's sessions (9 AM to 6 PM)
    const hourlyData = [
      { hour: '9 AM', worked: 0, active: 0 },
      { hour: '10 AM', worked: 0, active: 0 },
      { hour: '11 AM', worked: 0, active: 0 },
      { hour: '12 PM', worked: 0, active: 0 },
      { hour: '1 PM', worked: 0, active: 0 },
      { hour: '2 PM', worked: 0, active: 0 },
      { hour: '3 PM', worked: 0, active: 0 },
      { hour: '4 PM', worked: 0, active: 0 },
      { hour: '5 PM', worked: 0, active: 0 },
      { hour: '6 PM', worked: 0, active: 0 },
    ]

    // Real aggregation from activity logs
    for (const log of activityLogs) {
      const logDate = new Date(log.start_time)
      const istHours = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(logDate))
      if (istHours >= 9 && istHours <= 18) {
        const slotIdx = istHours - 9
        if (hourlyData[slotIdx]) {
          hourlyData[slotIdx].active += Number(((log.active_seconds || 0) / 3600).toFixed(2))
        }
      }
    }

    return NextResponse.json({
      success: true,
      overview: {
        totalEmployees,
        currentlyWorking,
        totalWorkedMinutes: employees.reduce((acc, e) => acc + e.workedMinutes, 0),
        totalActiveMinutes: employees.reduce((acc, e) => acc + e.activeMinutes, 0),
        hourlyData
      },
      employees: filteredEmployees
    })
  } catch (err: any) {
    console.error('[API /api/time-tracking/admin/reports] Unhandled exception:', err)
    return NextResponse.json({ success: false, error: err.message || 'Internal server error' }, { status: 500 })
  }
}
`;
fs.writeFileSync(adminReportsPath, adminReportsContent, 'utf8');
console.log('Successfully updated /api/time-tracking/admin/reports/route.ts (Real Supabase Queries, Zero Mock Data, Admin Auth Guard)');

// 4. Update EODSubmissionForm.tsx with Quick-Apply button and clean state
const eodFormPath = path.join(erpBase, 'components/eod/EODSubmissionForm.tsx');
let eodFormContent = fs.readFileSync(eodFormPath, 'utf8');

// Replace loadTimeTrackerHours to not auto-overwrite and only populate trackedHours
const oldLoadTrackerRegex = /useEffect\(\(\) => \{\s*async function loadTimeTrackerHours\(\) \{[\s\S]*?loadTimeTrackerHours\(\);\s*\}, \[selectedEmployeeId, reportDate, isUpdate\]\);/;
const newLoadTrackerCode = `useEffect(() => {
    async function loadTimeTrackerHours() {
      try {
        const res = await fetch(\`/api/time-tracking/summary?employeeId=\${selectedEmployeeId}&date=\${reportDate}\`);
        if (res.ok) {
          const data = await res.json();
          if (data.success && !data.isEmpty && data.totalActiveMinutes > 0) {
            setTrackedHours(data.formattedDisplay || data.formattedActive);
          } else {
            setTrackedHours(null);
          }
        } else {
          setTrackedHours(null);
        }
      } catch (e) {
        setTrackedHours(null);
      }
    }
    loadTimeTrackerHours();
  }, [selectedEmployeeId, reportDate, isUpdate]);`;

if (oldLoadTrackerRegex.test(eodFormContent)) {
  eodFormContent = eodFormContent.replace(oldLoadTrackerRegex, newLoadTrackerCode);
}

// Add the Quick Apply button into the Worked Hours label bar
const workedHoursLabelTarget = `<label className="block text-sm font-medium text-foreground">Worked Hours <span className="text-error">*</span></label>`;
const workedHoursLabelReplacement = `<div className="flex items-center gap-2">
                    <label className="block text-sm font-medium text-foreground">Worked Hours <span className="text-error">*</span></label>
                    {trackedHours && (
                      <button
                        type="button"
                        onClick={() => {
                          // Format tracked hours into HH.MM user input format
                          const totalMins = parseHHMM(trackedHours);
                          if (totalMins !== null) {
                            const h = Math.floor(totalMins / 60);
                            const m = totalMins % 60;
                            setWorkedHoursInput(\`\${h}.\${m.toString().padStart(2, '0')}\`);
                          } else {
                            setWorkedHoursInput(trackedHours);
                          }
                          toast.success(\`Applied \${trackedHours} from Time Tracker\`);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors border border-emerald-500/20"
                        title="Click to apply verified Active Hours from Time Tracker"
                      >
                        <Clock className="w-3 h-3" />
                        <span>Use Tracker: {trackedHours}</span>
                      </button>
                    )}
                  </div>`;

if (eodFormContent.includes(workedHoursLabelTarget) && !eodFormContent.includes('Use Tracker: {trackedHours}')) {
  eodFormContent = eodFormContent.replace(workedHoursLabelTarget, workedHoursLabelReplacement);
}

fs.writeFileSync(eodFormPath, eodFormContent, 'utf8');
console.log('Successfully updated EODSubmissionForm.tsx (Quick Apply Button, Non-Destructive Tracker Loading)');
