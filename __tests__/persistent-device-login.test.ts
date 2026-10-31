import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { UserProfile, TrackingSession } from '../src/types'

// Mock implementation of safeStorage and Supabase authentication lifecycle
describe('Persistent Device Login & Session Restoration', () => {
  let diskStore: Record<string, string>
  let safeStorageEnabled: boolean

  // Simulated safeStorage engine mimicking Windows DPAPI (tied to Windows User Profile)
  const mockSafeStorage = {
    isEncryptionAvailable: () => safeStorageEnabled,
    encryptString: (plainText: string) => {
      if (!safeStorageEnabled) throw new Error('safeStorage not available')
      // Simulate Windows DPAPI encryption with a prefix
      return Buffer.from(`DPAPI_ENCRYPTED:${plainText}`, 'utf-8')
    },
    decryptString: (encryptedBuffer: Buffer) => {
      if (!safeStorageEnabled) throw new Error('safeStorage not available')
      const str = encryptedBuffer.toString('utf-8')
      if (!str.startsWith('DPAPI_ENCRYPTED:')) {
        throw new Error('DPAPI decryption failed: data was encrypted by another Windows user or invalid key')
      }
      return str.replace('DPAPI_ENCRYPTED:', '')
    }
  }

  // Persistent storage simulator
  class PersistentStorageSimulator {
    public data: {
      currentUser: UserProfile | null
      activeEmployeeId: string | null
      encryptedAuthTokens: string | null
      employeeData: Record<string, {
        currentSession: TrackingSession | null
        todaySessions: TrackingSession[]
      }>
    }

    constructor() {
      this.data = {
        currentUser: null,
        activeEmployeeId: null,
        encryptedAuthTokens: null,
        employeeData: {}
      }
    }

    public getAuthTokens(): { access_token: string; refresh_token: string; expires_at?: number } | null {
      if (!this.data.encryptedAuthTokens) return null
      try {
        if (mockSafeStorage.isEncryptionAvailable()) {
          const buffer = Buffer.from(this.data.encryptedAuthTokens, 'base64')
          const decrypted = mockSafeStorage.decryptString(buffer)
          return JSON.parse(decrypted)
        } else {
          const decoded = Buffer.from(this.data.encryptedAuthTokens, 'base64').toString('utf-8')
          return JSON.parse(decoded)
        }
      } catch (e) {
        return null
      }
    }

    public setAuthTokens(tokens: { access_token: string; refresh_token: string; expires_at?: number } | null): void {
      if (!tokens) {
        this.data.encryptedAuthTokens = null
        return
      }
      const json = JSON.stringify(tokens)
      if (mockSafeStorage.isEncryptionAvailable()) {
        const encrypted = mockSafeStorage.encryptString(json)
        this.data.encryptedAuthTokens = encrypted.toString('base64')
      } else {
        this.data.encryptedAuthTokens = Buffer.from(json, 'utf-8').toString('base64')
      }
    }

    public getCurrentUser(): UserProfile | null {
      return this.data.currentUser
    }

    public setCurrentUser(user: UserProfile | null): void {
      this.data.currentUser = user
      this.data.activeEmployeeId = user ? user.id : null
      if (user && !this.data.employeeData[user.id]) {
        this.data.employeeData[user.id] = { currentSession: null, todaySessions: [] }
      }
    }

    public clearActiveUser(): void {
      this.data.currentUser = null
      this.data.activeEmployeeId = null
    }

    public getCurrentSession(empId: string): TrackingSession | null {
      return this.data.employeeData[empId]?.currentSession || null
    }

    public setCurrentSession(session: TrackingSession | null, empId: string): void {
      if (!this.data.employeeData[empId]) {
        this.data.employeeData[empId] = { currentSession: null, todaySessions: [] }
      }
      this.data.employeeData[empId].currentSession = session
    }

    public getTodaySessions(empId: string): TrackingSession[] {
      return this.data.employeeData[empId]?.todaySessions || []
    }

    public setTodaySessions(sessions: TrackingSession[], empId: string): void {
      if (!this.data.employeeData[empId]) {
        this.data.employeeData[empId] = { currentSession: null, todaySessions: [] }
      }
      this.data.employeeData[empId].todaySessions = sessions
    }
  }

  // Supabase service simulator matching electron/supabase-service.ts
  class MockSupabaseService {
    public storage: PersistentStorageSimulator
    public mockDbUsers: Record<string, any>
    public mockDbProfiles: Record<string, any>
    public mockDbSessions: Record<string, any[]>
    public isOffline: boolean = false
    public networkErrorMessage: string = 'fetch failed: ENOTFOUND sfjerymoxnolxblhelho.supabase.co'

    constructor(storage: PersistentStorageSimulator) {
      this.storage = storage
      this.mockDbUsers = {}
      this.mockDbProfiles = {}
      this.mockDbSessions = {}
    }

    private isNetworkError(err: any): boolean {
      if (!err) return false
      const msg = (err.message || err.toString() || '').toLowerCase()
      return msg.includes('fetch failed') || msg.includes('network') || msg.includes('enotfound')
    }

    public async initSession(): Promise<{ success: boolean; user?: UserProfile; error?: string }> {
      try {
        const tokens = this.storage.getAuthTokens()
        if (!tokens || !tokens.access_token || !tokens.refresh_token) {
          return { success: false }
        }

        if (this.isOffline) {
          const cachedUser = this.storage.getCurrentUser()
          if (cachedUser && cachedUser.id) {
            return {
              success: true,
              user: cachedUser,
              error: 'Offline mode: Network unavailable. Tracking will sync when connection is restored.'
            }
          }
          return {
            success: false,
            error: 'Network unavailable. Please connect to the internet to sign in.'
          }
        }

        // Simulate setSession
        if (tokens.refresh_token === 'revoked_token' || tokens.refresh_token === 'invalid_token') {
          this.storage.setAuthTokens(null)
          this.storage.clearActiveUser()
          return {
            success: false,
            error: 'Your session has expired or was revoked. Please log in again.'
          }
        }

        const user = this.mockDbUsers[tokens.access_token]
        if (!user) {
          this.storage.setAuthTokens(null)
          this.storage.clearActiveUser()
          return {
            success: false,
            error: 'Your session has expired. Please log in again.'
          }
        }

        if (user.deactivated) {
          this.storage.setAuthTokens(null)
          this.storage.clearActiveUser()
          return {
            success: false,
            error: 'Your account has been deactivated. Please contact your administrator.'
          }
        }

        const profile = this.mockDbProfiles[user.id]
        if (!profile) {
          this.storage.setAuthTokens(null)
          this.storage.clearActiveUser()
          return {
            success: false,
            error: 'ERP profile not found. Please contact your administrator.'
          }
        }

        const userProfile: UserProfile = {
          id: profile.id,
          email: user.email,
          first_name: profile.first_name,
          last_name: profile.last_name,
          employee_id: profile.employee_id,
          department: profile.department,
          designation: profile.designation,
          role: profile.role || 'Employee',
          is_active: true
        }

        this.storage.setCurrentUser(userProfile)

        // Restore active session for this employee if available
        const sessions = this.mockDbSessions[userProfile.id] || []
        const active = sessions.find(s => !s.clock_out && (s.status === 'working' || s.status === 'on_break'))
        this.storage.setCurrentSession(active || null, userProfile.id)
        this.storage.setTodaySessions(sessions, userProfile.id)

        return { success: true, user: userProfile }
      } catch (e: any) {
        if (this.isNetworkError(e)) {
          const cachedUser = this.storage.getCurrentUser()
          if (cachedUser && cachedUser.id) {
            return {
              success: true,
              user: cachedUser,
              error: 'Offline mode: Network unavailable.'
            }
          }
        }
        return { success: false, error: e?.message || 'Authentication restoration failed' }
      }
    }

    public async login(email: string, pass: string): Promise<{ success: boolean; user?: UserProfile; error?: string }> {
      const user = Object.values(this.mockDbUsers).find((u: any) => u.email === email && u.password === pass)
      if (!user) {
        return { success: false, error: 'Invalid login credentials' }
      }

      if (user.deactivated) {
        return { success: false, error: 'Your account has been deactivated. Please contact your administrator.' }
      }

      const profile = this.mockDbProfiles[user.id]
      if (!profile) {
        return { success: false, error: 'ERP profile not found' }
      }

      const userProfile: UserProfile = {
        id: profile.id,
        email: user.email,
        first_name: profile.first_name,
        last_name: profile.last_name,
        employee_id: profile.employee_id,
        department: profile.department,
        designation: profile.designation,
        role: profile.role || 'Employee',
        is_active: true
      }

      this.storage.setCurrentUser(userProfile)
      this.storage.setAuthTokens({
        access_token: user.token,
        refresh_token: user.refresh_token,
        expires_at: Date.now() + 3600000
      })

      const sessions = this.mockDbSessions[userProfile.id] || []
      const active = sessions.find(s => !s.clock_out && (s.status === 'working' || s.status === 'on_break'))
      this.storage.setCurrentSession(active || null, userProfile.id)
      this.storage.setTodaySessions(sessions, userProfile.id)

      return { success: true, user: userProfile }
    }

    public async logout(): Promise<{ success: boolean }> {
      this.storage.setAuthTokens(null)
      this.storage.clearActiveUser()
      return { success: true }
    }
  }

  let storage: PersistentStorageSimulator
  let service: MockSupabaseService

  beforeEach(() => {
    safeStorageEnabled = true
    storage = new PersistentStorageSimulator()
    service = new MockSupabaseService(storage)

    // Seed mock database
    service.mockDbUsers['token_emp_1'] = {
      id: 'uuid-emp-101',
      email: 'john.doe@triplesproduction.com',
      password: 'SecurePassword123!',
      token: 'token_emp_1',
      refresh_token: 'refresh_emp_1',
      deactivated: false
    }

    service.mockDbProfiles['uuid-emp-101'] = {
      id: 'uuid-emp-101',
      first_name: 'John',
      last_name: 'Doe',
      employee_id: '3S-042',
      department: 'VFX',
      designation: 'Senior Compositor',
      role: 'Employee'
    }

    service.mockDbUsers['token_emp_2'] = {
      id: 'uuid-emp-202',
      email: 'sarah.connor@triplesproduction.com',
      password: 'SecurePassword456!',
      token: 'token_emp_2',
      refresh_token: 'refresh_emp_2',
      deactivated: false
    }

    service.mockDbProfiles['uuid-emp-202'] = {
      id: 'uuid-emp-202',
      first_name: 'Sarah',
      last_name: 'Connor',
      employee_id: '3S-088',
      department: 'Editing',
      designation: 'Lead Colorist',
      role: 'Employee'
    }
  })

  // 1. First Launch Scenario
  it('1. First launch after install shows login screen without crashing or fabricating identity', async () => {
    // Storage has no tokens
    expect(storage.getAuthTokens()).toBeNull()
    expect(storage.getCurrentUser()).toBeNull()

    const result = await service.initSession()
    expect(result.success).toBe(false)
    expect(result.user).toBeUndefined()
    expect(storage.getCurrentUser()).toBeNull()
  })

  // 2. Login and Secure Storage Encryption
  it('2. Login securely encrypts tokens with safeStorage DPAPI and binds to local storage', async () => {
    const loginRes = await service.login('john.doe@triplesproduction.com', 'SecurePassword123!')
    expect(loginRes.success).toBe(true)
    expect(loginRes.user?.first_name).toBe('John')
    expect(loginRes.user?.id).toBe('uuid-emp-101')

    // Verify token is NOT stored in plaintext
    const rawStored = storage.data.encryptedAuthTokens
    expect(rawStored).toBeTruthy()
    // Base64 decoded buffer must contain DPAPI encryption wrapper
    const decodedBuffer = Buffer.from(rawStored!, 'base64').toString('utf-8')
    expect(decodedBuffer).toContain('DPAPI_ENCRYPTED:')
    expect(decodedBuffer).not.toContain('SecurePassword123!')

    // Storage decrypts properly via safeStorage
    const decrypted = storage.getAuthTokens()
    expect(decrypted?.access_token).toBe('token_emp_1')
    expect(decrypted?.refresh_token).toBe('refresh_emp_1')
  })

  // 3. Subsequent Launch with Valid Session
  it('3. Subsequent launch automatically restores the authenticated employee without login prompt', async () => {
    // User logged in previously
    await service.login('john.doe@triplesproduction.com', 'SecurePassword123!')

    // App is closed and reopened (simulate fresh instance with same persistent storage)
    const freshStorage = new PersistentStorageSimulator()
    freshStorage.data = JSON.parse(JSON.stringify(storage.data))
    const freshService = new MockSupabaseService(freshStorage)
    freshService.mockDbUsers = service.mockDbUsers
    freshService.mockDbProfiles = service.mockDbProfiles

    const restoreRes = await freshService.initSession()
    expect(restoreRes.success).toBe(true)
    expect(restoreRes.user).toBeDefined()
    expect(restoreRes.user?.id).toBe('uuid-emp-101')
    expect(restoreRes.user?.first_name).toBe('John')
    expect(freshStorage.getCurrentUser()?.id).toBe('uuid-emp-101')
  })

  // 4. Session State Restoration: Unclocked Employee shows Clock In
  it('4. Restores employee with no ongoing session to unclocked Clock In state', async () => {
    service.mockDbSessions['uuid-emp-101'] = []
    await service.login('john.doe@triplesproduction.com', 'SecurePassword123!')

    const restoreRes = await service.initSession()
    expect(restoreRes.success).toBe(true)
    const currentSession = storage.getCurrentSession('uuid-emp-101')
    expect(currentSession).toBeNull()
  })

  // 5. Session State Restoration: Working Session restored
  it('5. Restores employee with active working session to Working state', async () => {
    const workingSession: TrackingSession = {
      id: 'session-work-1',
      employee_id: 'uuid-emp-101',
      session_date: '2026-10-19',
      clock_in: '2026-10-19T09:00:00+05:30',
      clock_out: null,
      status: 'working',
      worked_minutes: 120,
      active_minutes: 110,
      breaks: []
    }
    service.mockDbSessions['uuid-emp-101'] = [workingSession]

    await service.login('john.doe@triplesproduction.com', 'SecurePassword123!')
    const restoreRes = await service.initSession()
    expect(restoreRes.success).toBe(true)

    const session = storage.getCurrentSession('uuid-emp-101')
    expect(session).toBeTruthy()
    expect(session?.id).toBe('session-work-1')
    expect(session?.status).toBe('working')
    expect(session?.worked_minutes).toBe(120)
  })

  // 6. Session State Restoration: On Break restored
  it('6. Restores employee with active break to On Break state', async () => {
    const breakSession: TrackingSession = {
      id: 'session-break-1',
      employee_id: 'uuid-emp-101',
      session_date: '2026-10-19',
      clock_in: '2026-10-19T09:00:00+05:30',
      clock_out: null,
      status: 'on_break',
      worked_minutes: 90,
      active_minutes: 85,
      breaks: [
        {
          id: 'b-1',
          session_id: 'session-break-1',
          start_time: '2026-10-19T10:30:00+05:30',
          end_time: null,
          duration_minutes: 0,
          reason: 'Tea break'
        }
      ]
    }
    service.mockDbSessions['uuid-emp-101'] = [breakSession]

    await service.login('john.doe@triplesproduction.com', 'SecurePassword123!')
    const restoreRes = await service.initSession()
    expect(restoreRes.success).toBe(true)

    const session = storage.getCurrentSession('uuid-emp-101')
    expect(session).toBeTruthy()
    expect(session?.status).toBe('on_break')
    expect(session?.breaks.some(b => b.end_time === null)).toBe(true)
  })

  // 7. Clocked Out Earlier Today Preserves Daily Totals
  it('7. Employee clocked out earlier shows Clock In while preserving daily totals', async () => {
    const completedSession: TrackingSession = {
      id: 'session-completed-1',
      employee_id: 'uuid-emp-101',
      session_date: '2026-10-19',
      clock_in: '2026-10-19T09:00:00+05:30',
      clock_out: '2026-10-19T13:00:00+05:30',
      status: 'completed',
      worked_minutes: 240,
      active_minutes: 220,
      breaks: []
    }
    service.mockDbSessions['uuid-emp-101'] = [completedSession]

    await service.login('john.doe@triplesproduction.com', 'SecurePassword123!')
    const restoreRes = await service.initSession()
    expect(restoreRes.success).toBe(true)

    // Current session must be null (shows Clock In)
    const currentSession = storage.getCurrentSession('uuid-emp-101')
    expect(currentSession).toBeNull()

    // Today's history contains the completed session
    const todaySessions = storage.getTodaySessions('uuid-emp-101')
    expect(todaySessions.length).toBe(1)
    expect(todaySessions[0].worked_minutes).toBe(240)
    expect(todaySessions[0].active_minutes).toBe(220)
  })

  // 8. Revoked or Expired Session Recovery
  it('8. Revoked or expired session safely clears credentials and returns meaningful error', async () => {
    storage.setAuthTokens({
      access_token: 'token_expired',
      refresh_token: 'revoked_token',
      expires_at: 0
    })
    storage.setCurrentUser(service.mockDbProfiles['uuid-emp-101'])

    const result = await service.initSession()
    expect(result.success).toBe(false)
    expect(result.error).toContain('expired or was revoked')
    expect(storage.getAuthTokens()).toBeNull()
    expect(storage.getCurrentUser()).toBeNull()
  })

  // 9. Deactivated Account Recovery
  it('9. Deactivated employee account revokes session safely with descriptive message', async () => {
    service.mockDbUsers['token_emp_1'].deactivated = true
    storage.setAuthTokens({
      access_token: 'token_emp_1',
      refresh_token: 'refresh_emp_1',
      expires_at: Date.now() + 3600000
    })

    const result = await service.initSession()
    expect(result.success).toBe(false)
    expect(result.error).toContain('deactivated')
    expect(storage.getAuthTokens()).toBeNull()
    expect(storage.getCurrentUser()).toBeNull()
  })

  // 10. Network Offline Startup Handling
  it('10. Network offline during startup restores cached employee profile without logging them out', async () => {
    // Log in while online
    await service.login('john.doe@triplesproduction.com', 'SecurePassword123!')

    // Simulate network offline (Wi-Fi disconnected)
    service.isOffline = true

    const result = await service.initSession()
    expect(result.success).toBe(true)
    expect(result.user?.id).toBe('uuid-emp-101')
    expect(result.user?.first_name).toBe('John')
    expect(result.error).toContain('Offline mode')

    // Stored tokens and active user must remain intact for offline work
    expect(storage.getAuthTokens()).toBeTruthy()
    expect(storage.getCurrentUser()?.id).toBe('uuid-emp-101')
  })

  // 11. Multi-Account and Device Isolation
  it('11. Account isolation: Switching employees prevents data leaking between users', async () => {
    // Employee 1 logs in and has a session
    await service.login('john.doe@triplesproduction.com', 'SecurePassword123!')
    storage.setCurrentSession({
      id: 'session-emp-1',
      employee_id: 'uuid-emp-101',
      session_date: '2026-10-19',
      clock_in: '2026-10-19T09:00:00+05:30',
      clock_out: null,
      status: 'working',
      worked_minutes: 50,
      active_minutes: 45,
      breaks: []
    }, 'uuid-emp-101')

    expect(storage.getCurrentSession('uuid-emp-101')?.id).toBe('session-emp-1')

    // Employee 1 logs out
    await service.logout()
    expect(storage.getCurrentUser()).toBeNull()
    expect(storage.getAuthTokens()).toBeNull()

    // Employee 2 logs in
    await service.login('sarah.connor@triplesproduction.com', 'SecurePassword456!')
    expect(storage.getCurrentUser()?.id).toBe('uuid-emp-202')
    expect(storage.getCurrentUser()?.first_name).toBe('Sarah')

    // Employee 2 does not see Employee 1's active session
    expect(storage.getCurrentSession('uuid-emp-202')).toBeNull()

    // Employee 1's data in their own isolated bucket remains preserved
    expect(storage.getCurrentSession('uuid-emp-101')?.id).toBe('session-emp-1')
  })

  // 12. Windows OS User Isolation via DPAPI
  it('12. DPAPI isolation: encrypted tokens cannot be decrypted by a different Windows user', async () => {
    // User A on Windows logs in
    await service.login('john.doe@triplesproduction.com', 'SecurePassword123!')
    const userA_EncryptedToken = storage.data.encryptedAuthTokens!

    // If another Windows OS profile tries to read it, DPAPI throws
    const otherWindowsUserStorage = new PersistentStorageSimulator()
    otherWindowsUserStorage.data.encryptedAuthTokens = userA_EncryptedToken

    // Simulate different Windows user by altering the DPAPI decryption
    const originalDecrypt = mockSafeStorage.decryptString
    mockSafeStorage.decryptString = () => {
      throw new Error('DPAPI decryption failed: access denied (wrong Windows user)')
    }

    // Attempting to read tokens from another Windows user returns null safely
    expect(otherWindowsUserStorage.getAuthTokens()).toBeNull()

    mockSafeStorage.decryptString = originalDecrypt
  })
})
