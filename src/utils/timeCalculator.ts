import type { TrackingSession, ActivityInterval, TrackingStatus } from '../types'

/**
 * Default timezone is Asia/Kolkata (fixed UTC+05:30, 19,800,000 ms, no DST).
 * Configurable per employee via AppSettings.timezone.
 */
export const DEFAULT_TIMEZONE = 'Asia/Kolkata'
export const KOLKATA_TIMEZONE = 'Asia/Kolkata'

/**
 * Returns the calendar day boundaries (00:00:00.000 to 24:00:00.000) in ms
 * for a given date in the specified timezone (defaults to Asia/Kolkata).
 */
export function getDayBounds(
  dateOrString?: string | Date | number,
  timeZone: string = DEFAULT_TIMEZONE
): {
  dayStartMs: number
  dayEndMs: number
  dateString: string
} {
  let dateString: string

  if (typeof dateOrString === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateOrString)) {
    dateString = dateOrString
  } else {
    const d = dateOrString !== undefined ? new Date(dateOrString) : new Date()
    dateString = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || DEFAULT_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(d)
  }

  // Fast path for Asia/Kolkata (fixed +05:30 offset, 19,800,000 ms, no DST)
  if (!timeZone || timeZone === 'Asia/Kolkata' || timeZone === 'Asia/Calcutta' || timeZone === 'IST') {
    const dayStartMs = new Date(`${dateString}T00:00:00+05:30`).getTime()
    return {
      dayStartMs,
      dayEndMs: dayStartMs + 24 * 60 * 60 * 1000,
      dateString
    }
  }

  // For UTC
  if (timeZone === 'UTC' || timeZone === 'Etc/UTC') {
    const dayStartMs = new Date(`${dateString}T00:00:00Z`).getTime()
    return {
      dayStartMs,
      dayEndMs: dayStartMs + 24 * 60 * 60 * 1000,
      dateString
    }
  }

  // General timezone support using Intl formatToParts
  try {
    const [y, m, d] = dateString.split('-').map(Number)
    const utcGuess = Date.UTC(y, m - 1, d, 0, 0, 0)
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false
    }).formatToParts(new Date(utcGuess))

    const pMap: Record<string, number> = {}
    for (const p of parts) {
      if (p.type !== 'literal') pMap[p.type] = parseInt(p.value, 10)
    }

    const localAtUtcGuess = Date.UTC(
      pMap.year,
      pMap.month - 1,
      pMap.day,
      pMap.hour % 24,
      pMap.minute,
      pMap.second
    )
    const offsetMs = localAtUtcGuess - utcGuess
    const dayStartMs = utcGuess - offsetMs
    return {
      dayStartMs,
      dayEndMs: dayStartMs + 24 * 60 * 60 * 1000,
      dateString
    }
  } catch {
    const dayStartMs = new Date(`${dateString}T00:00:00+05:30`).getTime()
    return {
      dayStartMs,
      dayEndMs: dayStartMs + 24 * 60 * 60 * 1000,
      dateString
    }
  }
}

/**
 * Backwards-compatible alias for Asia/Kolkata day bounds.
 */
export function getKolkataDayBounds(dateOrString?: string | Date | number): {
  dayStartMs: number
  dayEndMs: number
  dateString: string
} {
  return getDayBounds(dateOrString, KOLKATA_TIMEZONE)
}

/**
 * Returns the current date string in the target timezone as YYYY-MM-DD.
 */
export function getDateString(dateOrMs?: Date | number, timeZone: string = DEFAULT_TIMEZONE): string {
  const d = dateOrMs !== undefined ? new Date(dateOrMs) : new Date()
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || DEFAULT_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(d)
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: KOLKATA_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(d)
  }
}

/**
 * Backwards-compatible alias for Asia/Kolkata date string.
 */
export function getKolkataDateString(dateOrMs?: Date | number): string {
  return getDateString(dateOrMs, KOLKATA_TIMEZONE)
}

/**
 * Returns the hour (0-23) in the target timezone.
 */
export function getHour(dateOrMs?: Date | number, timeZone: string = DEFAULT_TIMEZONE): number {
  const d = dateOrMs !== undefined ? new Date(dateOrMs) : new Date()
  try {
    const hourStr = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || DEFAULT_TIMEZONE,
      hour: 'numeric',
      hour12: false
    }).format(d)
    const hour = parseInt(hourStr, 10)
    return hour % 24
  } catch {
    return getKolkataHour(dateOrMs)
  }
}

/**
 * Backwards-compatible alias for Asia/Kolkata hour.
 */
export function getKolkataHour(dateOrMs?: Date | number): number {
  const d = dateOrMs !== undefined ? new Date(dateOrMs) : new Date()
  const hourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: KOLKATA_TIMEZONE,
    hour: 'numeric',
    hour12: false
  }).format(d)
  const hour = parseInt(hourStr, 10)
  return hour % 24
}

/**
 * Returns greeting based on current time in the specified timezone:
 * - 5:00 AM–11:59 AM: Good Morning
 * - 12:00 PM–4:59 PM: Good Afternoon
 * - 5:00 PM–8:59 PM: Good Evening
 * - 9:00 PM–4:59 AM: Good Night
 */
export function getGreeting(
  dateOrMs: Date | number = Date.now(),
  fullName?: string | null,
  timeZone: string = DEFAULT_TIMEZONE
): { greetingText: string; fullNameText: string; fullGreeting: string } {
  const hour = getHour(dateOrMs, timeZone)

  let greetingText = 'Good Morning'
  if (hour >= 5 && hour < 12) {
    greetingText = 'Good Morning'
  } else if (hour >= 12 && hour < 17) {
    greetingText = 'Good Afternoon'
  } else if (hour >= 17 && hour < 21) {
    greetingText = 'Good Evening'
  } else {
    greetingText = 'Good Night'
  }

  const cleanName = (fullName || '').trim()
  const fullNameText = cleanName
  const fullGreeting = cleanName ? `${greetingText}, ${cleanName}` : greetingText

  return {
    greetingText,
    fullNameText,
    fullGreeting
  }
}

/**
 * Backwards-compatible alias for Asia/Kolkata greeting.
 */
export function getKolkataGreeting(
  dateOrMs: Date | number = Date.now(),
  fullName?: string | null
): { greetingText: string; fullNameText: string; fullGreeting: string } {
  return getGreeting(dateOrMs, fullName, KOLKATA_TIMEZONE)
}

/**
 * Calculates the exact worked ms of a session that fall within target calendar date.
 * Splits sessions crossing midnight: only the portion within target date's 00:00:00 to 24:00:00 in specified timezone is counted.
 * Excludes breaks and system suspend intervals that fell within the target date.
 * If currently on break, freeze effective work at the start of open break.
 * If interrupted by a PC crash, hard shutdown, or offline gap (>5m without heartbeat), caps at last heartbeat to prevent time inflation.
 */
export function calculateSessionWorkedMsForDate(
  session: TrackingSession,
  targetDateStr: string,
  nowMs: number = Date.now(),
  timeZone: string = DEFAULT_TIMEZONE
): number {
  const { dayStartMs, dayEndMs } = getDayBounds(targetDateStr, timeZone)
  const clockInMs = new Date(session.clock_in).getTime()

  const isBreak = session.status === 'on_break' || session.status === 'On Break'

  // Determine effective end of work for this session
  let sessionEffectiveEndMs: number
  if (session.clock_out) {
    sessionEffectiveEndMs = new Date(session.clock_out).getTime()
  } else if (isBreak) {
    const openBreak = session.breaks?.find(b => b.end_time === null)
    sessionEffectiveEndMs = openBreak ? new Date(openBreak.start_time).getTime() : nowMs
  } else if (
    session.last_heartbeat &&
    nowMs - new Date(session.last_heartbeat).getTime() > 5 * 60 * 1000
  ) {
    // The session's last activity stopped >5m ago and was never clocked out (PC shutdown/crash/power loss).
    // Finalize at last heartbeat (or prior day boundary) so offline downtime does NOT inflate worked hours.
    const lastHbMs = new Date(session.last_heartbeat).getTime()
    const priorDayBounds = getDayBounds(session.session_date || clockInMs, timeZone)
    sessionEffectiveEndMs = Math.min(lastHbMs, priorDayBounds.dayEndMs)
  } else if (nowMs - clockInMs > 24 * 60 * 60 * 1000) {
    // Stale unclosed session older than 24h cannot extend into current date
    const priorDayBounds = getDayBounds(session.session_date || clockInMs, timeZone)
    sessionEffectiveEndMs = session.last_heartbeat
      ? Math.min(new Date(session.last_heartbeat).getTime(), priorDayBounds.dayEndMs)
      : priorDayBounds.dayEndMs
  } else {
    sessionEffectiveEndMs = nowMs
  }

  // Gross session interval overlap with the target date
  const overlapStart = Math.max(clockInMs, dayStartMs)
  const overlapEnd = Math.min(sessionEffectiveEndMs, dayEndMs)

  if (overlapEnd <= overlapStart) {
    return 0
  }

  const grossElapsedMs = overlapEnd - overlapStart

  // Calculate closed breaks overlapping the target date
  let breakMsOnDate = 0
  for (const b of session.breaks) {
    const bStart = new Date(b.start_time).getTime()
    // If open break, work was already frozen at bStart so nothing after bStart was in grossElapsedMs
    const bEnd = b.end_time ? new Date(b.end_time).getTime() : (isBreak ? bStart : nowMs)
    const bOverlapStart = Math.max(bStart, dayStartMs)
    const bOverlapEnd = Math.min(bEnd, dayEndMs)

    if (bOverlapEnd > bOverlapStart) {
      breakMsOnDate += (bOverlapEnd - bOverlapStart)
    }
  }

  // System suspend / sleep duration allocated to the target date
  let suspendMsOnDate = 0
  if (session.suspended_seconds && session.suspended_seconds > 0) {
    const totalSessionDuration = Math.max(1, sessionEffectiveEndMs - clockInMs)
    const dateRatio = Math.min(1, grossElapsedMs / totalSessionDuration)
    suspendMsOnDate = session.suspended_seconds * 1000 * dateRatio
  }

  const netWorkedMs = Math.max(0, grossElapsedMs - breakMsOnDate - suspendMsOnDate)
  return netWorkedMs
}

/**
 * Calculates the exact worked seconds for a single work session from its clock_in time.
 * - Starts at 00:00:00 when clock_in is established.
 * - Increments monotonically during the working state.
 * - Pauses during break (frozen at the start of open break).
 * - Resumes upon Resume Work.
 * - Freezes upon Clock Out (at clock_out timestamp).
 * - Prevents crash / abrupt shutdown inflation by freezing at last_heartbeat if offline >5m.
 * - Excludes all completed break durations.
 * - Excludes system suspend/sleep seconds.
 */
export function calculateSessionWorkedSeconds(
  session: TrackingSession | null,
  nowMs: number = Date.now()
): number {
  if (!session || !session.clock_in) return 0
  const clockInMs = new Date(session.clock_in).getTime()
  if (isNaN(clockInMs)) return 0

  const isBreak = session.status === 'on_break' || session.status === 'On Break'
  let effectiveEndMs = nowMs

  if (session.clock_out) {
    effectiveEndMs = new Date(session.clock_out).getTime()
  } else if (isBreak) {
    const openBreak = session.breaks?.find(b => b.end_time === null)
    effectiveEndMs = openBreak ? new Date(openBreak.start_time).getTime() : nowMs
  } else if (
    session.last_heartbeat &&
    nowMs - new Date(session.last_heartbeat).getTime() > 5 * 60 * 1000
  ) {
    // Abrupt shutdown / crash / app terminated without clock-out: freeze at last recorded heartbeat
    effectiveEndMs = new Date(session.last_heartbeat).getTime()
  }

  if (effectiveEndMs <= clockInMs) return 0

  let totalBreakMs = 0
  if (Array.isArray(session.breaks)) {
    for (const b of session.breaks) {
      if (b.end_time) {
        const bStart = new Date(b.start_time).getTime()
        const bEnd = new Date(b.end_time).getTime()
        totalBreakMs += Math.max(0, bEnd - bStart)
      }
    }
  }

  const suspendedMs = (session.suspended_seconds || 0) * 1000
  const netWorkedMs = Math.max(0, effectiveEndMs - clockInMs - totalBreakMs - suspendedMs)
  return Math.floor(netWorkedMs / 1000)
}

/**
 * Calculates total worked seconds for the target date across all sessions.
 * Capped strictly at 24:00:00 (86,400 seconds).
 */
export function calculateDailyWorkedSeconds(
  currentSession: TrackingSession | null,
  allSessions: TrackingSession[] = [],
  targetDateStr?: string,
  nowMs: number = Date.now(),
  timeZone: string = DEFAULT_TIMEZONE
): number {
  const { dateString } = getDayBounds(targetDateStr || new Date(nowMs), timeZone)

  const sessionMap = new Map<string, TrackingSession>()
  for (const s of allSessions) {
    if (s && s.id) {
      sessionMap.set(s.id, s)
    }
  }
  if (currentSession && currentSession.id) {
    sessionMap.set(currentSession.id, currentSession)
  }

  let totalMs = 0
  for (const session of sessionMap.values()) {
    totalMs += calculateSessionWorkedMsForDate(session, dateString, nowMs, timeZone)
  }

  // Max 24 hours = 86400 seconds
  const totalSeconds = Math.min(86400, Math.floor(totalMs / 1000))
  return Math.max(0, totalSeconds)
}

/**
 * Formats seconds as digital text: HH:MM:SS
 * Capped at 24:00:00
 */
export function formatSecondsToHHMMSS(totalSeconds: number): string {
  const clamped = Math.min(86400, Math.max(0, totalSeconds))
  const hrs = Math.floor(clamped / 3600)
  const mins = Math.floor((clamped % 3600) / 60)
  const secs = clamped % 60
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

/**
 * Formats minutes as digital text: HH:MM:SS
 */
export function formatMinutesToHHMMSS(totalMinutes: number): string {
  return formatSecondsToHHMMSS(totalMinutes * 60)
}

/**
 * Calculates total active seconds for the target date across all sessions.
 * Stops accumulating during breaks, respects idle thresholds, and caps at worked time and 24h.
 */
export function calculateDailyActiveSeconds(
  currentSession: TrackingSession | null,
  allSessions: TrackingSession[] = [],
  targetDateStr?: string,
  nowMs: number = Date.now(),
  timeZone: string = DEFAULT_TIMEZONE
): number {
  const { dateString } = getDayBounds(targetDateStr || new Date(nowMs), timeZone)

  const sessionMap = new Map<string, TrackingSession>()
  for (const s of allSessions) {
    if (s && s.id) {
      sessionMap.set(s.id, s)
    }
  }
  if (currentSession && currentSession.id) {
    sessionMap.set(currentSession.id, currentSession)
  }

  let totalActiveSeconds = 0
  for (const session of sessionMap.values()) {
    // Only calculate active seconds if session belongs to or overlaps target date
    if (session.session_date && session.session_date !== dateString) continue

    const workedSecondsOnDate = Math.floor(
      calculateSessionWorkedMsForDate(session, dateString, nowMs, timeZone) / 1000
    )
    if (workedSecondsOnDate <= 0) continue

    const sessionActiveSeconds =
      (session.active_minutes || 0) * 60 + (session.active_seconds_buffer || 0)
    const activeOnDate = Math.min(workedSecondsOnDate, sessionActiveSeconds)
    totalActiveSeconds += activeOnDate
  }

  return Math.min(86400, Math.max(0, totalActiveSeconds))
}

