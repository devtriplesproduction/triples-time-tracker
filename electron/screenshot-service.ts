import { desktopCapturer, screen, app } from 'electron'
import fs from 'fs'
import path from 'path'
import { storage } from './storage'
import { supabaseService } from './supabase-service'
import type { ScreenshotRecord, TrackingSession, UserProfile } from '../src/types'

class ScreenshotService {
  private isCapturing: boolean = false

  /**
   * Captures the full primary screen and compresses to an optimized JPEG buffer.
   */
  public async captureScreen(): Promise<{ buffer: Buffer; width: number; height: number } | null> {
    try {
      const primaryDisplay = screen.getPrimaryDisplay()
      const { width, height } = primaryDisplay.size
      const scaleFactor = primaryDisplay.scaleFactor || 1

      // Capture at physical resolution or max 1920x1080 to ensure crisp readability while preserving space
      const fullWidth = Math.floor(width * scaleFactor)
      const fullHeight = Math.floor(height * scaleFactor)
      const targetWidth = Math.min(1920, fullWidth)
      const targetHeight = Math.min(1080, Math.floor(fullHeight * (targetWidth / fullWidth)))

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: targetWidth,
          height: targetHeight
        }
      })

      if (!sources || sources.length === 0) {
        console.warn('[ScreenshotService] No screen sources found by desktopCapturer.')
        return null
      }

      // Select primary screen or first available screen
      const screenSource = sources.find(s => 
        s.id.startsWith('screen:0') || 
        s.name.toLowerCase().includes('screen 1') || 
        s.name.toLowerCase().includes('entire')
      ) || sources[0]

      if (!screenSource || !screenSource.thumbnail || screenSource.thumbnail.isEmpty()) {
        console.warn('[ScreenshotService] Screen thumbnail is empty.')
        return null
      }

      // Convert to JPEG with 70% quality (~80-150KB per capture)
      const jpegBuffer = screenSource.thumbnail.toJPEG(70)
      const size = screenSource.thumbnail.getSize()

      return {
        buffer: jpegBuffer,
        width: size.width,
        height: size.height
      }
    } catch (err: any) {
      console.error('[ScreenshotService] Error capturing screen:', err.message || err)
      return null
    }
  }

  /**
   * Captures a screenshot for an active session, persists to Supabase (Storage + Database),
   * and handles offline queuing if disconnected.
   */
  public async captureAndSaveScreenshot(
    session: TrackingSession,
    user: UserProfile,
    appName?: string,
    windowTitle?: string
  ): Promise<ScreenshotRecord | null> {
    if (this.isCapturing) {
      console.log('[ScreenshotService] Capture already in progress, skipping overlapping call.')
      return null
    }

    this.isCapturing = true

    try {
      console.log(`[ScreenshotService] Taking 7-minute periodic screenshot for ${user.first_name} (${user.id})...`)
      const captureResult = await this.captureScreen()

      if (!captureResult || !captureResult.buffer) {
        console.warn('[ScreenshotService] Screen capture returned null buffer.')
        return null
      }

      const screenshotId = crypto.randomUUID()
      const nowIso = new Date().toISOString()
      const sessionDate = session.session_date || storage.getTodayBusinessDate()
      const storagePath = `${user.id}/${sessionDate}/${session.id}/${screenshotId}.jpg`

      const record: ScreenshotRecord = {
        id: screenshotId,
        session_id: session.id,
        employee_id: user.id,
        session_date: sessionDate,
        captured_at: nowIso,
        storage_path: storagePath,
        image_url: null,
        image_data: null,
        file_size_bytes: captureResult.buffer.length,
        app_name: appName || 'Desktop Work',
        window_title: windowTitle ? windowTitle.slice(0, 255) : '',
        created_at: nowIso
      }

      // Attempt upload to Supabase Storage and DB record insertion
      const uploadRes = await supabaseService.uploadScreenshot(record, captureResult.buffer)

      if (uploadRes.success && uploadRes.record) {
        console.log(`[ScreenshotService] Screenshot ${screenshotId} uploaded and recorded successfully (${record.file_size_bytes} bytes).`)
        return uploadRes.record
      } else {
        console.warn('[ScreenshotService] Online upload failed or offline. Storing in local pending queue:', uploadRes.error)
        
        // Cache screenshot buffer locally to disk for offline resilience
        const offlineDir = path.join(app.getPath('userData'), 'pending-screenshots')
        if (!fs.existsSync(offlineDir)) {
          fs.mkdirSync(offlineDir, { recursive: true })
        }
        const offlineFilePath = path.join(offlineDir, `${screenshotId}.jpg`)
        fs.writeFileSync(offlineFilePath, captureResult.buffer)

        // Enqueue to employee's pending sync queue with disk reference
        record.image_data = `file://${offlineFilePath}`
        storage.enqueuePending({
          id: `screenshot-${screenshotId}`,
          type: 'screenshot',
          employee_id: user.id,
          data: {
            record,
            offlineFilePath
          },
          createdAt: nowIso,
          retries: 0
        }, user.id)

        return record
      }
    } catch (err: any) {
      console.error('[ScreenshotService] Unexpected error during capture and save:', err)
      return null
    } finally {
      this.isCapturing = false
    }
  }
}

export const screenshotService = new ScreenshotService()

