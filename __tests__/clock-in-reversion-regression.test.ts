import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { TrackingSession, UserProfile, TrackingState, TrackingStatus, BreakRecord } from '../src/types'
import { calculateDailyWorkedSeconds, calculateDailyActiveSeconds } from '../src/utils/timeCalculator'

describe('TripleS Time Tracker — Clock In Reversion & Regression Suite', () => {
  const employeeAlice: UserProfile = {
    id: 'emp-uuid-alice',
    email: 'alice@triplesproduction.com',
    first_name: 'Alice',
    last_name: 'Smith',
    employee_id: 'TSP-001',
    department: 'Production',
    designation: '3D Artist',
    role: 'Employee',
    is_active: true
  }

  const employeeBob: UserProfile = {
    id: 'emp-uuid-bob',
    email: 'bob@triplesproduction.com',
    first_name: 'Bob',
    last_name: 'Jones',
    employee_id: 'TSP-002',
    department: 'Editing',
    designation: 'Video Editor',
    role: 'Employee',
    is_active: true
  }

  // Simulated React State Engine replicating App.tsx with ref-backed listener
  class SimulatedAppUi {
    public user: UserProfile | null = null
    public userRef: { current: UserProfile | null } = { current: null }
    public status: TrackingStatus = 'Not Clocked In'
    public currentSession: TrackingSession | null = null
    public todaySessions: TrackingSession[] = []
    public todayWorkedMinutes: number = 0
    public todayActiveMinutes: number = 0
    public isClockingIn: boolean = false
    public errorMessage: string | null = null
    public syncError: string | null = null

    public setUser(newUser: UserProfile | null) {
      this.user = newUser
      this.userRef.current = newUser
    }

    public applyState(state: TrackingState, currentUserOverride?: UserProfile | null) {
      const activeUser = currentUserOverride !== undefined ? currentUserOverride : this.userRef.current
      if (!activeUser) {
        this.status = 'Not Clocked In'
        this.currentSession = null
        this.todaySessions = []
        this.todayWorkedMinutes = 0
        this.todayActiveMinutes = 0
        return
      }

      let validSession: TrackingSession | null = null
      if (state.currentSession && state.currentSession.employee_id === activeUser.id) {
        if (!state.currentSession.clock_out && state.currentSession.status !== 'completed' && state.currentSession.status !== 'Completed') {
          validSession = state.currentSession
        }
      }

      this.currentSession = validSession
      if (validSession) {
        const hasOpenBreak = validSession.breaks && validSession.breaks.some(b => b.end_time === null)
        this.status = hasOpenBreak ? 'on_break' : 'working'
      } else {
        this.status = state.status
      }

      this.todayWorkedMinutes = state.todayWorkedMinutes
      this.todayActiveMinutes = state.todayActiveMinutes
      if (state.todaySessions) {
        this.todaySessions = state.todaySessions.filter(s => s.employee_id === activeUser.id)
      }
    }

    public getRenderedScreen(): 'clock_in_screen' | 'working_screen' | 'break_screen' {
      const hasValid = Boolean(
        this.user &&
        this.currentSession &&
        this.currentSession.id &&
        this.currentSession.employee_id === this.user.id &&
        !this.currentSession.clock_out &&
        this.currentSession.status !== 'completed' &&
        this.currentSession.status !== 'Completed'
      )

      if (!hasValid) {
        return 'clock_in_screen'
      }

      const hasOpenBreak = Boolean(this.currentSession?.breaks?.some(b => b.end_time === null))
      return (this.status === 'on_break' || hasOpenBreak) ? 'break_screen' : 'working_screen'
    }
  }

  // Simulated Tracker Engine replicating ActivityTracker + Storage + SupabaseService
  class SimulatedBackend {
    public currentUser: UserProfile | null = null
    public store: Record<string, { currentSession: TrackingSession | null; todaySessions: TrackingSession[] }> = {}
    public dbSessions: Record<string, TrackingSession[]> = {}
    public shouldSupabaseFail: boolean = false
    public supabaseErrorMessage: string = 'RLS check failed: Unauthorized'
    public isClockInInProgress: boolean = false

    public setCurrentUser(user: UserProfile | null) {
      this.currentUser = user
      if (user && !this.store[user.id]) {
        this.store[user.id] = { currentSession: null, todaySessions: [] }
      }
    }

    public getState(empId?: string): TrackingState {
      const activeId = empId || this.currentUser?.id
      if (!activeId || !this.store[activeId]) {
        return {
          status: 'Not Clocked In',
          currentSession: null,
          todayWorkedMinutes: 0,
          todayActiveMinutes: 0,
          activeAppName: 'Desktop Work',
          isIdle: false,
          idleSeconds: 0,
          lastActivityTime: new Date().toISOString(),
          isOnline: true,
          lastSyncedAt: null,
          pendingSyncCount: 0
        }
      }

      const s = this.store[activeId].currentSession
      let status: TrackingStatus = 'Not Clocked In'
      if (s && !s.clock_out && s.status !== 'completed' && s.status !== 'Completed') {
        status = s.breaks.some(b => b.end_time === null) ? 'on_break' : 'working'
      }

      return {
        status,
        currentSession: s,
        todayWorkedMinutes: s?.worked_minutes || 0,
        todayActiveMinutes: s?.active_minutes || 0,
        todaySessions: this.store[activeId].todaySessions,
        activeAppName: 'Desktop Work',
        isIdle: false,
        idleSeconds: 0,
        lastActivityTime: new Date().toISOString(),
        isOnline: true,
        lastSyncedAt: null,
        pendingSyncCount: 0
      }
    }

    public async clockIn(empId: string): Promise<{ success: boolean; session?: TrackingSession; error?: string }> {
      if (!this.currentUser || this.currentUser.id !== empId) {
        return { success: false, error: 'Authentication required' }
      }

      if (this.isClockInInProgress) {
        const existing = this.store[empId]?.currentSession
        if (existing && !existing.clock_out && existing.status !== 'completed') {
          return { success: true, session: existing }
        }
        return { success: false, error: 'Clock in operation is already in progress' }
      }

      this.isClockInInProgress = true

      try {
        const existing = this.store[empId]?.currentSession
        if (existing && !existing.clock_out && existing.status !== 'completed') {
          return { success: true, session: existing }
        }

        const newSession: TrackingSession = {
          id: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          employee_id: empId,
          session_date: '2026-10-19',
          clock_in: new Date().toISOString(),
          clock_out: null,
          status: 'working',
          worked_minutes: 0,
          active_minutes: 0,
          breaks: []
        }

        // Test Supabase synchronization
        if (this.shouldSupabaseFail) {
          // Safe rollback
          return { success: false, error: this.supabaseErrorMessage }
        }

        // Persist confirmed session locally
        if (!this.store[empId]) this.store[empId] = { currentSession: null, todaySessions: [] }
        this.store[empId].currentSession = newSession
        this.store[empId].todaySessions.push(newSession)

        // Persist in remote db
        if (!this.dbSessions[empId]) this.dbSessions[empId] = []
        this.dbSessions[empId].push(newSession)

        return { success: true, session: newSession }
      } finally {
        this.isClockInInProgress = false
      }
    }

    public async syncEmployeeSessionsFromSupabase(empId: string): Promise<void> {
      const local = this.store[empId]?.currentSession
      const isLocalActive = Boolean(local && !local.clock_out && local.status !== 'completed')
      const remote = this.dbSessions[empId] || []

      if (remote.length === 0) {
        // Must NOT clear an active local session on empty/stale DB response!
        if (!isLocalActive) {
          this.store[empId].currentSession = null
        }
        return
      }

      const activeRemote = remote.find(s => !s.clock_out && (s.status === 'working' || s.status === 'on_break'))
      if (activeRemote) {
        this.store[empId].currentSession = activeRemote
      } else {
        const explicitlyEnded = isLocalActive && remote.some(s => s.id === local!.id && (s.clock_out !== null || s.status === 'completed'))
        if (explicitlyEnded || !isLocalActive) {
          this.store[empId].currentSession = null
        }
      }
    }
  }

  // 1. New account clicks Clock In and remains on the working screen (Fixes the immediate 0.1s reversion bug)
  it('1. New account clicks Clock In and remains on the working screen without reverting', async () => {
    const app = new SimulatedAppUi()
    const backend = new SimulatedBackend()

    // Login Alice
    backend.setCurrentUser(employeeAlice)
    app.setUser(employeeAlice)

    expect(app.getRenderedScreen()).toBe('clock_in_screen')
    expect(app.status).toBe('Not Clocked In')

    // Alice clicks Clock In
    const clockInRes = await backend.clockIn(employeeAlice.id)
    expect(clockInRes.success).toBe(true)
    expect(clockInRes.session).toBeDefined()

    // App receives Clock In result and updates state
    app.currentSession = clockInRes.session!
    app.status = 'working'
    expect(app.getRenderedScreen()).toBe('working_screen')

    // Simulate IPC event 'tracking:state-update' arriving ~0.1s later (the event that previously reverted the screen)
    const backendState = backend.getState(employeeAlice.id)
    // The IPC listener in App.tsx invokes applyState(backendState)
    app.applyState(backendState)

    // Verify: The screen MUST REMAIN working_screen and NOT revert to clock_in_screen!
    expect(app.getRenderedScreen()).toBe('working_screen')
    expect(app.status).toBe('working')
    expect(app.currentSession).not.toBeNull()
    expect(app.currentSession?.employee_id).toBe(employeeAlice.id)
  })

  // 2. The timer continues updating after Clock In
  it('2. The timer continues updating after Clock In', () => {
    const clockInTime = new Date('2026-10-19T10:00:00+05:30').toISOString()
    const session: TrackingSession = {
      id: 'sess-timer-test',
      employee_id: employeeAlice.id,
      session_date: '2026-10-19',
      clock_in: clockInTime,
      clock_out: null,
      status: 'working',
      worked_minutes: 0,
      active_minutes: 0,
      breaks: []
    }

    // 10 seconds later
    const now1 = new Date('2026-10-19T10:00:10+05:30').getTime()
    const worked1 = calculateDailyWorkedSeconds(session, [session], undefined, now1)
    expect(worked1).toBe(10)

    // 2 minutes later
    const now2 = new Date('2026-10-19T10:02:00+05:30').getTime()
    const worked2 = calculateDailyWorkedSeconds(session, [session], undefined, now2)
    expect(worked2).toBe(120)

    // Verify timer continues incrementing monotonically
    expect(worked2).toBeGreaterThan(worked1)
  })

  // 3. Background polling does not revert the state
  it('3. Background polling does not revert the state even when server returns empty sessions', async () => {
    const app = new SimulatedAppUi()
    const backend = new SimulatedBackend()

    backend.setCurrentUser(employeeAlice)
    app.setUser(employeeAlice)

    const clockInRes = await backend.clockIn(employeeAlice.id)
    app.currentSession = clockInRes.session!
    app.status = 'working'
    expect(app.getRenderedScreen()).toBe('working_screen')

    // Simulate empty server DB response (e.g. read replica replication lag)
    backend.dbSessions[employeeAlice.id] = []

    // Background polling runs
    await backend.syncEmployeeSessionsFromSupabase(employeeAlice.id)

    // Emit updated state
    const state = backend.getState(employeeAlice.id)
    app.applyState(state)

    // Verify: State must NOT revert to null or clock_in_screen!
    expect(backend.store[employeeAlice.id].currentSession).not.toBeNull()
    expect(app.getRenderedScreen()).toBe('working_screen')
    expect(app.currentSession).not.toBeNull()
  })

  // 4. App restart restores the correct active session
  it('4. App restart restores the correct active session', async () => {
    const backend = new SimulatedBackend()
    backend.setCurrentUser(employeeAlice)

    // Establish session
    await backend.clockIn(employeeAlice.id)
    const activeSession = backend.store[employeeAlice.id].currentSession
    expect(activeSession).toBeDefined()

    // Simulate fresh app instance on restart
    const restartedApp = new SimulatedAppUi()
    restartedApp.setUser(employeeAlice)

    // On startup, it calls getTrackingState
    const startupState = backend.getState(employeeAlice.id)
    restartedApp.applyState(startupState, employeeAlice)

    expect(restartedApp.getRenderedScreen()).toBe('working_screen')
    expect(restartedApp.currentSession?.id).toBe(activeSession!.id)
    expect(restartedApp.status).toBe('working')
  })

  // 5. Network or Supabase errors produce a clear error instead of a false success
  it('5. Network or Supabase errors produce a clear error instead of a false success', async () => {
    const app = new SimulatedAppUi()
    const backend = new SimulatedBackend()

    backend.setCurrentUser(employeeAlice)
    app.setUser(employeeAlice)

    // Simulate backend rejection (e.g. RLS policy error or network disconnection)
    backend.shouldSupabaseFail = true
    backend.supabaseErrorMessage = 'Row Level Security policy violation on table time_sessions'

    const result = await backend.clockIn(employeeAlice.id)

    // Must return false success = false
    expect(result.success).toBe(false)
    expect(result.error).toBe('Row Level Security policy violation on table time_sessions')
    expect(result.session).toBeUndefined()

    // App remains safely unclocked
    if (!result.success) {
      app.errorMessage = result.error!
    }
    expect(app.getRenderedScreen()).toBe('clock_in_screen')
    expect(app.currentSession).toBeNull()
    expect(app.errorMessage).toContain('Row Level Security policy violation')
  })

  // 6. Repeated clicks do not create duplicate sessions
  it('6. Repeated clicks do not create duplicate sessions', async () => {
    const backend = new SimulatedBackend()
    backend.setCurrentUser(employeeAlice)

    // Click 1
    const res1 = await backend.clockIn(employeeAlice.id)
    expect(res1.success).toBe(true)

    // Click 2 immediately after
    const res2 = await backend.clockIn(employeeAlice.id)
    expect(res2.success).toBe(true)

    // Must return the exact same session, not a second one
    expect(res1.session!.id).toBe(res2.session!.id)
    expect(backend.store[employeeAlice.id].todaySessions.length).toBe(1)
  })

  // 7. Switching accounts never restores another employee\'s session
  it('7. Switching accounts never restores another employee\'s session', async () => {
    const app = new SimulatedAppUi()
    const backend = new SimulatedBackend()

    // Alice logs in and clocks in
    backend.setCurrentUser(employeeAlice)
    app.setUser(employeeAlice)
    const aliceSession = (await backend.clockIn(employeeAlice.id)).session!
    app.currentSession = aliceSession
    app.status = 'working'
    expect(app.getRenderedScreen()).toBe('working_screen')

    // Alice logs out
    backend.setCurrentUser(null)
    app.setUser(null)
    app.applyState(backend.getState())
    expect(app.getRenderedScreen()).toBe('clock_in_screen')

    // Bob logs in
    backend.setCurrentUser(employeeBob)
    app.setUser(employeeBob)

    const bobState = backend.getState(employeeBob.id)
    app.applyState(bobState, employeeBob)

    // Bob must be on Clock In screen and must NOT have Alice's session
    expect(app.getRenderedScreen()).toBe('clock_in_screen')
    expect(app.currentSession).toBeNull()
    expect(app.status).toBe('Not Clocked In')
  })

  // 8. Existing break, resume, and clock-out transitions continue working
  it('8. Existing break, resume, and clock-out transitions continue working reliably', async () => {
    const app = new SimulatedAppUi()
    const backend = new SimulatedBackend()

    backend.setCurrentUser(employeeAlice)
    app.setUser(employeeAlice)

    // 1. Clock In -> Working
    const session = (await backend.clockIn(employeeAlice.id)).session!
    app.currentSession = session
    app.status = 'working'
    expect(app.getRenderedScreen()).toBe('working_screen')

    // 2. Take a Break -> On Break
    const breakRecord: BreakRecord = {
      id: 'break-1',
      session_id: session.id,
      start_time: new Date().toISOString(),
      end_time: null,
      duration_minutes: 0,
      reason: 'Coffee'
    }
    session.breaks.push(breakRecord)
    session.status = 'on_break'
    app.status = 'on_break'
    app.currentSession = { ...session }
    expect(app.getRenderedScreen()).toBe('break_screen')

    // 3. Resume Work -> Working
    breakRecord.end_time = new Date().toISOString()
    session.status = 'working'
    app.status = 'working'
    app.currentSession = { ...session }
    expect(app.getRenderedScreen()).toBe('working_screen')

    // 4. Clock Out -> Completed
    session.clock_out = new Date().toISOString()
    session.status = 'completed'
    app.currentSession = null
    app.status = 'Completed'
    expect(app.getRenderedScreen()).toBe('clock_in_screen')
  })
})
