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
/**
 * 이 일정이 '회의'가 아니라 '내가 잡아 둔 시간'이라는 표시.
 *
 * 업무 id로는 구별이 안 됩니다 — 업무에서 잡은 진짜 회의에도 그게 붙으니까요.
 * 시간 축에서 둘을 다르게 그리려면 별개의 표시가 필요합니다.
 */
export const TIMEBLOCK_KEY = 'bppTimeblock'

/**
 * 체크박스 한 줄에서 온 블록이 **그 줄로 돌아가는 길**. `날짜|줄id` 한 덩어리.
 *
 * 업무 블록에는 taskId가 있어서 상태를 바꾸면 그 업무가 바뀝니다. 체크박스
 * 줄에는 가리킬 업무가 없어서 지금까지 블록의 네모가 눌리지 않는 그림이었고,
 * 시간을 잡아 둔 일을 끝내도 정작 노트의 그 줄은 안 눌린 채였습니다.
 *
 * 글자로 찾지 않습니다 — 같은 말이 두 줄이면 엉뚱한 줄이 눌리고, 줄을 고치면
 * 조용히 아무 일도 안 일어납니다. 줄에 id를 붙이고 그 id를 싣습니다.
 */
export const NOTE_LINK_KEY = 'bppNoteRef'

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

/**
 * ── 남의 캘린더 ──────────────────────────────────────────────────────────────
 *
 * 구글 워크스페이스 안에서는 두 가지가 가능한데, **어느 쪽이 되는지는 그
 * 사람의 공유 설정이 정합니다.**
 *
 *   상세까지    그 사람이 캘린더를 공유했거나 회사가 도메인 전체에 상세를
 *              열어 둔 경우. `events.list`가 그대로 됩니다.
 *   한가함/바쁨  그 외. 제목도 참석자도 안 옵니다 — 언제 찼는지만 옵니다.
 *              대부분의 회사 기본값이 이쪽입니다.
 *
 * 그래서 상세를 먼저 물어보고, 거절당하면 한가함/바쁨으로 내려갑니다. 구글
 * 캘린더가 하는 것과 같습니다 — 열려 있으면 제목이 보이고 아니면 '바쁨'입니다.
 *
 * **새 권한을 안 씁니다.** 캘린더 목록에 남을 끼워 넣는 길(`calendarList.insert`)
 * 도 있는데 그건 더 넓은 권한이 필요하고, 그러면 오십 명이 전부 다시 허락을
 * 눌러야 합니다. 읽기 권한만으로 되는 이 길을 씁니다.
 */
export interface BusySlot {
  /** ISO. 구글이 준 그대로. */
  start: string
  end: string
}

export async function fetchFreeBusy(
  token: string, emails: string[], from: string, to: string, signal?: AbortSignal,
): Promise<Record<string, BusySlot[]>> {
  if (!emails.length) return {}
  const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeMin: `${from}T00:00:00Z`,
      timeMax: `${to}T23:59:59Z`,
      items: emails.map(id => ({ id })),
    }),
    signal,
  })
  if (res.status === 401) throw new Error(TOKEN_EXPIRED)
  if (!res.ok) throw new Error(`Calendar API ${res.status}`)
  const data = await res.json() as {
    calendars?: Record<string, { busy?: BusySlot[]; errors?: { reason: string }[] }>
  }
  const out: Record<string, BusySlot[]> = {}
  for (const [id, entry] of Object.entries(data.calendars ?? {})) {
    // 못 읽는 사람은 빈 배열이 아니라 **아예 없는 것**으로 둡니다. 둘을 같게
    // 만들면 '그날 종일 비어 있다'와 '못 물어봤다'가 화면에서 같아 보입니다.
    if (entry.errors?.length) continue
    out[id] = entry.busy ?? []
  }
  return out
}

// ── 쓰기 ──────────────────────────────────────────────────────────────────────

export interface NewEvent {
  calendarId: string
  summary: string
  /** 회의실 이름. 조직 밖 사람도 이건 봅니다 — EventPatch.location 참고. */
  location?: string
  /** 아젠다와 회의록 링크. joinAgenda가 만드는 문자열입니다. */
  description?: string
  /**
   * Local wall-clock ISO without a zone, e.g. "2026-08-18T14:00:00".
   * `allDayDate`를 주면 안 씁니다.
   */
  startDateTime?: string
  endDateTime?: string
  timeZone?: string
  /** Addresses to invite. Google emails each of them.  */
  attendees?: string[]
  /** The task this event belongs to, written into the event itself. */
  taskId?: string
  /**
   * 'transparent'면 남의 '한가함/바쁨'에 안 잡힙니다.
   *
   * 회의는 바쁨입니다 — 그 시간에 다른 회의가 잡히면 안 되니까요. 타임블록은
   * 그렇게까지 하지 않습니다: 내 하루를 짜 두는 것이지 남에게 오지 말라고
   * 하는 것은 아니라서, 캘린더에는 보이되 남이 회의를 잡는 것은 막지
   * 않습니다.
   */
  transparency?: 'opaque' | 'transparent'
  /** 노트에서 끌어다 놓아 만든 시간. 회의와 다르게 그립니다. */
  timeblock?: boolean
  /** 이 블록이 온 체크박스 줄 — `날짜|줄id`. NOTE_LINK_KEY 참고. */
  noteRef?: string
  /**
   * 종일 일정. `YYYY-MM-DD` 하루.
   *
   * 월 화면의 날짜 칸에는 시각이 없습니다 — 칸 하나가 곧 하루입니다. 거기서
   * 만드는 일정에 억지로 시각을 붙이면(예: 늘 오후 2시) 아무도 안 정한 시간이
   * 캘린더에 사실처럼 적힙니다. 구글 캘린더도 그 자리에서는 종일로 만듭니다.
   */
  allDayDate?: string
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
/** `YYYY-MM-DD`의 다음 날. 종일 일정의 배타적 끝에 씁니다. */
function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + 1)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

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
        ...(event.allDayDate
          /*
            구글의 종일 일정은 **끝 날짜가 배타적**입니다 — 8월 19일 하루는
            end가 8월 20일입니다. 같은 날을 적으면 길이가 0인 일정이 되어
            어떤 화면에서는 아예 안 보입니다.
          */
          ? { start: { date: event.allDayDate }, end: { date: nextDay(event.allDayDate) } }
          : {
              start: { dateTime: event.startDateTime, timeZone },
              end: { dateTime: event.endDateTime, timeZone },
            }),
        ...(event.attendees?.length ? { attendees: event.attendees.map(email => ({ email })) } : {}),
        ...(event.taskId || event.timeblock || event.noteRef
          ? {
              extendedProperties: {
                private: {
                  ...(event.taskId ? { [TASK_LINK_KEY]: event.taskId } : {}),
                  ...(event.timeblock ? { [TIMEBLOCK_KEY]: '1' } : {}),
                  ...(event.noteRef ? { [NOTE_LINK_KEY]: event.noteRef } : {}),
                },
              },
            }
          : {}),
        ...(event.transparency ? { transparency: event.transparency } : {}),
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
  /**
   * 종일 일정의 날짜. `startDateTime`과 **같이 보내면 안 됩니다** — 구글은
   * 하나만 받습니다.
   *
   * 종일 일정은 시간이 아니라 날짜로 삽니다. 시간 있는 일정의 모양으로
   * 고치려 하면 구글이 거절합니다. 달력에서 끌어 옮기는 것은 종일 쪽이
   * 오히려 흔해서(휴가, 출장, 마감일) 이 칸이 필요합니다.
   *
   * **끝 날짜는 하루 뒤입니다.** 구글에서 종일 일정의 end는 안 포함하는
   * 값이라, 8월 26일 하루짜리는 end가 8월 27일입니다.
   */
  startDate?: string
  endDate?: string
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
  // 종일 쪽. dateTime과 섞어 보내지 않습니다 — 부르는 쪽이 둘 중 하나만
  // 채웁니다(EventPatch 주석).
  if (patch.startDate) body.start = { date: patch.startDate }
  if (patch.endDate) body.end = { date: patch.endDate }
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
