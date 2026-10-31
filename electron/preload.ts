import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronAPI, TrackingState, AppSettings, ScreenshotRecord } from '../src/types'

const api: ElectronAPI = {
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),

  getTrackingState: () => ipcRenderer.invoke('tracker:get-state'),
  clockIn: () => ipcRenderer.invoke('tracker:clock-in'),
  takeBreak: (reason?: string) => ipcRenderer.invoke('tracker:take-break', reason),
  resumeBreak: () => ipcRenderer.invoke('tracker:resume'),
  clockOut: () => ipcRenderer.invoke('tracker:clock-out'),
  syncWithERP: () => ipcRenderer.invoke('tracker:sync'),
  syncSessions: () => ipcRenderer.invoke('tracker:sync-sessions'),
  initSession: () => ipcRenderer.invoke('auth:init-session'),

  getAuthUser: () => ipcRenderer.invoke('auth:get-user'),
  login: (email: string, password: string) => ipcRenderer.invoke('auth:login', email, password),
  logout: () => ipcRenderer.invoke('auth:logout'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke('settings:save', settings),

  getTodaySessions: () => ipcRenderer.invoke('tracker:get-today-sessions'),
  openExternal: (url: string) => ipcRenderer.invoke('window:open-external', url),
  submitBugReport: (report: { title: string; description: string }) => ipcRenderer.invoke('tracker:submit-bug-report', report),

  getAllEmployeesForAdmin: () => ipcRenderer.invoke('screenshots:get-all-employees'),
  getScreenshots: (params: { employeeId: string; sessionDate?: string; month?: string }) =>
    ipcRenderer.invoke('screenshots:get', params),
  deleteScreenshot: (id: string, storagePath?: string) =>
    ipcRenderer.invoke('screenshots:delete', id, storagePath),
  captureScreenshotNow: (employeeId?: string) => ipcRenderer.invoke('screenshots:capture-now', employeeId),
  onScreenshotCaptured: (callback: (newScreenshot: ScreenshotRecord) => void) => {
    const handler = (_event: any, screenshot: ScreenshotRecord) => callback(screenshot)
    ipcRenderer.on('screenshot:captured', handler)
    return () => {
      ipcRenderer.removeListener('screenshot:captured', handler)
    }
  },

  onStateUpdate: (callback: (state: TrackingState) => void) => {
    const handler = (_event: any, state: TrackingState) => callback(state)
    ipcRenderer.on('tracking:state-update', handler)
    return () => {
      ipcRenderer.removeListener('tracking:state-update', handler)
    }
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)
