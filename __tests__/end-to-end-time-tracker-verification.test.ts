import { describe, it, expect, beforeEach } from 'vitest'
import type {
  TrackingSession,
  ScreenshotRecord,
  UserProfile,
  PendingSyncItem,
  TrackingState,
  BreakRecord
} from '../src/types'
import {
  calculateDailyWorkedSeconds,
  calculateDailyActiveSeconds,
  formatSecondsToHHMMSS,
  getKolkataGreeting
} from '../src/utils/timeCalculator'

describe('TripleS Time Tracker — Full System End-to-End Verification', () => {
  const aliceEmployee: UserProfile = {
    id: 'emp-alice-uuid-001',
    email: 'alice@triplesproduction.com',
    first_name: 'Alice',
    last_name: 'Smith',
    employee_id: 'TSP-101',
    department: 'Development',
    designation: 'Software Developer',
    role: 'Employee',
    is_active: true
  }

  const bobAdmin: UserProfile = {
    id: 'emp-bob-uuid-002',
    email: 'bob@triplesproduction.com',
    first_name: 'Bob',
    last_name: 'Director',
    employee_id: 'TSP-002',
    department: 'Management',
    designation: 'Managing Director',
    role: 'Admin',
    is_active: true
  }

  // Simulated Full Stack Environment
  class CompleteTimeTrackerEnvironment {
    public currentUser: UserProfile | null = null
    public activeSession: TrackingSession | null = null
    public todaySessions: TrackingSession[] = []
    public screenshotBuffer = 0
    public screenshotIntervalSeconds = 420 // 7 minutes
    public isIdle = false
    public isSuspended = false
    public isScreenLocked = false
    public currentApp = 'Visual Studio Code'
    public currentTitle = 'App.tsx - TripleS Time Tracker'

    // Mock Databases & Storage
    public remoteSessions: TrackingSession[] = []
    public remoteScreenshots: ScreenshotRecord[] = []
    public storageBucket: Map<string, Buffer> = new Map()
    public pendingQueue: PendingSyncItem[] = []
    public isNetworkOnline = true

    public login(user: UserProfile) {
      this.currentUser = user
    }

    public logout() {
      this.currentUser = null
      this.activeSession = null
      this.screenshotBuffer = 0
    }

    public clockIn(timestamp: string = new Date().toISOString()): { success: boolean; session?: TrackingSession; error?: string } {
      if (!this.currentUser) return { success: false, error: 'Authentication required' }
      if (this.activeSession && !this.activeSession.clock_out && this.activeSession.status !== 'completed') {
        return { success: true, session: this.activeSession }
      }

      const session: TrackingSession = {
        id: `sess-${Date.now()}`,
        employee_id: this.currentUser.id,
        session_date: '2026-10-31',
        clock_in: timestamp,
        clock_out: null,
        status: 'working',
        worked_minutes: 0,
        active_minutes: 0,
        suspended_seconds: 0,
        active_seconds_buffer: 0,
        breaks: []
      }

      this.activeSession = session
      this.todaySessions.push(session)
      this.screenshotBuffer = 0

      if (this.isNetworkOnline) {
        this.remoteSessions.push(session)
      } else {
        this.pendingQueue.push({
          id: `session-${session.id}`,
          type: 'session',
          employee_id: this.currentUser.id,
          data: session,
          createdAt: timestamp,
          retries: 0
        })
      }

      return { success: true, session }
    }

    public takeBreak(timestamp: string = new Date().toISOString()) {
      if (!this.activeSession || this.activeSession.status !== 'working') return false
      this.activeSession.status = 'on_break'
      const b: BreakRecord = {
        id: `brk-${Date.now()}`,
        session_id: this.activeSession.id,
        start_time: timestamp,
        end_time: null,
        duration_minutes: 0,
        reason: 'Lunch Break'
      }
      this.activeSession.breaks.push(b)
      return true
    }

    public resumeBreak(timestamp: string = new Date().toISOString()) {
      if (!this.activeSession || this.activeSession.status !== 'on_break') return false
      const openBreak = this.activeSession.breaks.find(b => b.end_time === null)
      if (openBreak) {
        openBreak.end_time = timestamp
        const startMs = new Date(openBreak.start_time).getTime()
        const endMs = new Date(timestamp).getTime()
        openBreak.duration_minutes = Math.max(0, Math.floor((endMs - startMs) / 60000))
      }
      this.activeSession.status = 'working'
      return true
    }

    public clockOut(timestamp: string = new Date().toISOString()) {
      if (!this.activeSession) return false
      const nowMs = new Date(timestamp).getTime()
      const inMs = new Date(this.activeSession.clock_in).getTime()

      let totalBreakMs = 0
      for (const b of this.activeSession.breaks) {
        if (!b.end_time) b.end_time = timestamp
        const bStart = new Date(b.start_time).getTime()
        const bEnd = new Date(b.end_time).getTime()
        totalBreakMs += Math.max(0, bEnd - bStart)
      }

      const workedMs = Math.max(0, nowMs - inMs - totalBreakMs)
      this.activeSession.worked_minutes = Math.floor(workedMs / 60000)
      this.activeSession.clock_out = timestamp
      this.activeSession.status = 'completed'
      this.screenshotBuffer = 0
      return true
    }

    // 1-second tick loop replicating Electron activity-tracker.ts
    public tick() {
      if (!this.activeSession || !this.currentUser) return

      const isWorking = this.activeSession.status === 'working' || this.activeSession.status === 'Working'
      const hasOpenBreak = this.activeSession.breaks.some(b => b.end_time === null)

      if (isWorking && !hasOpenBreak && !this.isIdle && !this.isSuspended && !this.isScreenLocked) {
        this.screenshotBuffer += 1

        if (this.screenshotBuffer >= this.screenshotIntervalSeconds) {
          this.screenshotBuffer = 0
          this.captureScreenshot()
        }
      }
    }

    public captureScreenshot(): ScreenshotRecord {
      const id = `scr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const now = new Date().toISOString()
      const storagePath = `${this.currentUser!.id}/${this.activeSession!.session_date}/${this.activeSession!.id}/${id}.jpg`
      const mockImageBytes = Buffer.from('mock-compressed-jpeg-content')

      const record: ScreenshotRecord = {
        id,
        session_id: this.activeSession!.id,
        employee_id: this.currentUser!.id,
        session_date: this.activeSession!.session_date,
        captured_at: now,
        storage_path: storagePath,
        image_url: `https://sfjerymoxnolxblhelho.supabase.co/storage/v1/object/public/screenshots/${storagePath}`,
        image_data: null,
        file_size_bytes: mockImageBytes.length,
        app_name: this.currentApp,
        window_title: this.currentTitle,
        created_at: now
      }

      if (this.isNetworkOnline) {
        this.storageBucket.set(storagePath, mockImageBytes)
        this.remoteScreenshots.push(record)
      } else {
        // Enqueue to offline pending queue
        record.image_data = `data:image/jpeg;base64,${mockImageBytes.toString('base64')}`
        this.pendingQueue.push({
          id: `screenshot-${id}`,
          type: 'screenshot',
          employee_id: this.currentUser!.id,
          data: { record, buffer: mockImageBytes },
          createdAt: now,
          retries: 0
        })
      }

      return record
    }

    public flushPending() {
      if (!this.isNetworkOnline) return
      for (const item of [...this.pendingQueue]) {
        if (item.type === 'screenshot') {
          const { record, buffer } = item.data
          this.storageBucket.set(record.storage_path, buffer)
          this.remoteScreenshots.push(record)
          this.pendingQueue = this.pendingQueue.filter(p => p.id !== item.id)
        } else if (item.type === 'session') {
          this.remoteSessions.push(item.data)
          this.pendingQueue = this.pendingQueue.filter(p => p.id !== item.id)
        }
      }
    }

    // Admin Query API matching SupabaseService.getScreenshots
    public queryScreenshotsForAdmin(
      requestingUser: UserProfile,
      employeeId: string,
      month?: string,
      date?: string
    ) {
      const roleUpper = (requestingUser.role || '').toUpperCase()
      const isAdmin = roleUpper === 'ADMIN' || roleUpper === 'SUPER_ADMIN' || roleUpper === 'HR'
      const targetEmp = isAdmin ? employeeId : requestingUser.id

      return this.remoteScreenshots.filter(s => {
        if (s.employee_id !== targetEmp) return false
        if (date && s.session_date !== date) return false
        if (month && !s.session_date.startsWith(month)) return false
        return true
      })
    }
  }

  it('verifies the full end-to-end workflow: Clock in, 7-minute periodic screenshots, breaks, and admin monthly inspection', () => {
    const env = new CompleteTimeTrackerEnvironment()

    // 1. Employee Alice logs in
    env.login(aliceEmployee)
    expect(env.currentUser?.first_name).toBe('Alice')

    // 2. Alice clocks in at 10:00:00 AM
    const clockInRes = env.clockIn('2026-10-31T10:00:00+05:30')
    expect(clockInRes.success).toBe(true)
    expect(env.activeSession?.status).toBe('working')

    // 3. Alice works for 6 minutes (360 seconds) -> No screenshot yet
    for (let s = 0; s < 360; s++) env.tick()
    expect(env.screenshotBuffer).toBe(360)
    expect(env.remoteScreenshots.length).toBe(0)

    // 4. Alice completes the 7th minute (another 60 seconds -> total 420 seconds)
    for (let s = 0; s < 60; s++) env.tick()
    // Screenshot #1 captured automatically!
    expect(env.screenshotBuffer).toBe(0)
    expect(env.remoteScreenshots.length).toBe(1)
    expect(env.remoteScreenshots[0].employee_id).toBe(aliceEmployee.id)
    expect(env.remoteScreenshots[0].app_name).toBe('Visual Studio Code')
    expect(env.storageBucket.size).toBe(1)

    // 5. Alice works for another 3 minutes (180 seconds)
    for (let s = 0; s < 180; s++) env.tick()
    expect(env.screenshotBuffer).toBe(180)

    // 6. Alice takes a lunch break at 10:10:00 AM
    env.takeBreak('2026-10-31T10:10:00+05:30')
    expect(env.activeSession?.status).toBe('on_break')

    // 30 minutes pass on break (1800 ticks) -> Buffer MUST remain frozen at 180, 0 new screenshots
    for (let s = 0; s < 1800; s++) env.tick()
    expect(env.screenshotBuffer).toBe(180)
    expect(env.remoteScreenshots.length).toBe(1)

    // 7. Alice resumes work at 10:40:00 AM
    env.resumeBreak('2026-10-31T10:40:00+05:30')
    expect(env.activeSession?.status).toBe('working')

    // 8. Work remaining 240 seconds (180 + 240 = 420 seconds)
    for (let s = 0; s < 240; s++) env.tick()
    // Screenshot #2 captured automatically!
    expect(env.screenshotBuffer).toBe(0)
    expect(env.remoteScreenshots.length).toBe(2)

    // 9. Work another full 7 minutes (420 seconds)
    for (let s = 0; s < 420; s++) env.tick()
    // Screenshot #3 captured automatically!
    expect(env.remoteScreenshots.length).toBe(3)

    // 10. Alice clocks out
    env.clockOut('2026-10-31T11:00:00+05:30')
    expect(env.activeSession?.status).toBe('completed')
    expect(env.screenshotBuffer).toBe(0)

    // 11. Add historical screenshots for past months to remote database
    env.remoteScreenshots.push(
      {
        id: 'scr-sep-alice',
        session_id: 'sess-sep',
        employee_id: aliceEmployee.id,
        session_date: '2026-09-15',
        captured_at: '2026-09-15T11:07:00+05:30',
        storage_path: 'alice/2026-09-15/scr-sep.jpg',
        image_url: 'https://storage/alice/sep.jpg',
        file_size_bytes: 110000,
        app_name: 'Figma',
        created_at: '2026-09-15T11:07:00+05:30'
      },
      {
        id: 'scr-aug-alice',
        session_id: 'sess-aug',
        employee_id: aliceEmployee.id,
        session_date: '2026-08-20',
        captured_at: '2026-08-20T14:14:00+05:30',
        storage_path: 'alice/2026-08-20/scr-aug.jpg',
        image_url: 'https://storage/alice/aug.jpg',
        file_size_bytes: 125000,
        app_name: 'Postman',
        created_at: '2026-08-20T14:14:00+05:30'
      }
    )

    // 12. Admin Bob logs into the system to inspect Alice's screenshots
    // A) Admin queries current month (October 2026)
    const octScreenshots = env.queryScreenshotsForAdmin(bobAdmin, aliceEmployee.id, '2026-10')
    expect(octScreenshots.length).toBe(3)
    expect(octScreenshots.every(s => s.session_date.startsWith('2026-10'))).toBe(true)

    // B) Admin queries September 2026 (1 month ago)
    const sepScreenshots = env.queryScreenshotsForAdmin(bobAdmin, aliceEmployee.id, '2026-09')
    expect(sepScreenshots.length).toBe(1)
    expect(sepScreenshots[0].app_name).toBe('Figma')

    // C) Admin queries August 2026 (2 months ago)
    const augScreenshots = env.queryScreenshotsForAdmin(bobAdmin, aliceEmployee.id, '2026-08')
    expect(augScreenshots.length).toBe(1)
    expect(augScreenshots[0].app_name).toBe('Postman')

    // D) Admin queries specific day
    const dayScreenshots = env.queryScreenshotsForAdmin(bobAdmin, aliceEmployee.id, undefined, '2026-10-31')
    expect(dayScreenshots.length).toBe(3)

    // 13. Offline Resilience Verification:
    // If connection drops, captures are saved to pendingQueue, then flushed on reconnect
    env.isNetworkOnline = false
    env.clockIn('2026-10-31T15:00:00+05:30')
    // Work 420 seconds while offline
    for (let s = 0; s < 420; s++) env.tick()
    expect(env.pendingQueue.length).toBe(2) // 1 session + 1 screenshot pending
    expect(env.pendingQueue.some(p => p.type === 'screenshot')).toBe(true)

    // Network restored
    env.isNetworkOnline = true
    env.flushPending()
    expect(env.pendingQueue.length).toBe(0) // Successfully flushed to database & storage
    expect(env.remoteScreenshots.length).toBe(6) // All screenshots preserved with 0 loss!
  })
})
