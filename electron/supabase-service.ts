import { createClient, SupabaseClient } from '@supabase/supabase-js'
import WebSocket from 'ws'
import fs from 'fs'
import { storage } from './storage'
import { activityTracker } from './activity-tracker'
import type { UserProfile, TrackingSession, BreakRecord, ActivityInterval, PendingSyncItem, ScreenshotRecord } from '../src/types'

// Provide WebSocket implementation for Node.js / Electron main process
if (typeof (globalThis as any).WebSocket === 'undefined') {
  ;(globalThis as any).WebSocket = WebSocket
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://sfjerymoxnolxblhelho.supabase.co'
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_dJRsn_raWyuOLg2OqvQ3JQ_N6zlzph7'

class SupabaseService {
  private client: SupabaseClient
  private isSyncingQueue: boolean = false
  private isSyncingERP: boolean = false

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

    // Listen for auth state changes (e.g. background token refresh) and persist to safeStorage
    this.client.auth.onAuthStateChange((event, session) => {
      if (session) {
        storage.setAuthTokens({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_at: session.expires_at
        })
      } else if (event === 'SIGNED_OUT') {
        storage.setAuthTokens(null)
      }
    })
  }

  private isNetworkError(error: any): boolean {
    if (!error) return false
    const msg = (error.message || error.toString() || '').toLowerCase()
    return (
      msg.includes('fetch failed') ||
      msg.includes('network') ||
      msg.includes('enotfound') ||
      msg.includes('econnrefused') ||
      msg.includes('ehostunreach') ||
      msg.includes('timed out') ||
      msg.includes('timeout') ||
      msg.includes('failed to fetch') ||
      msg.includes('abort')
    )
  }

  public async initSession(): Promise<{ success: boolean; user?: UserProfile; error?: string }> {
    try {
      const tokens = storage.getAuthTokens()
      if (!tokens || !tokens.access_token || !tokens.refresh_token) {
        return { success: false }
      }

      const { data, error } = await this.client.auth.setSession({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token
      })

      if (error) {
        if (this.isNetworkError(error)) {
          const cachedUser = storage.getCurrentUser()
          if (cachedUser && cachedUser.id) {
            console.log('[SupabaseService] Network unavailable during startup. Restoring cached user:', cachedUser.email)
            activityTracker.onUserLogin(cachedUser)
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

        console.warn('[SupabaseService] Session restoration failed (revoked or expired):', error.message)
        storage.setAuthTokens(null)
        storage.clearActiveUser()
        activityTracker.onUserLogout()
        try {
          await this.client.auth.signOut()
        } catch (_) {}
        return {
          success: false,
          error: 'Your session has expired or was revoked. Please log in again.'
        }
      }

      if (!data.user) {
        storage.setAuthTokens(null)
        storage.clearActiveUser()
        activityTracker.onUserLogout()
        return {
          success: false,
          error: 'Your session has expired. Please log in again.'
        }
      }

      // Check if user is deactivated or banned in Auth metadata
      if (data.user.app_metadata?.deactivated || (data.user as any).banned_until) {
        console.warn('[SupabaseService] User is deactivated or banned in Auth metadata.')
        await this.logout()
        return {
          success: false,
          error: 'Your account has been deactivated. Please contact your administrator.'
        }
      }

      // Verify active status of the employee from canonical profiles table
      const { data: profile, error: pError } = await this.client
        .from('profiles')
        .select('id, first_name, last_name, employee_id, department, designation, role')
        .eq('id', data.user.id)
        .maybeSingle()

      if (pError) {
        if (this.isNetworkError(pError)) {
          const cachedUser = storage.getCurrentUser()
          if (cachedUser && cachedUser.id === data.user.id) {
            activityTracker.onUserLogin(cachedUser)
            return {
              success: true,
              user: cachedUser,
              error: 'Offline mode: Using cached profile.'
            }
          }
        }
        console.warn('[SupabaseService] Session restoration failed - profile query error:', pError.message)
        await this.logout()
        return {
          success: false,
          error: 'Database error reading profile. Please log in again.'
        }
      }

      if (!profile) {
        console.warn('[SupabaseService] Session restoration failed - profile missing for user:', data.user.id)
        await this.logout()
        return {
          success: false,
          error: 'ERP profile not found. Please contact your administrator.'
        }
      }

      let department = profile.department || null
      let designation = profile.designation || null

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
            return {
              success: false,
              error: 'Your employment status is inactive or terminated. Contact HR.'
            }
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

      return { success: true, user: userProfile }
    } catch (e: any) {
      console.warn('[SupabaseService] Exception during initSession:', e)
      if (this.isNetworkError(e)) {
        const cachedUser = storage.getCurrentUser()
        if (cachedUser && cachedUser.id) {
          activityTracker.onUserLogin(cachedUser)
          return {
            success: true,
            user: cachedUser,
            error: 'Offline mode: Network unavailable. Tracking will sync when connection is restored.'
          }
        }
      }
      return { success: false, error: e?.message || 'Authentication restoration failed' }
    }
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

      let department = profile.department || null
      let designation = profile.designation || null

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
    // 1. Clear active user and auth tokens from storage first so that any emitted state belongs to null user
    storage.setAuthTokens(null)
    storage.clearActiveUser()

    // 2. Inform activity tracker to reset in-memory buffers and emit clean 'Not Clocked In' state
    activityTracker.onUserLogout()

    // 3. Sign out of Supabase
    try {
      await this.client.auth.signOut()
    } catch (e) {
      console.warn('[SupabaseService] Error during auth signOut:', e)
    }

    return { success: true }
  }

  /**
   * Queries Supabase for today's sessions strictly owned by employeeId.
   * If the DB contains an active session and local storage has none, restores it.
   * If DB has no active session and no pending offline session creation, ensures currentSession is null.
   */
   public async syncEmployeeSessionsFromSupabase(employeeId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const today = storage.getTodayBusinessDate()
      // Query today's sessions or any open session for this employee (handling timezone or midnight boundary)
      const { data: dbSessions, error } = await this.client
        .from('time_sessions')
        .select('*, breaks:session_breaks(*)')
        .eq('employee_id', employeeId)
        .or(`session_date.eq.${today},clock_out.is.null`)
        .order('clock_in', { ascending: true })

      if (error) {
        console.warn(`[SupabaseService] Failed to fetch sessions for employee ${employeeId}:`, error.message)
        return { success: false, error: error.message }
      }

      // Check current local session
      const localSession = storage.getCurrentSession(employeeId)
      const isLocalActive = Boolean(
        localSession &&
        localSession.employee_id === employeeId &&
        !localSession.clock_out &&
        localSession.status !== 'completed' &&
        localSession.status !== 'Completed'
      )

      // Check if there are any locally queued offline session creations
      const pendingQueue = storage.getPendingQueue(employeeId)
      const hasPendingSessionCreation = pendingQueue.some(
        p => p.type === 'session' && (!p.data?.clock_out)
      )

      if (!dbSessions || dbSessions.length === 0) {
        // No sessions found in DB for this employee
        if (isLocalActive && localSession) {
          // Do NOT clear an active local session if DB lookup returns empty or is lagging!
          // Enqueue for sync if not already pending
          if (!hasPendingSessionCreation) {
            storage.enqueuePending({
              id: `session-${localSession.id}`,
              type: 'session',
              employee_id: employeeId,
              data: localSession,
              createdAt: new Date().toISOString(),
              retries: 0
            }, employeeId)
          }
        } else if (!hasPendingSessionCreation) {
          storage.setCurrentSession(null, employeeId)
          storage.setTodaySessions([], employeeId)
        }
        return { success: true }
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

      // If local session is active, ensure it is preserved in todaySessions list
      if (isLocalActive && localSession && !formattedSessions.some(s => s.id === localSession.id)) {
        formattedSessions.push(localSession)
      }

      storage.setTodaySessions(formattedSessions, employeeId)

      // Find an active session in DB (clock_out is null and status is working or on_break)
      const activeDbSession = formattedSessions.find(
        s => !s.clock_out && (s.status === 'working' || s.status === 'Working' || s.status === 'on_break' || s.status === 'On Break')
      )

      if (activeDbSession) {
        const validated = storage.validateActiveSession(activeDbSession, employeeId)
        if (validated) {
          // If local has newer worked_minutes or active buffers, preserve them
          if (isLocalActive && localSession && localSession.id === validated.id) {
            validated.worked_minutes = Math.max(validated.worked_minutes, localSession.worked_minutes)
            validated.active_minutes = Math.max(validated.active_minutes, localSession.active_minutes)
            validated.active_seconds_buffer = localSession.active_seconds_buffer || 0
            validated.suspended_seconds = Math.max(validated.suspended_seconds || 0, localSession.suspended_seconds || 0)
          }
          storage.setCurrentSession(validated, employeeId)
        } else {
          storage.setCurrentSession(null, employeeId)
        }
      } else {
        // No active session in DB.
        // Check if DB explicitly has localSession marked completed or clocked out
        const explicitlyEndedInDb = isLocalActive && formattedSessions.some(
          s => s.id === localSession!.id && (s.clock_out !== null || s.status === 'completed' || s.status === 'Completed')
        )

        if (explicitlyEndedInDb) {
          storage.setCurrentSession(null, employeeId)
        } else if (!isLocalActive && !hasPendingSessionCreation) {
          storage.setCurrentSession(null, employeeId)
        }
        // If isLocalActive and not explicitly ended in DB, PRESERVE localSession!
      }

      return { success: true }
    } catch (e: any) {
      console.warn('[SupabaseService] Error syncing employee sessions from Supabase:', e)
      return { success: false, error: e?.message || 'Error querying sessions' }
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

      // 2. Sync breaks in batch
      if (session.breaks && session.breaks.length > 0) {
        const breakPayload = session.breaks.map(b => ({
          id: b.id,
          session_id: session.id,
          start_time: b.start_time,
          end_time: b.end_time,
          duration_minutes: b.duration_minutes,
          reason: b.reason || 'Break'
        }))
        const { error: bErr } = await this.client.from('session_breaks').upsert(breakPayload)
        if (!bErr) {
          for (const b of session.breaks) {
            storage.removePending(`break-${b.id}`, session.employee_id)
          }
        } else {
          for (const b of session.breaks) {
            storage.enqueuePending({
              id: `break-${b.id}`,
              type: 'break',
              employee_id: session.employee_id,
              data: b,
              createdAt: new Date().toISOString(),
              retries: 0
            }, session.employee_id)
          }
        }
      }

      // 3. Sync recent activity intervals in batch
      const recentLogs = storage.getActivityLogs(session.employee_id, session.id).slice(-20)
      if (recentLogs.length > 0) {
        const logPayload = recentLogs.map(log => ({
          id: log.id,
          session_id: log.session_id,
          employee_id: session.employee_id,
          start_time: log.start_time,
          end_time: log.end_time,
          active_seconds: log.active_seconds,
          app_name: log.app_name || 'Desktop Work',
          window_title: (log.window_title || '').slice(0, 255)
        }))
        const { error: logErr } = await this.client.from('activity_logs').upsert(logPayload)
        if (!logErr) {
          for (const log of recentLogs) {
            storage.removePending(`log-${log.id}`, session.employee_id)
          }
        } else {
          for (const log of recentLogs) {
            storage.enqueuePending({
              id: `log-${log.id}`,
              type: 'activity',
              employee_id: session.employee_id,
              data: log,
              createdAt: new Date().toISOString(),
              retries: 0
            }, session.employee_id)
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
        } else if (item.type === 'screenshot') {
          const { record, offlineFilePath } = item.data as { record: ScreenshotRecord; offlineFilePath?: string }
          if (record.employee_id !== empId) continue

          let buffer: Buffer | null = null
          if (offlineFilePath && fs.existsSync(offlineFilePath)) {
            try {
              buffer = fs.readFileSync(offlineFilePath)
            } catch (_) {}
          }

          if (buffer) {
            const uploadRes = await this.uploadScreenshot(record, buffer)
            if (uploadRes.success) {
              storage.removePending(item.id, empId)
              try {
                if (offlineFilePath && fs.existsSync(offlineFilePath)) {
                  fs.unlinkSync(offlineFilePath)
                }
              } catch (_) {}
            } else {
              item.retries += 1
            }
          } else {
            const { error } = await this.client.from('session_screenshots').upsert({
              id: record.id,
              session_id: record.session_id,
              employee_id: empId,
              session_date: record.session_date,
              captured_at: record.captured_at,
              storage_path: record.storage_path,
              image_url: record.image_url,
              image_data: record.image_data,
              file_size_bytes: record.file_size_bytes,
              app_name: record.app_name,
              window_title: record.window_title,
              created_at: record.created_at
            })
            if (!error) storage.removePending(item.id, empId)
            else item.retries += 1
          }
        }
      }
    } catch (e) {
      console.warn('[SupabaseService] Error flushing queue:', e)
    } finally {
      this.isSyncingQueue = false
    }
  }

  /**
   * Uploads screenshot buffer to Supabase Storage and records metadata in public.session_screenshots.
   * If Storage bucket is unavailable or fails, gracefully falls back to base64 image_data.
   */
  public async uploadScreenshot(
    record: ScreenshotRecord,
    buffer: Buffer
  ): Promise<{ success: boolean; record?: ScreenshotRecord; error?: string }> {
    try {
      // 1. Upload to Supabase Storage bucket 'screenshots'
      const { error: storageError } = await this.client.storage
        .from('screenshots')
        .upload(record.storage_path, buffer, {
          contentType: 'image/jpeg',
          upsert: true
        })

      if (storageError) {
        console.warn('[SupabaseService] Storage bucket upload failed, using fallback base64 image_data:', storageError.message)
        record.image_data = `data:image/jpeg;base64,${buffer.toString('base64')}`
      } else {
        const { data: urlData } = this.client.storage
          .from('screenshots')
          .getPublicUrl(record.storage_path)
        record.image_url = urlData.publicUrl
      }

      // 2. Insert or upsert record into session_screenshots table
      const { data, error: dbError } = await this.client
        .from('session_screenshots')
        .upsert({
          id: record.id,
          session_id: record.session_id,
          employee_id: record.employee_id,
          session_date: record.session_date,
          captured_at: record.captured_at,
          storage_path: record.storage_path,
          image_url: record.image_url,
          image_data: record.image_data || null,
          file_size_bytes: record.file_size_bytes,
          app_name: record.app_name,
          window_title: record.window_title,
          created_at: record.created_at
        })
        .select()
        .single()

      if (dbError) {
        console.error('[SupabaseService] Error saving screenshot record to database:', dbError.message)
        return { success: false, error: dbError.message }
      }

      return { success: true, record: (data as ScreenshotRecord) || record }
    } catch (err: any) {
      console.error('[SupabaseService] Unexpected error uploading screenshot:', err)
      return { success: false, error: err.message || 'Failed to upload screenshot' }
    }
  }

  /**
   * Fetches all registered employees for Admin and HR inspection.
   */
  public async getAllEmployeesForAdmin(): Promise<{ success: boolean; employees: UserProfile[]; error?: string }> {
    try {
      const { data, error } = await this.client
        .from('profiles')
        .select('id, email, first_name, last_name, employee_id, department, designation, role, avatar_url, is_active')
        .order('first_name', { ascending: true })

      if (error) {
        return { success: false, employees: [], error: error.message }
      }

      const employees: UserProfile[] = (data || []).map((p: any) => ({
        id: p.id,
        email: p.email || '',
        first_name: p.first_name || '',
        last_name: p.last_name || null,
        employee_id: p.employee_id || null,
        department: p.department || null,
        designation: p.designation || null,
        role: p.role || 'Employee',
        avatar_url: p.avatar_url || null,
        is_active: p.is_active ?? true
      }))

      return { success: true, employees }
    } catch (err: any) {
      return { success: false, employees: [], error: err.message || 'Failed to fetch employees' }
    }
  }

  /**
   * Queries screenshots for a specific employee across days or full months.
   */
  public async getScreenshots(params: {
    employeeId: string
    sessionDate?: string
    month?: string
  }): Promise<{ success: boolean; screenshots?: ScreenshotRecord[]; error?: string }> {
    try {
      let query = this.client
        .from('session_screenshots')
        .select('*')
        .eq('employee_id', params.employeeId)
        .order('captured_at', { ascending: true })

      if (params.sessionDate) {
        query = query.eq('session_date', params.sessionDate)
      } else if (params.month) {
        query = query.gte('session_date', `${params.month}-01`).lte('session_date', `${params.month}-31`)
      }

      const { data, error } = await query

      if (error) {
        return { success: false, error: error.message }
      }

      return { success: true, screenshots: (data as ScreenshotRecord[]) || [] }
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to query screenshots' }
    }
  }

  /**
   * Deletes a screenshot record from both database and Supabase storage.
   */
  public async deleteScreenshot(id: string, storagePath?: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (storagePath) {
        await this.client.storage.from('screenshots').remove([storagePath])
      } else {
        const { data } = await this.client
          .from('session_screenshots')
          .select('storage_path')
          .eq('id', id)
          .maybeSingle()
        if (data?.storage_path) {
          await this.client.storage.from('screenshots').remove([data.storage_path])
        }
      }

      const { error } = await this.client
        .from('session_screenshots')
        .delete()
        .eq('id', id)

      if (error) {
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to delete screenshot' }
    }
  }

  public async syncWithERP(): Promise<{ success: boolean; error?: string }> {
    if (this.isSyncingERP) return { success: true }
    this.isSyncingERP = true
    try {
      const user = storage.getCurrentUser()
      if (!user) return { success: true }

      await this.flushPendingQueue(user.id)
      const session = storage.getCurrentSession(user.id)
      if (session) {
        return await this.syncSession(session)
      }
      const todaySessions = storage.getTodaySessions(user.id)
      if (todaySessions.length > 0) {
        const lastSession = todaySessions[todaySessions.length - 1]
        return await this.syncSession(lastSession)
      }
      return { success: true }
    } finally {
      this.isSyncingERP = false
    }
  }
}

export const supabaseService = new SupabaseService()
