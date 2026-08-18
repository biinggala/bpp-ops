// Google Calendar API calls. Ported from the noteplan-clone repository, which
// already had multi-calendar reading working; the functions there take an access
// token and nothing else, so none of its Supabase wiring came along.
//
// Everything here is a plain fetch: getting and refreshing the token is the
// caller's problem (see gcalStore).

export interface GoogleCalendar {
  id: string
  summary: string
  backgroundColor: string
  primary?: boolean
  accessRole?: string
}

export interface EventAttendee {
  email: string
  /** "needsAction" | "accepted" | "declined" | "tentative" */
  responseStatus?: string
  organizer?: boolean
  self?: boolean
}

export interface RawCalendarEvent {
  id: string
  calendarId: string
  calendarColor: string
  summary?: string
  start: { dateTime?: string; date?: string }
  end: { dateTime?: string; date?: string }
  htmlLink?: string
  attendees?: EventAttendee[]
}

/** Signals that the token is no longer good, so callers can stop and reconnect. */
export const TOKEN_EXPIRED = 'GOOGLE_TOKEN_EXPIRED'

async function get(url: string, token: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal })
  if (res.status === 401) throw new Error(TOKEN_EXPIRED)
  if (!res.ok) throw new Error(`Calendar API ${res.status}`)
  return res.json()
}

/**
 * Every calendar the account can read, not just its own.
 *
 * The app used to read `calendars/primary` alone, which meant a shared team
 * calendar — the obvious place to put things everyone should see — was
 * invisible no matter how the connection was set up.
 */
export async function fetchCalendarList(token: string, signal?: AbortSignal): Promise<GoogleCalendar[]> {
  const data = await get(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader',
    token, signal,
  ) as { items?: GoogleCalendar[] }
  return (data.items ?? []).map(c => ({
    id: c.id,
    summary: c.summary,
    backgroundColor: c.backgroundColor || '#4285f4',
    primary: c.primary,
    accessRole: c.accessRole,
  }))
}

export async function fetchEventsForRange(
  token: string,
  calendar: GoogleCalendar,
  from: string,   // YYYY-MM-DD
  to: string,     // YYYY-MM-DD, inclusive
  signal?: AbortSignal,
): Promise<RawCalendarEvent[]> {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events`
  )
  url.searchParams.set('timeMin', `${from}T00:00:00Z`)
  url.searchParams.set('timeMax', `${to}T23:59:59Z`)
  url.searchParams.set('singleEvents', 'true')
  url.searchParams.set('orderBy', 'startTime')
  url.searchParams.set('maxResults', '500')

  const data = await get(url.toString(), token, signal) as { items?: RawCalendarEvent[] }
  return (data.items ?? []).map(item => ({
    ...item,
    calendarId: calendar.id,
    calendarColor: calendar.backgroundColor,
  }))
}

/**
 * Reads the chosen calendars at once.
 *
 * One calendar failing must not blank the whole view — a shared calendar can be
 * revoked without warning — so failures are dropped per calendar, except an
 * expired token, which is worth surfacing because every calendar will fail.
 */
export async function fetchEventsAcross(
  token: string,
  calendars: GoogleCalendar[],
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<RawCalendarEvent[]> {
  const settled = await Promise.allSettled(
    calendars.map(c => fetchEventsForRange(token, c, from, to, signal))
  )
  if (settled.every(r => r.status === 'rejected')) {
    const expired = settled.some(r => r.status === 'rejected' && (r.reason as Error)?.message === TOKEN_EXPIRED)
    if (expired) throw new Error(TOKEN_EXPIRED)
  }
  return settled
    .filter((r): r is PromiseFulfilledResult<RawCalendarEvent[]> => r.status === 'fulfilled')
    .flatMap(r => r.value)
}

// ── 쓰기 ──────────────────────────────────────────────────────────────────────

export interface NewEvent {
  calendarId: string
  summary: string
  /** Local wall-clock ISO without a zone, e.g. "2026-08-18T14:00:00". */
  startDateTime: string
  endDateTime: string
  timeZone?: string
  /** Addresses to invite. Google emails each of them.  */
  attendees?: string[]
}

/**
 * Google only notifies guests when asked to.
 *
 * Inviting someone without telling them defeats the point, so any request that
 * carries guests asks for the mail to go out.
 */
function sendUpdatesParam(attendees: string[] | undefined): string {
  return attendees?.length ? '?sendUpdates=all' : ''
}

/**
 * Creates a timed event.
 *
 * The times are sent as local wall-clock plus an explicit zone rather than UTC,
 * so an event dragged onto 2pm reads as 2pm to everyone in that zone regardless
 * of where it was created.
 */
export async function createCalendarEvent(token: string, event: NewEvent): Promise<RawCalendarEvent> {
  const timeZone = event.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(event.calendarId)}/events${sendUpdatesParam(event.attendees)}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: event.summary,
        start: { dateTime: event.startDateTime, timeZone },
        end: { dateTime: event.endDateTime, timeZone },
        ...(event.attendees?.length ? { attendees: event.attendees.map(email => ({ email })) } : {}),
      }),
    }
  )
  if (res.status === 401) throw new Error(TOKEN_EXPIRED)
  if (res.status === 403) throw new Error('이 캘린더에 일정을 만들 권한이 없습니다')
  if (!res.ok) throw new Error(`Calendar API ${res.status}`)
  const created = await res.json() as RawCalendarEvent
  return { ...created, calendarId: event.calendarId, calendarColor: '' }
}

export interface EventPatch {
  summary?: string
  startDateTime?: string
  endDateTime?: string
  timeZone?: string
  attendees?: string[]
}

/** PATCH, so fields that are not being changed are left exactly as they were. */
export async function updateCalendarEvent(
  token: string, calendarId: string, eventId: string, patch: EventPatch,
): Promise<void> {
  const timeZone = patch.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const body: Record<string, unknown> = {}
  if (patch.summary !== undefined) body.summary = patch.summary
  if (patch.startDateTime) body.start = { dateTime: patch.startDateTime, timeZone }
  if (patch.endDateTime) body.end = { dateTime: patch.endDateTime, timeZone }
  if (patch.attendees) body.attendees = patch.attendees.map(email => ({ email }))

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}${sendUpdatesParam(patch.attendees)}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
  if (res.status === 401) throw new Error(TOKEN_EXPIRED)
  if (res.status === 403) throw new Error('이 일정을 수정할 권한이 없습니다')
  if (!res.ok) throw new Error(`Calendar API ${res.status}`)
}

export async function deleteCalendarEvent(token: string, calendarId: string, eventId: string): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
  )
  if (res.status === 401) throw new Error(TOKEN_EXPIRED)
  // 410 means it is already gone, which is the outcome the caller wanted.
  if (!res.ok && res.status !== 410 && res.status !== 404) throw new Error(`Calendar API ${res.status}`)
}

/** Calendars this account may actually add events to. */
export function writableCalendars(calendars: GoogleCalendar[]): GoogleCalendar[] {
  return calendars.filter(c => c.accessRole === 'owner' || c.accessRole === 'writer')
}
