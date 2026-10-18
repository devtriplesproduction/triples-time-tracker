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

export interface PendingSyncItem {
  id: string
  type: 'session' | 'break' | 'activity'
  employee_id?: string
  data: any
  createdAt: string
  retries: number
}

export interface TrackingState {
  status: TrackingStatus
  currentSession: TrackingSession | null
  todayWorkedMinutes: number
  todayActiveMinutes: number
  activeAppName: string
  isIdle: boolean
  idleSeconds: number
  lastActivityTime: string
  isOnline: boolean
  lastSyncedAt: string | null
  pendingSyncCount?: number
  syncError?: string | null
}

export interface AppSettings {
  idleThresholdSeconds: number
  minimizeToTray: boolean
  theme: 'dark' | 'light'
  apiUrl: string
}

export interface ElectronAPI {
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void
  getTrackingState: () => Promise<TrackingState>
  clockIn: () => Promise<{ success: boolean; session?: TrackingSession; error?: string }>
  takeBreak: (reason?: string) => Promise<{ success: boolean; session?: TrackingSession; error?: string }>
  resumeBreak: () => Promise<{ success: boolean; session?: TrackingSession; error?: string }>
  clockOut: () => Promise<{ success: boolean; session?: TrackingSession; error?: string }>
  syncWithERP: () => Promise<{ success: boolean; error?: string }>
  getAuthUser: () => Promise<UserProfile | null>
  login: (email: string, password: string) => Promise<{ success: boolean; user?: UserProfile; error?: string }>
  logout: () => Promise<{ success: boolean }>
  getSettings: () => Promise<AppSettings>
  saveSettings: (settings: Partial<AppSettings>) => Promise<{ success: boolean; error?: string }>
  onStateUpdate: (callback: (state: TrackingState) => void) => () => void
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
