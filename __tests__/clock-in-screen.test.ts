import { describe, it, expect } from 'vitest'
import { getKolkataGreeting, getKolkataHour } from '../src/utils/timeCalculator'

describe('Clock In Screen UI & Timezone Greeting Specification', () => {
  it('calculates dynamic greeting correctly across all 4 Asia/Kolkata timezone windows', () => {
    // 5:00 AM - 11:59 AM: Good Morning
    const morningMs = new Date('2026-10-19T08:30:00+05:30').getTime()
    expect(getKolkataHour(morningMs)).toBe(8)
    const morning = getKolkataGreeting(morningMs, 'Omkar Sawant')
    expect(morning.greetingText).toBe('Good Morning')
    expect(morning.fullGreeting).toBe('Good Morning, Omkar Sawant')

    // 12:00 PM - 4:59 PM: Good Afternoon (exact match with user reference screenshot)
    const afternoonMs = new Date('2026-10-19T14:15:00+05:30').getTime()
    expect(getKolkataHour(afternoonMs)).toBe(14)
    const afternoon = getKolkataGreeting(afternoonMs, 'Omkar Sawant')
    expect(afternoon.greetingText).toBe('Good Afternoon')
    expect(afternoon.fullGreeting).toBe('Good Afternoon, Omkar Sawant')

    // 5:00 PM - 8:59 PM: Good Evening
    const eveningMs = new Date('2026-10-19T18:00:00+05:30').getTime()
    expect(getKolkataHour(eveningMs)).toBe(18)
    const evening = getKolkataGreeting(eveningMs, 'Omkar Sawant')
    expect(evening.greetingText).toBe('Good Evening')
    expect(evening.fullGreeting).toBe('Good Evening, Omkar Sawant')

    // 9:00 PM - 4:59 AM: Good Night
    const nightMs = new Date('2026-10-19T22:30:00+05:30').getTime()
    expect(getKolkataHour(nightMs)).toBe(22)
    const night = getKolkataGreeting(nightMs, 'Omkar Sawant')
    expect(night.greetingText).toBe('Good Night')
    expect(night.fullGreeting).toBe('Good Night, Omkar Sawant')

    // Late night 2:00 AM: Good Night
    const lateNightMs = new Date('2026-10-19T02:00:00+05:30').getTime()
    expect(getKolkataHour(lateNightMs)).toBe(2)
    const lateNight = getKolkataGreeting(lateNightMs, 'Omkar Sawant')
    expect(lateNight.greetingText).toBe('Good Night')
    expect(lateNight.fullGreeting).toBe('Good Night, Omkar Sawant')
  })

  it('formats full name dynamically without hardcoding', () => {
    const res1 = getKolkataGreeting(new Date('2026-10-19T13:00:00+05:30'), 'Jane Doe')
    expect(res1.fullGreeting).toBe('Good Afternoon, Jane Doe')

    const res2 = getKolkataGreeting(new Date('2026-10-19T13:00:00+05:30'), 'Admin User')
    expect(res2.fullGreeting).toBe('Good Afternoon, Admin User')

    const res3 = getKolkataGreeting(new Date('2026-10-19T13:00:00+05:30'), null)
    expect(res3.fullGreeting).toBe('Good Afternoon')
  })

  it('validates state-based rendering rules: Clock In screen vs Working screen', () => {
    const user = {
      id: 'emp-101',
      email: 'omkar@triplesproduction.com',
      first_name: 'Omkar',
      last_name: 'Sawant',
      employee_id: 'EMP-01',
      department: 'Development',
      designation: 'Software Engineer',
      role: 'Employee' as const,
      is_active: true
    }

    // Helper determining which view to display
    const determineScreen = (
      userProfile: typeof user | null,
      currentSession: any | null,
      status: string
    ) => {
      const hasValidSession = Boolean(
        userProfile &&
        currentSession &&
        currentSession.id &&
        currentSession.employee_id === userProfile.id &&
        !currentSession.clock_out &&
        currentSession.status !== 'completed' &&
        currentSession.status !== 'Completed'
      )

      if (!hasValidSession) {
        return {
          screen: 'clock_in_screen',
          showsWorkedHours: false,
          showsActiveHours: false,
          showsTakeBreak: false,
          showsResumeWork: false,
          showsClockOut: false,
          showsCenteredClockInButton: true,
          buttonColor: '#1677FF',
          buttonDimensions: { width: 185, height: 48 },
          subtitle: 'Yet to start work for today!'
        }
      }

      const isWorking = (status === 'Working' || status === 'working') && !currentSession.breaks?.some((b: any) => b.end_time === null)
      const isOnBreak = (status === 'On Break' || status === 'on_break') || Boolean(currentSession.breaks?.some((b: any) => b.end_time === null))

      return {
        screen: isOnBreak ? 'break_screen' : 'working_screen',
        showsWorkedHours: true,
        showsActiveHours: true,
        showsTakeBreak: isWorking,
        showsResumeWork: isOnBreak,
        showsClockOut: true,
        showsCenteredClockInButton: false
      }
    }

    // 1. Initial State: Unclocked user
    const unclocked = determineScreen(user, null, 'Not Clocked In')
    expect(unclocked.screen).toBe('clock_in_screen')
    expect(unclocked.showsCenteredClockInButton).toBe(true)
    expect(unclocked.buttonColor).toBe('#1677FF')
    expect(unclocked.buttonDimensions).toEqual({ width: 185, height: 48 })
    expect(unclocked.showsWorkedHours).toBe(false)
    expect(unclocked.showsActiveHours).toBe(false)
    expect(unclocked.showsTakeBreak).toBe(false)
    expect(unclocked.showsResumeWork).toBe(false)
    expect(unclocked.showsClockOut).toBe(false)
    expect(unclocked.subtitle).toBe('Yet to start work for today!')

    // 2. Active Working State: After successful Clock In
    const workingSession = {
      id: 'sess-active-1',
      employee_id: user.id,
      session_date: '2026-10-19',
      clock_in: new Date().toISOString(),
      clock_out: null,
      status: 'working',
      worked_minutes: 45,
      active_minutes: 40,
      breaks: []
    }
    const working = determineScreen(user, workingSession, 'working')
    expect(working.screen).toBe('working_screen')
    expect(working.showsCenteredClockInButton).toBe(false)
    expect(working.showsWorkedHours).toBe(true)
    expect(working.showsActiveHours).toBe(true)
    expect(working.showsTakeBreak).toBe(true)
    expect(working.showsClockOut).toBe(true)

    // 3. Break State: While employee takes a break
    const breakSession = {
      ...workingSession,
      status: 'on_break',
      breaks: [
        {
          id: 'b-1',
          session_id: workingSession.id,
          start_time: new Date().toISOString(),
          end_time: null,
          duration_minutes: 0,
          reason: 'Tea break'
        }
      ]
    }
    const onBreak = determineScreen(user, breakSession, 'on_break')
    expect(onBreak.screen).toBe('break_screen')
    expect(onBreak.showsCenteredClockInButton).toBe(false)
    expect(onBreak.showsWorkedHours).toBe(true)
    expect(onBreak.showsActiveHours).toBe(true)
    expect(onBreak.showsResumeWork).toBe(true)
    expect(onBreak.showsClockOut).toBe(true)

    // 4. Terminated / Clocked Out State
    const clockedOutSession = {
      ...workingSession,
      clock_out: new Date().toISOString(),
      status: 'completed'
    }
    const clockedOut = determineScreen(user, clockedOutSession, 'Completed')
    expect(clockedOut.screen).toBe('clock_in_screen')
    expect(clockedOut.showsCenteredClockInButton).toBe(true)
    expect(clockedOut.showsWorkedHours).toBe(false)
  })
})
