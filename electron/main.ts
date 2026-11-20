import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification, shell, powerMonitor, powerSaveBlocker } from 'electron'
import path from 'path'
import fs from 'fs'
import { storage } from './storage'
import { activityTracker } from './activity-tracker'
import { supabaseService } from './supabase-service'
import { screenshotService } from './screenshot-service'
import type { AppSettings, ResetTimeParams, TimeResetAuditRecord } from '../src/types'
import { calculateSessionWorkedSeconds } from '../src/utils/timeCalculator'

// Prevent unhandled promise rejections and uncaught exceptions from terminating the application
process.on('uncaughtException', (error) => {
  console.error('[Main] Global uncaughtException intercepted:', error)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Main] Global unhandledRejection intercepted at:', promise, 'reason:', reason)
})

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let powerSaveBlockerId: number | null = null

function updatePowerSaveBlocker(enable: boolean) {
  try {
    if (enable && powerSaveBlockerId === null) {
      powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension')
      console.log(`[Main] powerSaveBlocker started (id: ${powerSaveBlockerId})`)
    } else if (!enable && powerSaveBlockerId !== null) {
      if (powerSaveBlocker.isStarted(powerSaveBlockerId)) {
        powerSaveBlocker.stop(powerSaveBlockerId)
        console.log(`[Main] powerSaveBlocker stopped (id: ${powerSaveBlockerId})`)
      }
      powerSaveBlockerId = null
    }
  } catch (err) {
    console.warn('[Main] powerSaveBlocker error:', err)
  }
}

function showAndFocusWindow() {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.show()
  mainWindow.setAlwaysOnTop(true)
  mainWindow.focus()
  mainWindow.setAlwaysOnTop(false)
}

function configureAutoLaunch(enable: boolean) {
  try {
    app.setLoginItemSettings({
      openAtLogin: enable,
      openAsHidden: false,
      path: process.execPath,
      args: []
    })
    console.log(`[Main] Windows startup auto-launch configured: ${enable}`)
  } catch (err) {
    console.warn('[Main] Failed to configure auto-launch:', err)
  }
}

// Single instance lock to prevent duplicate tracker processes on startup
if (process.platform === 'win32') {
  app.setAppUserModelId('com.triples.timetracker')
}

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  console.log('[Main] Another instance is already running. Quitting duplicate instance.')
  app.quit()
} else {
  app.on('second-instance', () => {
    showAndFocusWindow()
  })
}

function getAppIconPath(): string | undefined {
  const candidates = [
    path.join(__dirname, '../build/icon.ico'),
    path.join(__dirname, '../public/icon.ico'),
    path.join(__dirname, '../public/logo.png'),
    path.join(__dirname, '../dist/logo.png'),
    path.join(process.resourcesPath, 'build/icon.ico'),
    path.join(process.resourcesPath, 'public/icon.ico'),
    path.join(process.resourcesPath, 'dist/logo.png'),
    path.join(process.resourcesPath, 'public/logo.png'),
    path.join(app.getAppPath(), 'build/icon.ico'),
    path.join(app.getAppPath(), 'public/icon.ico'),
    path.join(app.getAppPath(), 'public/logo.png'),
    path.join(app.getAppPath(), 'dist/logo.png')
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return undefined
}

function getTrayIcon(): Electron.NativeImage {
  const candidates = [
    path.join(__dirname, '../public/logo.png'),
    path.join(__dirname, '../dist/logo.png'),
    path.join(__dirname, '../public/icon.ico'),
    path.join(__dirname, '../build/icon.ico'),
    path.join(process.resourcesPath, 'dist/logo.png'),
    path.join(process.resourcesPath, 'public/logo.png'),
    path.join(process.resourcesPath, 'public/icon.ico'),
    path.join(app.getAppPath(), 'public/logo.png'),
    path.join(app.getAppPath(), 'dist/logo.png')
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const img = nativeImage.createFromPath(candidate)
        if (!img.isEmpty()) {
          return img.resize({ width: 16, height: 16 })
        }
      } catch {
        // continue
      }
    }
  }
  return nativeImage.createEmpty()
}

function createTray() {
  const icon = getTrayIcon()
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
  const iconPath = getAppIconPath()
  mainWindow = new BrowserWindow({
    width: 580,
    height: 600,
    minWidth: 460,
    minHeight: 520,
    resizable: true,
    frame: false,
    icon: iconPath,
    backgroundColor: storage.getSettings().theme === 'light' ? '#F7F7F7' : '#050505',
    titleBarStyle: 'hidden',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  if (iconPath) {
    mainWindow.setIcon(iconPath)
  }

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

  // Recover automatically if the renderer process encounters an issue
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Main] Renderer process crashed or terminated:', details.reason)
    if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
      console.log('[Main] Automatically recovering and reloading renderer window...')
      if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
      } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
      }
    }
  })

  mainWindow.webContents.on('unresponsive', () => {
    console.warn('[Main] Renderer window became temporarily unresponsive.')
  })

  mainWindow.on('close', (event) => {
    // The application should NEVER close automatically!
    // Closing the window (clicking X) minimizes/hides to system tray.
    // The application only exits when the user explicitly clicks "Quit" from the tray menu.
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()

      const user = storage.getCurrentUser()
      const session = user ? storage.getCurrentSession(user.id) : null
      const settings = storage.getSettings()

      if (session && session.status !== 'Completed' && session.status !== 'completed' && settings.minimizeToTray) {
        if (Notification.isSupported()) {
          new Notification({
            title: 'TripleS Time Tracker',
            body: 'Tracking session is still active in the background.'
          }).show()
        }
      }
      return
    }
  })
}

// App lifecycle
app.whenReady().then(async () => {
  const settings = storage.getSettings()
  configureAutoLaunch(settings.launchOnStartup !== false)
  updatePowerSaveBlocker(true)

  await supabaseService.initSession()
  createTray()
  createWindow()
  activityTracker.start()

  // Real-time ERP sync on every minute rollover
  activityTracker.onMinuteRolledOver(() => {
    supabaseService.syncWithERP().catch((err) => {
      console.warn('[Main] Minute rollover ERP sync error:', err)
    })
  })

  // Periodic ERP sync every 60 seconds with non-fatal error handler
  setInterval(() => {
    supabaseService.syncWithERP().catch((err) => {
      console.warn('[Main] Periodic ERP sync non-fatal error:', err)
    })
  }, 60000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })

  // When laptop opens / resumes from sleep or unlock, automatically bring tracker window to front
  powerMonitor.on('resume', () => {
    console.log('[Main] powerMonitor resume event received. Restoring and focusing tracker window.')
    showAndFocusWindow()
    supabaseService.syncWithERP().catch((err) => console.warn('[Main] Resume sync error:', err))
  })

  powerMonitor.on('unlock-screen', () => {
    console.log('[Main] powerMonitor unlock-screen event received. Restoring and focusing tracker window.')
    showAndFocusWindow()
  })

  powerMonitor.on('shutdown', () => {
    console.log('[Main] powerMonitor shutdown event received.')
    activityTracker.handleSystemShutdown()
  })
})

app.on('before-quit', () => {
  isQuitting = true
  updatePowerSaveBlocker(false)
  activityTracker.handleSystemShutdown()
})

app.on('window-all-closed', () => {
  if (isQuitting) {
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
      const errStr = (syncRes.error || '').toLowerCase()
      const isFatalRejection = errStr.includes('row-level security') || 
                               errStr.includes('42501') || 
                               errStr.includes('deactivated') || 
                               errStr.includes('terminated') ||
                               errStr.includes('banned')

      if (isFatalRejection) {
        // Only roll back if backend explicitly and permanently rejected the employee/session
        console.warn('[Tracker] Backend explicitly rejected session on clock-in:', syncRes.error)
        storage.setCurrentSession(null, user.id)
        storage.removePending(`session-${session.id}`, user.id)
        const updatedToday = storage.getTodaySessions(user.id).filter(s => s.id !== session.id)
        storage.setTodaySessions(updatedToday, user.id)
        activityTracker.emitState()
        return { success: false, error: syncRes.error || 'Failed to establish session on server' }
      }
      console.log('[Tracker] Clock-in confirmed locally and queued for background sync:', syncRes.error)
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

let isResetInProgress = false

ipcMain.handle('tracker:reset-time', async (_event, params: ResetTimeParams) => {
  const user = storage.getCurrentUser()
  if (!user || !user.id) {
    return { success: false, error: 'Authentication required: Please sign in to reset time' }
  }

  if (isResetInProgress) {
    return { success: false, error: 'Reset operation is already in progress' }
  }

  isResetInProgress = true

  try {
    // 1. Accidental Reset Protection: Explicit keyword verification
    if (!params.confirmationText || params.confirmationText.trim() !== 'RESET') {
      return {
        success: false,
        error: 'Confirmation failed: You must type RESET in uppercase to confirm resetting time.'
      }
    }

    // 2. Audit Logging requirement: Reason is mandatory
    if (!params.reason || !params.reason.trim()) {
      return {
        success: false,
        error: 'A reason is mandatory for audit logging before resetting time.'
      }
    }

    const validResetTypes = ['restart_session', 'discard_session']
    const resetType = (params.resetType || 'restart_session') as 'restart_session' | 'discard_session'
    if (!validResetTypes.includes(resetType)) {
      return { success: false, error: 'Invalid reset type specified.' }
    }

    // 3. Active Session Check (cannot reset if no active session or already completed)
    const currentSession = storage.getCurrentSession(user.id)
    if (!currentSession || !currentSession.id || currentSession.employee_id !== user.id) {
      return { success: false, error: 'No active session found to reset. Historical completed sessions cannot be reset.' }
    }

    if (currentSession.clock_out || currentSession.status === 'completed' || currentSession.status === 'Completed') {
      return { success: false, error: 'Cannot reset an already completed session.' }
    }

    // 4. Capture accurate pre-reset metrics for audit log
    const now = Date.now()
    const previousWorkedSeconds = Math.max(
      (currentSession.worked_minutes || 0) * 60,
      calculateSessionWorkedSeconds(currentSession, now)
    )
    const previousActiveSeconds = (currentSession.active_minutes * 60) + (currentSession.active_seconds_buffer || 0)

    const auditRecord: TimeResetAuditRecord = {
      id: crypto.randomUUID(),
      session_id: currentSession.id,
      employee_id: user.id,
      employee_email: user.email,
      employee_name: [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Employee',
      reset_type: resetType,
      previous_clock_in: currentSession.clock_in,
      previous_worked_minutes: currentSession.worked_minutes,
      previous_worked_seconds: previousWorkedSeconds,
      previous_active_minutes: currentSession.active_minutes,
      previous_active_seconds: previousActiveSeconds,
      previous_status: currentSession.status,
      reason: params.reason.trim(),
      notes: params.notes ? params.notes.trim().slice(0, 500) : undefined,
      reset_by: user.id,
      reset_by_role: user.role || 'Employee',
      created_at: new Date().toISOString()
    }

    // 5. Perform accurate session reset
    const { session: updatedSession } = activityTracker.resetTime(user.id, resetType)

    // 6. Record audit log and synchronize with database
    await supabaseService.recordResetAudit(auditRecord)
    await supabaseService.syncResetSession(updatedSession, currentSession.id, user.id)

    return {
      success: true,
      session: updatedSession,
      auditRecord
    }
  } catch (err: any) {
    console.error('[Tracker] Error in tracker:reset-time:', err)
    return { success: false, error: err.message || 'Failed to reset time' }
  } finally {
    isResetInProgress = false
  }
})

ipcMain.handle('tracker:get-reset-audit-logs', async (_event, employeeId?: string) => {
  return await supabaseService.getResetAuditLogs(employeeId)
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
  if (typeof updates.launchOnStartup === 'boolean') {
    configureAutoLaunch(updates.launchOnStartup)
  }
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
  return await supabaseService.submitBugReport(report)
})

ipcMain.handle('tracker:apply-leave', async (_event, leave: { leaveType: string; startDate: string; endDate: string; reason: string }) => {
  return await supabaseService.applyLeave(leave)
})

// Screenshots inspection & capture IPC handlers
ipcMain.handle('screenshots:get-all-employees', async () => {
  return await supabaseService.getAllEmployeesForAdmin()
})

ipcMain.handle('screenshots:get', async (_event, params: { employeeId: string; sessionDate?: string; month?: string }) => {
  return await supabaseService.getScreenshots(params)
})

ipcMain.handle('screenshots:delete', async (_event, id: string, storagePath?: string) => {
  return await supabaseService.deleteScreenshot(id, storagePath)
})

ipcMain.handle('screenshots:capture-now', async (_event, employeeId?: string) => {
  const user = storage.getCurrentUser()
  if (!user || !user.id) {
    return { success: false, error: 'User authentication required' }
  }
  const empId = employeeId || user.id
  const session = storage.getCurrentSession(empId)
  if (!session) {
    return { success: false, error: 'No active session found to capture screenshot for.' }
  }
  const record = await screenshotService.captureAndSaveScreenshot(
    session,
    user,
    activityTracker.getCurrentApp(),
    activityTracker.getCurrentTitle()
  )
  if (record) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('screenshot:captured', record)
    }
    return { success: true, screenshot: record }
  }
  return { success: false, error: 'Failed to capture screen' }
})


