import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronAPI, TrackingState, AppSettings } from '../src/types'

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

  getAuthUser: () => ipcRenderer.invoke('auth:get-user'),
  login: (email: string, password: string) => ipcRenderer.invoke('auth:login', email, password),
  logout: () => ipcRenderer.invoke('auth:logout'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke('settings:save', settings),

  onStateUpdate: (callback: (state: TrackingState) => void) => {
    const handler = (_event: any, state: TrackingState) => callback(state)
    ipcRenderer.on('tracking:state-update', handler)
    return () => {
      ipcRenderer.removeListener('tracking:state-update', handler)
    }
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)
