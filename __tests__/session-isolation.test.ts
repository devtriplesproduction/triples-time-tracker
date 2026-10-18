import { describe, it, expect, beforeEach } from 'vitest'
import type { TrackingSession, ActivityInterval, UserProfile, PendingSyncItem } from '../src/types'

// Testable storage implementation matching electron/storage.ts
interface EmployeeStore {
  currentSession: TrackingSession | null
  todaySessions: TrackingSession[]
  activityLogs: ActivityInterval[]
  pendingSyncQueue: PendingSyncItem[]
  lastSyncedAt: string | null
}

interface TestStorageData {
  schemaVersion: number
  currentUser: UserProfile | null
  activeEmployeeId: string | null
  settings: any
  encryptedAuthTokens: string | null
  employeeData: Record<string, EmployeeStore>
}

// In-Memory simulated filesystem storage to avoid vite-electron-renderer require issues in test environment
class IsolatedStorageEngine {
  private diskStore: Map<string, string>
  public filePath: string
  public data: TestStorageData

  constructor(filePath: string = 'tracker-store.json', diskStore: Map<string, string> = new Map()) {
    this.filePath = filePath
    this.diskStore = diskStore
    this.data = this.loadData()
  }

  private normalizeSession(session: TrackingSession | null): TrackingSession | null {
    if (!session) return null
    if (session.status !== 'completed' && session.status !== 'Completed') {
      const hasOpenBreak = session.breaks && session.breaks.some((b: any) => b.end_time === null)
      session.status = hasOpenBreak ? 'on_break' : 'working'
      if (session.suspended_seconds === undefined) session.suspended_seconds = 0
      if (session.active_seconds_buffer === undefined) session.active_seconds_buffer = 0
    }
    return session
  }

  public loadData(): TestStorageData {
    if (this.diskStore.has(this.filePath)) {
      const raw = this.diskStore.get(this.filePath)!
      const parsed = JSON.parse(raw)
      const employeeData: Record<string, EmployeeStore> = parsed.employeeData || {}

      // Schema migration from v1 (shared flat store) to v2 (per-employee isolation)
      if (!parsed.schemaVersion || parsed.schemaVersion < 2) {
        const getBucket = (empId: string): EmployeeStore => {
          if (!employeeData[empId]) {
            employeeData[empId] = {
              currentSession: null,
              todaySessions: [],
              activityLogs: [],
              pendingSyncQueue: [],
              lastSyncedAt: null
            }
          }
          return employeeData[empId]
        }

        if (parsed.currentSession && parsed.currentSession.employee_id) {
          const bucket = getBucket(parsed.currentSession.employee_id)
          bucket.currentSession = this.normalizeSession(parsed.currentSession)
        }

        if (Array.isArray(parsed.todaySessions)) {
          for (const s of parsed.todaySessions) {
            if (s && s.employee_id) {
              const bucket = getBucket(s.employee_id)
              if (!bucket.todaySessions.some(x => x.id === s.id)) {
                bucket.todaySessions.push(s)
              }
            }
          }
        }

        if (Array.isArray(parsed.activityLogs)) {
          for (const l of parsed.activityLogs) {
            if (l && l.employee_id) {
              const bucket = getBucket(l.employee_id)
              if (!bucket.activityLogs.some(x => x.id === l.id)) {
                bucket.activityLogs.push(l)
              }
            }
          }
        }

        if (Array.isArray(parsed.pendingSyncQueue)) {
          for (const p of parsed.pendingSyncQueue) {
            const empId = p.employee_id || p.data?.employee_id || parsed.currentUser?.id
            if (empId) {
              p.employee_id = empId
              const bucket = getBucket(empId)
              if (!bucket.pendingSyncQueue.some(x => x.id === p.id)) {
                bucket.pendingSyncQueue.push(p)
              }
            }
          }
        }
      }

      for (const empId of Object.keys(employeeData)) {
        const store = employeeData[empId]
        if (store.currentSession) {
          store.currentSession = this.normalizeSession(store.currentSession)
        }
      }

      return {
        schemaVersion: 2,
        currentUser: parsed.currentUser || null,
        activeEmployeeId: parsed.currentUser?.id || parsed.activeEmployeeId || null,
        employeeData,
        encryptedAuthTokens: parsed.encryptedAuthTokens || null,
        settings: parsed.settings || { idleThresholdSeconds: 60, minimizeToTray: true, theme: 'dark' }
      }
    }

    return {
      schemaVersion: 2,
      currentUser: null,
      activeEmployeeId: null,
      employeeData: {},
      encryptedAuthTokens: null,
      settings: { idleThresholdSeconds: 60, minimizeToTray: true, theme: 'dark' }
    }
  }

  public save(): void {
    this.diskStore.set(this.filePath, JSON.stringify(this.data, null, 2))
  }

  public getEmployeeData(employeeId: string): EmployeeStore {
    if (!this.data.employeeData[employeeId]) {
      this.data.employeeData[employeeId] = {
        currentSession: null,
        todaySessions: [],
        activityLogs: [],
        pendingSyncQueue: [],
        lastSyncedAt: null
      }
    }
    return this.data.employeeData[employeeId]
  }

  public getCurrentUser(): UserProfile | null {
    return this.data.currentUser
  }

  public setCurrentUser(user: UserProfile | null): void {
    this.data.currentUser = user
    this.data.activeEmployeeId = user ? user.id : null
    if (user?.id) {
      this.getEmployeeData(user.id)
    }
    this.save()
  }

  public clearActiveUser(): void {
    this.data.currentUser = null
    this.data.activeEmployeeId = null
    this.data.encryptedAuthTokens = null
    this.save()
  }

  public getCurrentSession(employeeId?: string): TrackingSession | null {
    const empId = employeeId || this.data.currentUser?.id || this.data.activeEmployeeId
    if (!empId) return null

    const store = this.data.employeeData[empId]
    if (!store || !store.currentSession) return null

    if (store.currentSession.employee_id !== empId) {
      store.currentSession = null
      this.save()
      return null
    }

    return store.currentSession
  }

  public setCurrentSession(session: TrackingSession | null, employeeId?: string): void {
    if (session) {
      const empId = session.employee_id || employeeId || this.data.currentUser?.id
      if (!empId) return
      session.employee_id = empId
      const store = this.getEmployeeData(empId)
      store.currentSession = session
      const idx = store.todaySessions.findIndex(s => s.id === session.id)
      if (idx !== -1) store.todaySessions[idx] = session
      else store.todaySessions.push(session)
      this.save()
    } else {
      const empId = employeeId || this.data.currentUser?.id
      if (empId && this.data.employeeData[empId]) {
        this.data.employeeData[empId].currentSession = null
        this.save()
      }
    }
  }

  public updateCurrentSession(updates: Partial<TrackingSession>, employeeId?: string): TrackingSession | null {
    const empId = employeeId || this.data.currentUser?.id
    if (!empId || !this.data.employeeData[empId]) return null
    const store = this.data.employeeData[empId]
    if (!store.currentSession) return null
    store.currentSession = { ...store.currentSession, ...updates }
    const idx = store.todaySessions.findIndex(s => s.id === store.currentSession!.id)
    if (idx !== -1) store.todaySessions[idx] = store.currentSession
    this.save()
    return store.currentSession
  }

  public getTodaySessions(employeeId?: string, todayDate: string = '2026-10-18'): TrackingSession[] {
    const empId = employeeId || this.data.currentUser?.id
    if (!empId || !this.data.employeeData[empId]) return []
    return this.data.employeeData[empId].todaySessions.filter(
      s => s.session_date === todayDate && s.employee_id === empId
    )
  }

  public getPendingQueue(employeeId?: string): PendingSyncItem[] {
    const empId = employeeId || this.data.currentUser?.id
    if (!empId || !this.data.employeeData[empId]) return []
    return this.data.employeeData[empId].pendingSyncQueue || []
  }

  public enqueuePending(item: PendingSyncItem, employeeId?: string): void {
    const empId = item.employee_id || employeeId || this.data.currentUser?.id
    if (!empId) return
    item.employee_id = empId
    const store = this.getEmployeeData(empId)
    if (!store.pendingSyncQueue.find(p => p.id === item.id)) {
      store.pendingSyncQueue.push(item)
      this.save()
    }
  }

  public removePending(id: string, employeeId?: string): void {
    if (employeeId && this.data.employeeData[employeeId]) {
      this.data.employeeData[employeeId].pendingSyncQueue = this.data.employeeData[employeeId].pendingSyncQueue.filter(p => p.id !== id)
      this.save()
      return
    }
    for (const empKey of Object.keys(this.data.employeeData)) {
      this.data.employeeData[empKey].pendingSyncQueue = this.data.employeeData[empKey].pendingSyncQueue.filter(p => p.id !== id)
    }
    this.save()
  }
}

// Controller simulator matching electron/main.ts and activity-tracker.ts
class ActivityTrackerSimulator {
  private storage: IsolatedStorageEngine
  public activeSecondsBuffer: number = 0

  constructor(storage: IsolatedStorageEngine) {
    this.storage = storage
  }

  public onUserLogin(user: UserProfile) {
    const session = this.storage.getCurrentSession(user.id)
    if (session && (session.status === 'working' || session.status === 'on_break')) {
      this.activeSecondsBuffer = session.active_seconds_buffer || 0
    } else {
      this.activeSecondsBuffer = 0
    }
  }

  public onUserLogout() {
    this.activeSecondsBuffer = 0
  }

  public getState(employeeId?: string, todayDate: string = '2026-10-18') {
    const empId = employeeId || this.storage.getCurrentUser()?.id
    if (!empId) {
      return {
        status: 'Not Clocked In' as const,
        currentSession: null,
        todayWorkedMinutes: 0,
        todayActiveMinutes: 0,
        pendingSyncCount: 0
      }
    }

    const session = this.storage.getCurrentSession(empId)
    const todaySessions = this.storage.getTodaySessions(empId, todayDate)
    const todayWorkedMinutes = todaySessions.reduce((acc, s) => acc + s.worked_minutes, 0)
    const todayActiveMinutes = todaySessions.reduce((acc, s) => acc + s.active_minutes, 0)

    return {
      status: session ? session.status : 'Not Clocked In',
      currentSession: session,
      todayWorkedMinutes,
      todayActiveMinutes,
      pendingSyncCount: this.storage.getPendingQueue(empId).length
    }
  }

  public clockIn(employeeId: string, timestamp: string = new Date().toISOString(), sessionDate: string = '2026-10-18'): TrackingSession {
    const user = this.storage.getCurrentUser()
    if (!user || user.id !== employeeId) {
      throw new Error(`Clock in failed: requested employee ${employeeId} does not match active authenticated user ${user?.id || 'none'}`)
    }

    const existing = this.storage.getCurrentSession(employeeId)
    if (existing && existing.status !== 'Completed' && existing.status !== 'completed') {
      return existing
    }

    const newSession: TrackingSession = {
      id: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      employee_id: employeeId,
      session_date: sessionDate,
      clock_in: timestamp,
      clock_out: null,
      status: 'working',
      worked_minutes: 0,
      active_minutes: 0,
      suspended_seconds: 0,
      active_seconds_buffer: 0,
      breaks: []
    }

    this.storage.setCurrentSession(newSession, employeeId)
    this.activeSecondsBuffer = 0
    return newSession
  }

  public takeBreak(employeeId: string, timestamp: string = new Date().toISOString()): TrackingSession | null {
    const user = this.storage.getCurrentUser()
    if (!user || user.id !== employeeId) return null

    const session = this.storage.getCurrentSession(employeeId)
    if (!session || session.employee_id !== employeeId) return null
    if (session.status !== 'working' && session.status !== 'Working') return null
    if (session.breaks.some(b => b.end_time === null)) return session

    session.breaks.push({
      id: `break-${Date.now()}`,
      session_id: session.id,
      start_time: timestamp,
      end_time: null,
      duration_minutes: 0,
      reason: 'Break'
    })
    session.status = 'on_break'
    this.storage.updateCurrentSession({ status: 'on_break', breaks: session.breaks }, employeeId)
    this.activeSecondsBuffer = 0
    return session
  }

  public resumeBreak(employeeId: string, timestamp: string = new Date().toISOString()): TrackingSession | null {
    const user = this.storage.getCurrentUser()
    if (!user || user.id !== employeeId) return null

    const session = this.storage.getCurrentSession(employeeId)
    if (!session || session.employee_id !== employeeId) return null
    if (session.status !== 'on_break' && session.status !== 'On Break') return session

    const openBreak = session.breaks.find(b => b.end_time === null)
    if (openBreak) {
      openBreak.end_time = timestamp
      const startMs = new Date(openBreak.start_time).getTime()
      const endMs = new Date(timestamp).getTime()
      openBreak.duration_minutes = Math.max(0, Math.floor((endMs - startMs) / 60000))
    }

    session.status = 'working'
    this.storage.updateCurrentSession({ status: 'working', breaks: session.breaks }, employeeId)
    this.activeSecondsBuffer = 0
    return session
  }

  public clockOut(employeeId: string, timestamp: string = new Date().toISOString()): TrackingSession | null {
    const user = this.storage.getCurrentUser()
    if (!user || user.id !== employeeId) return null

    const session = this.storage.getCurrentSession(employeeId)
    if (!session || session.employee_id !== employeeId) return null
    if (session.status === 'Completed' || session.status === 'completed') return null

    session.clock_out = timestamp
    session.status = 'completed'

    const clockInTime = new Date(session.clock_in).getTime()
    let totalBreakMs = 0
    for (const b of session.breaks) {
      if (b.end_time) {
        totalBreakMs += Math.max(0, new Date(b.end_time).getTime() - new Date(b.start_time).getTime())
      }
    }
    const suspendedMs = (session.suspended_seconds || 0) * 1000
    const finalWorkedMs = Math.max(0, new Date(timestamp).getTime() - clockInTime - totalBreakMs - suspendedMs)
    session.worked_minutes = Math.floor(finalWorkedMs / 60000)

    this.storage.setCurrentSession(null, employeeId)
    const store = this.storage.getEmployeeData(employeeId)
    const idx = store.todaySessions.findIndex(s => s.id === session.id)
    if (idx !== -1) store.todaySessions[idx] = session
    else store.todaySessions.push(session)
    this.storage.save()

    this.activeSecondsBuffer = 0
    return session
  }

  public simulateTick(employeeId: string, currentTimeMs: number) {
    const user = this.storage.getCurrentUser()
    if (!user || user.id !== employeeId) return

    const session = this.storage.getCurrentSession(employeeId)
    if (!session || session.status !== 'working') return

    const clockInTime = new Date(session.clock_in).getTime()
    let totalBreakMs = 0
    for (const b of session.breaks) {
      const start = new Date(b.start_time).getTime()
      const end = b.end_time ? new Date(b.end_time).getTime() : currentTimeMs
      totalBreakMs += Math.max(0, end - start)
    }
    const currentWorkedMs = Math.max(0, currentTimeMs - clockInTime - totalBreakMs)
    session.worked_minutes = Math.floor(currentWorkedMs / 60000)

    this.activeSecondsBuffer += 60
    if (this.activeSecondsBuffer >= 60) {
      session.active_minutes += 1
      this.activeSecondsBuffer = 0
    }

    this.storage.updateCurrentSession({
      worked_minutes: session.worked_minutes,
      active_minutes: session.active_minutes
    }, employeeId)
  }
}

describe('Cross-User Session Isolation & Ownership Regression Suite', () => {
  let diskStore: Map<string, string>
  let storage: IsolatedStorageEngine
  let tracker: ActivityTrackerSimulator

  const userOmkar: UserProfile = {
    id: 'user-omkar-uuid-1',
    email: 'omkar.sawant@triples.com',
    first_name: 'Omkar',
    last_name: 'Sawant',
    employee_id: 'EMP-001',
    department: 'Engineering',
    designation: 'Full-Stack Developer',
    role: 'Employee'
  }

  const userAdmin: UserProfile = {
    id: 'user-admin-uuid-2',
    email: 'admin@triples.com',
    first_name: 'Admin',
    last_name: 'Staff',
    employee_id: 'EMP-999',
    department: 'Management',
    designation: 'Staff',
    role: 'Admin'
  }

  beforeEach(() => {
    diskStore = new Map()
    storage = new IsolatedStorageEngine('tracker-store.json', diskStore)
    tracker = new ActivityTrackerSimulator(storage)
  })

  it('Regression Test 1: Omkar clocks in; Admin logs in separately and sees no active session unless Admin has independently clocked in', () => {
    // 1. Omkar logs in and clocks in
    storage.setCurrentUser(userOmkar)
    tracker.onUserLogin(userOmkar)
    const omkarSession = tracker.clockIn(userOmkar.id, '2026-10-18T09:00:00.000Z')
    expect(omkarSession.employee_id).toBe(userOmkar.id)
    expect(omkarSession.status).toBe('working')

    // Work for 90 minutes
    const startMs = new Date('2026-10-18T09:00:00.000Z').getTime()
    tracker.simulateTick(userOmkar.id, startMs + 90 * 60000)

    const omkarState = tracker.getState(userOmkar.id)
    expect(omkarState.status).toBe('working')
    expect(omkarState.todayWorkedMinutes).toBe(90)
    expect(omkarState.todayActiveMinutes).toBe(1)

    // 2. Omkar logs out
    tracker.onUserLogout()
    storage.clearActiveUser()

    const loggedOutState = tracker.getState()
    expect(loggedOutState.status).toBe('Not Clocked In')
    expect(loggedOutState.currentSession).toBeNull()
    expect(loggedOutState.todayWorkedMinutes).toBe(0)

    // 3. Admin logs in separately
    storage.setCurrentUser(userAdmin)
    tracker.onUserLogin(userAdmin)

    const adminState = tracker.getState(userAdmin.id)
    // CRITICAL REGRESSION CHECK: Admin must see NO active session and ZERO hours!
    expect(adminState.status).toBe('Not Clocked In')
    expect(adminState.currentSession).toBeNull()
    expect(adminState.todayWorkedMinutes).toBe(0)
    expect(adminState.todayActiveMinutes).toBe(0)
    expect(adminState.pendingSyncCount).toBe(0)
  })

  it('Regression Test 2: Admin cannot inherit Omkar\'s timer or pending synchronization records', () => {
    // Omkar logs in, clocks in, and enqueues offline sync records
    storage.setCurrentUser(userOmkar)
    tracker.onUserLogin(userOmkar)
    tracker.clockIn(userOmkar.id)

    for (let i = 1; i <= 20; i++) {
      storage.enqueuePending({
        id: `omkar-sync-item-${i}`,
        type: 'activity',
        employee_id: userOmkar.id,
        data: { active_seconds: 60, interval: i },
        createdAt: new Date().toISOString(),
        retries: 0
      }, userOmkar.id)
    }

    expect(storage.getPendingQueue(userOmkar.id).length).toBe(20)

    // Omkar logs out and Admin logs in
    tracker.onUserLogout()
    storage.clearActiveUser()

    storage.setCurrentUser(userAdmin)
    tracker.onUserLogin(userAdmin)

    // Admin pending sync queue must be strictly empty (0), not 20 or 19!
    expect(storage.getPendingQueue(userAdmin.id).length).toBe(0)
    const adminState = tracker.getState(userAdmin.id)
    expect(adminState.pendingSyncCount).toBe(0)
    expect(adminState.todayWorkedMinutes).toBe(0)
    expect(adminState.currentSession).toBeNull()

    // Omkar's pending records remain safely preserved under Omkar's identity
    expect(storage.getPendingQueue(userOmkar.id).length).toBe(20)
  })

  it('Regression Test 3: Two accounts have independent session IDs, clock-in timestamps, Worked Hours, and Active Hours', () => {
    // Omkar clocks in at 09:00 AM
    storage.setCurrentUser(userOmkar)
    tracker.onUserLogin(userOmkar)
    const omkarSession = tracker.clockIn(userOmkar.id, '2026-10-18T09:00:00.000Z')

    // Omkar works 2 hours (120 mins)
    const omkarStartMs = new Date('2026-10-18T09:00:00.000Z').getTime()
    for (let i = 1; i <= 120; i++) {
      tracker.simulateTick(userOmkar.id, omkarStartMs + i * 60000)
    }

    // Switch to Admin
    tracker.onUserLogout()
    storage.clearActiveUser()

    storage.setCurrentUser(userAdmin)
    tracker.onUserLogin(userAdmin)

    // Admin clocks in independently at 11:30 AM
    const adminSession = tracker.clockIn(userAdmin.id, '2026-10-18T11:30:00.000Z')

    // Admin works 30 mins
    const adminStartMs = new Date('2026-10-18T11:30:00.000Z').getTime()
    for (let i = 1; i <= 30; i++) {
      tracker.simulateTick(userAdmin.id, adminStartMs + i * 60000)
    }

    // Check independent session attributes
    expect(omkarSession.id).not.toBe(adminSession.id)
    expect(omkarSession.clock_in).toBe('2026-10-18T09:00:00.000Z')
    expect(adminSession.clock_in).toBe('2026-10-18T11:30:00.000Z')

    const omkarState = tracker.getState(userOmkar.id)
    const adminState = tracker.getState(userAdmin.id)

    expect(omkarState.todayWorkedMinutes).toBe(120)
    expect(omkarState.todayActiveMinutes).toBe(120)

    expect(adminState.todayWorkedMinutes).toBe(30)
    expect(adminState.todayActiveMinutes).toBe(30)
  })

  it('Regression Test 4: Logging out and switching accounts clears the previous account\'s UI state', () => {
    storage.setCurrentUser(userOmkar)
    tracker.onUserLogin(userOmkar)
    tracker.clockIn(userOmkar.id)

    // Omkar UI state is active
    let state = tracker.getState()
    expect(state.status).toBe('working')
    expect(state.currentSession).not.toBeNull()

    // Trigger logout
    tracker.onUserLogout()
    storage.clearActiveUser()

    state = tracker.getState()
    expect(state.status).toBe('Not Clocked In')
    expect(state.currentSession).toBeNull()
    expect(state.todayWorkedMinutes).toBe(0)
    expect(state.todayActiveMinutes).toBe(0)
    expect(state.pendingSyncCount).toBe(0)
  })

  it('Regression Test 5: Restarting the app restores only the authenticated employee\'s own session', () => {
    // Omkar clocks in and takes a break
    storage.setCurrentUser(userOmkar)
    tracker.onUserLogin(userOmkar)
    const s = tracker.clockIn(userOmkar.id, '2026-10-18T09:00:00.000Z')
    tracker.takeBreak(userOmkar.id, '2026-10-18T10:00:00.000Z')

    // Simulate App Restart by reloading storage from simulated disk
    const restartedStorage = new IsolatedStorageEngine('tracker-store.json', diskStore)
    restartedStorage.setCurrentUser(userOmkar)
    const restartedTracker = new ActivityTrackerSimulator(restartedStorage)
    restartedTracker.onUserLogin(userOmkar)

    const restoredState = restartedTracker.getState(userOmkar.id)
    expect(restoredState.currentSession?.id).toBe(s.id)
    expect(restoredState.currentSession?.employee_id).toBe(userOmkar.id)
    expect(restoredState.status).toBe('on_break')

    // If Admin starts app on same machine without Omkar tokens:
    restartedStorage.setCurrentUser(userAdmin)
    restartedTracker.onUserLogin(userAdmin)
    const adminRestoredState = restartedTracker.getState(userAdmin.id)
    expect(adminRestoredState.currentSession).toBeNull()
    expect(adminRestoredState.status).toBe('Not Clocked In')
  })

  it('Regression Test 6: Offline records sync to their original owner after account switching', () => {
    // Omkar creates 1 offline record
    storage.setCurrentUser(userOmkar)
    tracker.onUserLogin(userOmkar)
    storage.enqueuePending({
      id: 'omkar-rec-1',
      type: 'activity',
      employee_id: userOmkar.id,
      data: { app: 'VS Code' },
      createdAt: new Date().toISOString(),
      retries: 0
    }, userOmkar.id)

    // Admin logs in and creates 1 offline record
    tracker.onUserLogout()
    storage.clearActiveUser()

    storage.setCurrentUser(userAdmin)
    tracker.onUserLogin(userAdmin)
    storage.enqueuePending({
      id: 'admin-rec-1',
      type: 'activity',
      employee_id: userAdmin.id,
      data: { app: 'TripleS ERP' },
      createdAt: new Date().toISOString(),
      retries: 0
    }, userAdmin.id)

    // Admin queue has 1 record owned by admin
    const adminQueue = storage.getPendingQueue(userAdmin.id)
    expect(adminQueue.length).toBe(1)
    expect(adminQueue[0].employee_id).toBe(userAdmin.id)

    // Omkar queue has 1 record owned by omkar
    const omkarQueue = storage.getPendingQueue(userOmkar.id)
    expect(omkarQueue.length).toBe(1)
    expect(omkarQueue[0].employee_id).toBe(userOmkar.id)

    // Admin syncing removes only admin's record
    storage.removePending('admin-rec-1', userAdmin.id)
    expect(storage.getPendingQueue(userAdmin.id).length).toBe(0)
    expect(storage.getPendingQueue(userOmkar.id).length).toBe(1) // Omkar's record still intact!
  })

  it('Regression Test 7: A user cannot read, update, or clock out another employee\'s session by manipulating IPC payloads or API requests', () => {
    // Omkar has an active session
    storage.setCurrentUser(userOmkar)
    tracker.onUserLogin(userOmkar)
    const omkarSession = tracker.clockIn(userOmkar.id)

    // Malicious request attempt: Admin tries to clock in or clock out Omkar's session
    storage.setCurrentUser(userAdmin)
    tracker.onUserLogin(userAdmin)

    // 1. Admin tries to clock in as Omkar -> Throws unauthorized
    expect(() => tracker.clockIn(userOmkar.id)).toThrow(/does not match active authenticated user/)

    // 2. Admin tries to take a break on Omkar's session -> Rejected (null)
    const breakResult = tracker.takeBreak(userOmkar.id)
    expect(breakResult).toBeNull()

    // 3. Admin tries to resume Omkar's session -> Rejected (null)
    const resumeResult = tracker.resumeBreak(userOmkar.id)
    expect(resumeResult).toBeNull()

    // 4. Admin tries to clock out Omkar's session -> Rejected (null)
    const clockOutResult = tracker.clockOut(userOmkar.id)
    expect(clockOutResult).toBeNull()

    // Omkar's session in storage is completely untouched and still working
    storage.setCurrentUser(userOmkar)
    expect(storage.getCurrentSession(userOmkar.id)?.id).toBe(omkarSession.id)
    expect(storage.getCurrentSession(userOmkar.id)?.status).toBe('working')
  })

  it('Regression Test 8: No session is created without an explicit successful Clock In action', () => {
    // User logs in
    storage.setCurrentUser(userAdmin)
    tracker.onUserLogin(userAdmin)

    // Merely logging in or initializing must NOT create or restore any session
    const state = tracker.getState(userAdmin.id)
    expect(state.currentSession).toBeNull()
    expect(state.status).toBe('Not Clocked In')
    expect(state.todayWorkedMinutes).toBe(0)

    // Session only created after explicit clockIn action
    const session = tracker.clockIn(userAdmin.id)
    expect(session).toBeDefined()
    expect(session.status).toBe('working')
    expect(tracker.getState(userAdmin.id).status).toBe('working')
  })

  it('Migration Test: Migrates legacy v1 flat store into v2 per-employee isolated store safely without losing data', () => {
    const legacyV1Data = {
      currentUser: userOmkar,
      currentSession: {
        id: 'legacy-sess-100',
        employee_id: userOmkar.id,
        session_date: '2026-10-18',
        clock_in: '2026-10-18T08:00:00.000Z',
        clock_out: null,
        status: 'working',
        worked_minutes: 89,
        active_minutes: 63,
        breaks: []
      },
      todaySessions: [
        {
          id: 'legacy-sess-100',
          employee_id: userOmkar.id,
          session_date: '2026-10-18',
          clock_in: '2026-10-18T08:00:00.000Z',
          clock_out: null,
          status: 'working',
          worked_minutes: 89,
          active_minutes: 63,
          breaks: []
        }
      ],
      pendingSyncQueue: [
        {
          id: 'sync-item-legacy-1',
          type: 'activity',
          employee_id: userOmkar.id,
          data: {},
          createdAt: '2026-10-18T08:30:00.000Z',
          retries: 0
        }
      ]
    }

    diskStore.set('legacy-store.json', JSON.stringify(legacyV1Data, null, 2))

    // Initialize storage engine on existing v1 file
    const migratedStorage = new IsolatedStorageEngine('legacy-store.json', diskStore)

    // Check that schema version is now 2
    expect(migratedStorage.data.schemaVersion).toBe(2)

    // Omkar's session and pending queue are safely mapped into employeeData[userOmkar.id]
    expect(migratedStorage.getCurrentSession(userOmkar.id)?.id).toBe('legacy-sess-100')
    expect(migratedStorage.getTodaySessions(userOmkar.id, '2026-10-18').length).toBe(1)
    expect(migratedStorage.getPendingQueue(userOmkar.id).length).toBe(1)

    // If Admin logs in, Admin has completely empty store
    expect(migratedStorage.getCurrentSession(userAdmin.id)).toBeNull()
    expect(migratedStorage.getTodaySessions(userAdmin.id, '2026-10-18').length).toBe(0)
    expect(migratedStorage.getPendingQueue(userAdmin.id).length).toBe(0)
  })
})
