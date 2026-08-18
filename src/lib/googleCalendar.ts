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

export interface RawCalendarEvent {
  id: string
  calendarId: string
  calendarColor: string
  summary?: string
  start: { dateTime?: string; date?: string }
  end: { dateTime?: string; date?: string }
  htmlLink?: string
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
