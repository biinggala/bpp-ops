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
  description?: string
  location?: string
  start: { dateTime?: string; date?: string }
  end: { dateTime?: string; date?: string }
  htmlLink?: string
  attendees?: EventAttendee[]
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> }
}

/**
 * The key an event carries to say which task it belongs to.
 *
 * It lives on the event, in Google, rather than as a list of event ids on the
 * task — for two reasons. An event moved, renamed or cancelled in Google stays
 * correct on its own, with nothing here to go stale. And access follows the
 * calendar it sits on: a task shows the interviews *you* can see, which is what
 * people expect of a calendar, and is not what a shared list of everyone's
 * appointments in our own database would have been.
 *
 * `private` means private to this copy of the event — the app reads it back
 * through the `privateExtendedProperty` query, which is the only reason this
 * link is findable at all without storing anything on our side.
 */
export const TASK_LINK_KEY = 'bppTaskId'

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
  /** 회의실 이름. 조직 밖 사람도 이건 봅니다 — EventPatch.location 참고. */
  location?: string
  /** 아젠다와 회의록 링크. joinAgenda가 만드는 문자열입니다. */
  description?: string
  /** Local wall-clock ISO without a zone, e.g. "2026-08-18T14:00:00". */
  startDateTime: string
  endDateTime: string
  timeZone?: string
  /** Addresses to invite. Google emails each of them.  */
  attendees?: string[]
  /** The task this event belongs to, written into the event itself. */
  taskId?: string
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
        ...(event.location ? { location: event.location } : {}),
        ...(event.description ? { description: event.description } : {}),
        start: { dateTime: event.startDateTime, timeZone },
        end: { dateTime: event.endDateTime, timeZone },
        ...(event.attendees?.length ? { attendees: event.attendees.map(email => ({ email })) } : {}),
        ...(event.taskId ? { extendedProperties: { private: { [TASK_LINK_KEY]: event.taskId } } } : {}),
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
  /**
   * 회의실 이름이 여기 들어갑니다.
   *
   * 회의실 예약은 우리 데이터베이스에 있고, 그건 조직원만 읽습니다. 그런데
   * 프로젝트에는 도메인 밖 사람도 있고, 애초에 이 앱을 안 쓰는 사람도 있습니다.
   * 그들에게 '이 회의 어디서 하지'를 답해 줄 유일한 공통 자리가 구글 일정의
   * 장소 칸입니다. 예약은 우리가 관리하고, 결과는 모두가 보는 곳에 적습니다.
   */
  location?: string
  /** 아젠다와 회의록 링크. 빈 문자열은 '지운다'는 뜻이라 undefined와 다릅니다. */
  description?: string
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
  if (patch.location !== undefined) body.location = patch.location
  if (patch.description !== undefined) body.description = patch.description
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

/** 초대에 대한 대답. 미정은 '아마 간다'입니다 — 안 한 것과는 다릅니다. */
export type Rsvp = 'accepted' | 'declined' | 'tentative'

/**
 * ── 초대에 답하기 ────────────────────────────────────────────────────────────
 *
 * 구글에는 '내 응답만 바꾸기' 같은 전용 통로가 없습니다. 참석자 목록을 통째로
 * 다시 보내면서 내 칸의 responseStatus만 바꿔 넣는 게 방법입니다 — 그래서
 * **기존 목록을 그대로 들고 와야 합니다.** 내 것만 담아 보내면 나머지 참석자가
 * 일정에서 사라집니다. 회의에 답하려다 회의를 지우는 셈입니다.
 *
 * `sendUpdates`는 붙이지 않습니다(기본값 none). 붙일 수 있는 건 '전원'뿐이고,
 * 수락 한 번이 다른 열한 명에게 메일을 보내는 건 주최자가 자기 캘린더에서
 * 확인하는 것보다 나쁩니다. 응답 자체는 일정에 그대로 기록됩니다.
 */
export async function respondToEvent(
  token: string,
  calendarId: string,
  eventId: string,
  attendees: EventAttendee[],
  response: Rsvp,
): Promise<EventAttendee[]> {
  const next = attendees.map(a => (a.self ? { ...a, responseStatus: response } : a))
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      // 받아 온 참석자 항목을 **그대로** 돌려보냅니다. 필요한 것만 골라
      // 담으면 우리 타입에 없는 것들이 사라집니다 — 회의실(resource),
      // 선택 참석(optional), 표시 이름 같은 것들요. 우리 타입이 모른다고
      // 없는 값이 아니고, 지우면 회의에서 회의실이 빠집니다.
      body: JSON.stringify({ attendees: next }),
    },
  )
  if (res.status === 401) throw new Error(TOKEN_EXPIRED)
  if (res.status === 403) throw new Error('이 일정에 응답할 권한이 없습니다')
  if (!res.ok) {
    // 구글이 왜 거절했는지 그대로 보여 줍니다. '연동 오류' 같은 말로 덮으면
    // 인증 문제로 읽히고, 실제로는 인증이 멀쩡한데 다른 게 틀린 경우가
    // 대부분입니다.
    let detail = ''
    try {
      const body = await res.json() as { error?: { message?: string } }
      detail = body.error?.message ?? ''
    } catch { /* not JSON */ }
    throw new Error(detail ? `응답 실패: ${detail}` : `응답 실패 (${res.status})`)
  }
  return next
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

/**
 * The events on these calendars that carry a link to `taskId`.
 *
 * Asked of Google every time rather than cached anywhere: the answer depends on
 * which calendars the person reading can see, so it is not the same answer for
 * two people looking at the same task, and there is nowhere sensible to keep it.
 *
 * Bounded to the last year — an interview from three years ago is not what
 * anyone opened the task to find, and the query would otherwise walk the whole
 * calendar history.
 */
export async function fetchEventsForTask(
  token: string,
  calendars: GoogleCalendar[],
  taskId: string,
  signal?: AbortSignal,
): Promise<RawCalendarEvent[]> {
  const yearAgo = new Date()
  yearAgo.setFullYear(yearAgo.getFullYear() - 1)

  const one = async (calendar: GoogleCalendar) => {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events`
    )
    url.searchParams.set('privateExtendedProperty', `${TASK_LINK_KEY}=${taskId}`)
    url.searchParams.set('timeMin', yearAgo.toISOString())
    url.searchParams.set('singleEvents', 'true')
    url.searchParams.set('orderBy', 'startTime')
    url.searchParams.set('maxResults', '100')
    const data = await get(url.toString(), token, signal) as { items?: RawCalendarEvent[] }
    return (data.items ?? []).map(item => ({
      ...item, calendarId: calendar.id, calendarColor: calendar.backgroundColor,
    }))
  }

  const settled = await Promise.allSettled(calendars.map(one))
  if (settled.length && settled.every(r => r.status === 'rejected')) {
    const expired = settled.some(r => r.status === 'rejected' && (r.reason as Error)?.message === TOKEN_EXPIRED)
    if (expired) throw new Error(TOKEN_EXPIRED)
  }
  return settled
    .filter((r): r is PromiseFulfilledResult<RawCalendarEvent[]> => r.status === 'fulfilled')
    .flatMap(r => r.value)
}

/**
 * Free-text search across the chosen calendars, for attaching an event that
 * already exists — which is the common case. Nobody schedules a candidate
 * interview from a task board; they schedule it in Gmail, from the thread.
 */
export async function searchEvents(
  token: string,
  calendars: GoogleCalendar[],
  query: string,
  signal?: AbortSignal,
): Promise<RawCalendarEvent[]> {
  const from = new Date(); from.setDate(from.getDate() - 60)
  const to = new Date(); to.setDate(to.getDate() + 180)

  const one = async (calendar: GoogleCalendar) => {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events`
    )
    if (query.trim()) url.searchParams.set('q', query.trim())
    url.searchParams.set('timeMin', from.toISOString())
    url.searchParams.set('timeMax', to.toISOString())
    url.searchParams.set('singleEvents', 'true')
    url.searchParams.set('orderBy', 'startTime')
    url.searchParams.set('maxResults', '40')
    const data = await get(url.toString(), token, signal) as { items?: RawCalendarEvent[] }
    return (data.items ?? []).map(item => ({
      ...item, calendarId: calendar.id, calendarColor: calendar.backgroundColor,
    }))
  }

  const settled = await Promise.allSettled(calendars.map(one))
  return settled
    .filter((r): r is PromiseFulfilledResult<RawCalendarEvent[]> => r.status === 'fulfilled')
    .flatMap(r => r.value)
}

/**
 * Attaches an event to a task, or detaches it — the event itself is left alone
 * either way. Detaching a wrongly linked interview must not cancel it.
 *
 * Reads the event's existing private properties first and writes them back
 * merged, because a PATCH of `extendedProperties.private` replaces the whole
 * map: sending only our key would silently drop whatever else had been stored
 * there by anything else.
 */
export async function setEventTaskLink(
  token: string, calendarId: string, eventId: string, taskId: string | null,
): Promise<void> {
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
  const existing = await get(`${base}?fields=extendedProperties`, token) as
    { extendedProperties?: { private?: Record<string, string> } }

  const priv: Record<string, string | null> = { ...(existing.extendedProperties?.private ?? {}) }
  // null is how Google is told to remove a key; leaving it out would keep it.
  priv[TASK_LINK_KEY] = taskId

  const res = await fetch(base, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ extendedProperties: { private: priv } }),
  })
  if (res.status === 401) throw new Error(TOKEN_EXPIRED)
  if (res.status === 403) throw new Error('이 일정을 수정할 권한이 없습니다')
  if (!res.ok) throw new Error(`Calendar API ${res.status}`)
}

/** Calendars this account may actually add events to. */
/**
 * ── 아젠다와 회의록 링크 ─────────────────────────────────────────────────────
 *
 * 구글 일정에는 '회의록' 칸이 없습니다. 있는 건 설명 하나뿐이고, 그건 초대받은
 * 모두가 봅니다 — 우리 앱을 안 쓰는 사람, 도메인 밖 사람까지. 회의록 링크가
 * 있어야 할 자리는 정확히 거기입니다.
 *
 * 그래서 링크를 **설명의 첫 줄**에 고정된 모양으로 적습니다. 우리 데이터베이스에
 * 따로 들고 있지 않습니다 — 사본은 늙고, 구글에서 설명을 고친 사람과 앱에서
 * 고친 사람이 서로 다른 것을 보게 됩니다. 한 군데에만 있으면 그럴 일이 없습니다.
 *
 * 대신 첫 줄이 이 모양이 아니면 그냥 아젠다의 일부로 읽습니다. 구글 쪽에서
 * 자유롭게 고쳐도 글자가 사라지지는 않는다는 뜻입니다.
 */
const NOTES_MARK = '회의록: '

export function splitAgenda(description?: string): { notesUrl: string; agenda: string } {
  const text = description ?? ''
  const nl = text.indexOf('\n')
  const first = nl === -1 ? text : text.slice(0, nl)
  if (!first.startsWith(NOTES_MARK)) return { notesUrl: '', agenda: text }
  const url = first.slice(NOTES_MARK.length).trim()
  // 링크 줄 다음의 빈 줄은 우리가 넣은 것이라 다시 읽을 때 걷어냅니다.
  const rest = nl === -1 ? '' : text.slice(nl + 1).replace(/^\n/, '')
  return { notesUrl: url, agenda: rest }
}

export function joinAgenda(notesUrl: string, agenda: string): string {
  const url = notesUrl.trim()
  const body = agenda.trim()
  if (!url) return body
  return body ? `${NOTES_MARK}${url}\n\n${body}` : `${NOTES_MARK}${url}`
}

export function writableCalendars(calendars: GoogleCalendar[]): GoogleCalendar[] {
  return calendars.filter(c => c.accessRole === 'owner' || c.accessRole === 'writer')
}
