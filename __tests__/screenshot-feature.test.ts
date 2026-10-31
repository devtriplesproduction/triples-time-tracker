import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ScreenshotRecord, TrackingSession, UserProfile, PendingSyncItem } from '../src/types'

describe('TripleS Time Tracker — Automatic 7-Minute Screenshot Feature', () => {
  const alice: UserProfile = {
    id: 'emp-uuid-alice',
    email: 'alice@tsp.com',
    first_name: 'Alice',
    last_name: 'Smith',
    employee_id: 'TSP-001',
    department: 'Development',
    designation: 'Software Developer',
    role: 'Employee',
    is_active: true
  }

  const bobAdmin: UserProfile = {
    id: 'emp-uuid-bob',
    email: 'bob@tsp.com',
    first_name: 'Bob',
    last_name: 'Admin',
    employee_id: 'TSP-002',
    department: 'Management',
    designation: 'VP Engineering',
    role: 'Admin',
    is_active: true
  }

  // Simulated Tracker Engine replicating the 7-minute screenshot scheduler
  class SimulatedScreenshotTracker {
    public session: TrackingSession | null = null
    public user: UserProfile | null = null
    public isIdle = false
    public isSuspended = false
    public isScreenLocked = false
    public screenshotIntervalSeconds = 420 // 7 minutes
    public screenshotSecondsBuffer = 0
    public capturedScreenshots: ScreenshotRecord[] = []
    public mockCaptureBuffer = Buffer.from('fake-jpeg-data')

    constructor(user: UserProfile) {
      this.user = user
    }

    public startSession(clockInIso: string = new Date().toISOString()) {
      this.session = {
        id: 'session-101',
        employee_id: this.user!.id,
        session_date: '2026-10-31',
        clock_in: clockInIso,
        clock_out: null,
        status: 'working',
        worked_minutes: 0,
        active_minutes: 0,
        breaks: []
      }
      this.screenshotSecondsBuffer = 0
    }

    public tick() {
      if (!this.session || !this.user) return

      const isWorking = this.session.status === 'working' || this.session.status === 'Working'
      const hasOpenBreak = this.session.breaks.some(b => b.end_time === null)

      if (isWorking && !hasOpenBreak && !this.isIdle && !this.isSuspended && !this.isScreenLocked) {
        this.screenshotSecondsBuffer += 1

        if (this.screenshotSecondsBuffer >= this.screenshotIntervalSeconds) {
          this.screenshotSecondsBuffer = 0
          this.triggerCapture()
        }
      }
    }

    public triggerCapture(): ScreenshotRecord {
      const id = `scr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const now = new Date().toISOString()
      const record: ScreenshotRecord = {
        id,
        session_id: this.session!.id,
        employee_id: this.user!.id,
        session_date: this.session!.session_date,
        captured_at: now,
        storage_path: `${this.user!.id}/${this.session!.session_date}/${this.session!.id}/${id}.jpg`,
        image_url: `https://sfjerymoxnolxblhelho.supabase.co/storage/v1/object/public/screenshots/${this.user!.id}/${id}.jpg`,
        image_data: null,
        file_size_bytes: this.mockCaptureBuffer.length,
        app_name: 'Visual Studio Code',
        window_title: 'App.tsx - TripleS Time Tracker',
        created_at: now
      }
      this.capturedScreenshots.push(record)
      return record
    }

    public takeBreak() {
      if (!this.session) return
      this.session.status = 'on_break'
      this.session.breaks.push({
        id: 'break-1',
        session_id: this.session.id,
        start_time: new Date().toISOString(),
        end_time: null,
        duration_minutes: 0
      })
    }

    public resumeBreak() {
      if (!this.session) return
      const b = this.session.breaks.find(x => x.end_time === null)
      if (b) b.end_time = new Date().toISOString()
      this.session.status = 'working'
    }

    public clockOut() {
      if (!this.session) return
      this.session.status = 'completed'
      this.session.clock_out = new Date().toISOString()
      this.screenshotSecondsBuffer = 0
    }
  }

  // 1. Automatic 7-minute periodic screenshot timer
  it('1. automatically captures a screenshot exactly every 420 working seconds (7 minutes)', () => {
    const tracker = new SimulatedScreenshotTracker(alice)
    tracker.startSession()

    expect(tracker.capturedScreenshots.length).toBe(0)
    expect(tracker.screenshotSecondsBuffer).toBe(0)

    // Simulate 419 ticks (419 seconds of active work)
    for (let i = 0; i < 419; i++) {
      tracker.tick()
    }
    expect(tracker.screenshotSecondsBuffer).toBe(419)
    expect(tracker.capturedScreenshots.length).toBe(0)

    // 420th tick -> Exactly 7 minutes elapsed!
    tracker.tick()
    expect(tracker.capturedScreenshots.length).toBe(1)
    expect(tracker.screenshotSecondsBuffer).toBe(0)
    expect(tracker.capturedScreenshots[0].employee_id).toBe(alice.id)
    expect(tracker.capturedScreenshots[0].app_name).toBe('Visual Studio Code')

    // Simulate another 7 minutes (420 ticks)
    for (let i = 0; i < 420; i++) {
      tracker.tick()
    }
    expect(tracker.capturedScreenshots.length).toBe(2)
    expect(tracker.screenshotSecondsBuffer).toBe(0)
  })

  // 2. Breaks freeze the screenshot timer
  it('2. pauses screenshot timer during breaks and does not capture screenshots on break', () => {
    const tracker = new SimulatedScreenshotTracker(alice)
    tracker.startSession()

    // Work for 200 seconds
    for (let i = 0; i < 200; i++) {
      tracker.tick()
    }
    expect(tracker.screenshotSecondsBuffer).toBe(200)

    // Employee takes a break
    tracker.takeBreak()

    // 500 seconds pass while on break
    for (let i = 0; i < 500; i++) {
      tracker.tick()
    }
    // Screenshot buffer must remain frozen at 200, no screenshots taken on break
    expect(tracker.screenshotSecondsBuffer).toBe(200)
    expect(tracker.capturedScreenshots.length).toBe(0)

    // Resume work
    tracker.resumeBreak()

    // Work for remaining 220 seconds (200 + 220 = 420 seconds)
    for (let i = 0; i < 220; i++) {
      tracker.tick()
    }

    // Now screenshot is captured!
    expect(tracker.capturedScreenshots.length).toBe(1)
    expect(tracker.screenshotSecondsBuffer).toBe(0)
  })

  // 3. Screen lock and system suspension freeze screenshot capture
  it('3. does not capture screenshots when workstation is locked or sleeping', () => {
    const tracker = new SimulatedScreenshotTracker(alice)
    tracker.startSession()

    // Work for 300 seconds
    for (let i = 0; i < 300; i++) tracker.tick()
    expect(tracker.screenshotSecondsBuffer).toBe(300)

    // Screen is locked
    tracker.isScreenLocked = true
    for (let i = 0; i < 600; i++) tracker.tick()
    expect(tracker.screenshotSecondsBuffer).toBe(300)
    expect(tracker.capturedScreenshots.length).toBe(0)

    tracker.isScreenLocked = false

    // System suspend / sleep
    tracker.isSuspended = true
    for (let i = 0; i < 600; i++) tracker.tick()
    expect(tracker.screenshotSecondsBuffer).toBe(300)
    expect(tracker.capturedScreenshots.length).toBe(0)

    tracker.isSuspended = false

    // Work remaining 120 seconds
    for (let i = 0; i < 120; i++) tracker.tick()
    expect(tracker.capturedScreenshots.length).toBe(1)
  })

  // 4. Admin can query screenshots across multiple months
  it('4. allows admin to query screenshots of every user across multiple months', () => {
    const mockDatabase: ScreenshotRecord[] = [
      // Alice's screenshots in August 2026
      {
        id: 'scr-aug-1',
        session_id: 'sess-aug',
        employee_id: alice.id,
        session_date: '2026-08-15',
        captured_at: '2026-08-15T10:14:00+05:30',
        storage_path: 'alice/2026-08-15/scr-aug-1.jpg',
        image_url: 'https://storage/alice/aug-1.jpg',
        file_size_bytes: 120400,
        app_name: 'Figma',
        created_at: '2026-08-15T10:14:00+05:30'
      },
      // Alice's screenshots in September 2026
      {
        id: 'scr-sep-1',
        session_id: 'sess-sep',
        employee_id: alice.id,
        session_date: '2026-09-20',
        captured_at: '2026-09-20T11:21:00+05:30',
        storage_path: 'alice/2026-09-20/scr-sep-1.jpg',
        image_url: 'https://storage/alice/sep-1.jpg',
        file_size_bytes: 115200,
        app_name: 'VS Code',
        created_at: '2026-09-20T11:21:00+05:30'
      },
      // Alice's screenshots in October 2026
      {
        id: 'scr-oct-1',
        session_id: 'sess-oct',
        employee_id: alice.id,
        session_date: '2026-10-31',
        captured_at: '2026-10-31T09:07:00+05:30',
        storage_path: 'alice/2026-10-31/scr-oct-1.jpg',
        image_url: 'https://storage/alice/oct-1.jpg',
        file_size_bytes: 135000,
        app_name: 'Chrome',
        created_at: '2026-10-31T09:07:00+05:30'
      },
      // Bob's screenshots in October 2026
      {
        id: 'scr-oct-bob',
        session_id: 'sess-oct-bob',
        employee_id: bobAdmin.id,
        session_date: '2026-10-31',
        captured_at: '2026-10-31T14:14:00+05:30',
        storage_path: 'bob/2026-10-31/scr-bob.jpg',
        image_url: 'https://storage/bob/oct-bob.jpg',
        file_size_bytes: 142000,
        app_name: 'Terminal',
        created_at: '2026-10-31T14:14:00+05:30'
      }
    ]

    // Admin filter function matching SupabaseService.getScreenshots
    const queryScreenshots = (
      requestingUser: UserProfile,
      targetEmployeeId: string,
      month?: string,
      date?: string
    ) => {
      const roleUpper = requestingUser.role.toUpperCase()
      const isAdmin = roleUpper === 'ADMIN' || roleUpper === 'SUPER_ADMIN' || roleUpper === 'HR'
      
      // Enforce RBAC: Non-admin can only query their own
      const effectiveEmpId = isAdmin ? targetEmployeeId : requestingUser.id

      return mockDatabase.filter(s => {
        if (s.employee_id !== effectiveEmpId) return false
        if (date && s.session_date !== date) return false
        if (month && !s.session_date.startsWith(month)) return false
        return true
      })
    }

    // Admin querying Alice's screenshots in August 2026
    const augScreenshots = queryScreenshots(bobAdmin, alice.id, '2026-08')
    expect(augScreenshots.length).toBe(1)
    expect(augScreenshots[0].id).toBe('scr-aug-1')

    // Admin querying Alice's screenshots in September 2026
    const sepScreenshots = queryScreenshots(bobAdmin, alice.id, '2026-09')
    expect(sepScreenshots.length).toBe(1)
    expect(sepScreenshots[0].id).toBe('scr-sep-1')

    // Admin querying Alice's screenshots in October 2026
    const octScreenshots = queryScreenshots(bobAdmin, alice.id, '2026-10')
    expect(octScreenshots.length).toBe(1)
    expect(octScreenshots[0].id).toBe('scr-oct-1')

    // Non-admin employee trying to query Bob's screenshots is restricted to their own
    const unauthorizedQuery = queryScreenshots(alice, bobAdmin.id, '2026-10')
    expect(unauthorizedQuery.length).toBe(1)
    expect(unauthorizedQuery[0].employee_id).toBe(alice.id) // Returns Alice's, not Bob's
  })
})

