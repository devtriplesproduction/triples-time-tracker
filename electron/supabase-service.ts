import { createClient, SupabaseClient } from '@supabase/supabase-js'
import WebSocket from 'ws'
import { storage } from './storage'
import { activityTracker } from './activity-tracker'
import type { UserProfile, TrackingSession, BreakRecord, ActivityInterval, PendingSyncItem } from '../src/types'

// Provide WebSocket implementation for Node.js / Electron main process
if (typeof (globalThis as any).WebSocket === 'undefined') {
  ;(globalThis as any).WebSocket = WebSocket
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://sfjerymoxnolxblhelho.supabase.co'
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_dJRsn_raWyuOLg2OqvQ3JQ_N6zlzph7'

class SupabaseService {
  private client: SupabaseClient
  private isSyncingQueue: boolean = false

  constructor() {
    this.client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false, // Handled explicitly via storage.getAuthTokens() / safeStorage
        autoRefreshToken: true
      },
      realtime: {
        transport: WebSocket as any
      }
    })

    // Restore saved session if available
    this.initSession()
  }

  public async initSession(): Promise<boolean> {
    try {
      const tokens = storage.getAuthTokens()
      if (tokens && tokens.access_token && tokens.refresh_token) {
        const { data, error } = await this.client.auth.setSession({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token
        })
        if (error || !data.user) {
          console.warn('[SupabaseService] Session restoration failed:', error?.message)
          storage.setAuthTokens(null)
          storage.clearActiveUser()
          return false
        }

        // Check if user is deactivated or banned in Auth metadata
        if (data.user.app_metadata?.deactivated || (data.user as any).banned_until) {
          console.warn('[SupabaseService] User is deactivated or banned in Auth metadata.')
          await this.logout()
          return false
        }

        // Verify active status of the employee from canonical profiles table
        const { data: profile, error: pError } = await this.client
          .from('profiles')
          .select('id, first_name, last_name, employee_id, department, designation, role')
          .eq('id', data.user.id)
          .maybeSingle()

        if (pError || !profile) {
          console.warn('[SupabaseService] Session restoration failed - profile missing or query error:', pError?.message)
          await this.logout()
          return false
        }

        let department = profile.department || 'General'
        let designation = profile.designation || 'Staff'

        if (profile.employee_id) {
          const { data: onboarding } = await this.client
            .from('employee_onboarding')
            .select('employment_status, department, designation')
            .eq('employee_id_number', profile.employee_id)
            .maybeSingle()

          if (onboarding) {
            if (onboarding.employment_status === 'Inactive' || onboarding.employment_status === 'Terminated') {
              console.warn('[SupabaseService] Employee is inactive or terminated in onboarding. Revoking session.')
              await this.logout()
              return false
            }
            if (onboarding.department) department = onboarding.department
            if (onboarding.designation) designation = onboarding.designation
          }
        }

        const userProfile: UserProfile = {
          id: profile.id,
          email: data.user.email || '',
          first_name: profile.first_name || 'Employee',
          last_name: profile.last_name || null,
          employee_id: profile.employee_id || null,
          department,
          designation,
          role: (profile.role as any) || 'Employee',
          is_active: true
        }

        storage.setCurrentUser(userProfile)

        if (data.session) {
          storage.setAuthTokens({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            expires_at: data.session.expires_at
          })
        }

        // Synchronize this employee's active session and today's sessions from DB
        await this.syncEmployeeSessionsFromSupabase(userProfile.id)

        // Inform tracker that user session is active
        activityTracker.onUserLogin(userProfile)

        // Flush this user's pending queue
        this.flushPendingQueue(userProfile.id)

        return true
      }
    } catch (e) {
      console.warn('[SupabaseService] Exception during initSession:', e)
    }
    return false
  }

  public async login(email: string, password: string): Promise<{ success: boolean; user?: UserProfile; error?: string }> {
    try {
      if (!email || !password) {
        return { success: false, error: 'Email and password are required' }
      }

      const { data, error } = await this.client.auth.signInWithPassword({ email, password })
      if (error) {
        return { success: false, error: error.message }
      }

      if (!data.user || !data.session) {
        return { success: false, error: 'Authentication failed: No session established' }
      }

      if (data.user.app_metadata?.deactivated || (data.user as any).banned_until) {
        await this.client.auth.signOut()
        return { success: false, error: 'Your account has been deactivated. Please contact your administrator.' }
      }

      // Fetch canonical profile from ERP profiles table using canonical Supabase user ID (data.user.id)
      const { data: profile, error: pError } = await this.client
        .from('profiles')
        .select('id, first_name, last_name, employee_id, department, designation, role')
        .eq('id', data.user.id)
        .single()

      if (pError || !profile) {
        console.error('[SupabaseService] Profile fetch error for user', data.user.id, pError)
        await this.client.auth.signOut()
        if (pError && pError.code !== 'PGRST116') {
          return { success: false, error: `Database error reading profile: ${pError.message}` }
        }
        return { success: false, error: 'ERP profile not found. Please contact your administrator.' }
      }

      let department = profile.department || 'General'
      let designation = profile.designation || 'Staff'

      if (profile.employee_id) {
        const { data: onboarding } = await this.client
          .from('employee_onboarding')
          .select('employment_status, department, designation')
          .eq('employee_id_number', profile.employee_id)
          .maybeSingle()

        if (onboarding) {
          if (onboarding.employment_status === 'Inactive' || onboarding.employment_status === 'Terminated') {
            await this.client.auth.signOut()
            return { success: false, error: 'Your employment status is inactive or terminated. Contact HR.' }
          }
          if (onboarding.department) department = onboarding.department
          if (onboarding.designation) designation = onboarding.designation
        }
      }

      const userProfile: UserProfile = {
        id: profile.id,
        email: data.user.email || email,
        first_name: profile.first_name || 'Employee',
        last_name: profile.last_name || null,
        employee_id: profile.employee_id || null,
        department,
        designation,
        role: (profile.role as any) || 'Employee',
        is_active: true
      }

      // Save user profile and auth tokens
      storage.setCurrentUser(userProfile)
      storage.setAuthTokens({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at
      })

      // Sync employee's sessions from Supabase strictly for this user
      await this.syncEmployeeSessionsFromSupabase(userProfile.id)

      // Notify tracker engine of user login to set up active employee context
      activityTracker.onUserLogin(userProfile)

      // Flush offline queue strictly for this newly authenticated user
      this.flushPendingQueue(userProfile.id)

      return { success: true, user: userProfile }
    } catch (err: any) {
      console.error('[SupabaseService] Login exception:', err)
      return { success: false, error: err.message || 'Login failed' }
    }
  }

  public async logout(): Promise<{ success: boolean }> {
    // 1. Immediately inform activity tracker to clear active timers and buffers
    activityTracker.onUserLogout()

    // 2. Sign out of Supabase
    try {
      await this.client.auth.signOut()
    } catch (e) {
      console.warn('[SupabaseService] Error during auth signOut:', e)
    }

    // 3. Clear active session tokens and user without wiping their saved records
    storage.setAuthTokens(null)
    storage.clearActiveUser()

    return { success: true }
  }

  /**
   * Queries Supabase for today's sessions strictly owned by employeeId.
   * If the DB contains an active session and local storage has none, restores it.
   */
  public async syncEmployeeSessionsFromSupabase(employeeId: string): Promise<void> {
    try {
      const today = storage.getTodayBusinessDate()
      const { data: dbSessions, error } = await this.client
        .from('time_sessions')
        .select('*, breaks:session_breaks(*)')
        .eq('employee_id', employeeId)
        .eq('session_date', today)
        .order('clock_in', { ascending: true })

      if (error) {
        console.warn(`[SupabaseService] Failed to fetch sessions for employee ${employeeId}:`, error.message)
        return
      }

      if (!dbSessions || dbSessions.length === 0) {
        // No sessions today in database for this employee
        const localSession = storage.getCurrentSession(employeeId)
        // If local has no session or is completed, keep it null
        if (localSession && (localSession.status === 'Completed' || localSession.status === 'completed')) {
          storage.setCurrentSession(null, employeeId)
        }
        return
      }

      const formattedSessions: TrackingSession[] = dbSessions.map((s: any) => ({
        id: s.id,
        employee_id: s.employee_id,
        session_date: s.session_date,
        clock_in: s.clock_in,
        clock_out: s.clock_out,
        status: s.status,
        worked_minutes: s.worked_minutes,
        active_minutes: s.active_minutes,
        suspended_seconds: s.suspended_seconds || 0,
        active_seconds_buffer: 0,
        breaks: Array.isArray(s.breaks) ? s.breaks.map((b: any) => ({
          id: b.id,
          session_id: b.session_id,
          start_time: b.start_time,
          end_time: b.end_time,
          duration_minutes: b.duration_minutes || 0,
          reason: b.reason || 'Break'
        })) : []
      }))

      storage.setTodaySessions(formattedSessions, employeeId)

      // Check if there is an active session in DB
      const activeDbSession = formattedSessions.find(
        s => s.status === 'working' || s.status === 'Working' || s.status === 'on_break' || s.status === 'On Break'
      )

      const localSession = storage.getCurrentSession(employeeId)

      if (activeDbSession) {
        if (!localSession || localSession.id !== activeDbSession.id) {
          // Restore DB active session
          storage.setCurrentSession(activeDbSession, employeeId)
        }
      } else {
        // No active session in DB; ensure local current session is null
        if (localSession && (localSession.status === 'completed' || localSession.status === 'Completed')) {
          storage.setCurrentSession(null, employeeId)
        }
      }
    } catch (e) {
      console.warn('[SupabaseService] Error syncing employee sessions from Supabase:', e)
    }
  }

  public async syncSession(session: TrackingSession): Promise<{ success: boolean; error?: string }> {
    try {
      const user = storage.getCurrentUser()
      if (!user) {
        return { success: false, error: 'User not authenticated' }
      }

      // Strict session ownership verification: Prevent cross-account session sync
      if (session.employee_id !== user.id) {
        console.warn(`[SupabaseService] Session ownership violation: session ${session.id} is owned by ${session.employee_id}, but active user is ${user.id}. Enqueuing to session owner's pending queue.`)
        storage.enqueuePending({
          id: `session-${session.id}`,
          type: 'session',
          employee_id: session.employee_id,
          data: session,
          createdAt: new Date().toISOString(),
          retries: 0
        }, session.employee_id)
        return { success: false, error: 'Session belongs to another employee. Operation rejected.' }
      }

      const { data: { session: authSession } } = await this.client.auth.getSession()
      if (!authSession) {
        // Enqueue to offline queue for this employee
        storage.enqueuePending({
          id: `session-${session.id}`,
          type: 'session',
          employee_id: session.employee_id,
          data: session,
          createdAt: new Date().toISOString(),
          retries: 0
        }, session.employee_id)
        return { success: false, error: 'Offline / unauthenticated. Queued for sync.' }
      }

      const statusToSave = (session.status === 'on_break' || session.status === 'On Break')
        ? 'on_break'
        : (session.status === 'completed' || session.status === 'Completed')
        ? 'completed'
        : 'working'

      // 1. Upsert time_sessions preserving the canonical session.employee_id
      const { error: sessionError } = await this.client
        .from('time_sessions')
        .upsert({
          id: session.id,
          employee_id: session.employee_id,
          session_date: session.session_date,
          clock_in: session.clock_in,
          clock_out: session.clock_out,
          status: statusToSave,
          worked_minutes: session.worked_minutes,
          active_minutes: session.active_minutes,
          suspended_seconds: session.suspended_seconds || 0,
          updated_at: new Date().toISOString()
        })

      if (sessionError) {
        console.warn('[SupabaseService] Session upsert notice:', sessionError.message)
        storage.enqueuePending({
          id: `session-${session.id}`,
          type: 'session',
          employee_id: session.employee_id,
          data: session,
          createdAt: new Date().toISOString(),
          retries: 0
        }, session.employee_id)
        return { success: false, error: sessionError.message }
      }

      // Session sync succeeded, remove from pending queue
      storage.removePending(`session-${session.id}`, session.employee_id)

      // 2. Sync breaks
      if (session.breaks && session.breaks.length > 0) {
        for (const b of session.breaks) {
          const { error: bErr } = await this.client.from('session_breaks').upsert({
            id: b.id,
            session_id: session.id,
            start_time: b.start_time,
            end_time: b.end_time,
            duration_minutes: b.duration_minutes,
            reason: b.reason || 'Break'
          })
          if (bErr) {
            storage.enqueuePending({
              id: `break-${b.id}`,
              type: 'break',
              employee_id: session.employee_id,
              data: b,
              createdAt: new Date().toISOString(),
              retries: 0
            }, session.employee_id)
          } else {
            storage.removePending(`break-${b.id}`, session.employee_id)
          }
        }
      }

      // 3. Sync recent activity intervals
      const recentLogs = storage.getActivityLogs(session.employee_id, session.id).slice(-20)
      if (recentLogs.length > 0) {
        for (const log of recentLogs) {
          const { error: logErr } = await this.client.from('activity_logs').upsert({
            id: log.id,
            session_id: log.session_id,
            employee_id: session.employee_id,
            start_time: log.start_time,
            end_time: log.end_time,
            active_seconds: log.active_seconds,
            app_name: log.app_name || 'Desktop Work',
            window_title: (log.window_title || '').slice(0, 255)
          })
          if (logErr) {
            storage.enqueuePending({
              id: `log-${log.id}`,
              type: 'activity',
              employee_id: session.employee_id,
              data: log,
              createdAt: new Date().toISOString(),
              retries: 0
            }, session.employee_id)
          } else {
            storage.removePending(`log-${log.id}`, session.employee_id)
          }
        }
      }

      storage.setLastSynced(new Date().toISOString(), session.employee_id)
      return { success: true }
    } catch (err: any) {
      console.warn('[SupabaseService] Sync exception:', err.message)
      return { success: false, error: err.message }
    }
  }

  public async flushPendingQueue(employeeId?: string): Promise<void> {
    if (this.isSyncingQueue) return
    this.isSyncingQueue = true
    try {
      const user = storage.getCurrentUser()
      const empId = employeeId || user?.id
      if (!empId) return

      const queue = storage.getPendingQueue(empId)
      if (queue.length === 0) return

      const { data: { session: authSession } } = await this.client.auth.getSession()
      if (!authSession || authSession.user.id !== empId) return

      for (const item of queue) {
        // Enforce ownership: only flush items matching the active authenticated employee
        if (item.employee_id && item.employee_id !== empId) {
          continue
        }

        if (item.retries > 10) {
          storage.removePending(item.id, empId)
          continue
        }

        if (item.type === 'session') {
          const s = item.data as TrackingSession
          if (s.employee_id !== empId) continue

          const { error } = await this.client.from('time_sessions').upsert({
            id: s.id,
            employee_id: empId,
            session_date: s.session_date,
            clock_in: s.clock_in,
            clock_out: s.clock_out,
            status: s.status,
            worked_minutes: s.worked_minutes,
            active_minutes: s.active_minutes,
            suspended_seconds: s.suspended_seconds || 0,
            updated_at: new Date().toISOString()
          })
          if (!error) storage.removePending(item.id, empId)
          else item.retries += 1
        } else if (item.type === 'break') {
          const b = item.data as BreakRecord
          const { error } = await this.client.from('session_breaks').upsert({
            id: b.id,
            session_id: b.session_id,
            start_time: b.start_time,
            end_time: b.end_time,
            duration_minutes: b.duration_minutes,
            reason: b.reason || 'Break'
          })
          if (!error) storage.removePending(item.id, empId)
          else item.retries += 1
        } else if (item.type === 'activity') {
          const l = item.data as ActivityInterval
          if (l.employee_id !== empId) continue

          const { error } = await this.client.from('activity_logs').upsert({
            id: l.id,
            session_id: l.session_id,
            employee_id: empId,
            start_time: l.start_time,
            end_time: l.end_time,
            active_seconds: l.active_seconds,
            app_name: l.app_name,
            window_title: (l.window_title || '').slice(0, 255)
          })
          if (!error) storage.removePending(item.id, empId)
          else item.retries += 1
        }
      }
    } catch (e) {
      console.warn('[SupabaseService] Error flushing queue:', e)
    } finally {
      this.isSyncingQueue = false
    }
  }

  public async syncWithERP(): Promise<{ success: boolean; error?: string }> {
    const user = storage.getCurrentUser()
    if (!user) return { success: true }

    await this.flushPendingQueue(user.id)
    const session = storage.getCurrentSession(user.id)
    if (session) {
      return this.syncSession(session)
    }
    const todaySessions = storage.getTodaySessions(user.id)
    if (todaySessions.length > 0) {
      const lastSession = todaySessions[todaySessions.length - 1]
      return this.syncSession(lastSession)
    }
    return { success: true }
  }
}

export const supabaseService = new SupabaseService()
