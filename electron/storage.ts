import fs from 'fs'
import path from 'path'
import { app, safeStorage } from 'electron'
import type { TrackingSession, ActivityInterval, UserProfile, AppSettings, PendingSyncItem } from '../src/types'

export interface EmployeeStore {
  currentSession: TrackingSession | null
  todaySessions: TrackingSession[]
  activityLogs: ActivityInterval[]
  pendingSyncQueue: PendingSyncItem[]
  lastSyncedAt: string | null
}

export interface StorageData {
  schemaVersion: number
  currentUser: UserProfile | null
  activeEmployeeId: string | null
  settings: AppSettings
  encryptedAuthTokens: string | null
  employeeData: Record<string, EmployeeStore>
  // Deprecated top-level legacy fields for migration support
  currentSession?: TrackingSession | null
  todaySessions?: TrackingSession[]
  activityLogs?: ActivityInterval[]
  pendingSyncQueue?: PendingSyncItem[]
  lastSyncedAt?: string | null
}

const DEFAULT_SETTINGS: AppSettings = {
  idleThresholdSeconds: 60,
  minimizeToTray: true,
  theme: 'dark',
  apiUrl: 'http://localhost:3000'
}

class TrackerStorage {
  private filePath: string
  private data: StorageData

  constructor(customPath?: string) {
    if (customPath) {
      this.filePath = customPath
    } else {
      let userDataPath = ''
      try {
        userDataPath = app.getPath('userData')
      } catch (e) {
        userDataPath = path.resolve('./.userData')
      }
      this.filePath = path.join(userDataPath, 'tracker-store.json')
    }
    this.data = this.loadData()
  }

  public validateActiveSession(session: TrackingSession | null, expectedEmployeeId?: string): TrackingSession | null {
    if (!session || !session.id) return null

    // 1. Employee ownership check
    if (expectedEmployeeId && session.employee_id !== expectedEmployeeId) {
      console.warn(`[Storage] Session ${session.id} employee mismatch (${session.employee_id} !== ${expectedEmployeeId}). Discarding.`)
      return null
    }

    // 2. Non-terminated check: if already clocked out, it's not active
    if (session.clock_out !== null && session.clock_out !== undefined) {
      return null
    }

    // 3. Completed status check
    if (session.status === 'completed' || session.status === 'Completed') {
      return null
    }

    // 4. Timestamp validity check
    const clockInMs = new Date(session.clock_in).getTime()
    if (isNaN(clockInMs)) {
      console.warn(`[Storage] Session ${session.id} has invalid clock_in timestamp (${session.clock_in}). Discarding.`)
      return null
    }

    // 5. Staleness check: sessions older than 24h cannot be active
    if (Date.now() - clockInMs > 24 * 60 * 60 * 1000) {
      console.log(`[Storage] Session ${session.id} is stale (>24 hours elapsed since clock_in). Marking completed.`)
      session.status = 'completed'
      session.clock_out = new Date(clockInMs + 24 * 60 * 60 * 1000).toISOString()
      return null
    }

    // 6. Break state consistency check
    if (!Array.isArray(session.breaks)) {
      session.breaks = []
    }
    // Filter breaks that belong to this session
    session.breaks = session.breaks.filter(b => !b.session_id || b.session_id === session.id)

    // Check open breaks
    const openBreaks = session.breaks.filter(b => b.end_time === null)
    if (openBreaks.length > 1) {
      // Close older duplicate open breaks
      for (let i = 0; i < openBreaks.length - 1; i++) {
        openBreaks[i].end_time = openBreaks[i].start_time
      }
    }

    const hasOpenBreak = session.breaks.some(b => b.end_time === null)
    if (hasOpenBreak) {
      session.status = 'on_break'
    } else {
      session.status = 'working'
    }

    if (session.suspended_seconds === undefined) session.suspended_seconds = 0
    if (session.active_seconds_buffer === undefined) session.active_seconds_buffer = 0

    return session
  }

  private normalizeSession(session: TrackingSession | null): TrackingSession | null {
    return this.validateActiveSession(session)
  }

  private loadData(): StorageData {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8')
        const parsed = JSON.parse(raw)

        const employeeData: Record<string, EmployeeStore> = parsed.employeeData || {}

        // Migrate per-employee stores from legacy flat storage if present
        if (!parsed.schemaVersion || parsed.schemaVersion < 2) {
          console.log('[Storage] Migrating store to schema version 2 (per-employee isolation)...')

          // Helper to get or create bucket
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

          // 1. Migrate legacy currentSession if owned by an employee
          if (parsed.currentSession && parsed.currentSession.employee_id) {
            const bucket = getBucket(parsed.currentSession.employee_id)
            bucket.currentSession = this.normalizeSession(parsed.currentSession)
          }

          // 2. Migrate legacy todaySessions by employee_id
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

          // 3. Migrate legacy activityLogs by employee_id
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

          // 4. Migrate legacy pendingSyncQueue by item ownership
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

          if (parsed.currentUser?.id && parsed.lastSyncedAt) {
            const bucket = getBucket(parsed.currentUser.id)
            bucket.lastSyncedAt = parsed.lastSyncedAt
          }
        }

        // Normalize and validate sessions inside employeeData
        for (const empId of Object.keys(employeeData)) {
          const store = employeeData[empId]
          if (store.currentSession) {
            const valid = this.validateActiveSession(store.currentSession, empId)
            if (!valid) {
              const prev = store.currentSession
              const idx = store.todaySessions.findIndex(x => x.id === prev.id)
              if (idx !== -1) {
                store.todaySessions[idx] = prev
              } else {
                store.todaySessions.push(prev)
              }
              store.currentSession = null
            } else {
              store.currentSession = valid
            }
          }
        }

        const activeEmployeeId = parsed.currentUser?.id || parsed.activeEmployeeId || null

        const cleanData: StorageData = {
          schemaVersion: 2,
          currentUser: parsed.currentUser || null,
          activeEmployeeId,
          employeeData,
          encryptedAuthTokens: parsed.encryptedAuthTokens || null,
          settings: {
            ...DEFAULT_SETTINGS,
            ...(parsed.settings || {}),
            idleThresholdSeconds: (parsed.settings && typeof parsed.settings.idleThresholdSeconds === 'number' && parsed.settings.idleThresholdSeconds > 0)
              ? parsed.settings.idleThresholdSeconds
              : 60
          }
        }

        return cleanData
      }
    } catch (e) {
      console.error('[Storage] Error loading store, initializing fresh:', e)
    }

    return {
      schemaVersion: 2,
      currentUser: null,
      activeEmployeeId: null,
      employeeData: {},
      encryptedAuthTokens: null,
      settings: DEFAULT_SETTINGS
    }
  }

  private saveDebounceTimer: NodeJS.Timeout | null = null
  private lastSaveTime: number = 0

  /**
   * Immediately flushes any pending debounced writes to disk.
   */
  public flush(): void {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer)
      this.saveDebounceTimer = null
    }
    this.save()
  }

  /**
   * Schedules a debounced save to disk, ensuring routine per-second tick updates
   * do not cause continuous synchronous disk writes on the main thread.
   */
  public saveDebounced(delayMs: number = 10000): void {
    const now = Date.now()
    if (now - this.lastSaveTime >= delayMs) {
      this.flush()
      return
    }
    if (this.saveDebounceTimer) return
    this.saveDebounceTimer = setTimeout(() => {
      this.saveDebounceTimer = null
      this.save()
    }, delayMs)
  }

  private save(): void {
    try {
      this.lastSaveTime = Date.now()
      const dir = path.dirname(this.filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.data), 'utf-8')
    } catch (e) {
      console.error('[Storage] Error saving store:', e)
    }
  }

  public getData(): StorageData {
    return this.data
  }

  public getSettings(): AppSettings {
    return this.data.settings
  }

  public updateSettings(updates: Partial<AppSettings>): AppSettings {
    this.data.settings = { ...this.data.settings, ...updates }
    this.save()
    return this.data.settings
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

  public getAuthTokens(): { access_token: string; refresh_token: string; expires_at?: number } | null {
    if (!this.data.encryptedAuthTokens) return null
    try {
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        const buffer = Buffer.from(this.data.encryptedAuthTokens, 'base64')
        const decrypted = safeStorage.decryptString(buffer)
        return JSON.parse(decrypted)
      } else {
        const decoded = Buffer.from(this.data.encryptedAuthTokens, 'base64').toString('utf-8')
        return JSON.parse(decoded)
      }
    } catch (e) {
      console.warn('[Storage] Failed to decrypt auth tokens:', e)
      return null
    }
  }

  public setAuthTokens(tokens: { access_token: string; refresh_token: string; expires_at?: number } | null): void {
    if (!tokens) {
      this.data.encryptedAuthTokens = null
      this.save()
      return
    }
    try {
      const jsonStr = JSON.stringify(tokens)
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(jsonStr)
        this.data.encryptedAuthTokens = encrypted.toString('base64')
      } else {
        this.data.encryptedAuthTokens = Buffer.from(jsonStr, 'utf-8').toString('base64')
      }
      this.save()
    } catch (e) {
      console.error('[Storage] Error storing auth tokens:', e)
    }
  }

  /**
   * Returns current active session strictly scoped to the employee.
   * If employeeId is omitted, uses the currently authenticated user's ID.
   * Returns null if no user is authenticated or session belongs to someone else.
   */
  public getCurrentSession(employeeId?: string): TrackingSession | null {
    const empId = employeeId || this.data.currentUser?.id || this.data.activeEmployeeId
    if (!empId) return null

    const store = this.data.employeeData[empId]
    if (!store || !store.currentSession) return null

    // Enforce strict ownership and active validity verification
    const validated = this.validateActiveSession(store.currentSession, empId)
    if (!validated) {
      if (store.currentSession) {
        const s = store.currentSession
        const idx = store.todaySessions.findIndex(x => x.id === s.id)
        if (idx !== -1) {
          store.todaySessions[idx] = s
        } else {
          store.todaySessions.push(s)
        }
        store.currentSession = null
        this.save()
      }
      return null
    }

    store.currentSession = validated
    return validated
  }

  /**
   * Persists the active session for an explicit employee.
   * If session is terminated or completed, it is recorded in todaySessions but cleared from currentSession.
   */
  public setCurrentSession(session: TrackingSession | null, employeeId?: string): void {
    const empId = session?.employee_id || employeeId || this.data.currentUser?.id || this.data.activeEmployeeId
    if (!empId) {
      if (session) {
        console.error('[Storage] Cannot set current session: missing employee ID.')
      }
      return
    }

    const store = this.getEmployeeData(empId)

    if (session) {
      session.employee_id = empId
      const validated = this.validateActiveSession(session, empId)

      // Always update history in todaySessions
      const idx = store.todaySessions.findIndex(s => s.id === session.id)
      if (idx !== -1) {
        store.todaySessions[idx] = session
      } else {
        store.todaySessions.push(session)
      }

      // Only assign currentSession if the session is genuinely active
      store.currentSession = validated
      this.save()
    } else {
      store.currentSession = null
      this.save()
    }
  }

  /**
   * Updates fields on the specified employee's current session.
   * Routine tick updates (worked/active seconds) use debounced save;
   * State transitions or minute rollovers can pass immediate=true.
   */
  public updateCurrentSession(updates: Partial<TrackingSession>, employeeId?: string, immediate: boolean = false): TrackingSession | null {
    const empId = employeeId || this.data.currentUser?.id || this.data.activeEmployeeId
    if (!empId || !this.data.employeeData[empId]) return null

    const store = this.data.employeeData[empId]
    if (!store.currentSession) return null

    store.currentSession = { ...store.currentSession, ...updates }
    const idx = store.todaySessions.findIndex(s => s.id === store.currentSession!.id)
    if (idx !== -1) {
      store.todaySessions[idx] = store.currentSession
    }

    if (immediate) {
      this.flush()
    } else {
      this.saveDebounced(10000)
    }
    return store.currentSession
  }

  public addActivityInterval(interval: ActivityInterval): void {
    const empId = interval.employee_id || this.data.currentUser?.id
    if (!empId) return

    interval.employee_id = empId
    const store = this.getEmployeeData(empId)
    store.activityLogs.push(interval)

    // Keep max 500 in local disk buffer per employee
    if (store.activityLogs.length > 500) {
      store.activityLogs = store.activityLogs.slice(-300)
    }
    this.save()
  }

  public getActivityLogs(employeeId?: string, sessionId?: string): ActivityInterval[] {
    const empId = employeeId || this.data.currentUser?.id || this.data.activeEmployeeId
    if (!empId || !this.data.employeeData[empId]) return []

    const logs = this.data.employeeData[empId].activityLogs
    if (!sessionId) return logs
    return logs.filter(a => a.session_id === sessionId)
  }

  public getPendingQueue(employeeId?: string): PendingSyncItem[] {
    const empId = employeeId || this.data.currentUser?.id || this.data.activeEmployeeId
    if (!empId || !this.data.employeeData[empId]) return []
    return this.data.employeeData[empId].pendingSyncQueue || []
  }

  public enqueuePending(item: PendingSyncItem, employeeId?: string): void {
    const empId = item.employee_id || employeeId || this.data.currentUser?.id || this.data.activeEmployeeId
    if (!empId) return

    item.employee_id = empId
    const store = this.getEmployeeData(empId)
    const exists = store.pendingSyncQueue.find(p => p.id === item.id)
    if (!exists) {
      store.pendingSyncQueue.push(item)
      if (store.pendingSyncQueue.length > 500) {
        store.pendingSyncQueue = store.pendingSyncQueue.slice(-500)
      }
      this.save()
    }
  }

  public removePending(id: string, employeeId?: string): void {
    if (employeeId && this.data.employeeData[employeeId]) {
      const prevLen = this.data.employeeData[employeeId].pendingSyncQueue.length
      this.data.employeeData[employeeId].pendingSyncQueue = this.data.employeeData[employeeId].pendingSyncQueue.filter(p => p.id !== id)
      if (this.data.employeeData[employeeId].pendingSyncQueue.length !== prevLen) {
        this.save()
      }
      return
    }

    // If employeeId is not specified, remove matching item from all employee queues
    let changed = false
    for (const empKey of Object.keys(this.data.employeeData)) {
      const store = this.data.employeeData[empKey]
      if (store && store.pendingSyncQueue) {
        const prev = store.pendingSyncQueue.length
        store.pendingSyncQueue = store.pendingSyncQueue.filter(p => p.id !== id)
        if (store.pendingSyncQueue.length !== prev) changed = true
      }
    }
    if (changed) {
      this.save()
    }
  }

  public getTodayBusinessDate(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date())
  }

  /**
   * Returns today's sessions strictly belonging to the specified employee.
   * Supports targetDate parameter and includes sessions overlapping the date boundary.
   */
  public getTodaySessions(employeeId?: string, targetDate?: string): TrackingSession[] {
    const empId = employeeId || this.data.currentUser?.id || this.data.activeEmployeeId
    if (!empId || !this.data.employeeData[empId]) return []

    const target = targetDate || this.getTodayBusinessDate()
    const targetStartMs = new Date(`${target}T00:00:00+05:30`).getTime()
    const targetEndMs = targetStartMs + 24 * 60 * 60 * 1000

    return this.data.employeeData[empId].todaySessions.filter(s => {
      if (s.employee_id !== empId) return false
      if (s.session_date === target) return true
      const clockInMs = new Date(s.clock_in).getTime()
      const endMs = s.clock_out ? new Date(s.clock_out).getTime() : Date.now()
      return clockInMs < targetEndMs && endMs > targetStartMs
    })
  }

  public getAllSessions(employeeId?: string): TrackingSession[] {
    const empId = employeeId || this.data.currentUser?.id || this.data.activeEmployeeId
    if (!empId || !this.data.employeeData[empId]) return []
    return this.data.employeeData[empId].todaySessions.filter(s => s.employee_id === empId)
  }

  public setTodaySessions(sessions: TrackingSession[], employeeId?: string): void {
    const empId = employeeId || this.data.currentUser?.id || this.data.activeEmployeeId
    if (!empId) return
    const store = this.getEmployeeData(empId)
    store.todaySessions = sessions.filter(s => s.employee_id === empId)
    this.save()
  }

  public getLastSynced(employeeId?: string): string | null {
    const empId = employeeId || this.data.currentUser?.id || this.data.activeEmployeeId
    if (!empId || !this.data.employeeData[empId]) return null
    return this.data.employeeData[empId].lastSyncedAt || null
  }

  public setLastSynced(time: string, employeeId?: string): void {
    const empId = employeeId || this.data.currentUser?.id || this.data.activeEmployeeId
    if (!empId) return
    const store = this.getEmployeeData(empId)
    store.lastSyncedAt = time
    this.save()
  }

  public saveStore(): void {
    this.flush()
  }
}

export const storage = new TrackerStorage()
