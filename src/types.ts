export type TrackingStatus = 'Not Clocked In' | 'Working' | 'On Break' | 'Completed' | 'working' | 'on_break' | 'completed'

export interface BreakRecord {
  id: string
  session_id: string
  start_time: string
  end_time: string | null
  duration_minutes: number
  reason?: string
}

export interface ActivityInterval {
  id: string
  session_id: string
  employee_id: string
  start_time: string
  end_time: string
  active_seconds: number
  app_name: string
  window_title: string
}

export interface TrackingSession {
  id: string
  employee_id: string
  session_date: string // YYYY-MM-DD in Asia/Kolkata
  clock_in: string
  clock_out: string | null
  status: TrackingStatus
  worked_minutes: number
  active_minutes: number
  suspended_seconds?: number
  active_seconds_buffer?: number
  screenshot_seconds_buffer?: number
  last_heartbeat?: string
  breaks: BreakRecord[]
}

export interface UserProfile {
  id: string
  email: string
  first_name: string
  last_name: string | null
  employee_id: string | null
  department: string | null
  designation: string | null
  role: 'Admin' | 'HR' | 'Employee' | 'Manager'
  avatar_url?: string | null
  is_active?: boolean
}

export interface ScreenshotRecord {
  id: string
  session_id: string
  employee_id: string
  session_date: string // YYYY-MM-DD
  captured_at: string
  storage_path: string
  image_url: string | null
  image_data?: string | null
  file_size_bytes: number
  app_name?: string
  window_title?: string
  created_at: string
}

export interface PendingSyncItem {
  id: string
  type: 'session' | 'break' | 'activity' | 'screenshot' | 'leave' | 'bug' | 'reset_audit'
  employee_id?: string
  data: any
  createdAt: string
  retries: number
}

export type TimeResetType = 'automatic_daily_reset' | 'restart_session' | 'discard_session'

export interface TimeResetAuditRecord {
  id: string
  session_id: string
  employee_id: string
  employee_email: string
  employee_name?: string
  reset_type: TimeResetType
  previous_clock_in: string
  previous_worked_minutes: number
  previous_worked_seconds: number
  previous_active_minutes: number
  previous_active_seconds: number
  previous_status: TrackingStatus
  reason: string
  notes?: string
  reset_by: string
  reset_by_role?: string
  created_at: string
}

export interface ResetTimeParams {
  resetType: TimeResetType
  reason: string
  notes?: string
  confirmationText?: string
}

export interface TrackingState {
  status: TrackingStatus
  currentSession: TrackingSession | null
  todayWorkedMinutes: number
  todayActiveMinutes: number
  todayWorkedSeconds?: number
  todayActiveSeconds?: number
  todaySessions?: TrackingSession[]
  activeAppName: string
  isIdle: boolean
  idleSeconds: number
  lastActivityTime: string
  isOnline: boolean
  lastSyncedAt: string | null
  pendingSyncCount?: number
  syncError?: string | null
  serverTimestamp?: number
  sessionClockInMs?: number | null
  totalBreakMs?: number
  suspendedMs?: number
  isTrackingActive?: boolean
}

export interface AppSettings {
  idleThresholdSeconds: number
  minimizeToTray: boolean
  theme: 'dark' | 'light'
  apiUrl: string
  timezone?: string
  launchOnStartup?: boolean
}

export interface ElectronAPI {
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void
  getTrackingState: () => Promise<TrackingState>
  getTodaySessions?: () => Promise<TrackingSession[]>
  clockIn: () => Promise<{ success: boolean; session?: TrackingSession; error?: string }>
  takeBreak: (reason?: string) => Promise<{ success: boolean; session?: TrackingSession; error?: string }>
  resumeBreak: () => Promise<{ success: boolean; session?: TrackingSession; error?: string }>
  clockOut: () => Promise<{ success: boolean; session?: TrackingSession; error?: string }>
  syncWithERP: () => Promise<{ success: boolean; error?: string }>
  syncSessions?: () => Promise<{ success: boolean; error?: string }>
  initSession?: () => Promise<{ success: boolean; user?: UserProfile; error?: string }>
  getAuthUser: () => Promise<UserProfile | null>
  login: (email: string, password: string) => Promise<{ success: boolean; user?: UserProfile; error?: string }>
  logout: () => Promise<{ success: boolean }>
  getSettings: () => Promise<AppSettings>
  saveSettings: (settings: Partial<AppSettings>) => Promise<{ success: boolean; error?: string }>
  openExternal?: (url: string) => Promise<void>
  submitBugReport?: (report: { title: string; description: string }) => Promise<{ success: boolean; error?: string }>
  applyLeave?: (leave: { leaveType: string; startDate: string; endDate: string; reason: string }) => Promise<{ success: boolean; error?: string }>
  resetTime?: (params: ResetTimeParams) => Promise<{ success: boolean; session?: TrackingSession | null; auditRecord?: TimeResetAuditRecord; error?: string }>
  getResetAuditLogs?: (employeeId?: string) => Promise<{ success: boolean; logs?: TimeResetAuditRecord[]; error?: string }>
  onStateUpdate: (callback: (state: TrackingState) => void) => () => void

  // Screenshot and Admin methods
  getAllEmployeesForAdmin?: () => Promise<{ success: boolean; employees: UserProfile[]; error?: string }>
  getScreenshots?: (params: { employeeId: string; sessionDate?: string; month?: string }) => Promise<{ success: boolean; screenshots?: ScreenshotRecord[]; error?: string }>
  deleteScreenshot?: (id: string, storagePath?: string) => Promise<{ success: boolean; error?: string }>
  captureScreenshotNow?: (employeeId?: string) => Promise<{ success: boolean; screenshot?: ScreenshotRecord; error?: string }>
  onScreenshotCaptured?: (callback: (newScreenshot: ScreenshotRecord) => void) => () => void
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
