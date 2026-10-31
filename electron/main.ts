import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { storage } from './storage'
import { activityTracker } from './activity-tracker'
import { supabaseService } from './supabase-service'
import type { AppSettings } from '../src/types'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

function createTray() {
  const iconPath = path.join(__dirname, '../public/logo.png')
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setToolTip('TripleS Time Tracker')

  const updateContextMenu = () => {
    const user = storage.getCurrentUser()
    const session = user ? storage.getCurrentSession(user.id) : null
    const isWorking = session?.status === 'Working' || session?.status === 'working'
    const isOnBreak = session?.status === 'On Break' || session?.status === 'on_break'

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open TripleS Time Tracker',
        click: () => {
          if (mainWindow) {
            mainWindow.show()
            mainWindow.focus()
          }
        }
      },
      { type: 'separator' },
      {
        label: isWorking ? 'Take Break' : isOnBreak ? 'Resume' : 'Clock In',
        click: () => {
          const currentUser = storage.getCurrentUser()
          if (!currentUser || !currentUser.id) {
            if (mainWindow) {
              mainWindow.show()
              mainWindow.focus()
            }
            return
          }
          if (isWorking) {
            activityTracker.takeBreak(currentUser.id)
          } else if (isOnBreak) {
            activityTracker.resumeBreak(currentUser.id)
          } else {
            activityTracker.clockIn(currentUser.id)
          }
          updateContextMenu()
        }
      },
      {
        label: 'Clock Out',
        enabled: !!session && session.status !== 'Completed' && session.status !== 'completed',
        click: () => {
          const currentUser = storage.getCurrentUser()
          if (currentUser) {
            activityTracker.clockOut(currentUser.id)
          }
          updateContextMenu()
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])

    tray?.setContextMenu(contextMenu)
  }

  updateContextMenu()

  tray.on('double-click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus()
      } else {
        mainWindow.show()
      }
    }
  })
}

function createWindow() {
  const iconPath = path.join(__dirname, '../public/logo.png')
  mainWindow = new BrowserWindow({
    width: 580,
    height: 600,
    minWidth: 460,
    minHeight: 520,
    resizable: true,
    frame: false,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: storage.getSettings().theme === 'light' ? '#F7F7F7' : '#050505',
    titleBarStyle: 'hidden',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  // Set window in activity tracker
  activityTracker.setWindow(mainWindow)

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('close', (event) => {
    const user = storage.getCurrentUser()
    const session = user ? storage.getCurrentSession(user.id) : null
    const settings = storage.getSettings()

    // If session is active and user didn't explicitly choose Quit, minimize to tray
    if (!isQuitting && session && session.status !== 'Completed' && session.status !== 'completed' && settings.minimizeToTray) {
      event.preventDefault()
      mainWindow?.hide()

      if (Notification.isSupported()) {
        new Notification({
          title: 'TripleS Time Tracker',
          body: 'Tracking session is still active in the background.'
        }).show()
      }
    }
  })
}

// App lifecycle
app.whenReady().then(async () => {
  await supabaseService.initSession()
  createTray()
  createWindow()
  activityTracker.start()

  // Periodic ERP sync every 60 seconds
  setInterval(() => {
    supabaseService.syncWithERP()
  }, 60000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('before-quit', () => {
  isQuitting = true
  activityTracker.stop()
  storage.flush()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) {
    app.quit()
  }
})

// IPC Handlers
ipcMain.on('window:minimize', () => {
  mainWindow?.minimize()
})

ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})

ipcMain.on('window:close', () => {
  mainWindow?.close()
})

ipcMain.handle('tracker:get-state', () => {
  const user = storage.getCurrentUser()
  return activityTracker.getState(user?.id)
})

let isClockInInProgress = false

ipcMain.handle('tracker:clock-in', async () => {
  const user = storage.getCurrentUser()
  if (!user || !user.id) {
    return { success: false, error: 'Cannot clock in: Employee authentication required. Please sign in.' }
  }

  // Prevent duplicate concurrent clock-in requests
  if (isClockInInProgress) {
    const existing = storage.getCurrentSession(user.id)
    if (existing && existing.status !== 'Completed' && existing.status !== 'completed' && !existing.clock_out) {
      return { success: true, session: existing }
    }
    return { success: false, error: 'Clock in operation is already in progress' }
  }

  isClockInInProgress = true

  try {
    // If user already has an active session, return it idempotently without creating duplicate
    const existing = storage.getCurrentSession(user.id)
    if (existing && existing.status !== 'Completed' && existing.status !== 'completed' && !existing.clock_out) {
      return { success: true, session: existing }
    }

    // Create session in activityTracker without emitting intermediate state yet
    const session = activityTracker.clockIn(user.id, false)

    // Persist to Supabase
    const syncRes = await supabaseService.syncSession(session)

    if (!syncRes.success) {
      // If backend explicitly rejected the session (e.g. database error, RLS rejection),
      // roll back and remain safely unclocked-in rather than pretending the operation succeeded.
      console.warn('[Tracker] Backend session sync failed on clock-in:', syncRes.error)
      storage.setCurrentSession(null, user.id)
      storage.removePending(`session-${session.id}`, user.id)
      const updatedToday = storage.getTodaySessions(user.id).filter(s => s.id !== session.id)
      storage.setTodaySessions(updatedToday, user.id)
      activityTracker.emitState()
      return { success: false, error: syncRes.error || 'Failed to establish session on server' }
    }

    // Persist confirmed session in storage & emit authoritative state
    storage.setCurrentSession(session, user.id)
    activityTracker.emitState()
    return { success: true, session }
  } catch (err: any) {
    // On unexpected exception, ensure safe rollback
    storage.setCurrentSession(null, user.id)
    activityTracker.emitState()
    return { success: false, error: err.message || 'Failed to clock in' }
  } finally {
    isClockInInProgress = false
  }
})

ipcMain.handle('tracker:take-break', async (_event, reason?: string) => {
  const user = storage.getCurrentUser()
  if (!user || !user.id) {
    return { success: false, error: 'Authentication required' }
  }
  const session = activityTracker.takeBreak(user.id, reason)
  if (session) {
    await supabaseService.syncSession(session)
    return { success: true, session }
  }
  return { success: false, error: 'Cannot take break: session is not in working state' }
})

ipcMain.handle('tracker:resume', async () => {
  const user = storage.getCurrentUser()
  if (!user || !user.id) {
    return { success: false, error: 'Authentication required' }
  }
  const session = activityTracker.resumeBreak(user.id)
  if (session) {
    await supabaseService.syncSession(session)
    return { success: true, session }
  }
  return { success: false, error: 'Cannot resume: session is not on break' }
})

ipcMain.handle('tracker:clock-out', async () => {
  const user = storage.getCurrentUser()
  if (!user || !user.id) {
    return { success: false, error: 'Authentication required' }
  }
  const session = activityTracker.clockOut(user.id)
  if (session) {
    await supabaseService.syncSession(session)
    return { success: true, session }
  }
  return { success: false, error: 'Cannot clock out: no session' }
})

ipcMain.handle('tracker:sync', async () => {
  return await supabaseService.syncWithERP()
})

ipcMain.handle('tracker:sync-sessions', async () => {
  const user = storage.getCurrentUser()
  if (!user || !user.id) {
    return { success: false, error: 'Authentication required' }
  }
  const result = await supabaseService.syncEmployeeSessionsFromSupabase(user.id)
  activityTracker.emitState()
  return result
})

ipcMain.handle('auth:init-session', async () => {
  return await supabaseService.initSession()
})

ipcMain.handle('auth:get-user', () => {
  return storage.getCurrentUser()
})

ipcMain.handle('auth:login', async (_event, email: string, pass: string) => {
  const result = await supabaseService.login(email, pass)
  if (result.success && result.user) {
    tray?.setToolTip(`TripleS Time Tracker - ${result.user.first_name}`)
  }
  return result
})

ipcMain.handle('auth:logout', async () => {
  const res = await supabaseService.logout()
  tray?.setToolTip('TripleS Time Tracker')
  return res
})

ipcMain.handle('settings:get', () => {
  return storage.getSettings()
})

ipcMain.handle('settings:save', (_event, updates: Partial<AppSettings>) => {
  if (!updates || typeof updates !== 'object') {
    return { success: false, error: 'Invalid settings payload' }
  }

  // If idleThresholdSeconds is being modified, enforce authenticated Admin role server-side
  if (updates.idleThresholdSeconds !== undefined) {
    const user = storage.getCurrentUser()
    if (!user || !user.id) {
      console.warn('[Security] Unauthorized threshold modification attempt: No authenticated user session.')
      return { 
        success: false, 
        error: 'Unauthorized: Authentication required to modify the inactivity threshold.' 
      }
    }

    const roleUpper = (user.role || '').toUpperCase()
    const isAdmin = roleUpper === 'ADMIN' || roleUpper === 'SUPER_ADMIN' || roleUpper === 'SUPER ADMIN'

    if (!isAdmin) {
      console.warn(`[Security] Unauthorized threshold modification attempt by non-admin: ${user.email} (Role: ${user.role})`)
      return { 
        success: false, 
        error: 'Unauthorized: Inactivity threshold can only be modified by an administrator.' 
      }
    }

    const validThresholds = [30, 60, 120, 300]
    if (!validThresholds.includes(updates.idleThresholdSeconds)) {
      return { 
        success: false, 
        error: 'Invalid threshold: Supported values are 30s, 60s (1m), 120s (2m), and 300s (5m).' 
      }
    }
  }

  const updatedSettings = storage.updateSettings(updates)
  return { success: true, settings: updatedSettings }
})

ipcMain.handle('window:open-external', async (_event, url: string) => {
  try {
    if (url && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('mailto:'))) {
      await shell.openExternal(url)
      return { success: true }
    }
    return { success: false, error: 'Invalid URL scheme' }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to open URL' }
  }
})

ipcMain.handle('tracker:get-today-sessions', () => {
  const user = storage.getCurrentUser()
  if (!user || !user.id) return []
  return storage.getTodaySessions(user.id)
})

ipcMain.handle('tracker:submit-bug-report', async (_event, report: { title: string; description: string }) => {
  const user = storage.getCurrentUser()
  console.log(`[BugReport] Submitted by ${user?.email || 'anonymous'}:`, report)
  return { success: true }
})

