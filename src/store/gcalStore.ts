import { create } from 'zustand'
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth'
import { auth } from '../lib/firebase'
import { requestGoogleToken, prepareGoogleAuthz, AuthzError, GIS_CONFIGURED } from '../lib/googleAuthz'
import { isDesktopShell, forgetStoredGrant } from '../lib/desktopAuth'
import { askConfirm } from '../components/shared/Confirm'
import { fetchCalendarList, fetchEventsAcross, fetchEventsForRange, fetchFreeBusy, fetchEventsForTask, searchEvents, setEventTaskLink, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, respondToEvent, type Rsvp, writableCalendars, TASK_LINK_KEY, TIMEBLOCK_KEY, NOTE_LINK_KEY, TOKEN_EXPIRED, type GoogleCalendar, type RawCalendarEvent, type EventAttendee } from '../lib/googleCalendar'

export interface GCalEvent {
  id: string
  summary: string
  /** 구글 일정의 장소. 회의실을 잡으면 방 이름이 여기 적힙니다. */
  location?: string
  /**
   * 구글 일정의 설명. 아젠다와 회의록 링크가 여기 삽니다 — 초대받은 모두가
   * 보는 유일한 칸이라서요. splitAgenda/joinAgenda 참고.
   */
  description?: string
  start: string      // YYYY-MM-DD
  end: string        // YYYY-MM-DD
  startTime?: string // e.g. "9:30am", "8pm" — only for timed (non-all-day) events
  allDay: boolean
  htmlLink: string
  calendarId: string
  calendarColor: string
  /** Exact start/end, kept for the timeline. Absent for all-day entries. */
  startIso?: string
  endIso?: string
  attendees?: EventAttendee[]
  /** The task this event belongs to, as recorded on the event in Google. */
  taskId?: string
  /** 노트에서 끌어다 놓아 만든 시간. 회의와 다르게 그립니다. */
  isBlock?: boolean
  /** 체크박스 한 줄에서 왔다면, 그 줄로 돌아가는 길 — `날짜|줄id`. */
  noteRef?: string
  /**
   * 남의 일정이면 그 사람의 주소.
   *
   * 이게 있으면 **읽기 전용**입니다 — 끌 수도, 눌러서 고칠 수도 없습니다.
   * 내 일정과 같은 배열에 섞지 않는 이유이기도 합니다: 섞으면 고치는 길들이
   * 전부 '내 것인지' 한 번씩 더 물어봐야 하고, 한 군데만 빠뜨리면 남의
   * 회의를 옮기게 됩니다.
   */
  peekOf?: string
  /** 한가함/바쁨으로만 받아 온 것. 제목이 없습니다. */
  busyOnly?: boolean
}

/**
 * ── 아직 대답 안 한 일정 ─────────────────────────────────────────────────────
 *
 * 초대만 받아 놓고 수락도 거절도 안 한 일정은 **아직 내 일정이 아닙니다.**
 * 그런데 화면에서는 확정된 회의와 똑같이 칠해져 있었습니다 — 오늘 오후가 꽉
 * 차 보이는데 그중 절반은 내가 갈지 안 갈지도 모르는 것들인 거죠.
 *
 * 그래서 맥 캘린더가 하는 것과 같은 표시를 씁니다: **점선 테두리, 채우기
 * 없음.** 색은 그대로 둡니다 — 어느 캘린더 것인지는 여전히 알아야 하고,
 * 바뀌는 건 '확정인가' 하나뿐입니다. 확정된 것만 면으로 칠해져 있으면 오늘이
 * 실제로 얼마나 찼는지가 한눈에 보입니다.
 *
 * `tentative`(미정)는 여기 안 넣습니다. 그건 대답을 안 한 게 아니라 '아마
 * 간다'고 대답한 것이고, 대답한 것과 안 한 것은 다른 상태입니다.
 *
 * 참석자가 없는 일정 — 내가 만든 것, 혼자 쓰는 시간 블록 — 은 대답할 것이
 * 없으므로 늘 확정입니다.
 */
export function awaitingMe(event: { attendees?: EventAttendee[] }): boolean {
  const me = myAttendance(event)
  return !!me && (me.responseStatus ?? 'needsAction') === 'needsAction'
}

/**
 * 내가 **답해야 하는** 참석자 항목. 없으면 답할 일이 없습니다.
 *
 * 주최자는 뺍니다. 구글은 내가 만든 일정에도 내 참석자 항목을 넣고
 * `organizer: true, responseStatus: 'accepted'`로 표시하는데, 그걸 그대로
 * 읽으면 내가 부른 회의에 나에게 '수락/미정/거절'을 묻게 됩니다. 내가 만든
 * 회의에 내가 갈지 안 갈지는 물을 일이 아닙니다 — 안 가면 회의를 옮기거나
 * 없애는 것이고, 그건 다른 버튼입니다.
 *
 * 참석자가 아예 없는 일정(혼자 쓰는 시간 블록)도 여기서 null입니다.
 */
export function myAttendance(event: { attendees?: EventAttendee[] }): EventAttendee | null {
  const me = event.attendees?.find(a => a.self)
  if (!me || me.organizer) return null
  return me
}

const ENABLED_KEY = 'gcal_enabled_calendars'
const PEEK_KEY = 'gcal_peeking'

/** 남의 일정을 그리는 색. 내 캘린더 색들과 안 겹치게 회색 계열 하나로. */
export const PEEK_COLOR = '#787774'

function loadPeeking(): string[] {
  try {
    const raw = localStorage.getItem(PEEK_KEY)
    return raw ? JSON.parse(raw) as string[] : []
  } catch { return [] }
}

/** 한가함/바쁨 한 칸을 일정 하나로. 제목이 없다는 것을 그대로 들고 갑니다. */
function busyToEvent(email: string, slot: { start: string; end: string }, i: number): GCalEvent {
  const day = slot.start.slice(0, 10)
  return {
    id: `busy:${email}:${slot.start}:${i}`,
    summary: '바쁨',
    start: day,
    end: slot.end.slice(0, 10) || day,
    allDay: false,
    htmlLink: '',
    calendarId: email,
    calendarColor: PEEK_COLOR,
    startIso: slot.start,
    endIso: slot.end,
    peekOf: email,
    busyOnly: true,
  }
}

/**
 * How far either side of the asked-for range to fetch.
 *
 * Every range switch used to be its own round trip — day view fetched one day,
 * then week refetched seven, then month refetched a month, each one throwing the
 * previous result away. Fetching a generous window once means switching between
 * 일/3일/주/월 around the same date touches the network not at all.
 */
const PAD_DAYS = 45

/** Beyond this the cached window is refetched, so a stale calendar catches up. */
const STALE_MS = 5 * 60 * 1000

function shiftDate(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function loadEnabled(): string[] | null {
  try {
    const raw = localStorage.getItem(ENABLED_KEY)
    return raw ? JSON.parse(raw) as string[] : null
  } catch { return null }
}

interface GCalState {
  token: string | null
  expiry: number | null
  wasConnected: boolean   // persists in localStorage; survives token expiry
  autoRefreshing: boolean // true while silent background reconnect is in progress
  events: GCalEvent[]
  /** Every calendar the account can read, not just its own. */
  calendars: GoogleCalendar[]
  /** Which of them to show. null until the list has been read once. */
  enabledCalendarIds: string[] | null
  /** Whether the stored token carries permission to add events. */
  canWrite: boolean
  /** Calendar new events are added to. */
  targetCalendarId: string | null
  /**
   * 지금 같이 들여다보고 있는 사람들 — 주소.
   *
   * 이 기기에 남습니다(`enabledCalendarIds`와 같은 자리). 누구 일정을 켜
   * 두는지는 지금 뭘 하고 있느냐에 붙는 것이지 계정에 붙는 취향이 아닙니다.
   */
  peeking: string[]
  /** 그 사람들의 일정. 내 것과 **섞지 않습니다** — GCalEvent.peekOf 참고. */
  peekEvents: GCalEvent[]
  peekLoading: boolean
  setPeeking: (email: string, on: boolean) => void
  /** 켜 둔 사람들의 그 기간 일정을 다시 읽습니다. */
  fetchPeek: (from: string, to: string) => Promise<void>
  /** The span currently held in `events`, and when it was read. */
  loadedFrom: string | null
  loadedTo: string | null
  fetchedAt: number
  loading: boolean
  error: string | null
  connect: () => Promise<void>
  disconnect: () => void
  fetchCalendars: () => Promise<void>
  setCalendarEnabled: (id: string, on: boolean) => void
  /** Loads the range if the cached window does not already cover it. */
  ensureEvents: (from: string, to: string) => Promise<void>
  /** Refetches the cached window regardless of age. */
  refreshEvents: () => Promise<void>
  fetchEvents: (from: string, to: string) => Promise<void>
  autoReconnect: () => Promise<void>
  setTargetCalendar: (id: string) => void
  /** Creates an event, asking for write permission the first time. */
  /** 만들어진 일정의 id(캘린더id:일정id). 실패하면 null. */
  createEvent: (input: { summary: string; location?: string; description?: string; startDateTime: string; endDateTime: string; attendees?: string[]; taskId?: string; transparency?: 'opaque' | 'transparent'; timeblock?: boolean; noteRef?: string }) => Promise<string | null>
  /** The events linked to a task, as this person's calendars have them. */
  eventsForTask: (taskId: string) => Promise<GCalEvent[]>
  /** Events to choose from when attaching one that already exists. */
  findLinkableEvents: (query: string) => Promise<GCalEvent[]>
  /** Attaches or detaches an event. The event itself is never touched. */
  setEventTask: (eventId: string, taskId: string | null) => Promise<boolean>
  /** 되돌릴 수 있는 시간 변경들. 가장 최근 것이 뒤에 있습니다. */
  history: CalUndo[]
  undoLast: () => Promise<void>
  updateEvent: (eventId: string, patch: { summary?: string; location?: string; description?: string; startDateTime?: string; endDateTime?: string; startDate?: string; endDate?: string; attendees?: string[] }) => Promise<boolean>
  /** 초대에 수락·미정·거절로 답합니다. */
  respond: (eventId: string, response: Rsvp) => Promise<boolean>
  removeEvent: (eventId: string) => Promise<void>
}

/**
 * 구글이 아는 일정 id.
 *
 * 우리가 들고 있는 id는 `캘린더id:일정id`입니다 — 캘린더가 여러 개고, 서로
 * 다른 캘린더에 같은 일정 id가 있을 수 있어서 앞에 캘린더를 붙여 둔 것입니다.
 * 구글에게 물을 때는 뒤쪽만 보내야 합니다.
 *
 * 이걸 함수로 뺀 이유: 부르는 곳마다 `slice(calendarId.length + 1)`을 손으로
 * 쓰고 있었고, 새로 붙인 '초대 응답'에서 그걸 빼먹었습니다. 그러면 구글은
 * 없는 일정을 찾다 오류를 내고, 화면에는 '연동 오류'로 보입니다 — 원인이
 * 인증인 것처럼요. 한 곳에 두면 다음에 또 빼먹을 자리가 없습니다.
 */
function bareEventId(event: { id: string; calendarId: string }): string {
  return event.id.slice(event.calendarId.length + 1)
}

/** Google returns dates two ways; the views want plain YYYY-MM-DD either way. */
function toGCalEvent(item: RawCalendarEvent): GCalEvent | null {
  const allDay = !!item.start?.date
  const start = allDay ? item.start.date! : item.start?.dateTime?.slice(0, 10) ?? ''
  if (!start) return null

  let end = allDay ? (item.end?.date ?? start) : (item.end?.dateTime?.slice(0, 10) ?? start)
  // An all-day event's end is exclusive, so a one-day event ends the next day.
  if (allDay && end > start) {
    const d = new Date(end + 'T00:00:00')
    d.setDate(d.getDate() - 1)
    end = d.toISOString().slice(0, 10)
  }
  if (end < start) end = start

  let startTime: string | undefined
  if (!allDay && item.start?.dateTime) {
    const d = new Date(item.start.dateTime)
    const h = d.getHours(), m = d.getMinutes()
    const ampm = h >= 12 ? 'pm' : 'am'
    const h12 = h % 12 || 12
    startTime = m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`
  }
  return {
    id: `${item.calendarId}:${item.id}`,
    summary: item.summary ?? '(제목 없음)',
    start, end, startTime, allDay,
    htmlLink: item.htmlLink ?? '',
    calendarId: item.calendarId,
    calendarColor: item.calendarColor,
    startIso: item.start?.dateTime,
    endIso: item.end?.dateTime,
    location: item.location,
    description: item.description,
    attendees: item.attendees,
    taskId: item.extendedProperties?.private?.[TASK_LINK_KEY],
    isBlock: item.extendedProperties?.private?.[TIMEBLOCK_KEY] === '1',
    noteRef: item.extendedProperties?.private?.[NOTE_LINK_KEY],
  }
}

function loadStored(): { token: string | null; expiry: number | null; wasConnected: boolean } {
  try {
    const wasConnected = localStorage.getItem('gcal_connected') === '1'
    const token = localStorage.getItem('gcal_token')
    const expiry = Number(localStorage.getItem('gcal_expiry') ?? 0)
    if (token && expiry > Date.now()) return { token, expiry, wasConnected }
    return { token: null, expiry: null, wasConnected }
  } catch { /* ignore */ }
  return { token: null, expiry: null, wasConnected: false }
}

/**
 * ── 캘린더 쪽 되돌리기 ───────────────────────────────────────────────────────
 *
 * 타임블록을 잘못 옮기는 일은 흔합니다 — 15분 눈금이라 손이 조금만 흔들려도
 * 한 칸 밀리고, 그때 원래 몇 시였는지는 이미 화면에 없습니다. 업무 쪽에는
 * ⌘Z가 있는데 여기만 없으면, 같은 화면에서 어떤 것은 되돌아가고 어떤 것은
 * 안 되돌아갑니다.
 *
 * 스토어를 합치지는 않았습니다. 되돌리는 방법이 서로 다르니까요 — 저쪽은
 * 우리 DB에 다시 쓰고 이쪽은 구글에 다시 물어봅니다. 대신 쌓인 시각을 같이
 * 적어 두고, ⌘Z가 **둘 중 더 최근 것**을 고릅니다(AppPage).
 */
export type CalUndo =
  /** 옮기기·길이 조절을 되돌립니다. 값은 그 전의 시각. */
  | { at: number; kind: 'time'; eventId: string; startDateTime: string; endDateTime: string }
  /**
   * 종일 일정을 되돌립니다. 값은 그 전의 날짜.
   *
   * 시각으로 되돌리면 안 됩니다 — 구글은 종일 일정을 날짜로만 받고, 시각
   * 모양을 보내면 종일이 아닌 일정으로 바뀝니다. 되돌리려다 종류를
   * 바꿔 놓는 셈입니다.
   */
  | { at: number; kind: 'time'; eventId: string; startDate: string; endDate: string }
  /**
   * 방금 만든 타임블록을 되돌립니다 — 지웁니다.
   *
   * 타임블록만입니다. 회의는 사람을 부르는 일이라 초대 메일이 이미 나가 있고,
   * ⌘Z 한 번에 조용히 사라지면 받은 사람은 취소 메일만 보게 됩니다. 그건
   * 되돌리기가 아니라 통보라, 지우는 버튼으로 분명히 해야 하는 일입니다.
   */
  | { at: number; kind: 'create'; eventId: string }

/**
 * 구글의 '안 포함하는' 종일 끝 날짜를 우리가 쓰는 '포함하는' 날짜로.
 *
 * toGCalEvent가 읽을 때 하는 것과 같은 일입니다. 화면을 먼저 바꾸는 자리에서도
 * 같은 변환이 필요해서 이름을 붙여 꺼냈습니다.
 */
function inclusiveEnd(start: string, exclusiveEnd: string): string {
  if (exclusiveEnd <= start) return start
  const d = new Date(exclusiveEnd + 'T00:00:00')
  d.setDate(d.getDate() - 1)
  const pad = (n: number) => String(n).padStart(2, '0')
  const out = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return out < start ? start : out
}

/** 구글이 준 ISO를 이 컴퓨터의 벽시계 문자열로. 쓰기 API가 받는 모양입니다. */
function wallClock(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
}

const MAX_CAL_HISTORY = 30

/** 되돌리는 중. 그동안의 변경은 스택에 안 쌓습니다 — undoLast 참고. */
let undoing = false

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'
const CALENDAR_WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const WRITE_KEY = 'gcal_can_write'
const TARGET_KEY = 'gcal_target_calendar'

/**
 * Read and write are asked for together, at connect.
 *
 * They used to be split: connect asked to read, and the first event somebody
 * created widened the grant. It read well on paper — most people only look at
 * the calendar — but the widening lands in the middle of the one action where
 * an interruption costs most. In the desktop shell it is not even a quiet
 * dialog: the consent screen cannot open in the webview, so the system browser
 * takes over the screen, sometimes asking to sign in again first, and the
 * person who was typing an event title is suddenly somewhere else. Writing an
 * event is the point of connecting a calendar here, so it belongs in the same
 * consent as reading one.
 */
const FULL_SCOPE = `${CALENDAR_SCOPE} ${CALENDAR_WRITE_SCOPE}`

/**
 * Gets the Google client ready before the 연동 button is pressed.
 *
 * Called when that button appears. Without it the first press spends its own
 * permission to open a window on loading the script instead — which is exactly
 * why this never worked on a phone.
 */
export function warmCalendarAuth(): void {
  void prepareGoogleAuthz(FULL_SCOPE)
}

function loadWrite(): boolean {
  try { return localStorage.getItem(WRITE_KEY) === '1' } catch { return false }
}

/** Trust Google's own lifetime, minus a minute so a request never races expiry. */
function storeToken(token: string, expiresInSeconds = 3500) {
  const expiry = Date.now() + Math.max(60, expiresInSeconds - 60) * 1000
  localStorage.setItem('gcal_token', token)
  localStorage.setItem('gcal_expiry', String(expiry))
  return expiry
}

type Setter = (partial: Partial<GCalState>) => void

/**
 * Returns a token that may write.
 *
 * Three paths, cheapest first: the token in hand, a silent renewal, and only
 * then a window. Any window has to be reached from a click — a popup with no
 * gesture behind it is blocked — and it is announced before it opens.
 */
/**
 * A live token for reading, renewed silently if the one in hand has lapsed.
 *
 * Never opens a window: every caller is a background read that a person did not
 * ask for directly, and a consent screen appearing because a task detail was
 * opened would be worse than the read failing.
 */
async function ensureReadToken(get: () => GCalState, set: Setter): Promise<string | null> {
  const { token, expiry } = get()
  if (token && expiry && expiry > Date.now()) return token
  // autoReconnect refuses to run while a token is held, so the lapsed one has to
  // go first — otherwise this hands back the very token that just expired.
  if (token) {
    localStorage.removeItem('gcal_token')
    localStorage.removeItem('gcal_expiry')
    set({ token: null, expiry: null })
  }
  await get().autoReconnect()
  return get().token
}

/** The calendars this person has ticked, reading the list first if need be. */
async function activeCalendars(get: () => GCalState): Promise<GoogleCalendar[]> {
  if (!get().calendars.length) await get().fetchCalendars()
  const enabled = get().enabledCalendarIds ?? get().calendars.map(c => c.id)
  return get().calendars.filter(c => enabled.includes(c.id))
}

async function ensureWriteToken(get: () => GCalState, set: Setter): Promise<string | null> {
  if (get().canWrite && get().token) return get().token
  const hint = auth.currentUser?.email ?? undefined

  // Granted already, just no live token in hand — renew without asking anyone.
  // The desktop shell redeems its stored refresh token; in the browser GIS
  // re-issues while the Google session lasts. No window either way.
  //
  // Skipping this was the other half of "갑자기 로그인 한 번 더": an hour after
  // connecting, saving an event went straight to an interactive request, which
  // in the browser means a consent screen and in the shell means the system
  // browser — for permission that had already been given.
  if (get().canWrite) {
    try {
      const granted = await requestGoogleToken({ scope: FULL_SCOPE, interactive: false, hint })
      const expiry = storeToken(granted.token, granted.expiresIn)
      set({ token: granted.token, expiry, error: null })
      return granted.token
    } catch { /* the Google session has lapsed — a click is the only way through */ }
  }

  // Everything past here needs a window: either the first write grant (only
  // people who connected before the scopes were merged reach that) or a lapsed
  // session. Say so first, rather than letting the browser take the screen
  // mid-sentence.
  const proceed = await askConfirm({
    message: get().canWrite
      ? '구글 로그인이 만료됐습니다. 다시 인증할까요?'
      : '캘린더에 일정을 만들 권한을 한 번 허용해야 합니다',
    detail: isDesktopShell()
      ? '브라우저가 열립니다. 끝나면 앱으로 돌아와 그대로 저장됩니다.'
      : '구글 창이 열립니다. 끝나면 그대로 저장됩니다.',
    confirmLabel: get().canWrite ? '다시 인증' : '권한 허용하기',
    danger: false,
  })
  if (!proceed) return null

  try {
    const granted = await requestGoogleToken({ scope: FULL_SCOPE, interactive: true, hint })
    const expiry = storeToken(granted.token, granted.expiresIn)
    localStorage.setItem(WRITE_KEY, '1')
    set({ token: granted.token, expiry, canWrite: true, error: null })
    return granted.token
  } catch {
    set({ error: '캘린더에 쓰려면 권한이 필요합니다' })
    return null
  }
}

export const useGCalStore = create<GCalState>((set, get) => ({
  ...loadStored(),
  autoRefreshing: false,
  events: [],
  history: [],
  calendars: [],
  enabledCalendarIds: loadEnabled(),
  peeking: loadPeeking(),
  peekEvents: [],
  peekLoading: false,
  canWrite: loadWrite(),
  targetCalendarId: (() => { try { return localStorage.getItem(TARGET_KEY) } catch { return null } })(),
  loadedFrom: null,
  loadedTo: null,
  fetchedAt: 0,
  loading: false,
  error: null,

  // Asks for calendar access. GIS handles this on its own; the Firebase popup is
  // only still here for the case where no web client id has been configured yet.
  connect: async () => {
    set({ error: null, loading: true })
    try {
      if (GIS_CONFIGURED) {
        try {
          const granted = await requestGoogleToken({
            scope: FULL_SCOPE,
            interactive: true,
            hint: auth.currentUser?.email ?? undefined,
          })
          const expiry = storeToken(granted.token, granted.expiresIn)
          localStorage.setItem('gcal_connected', '1')
          localStorage.setItem(WRITE_KEY, '1')
          set({ token: granted.token, expiry, wasConnected: true, canWrite: true, loading: false, error: null })
          return
        } catch (gisError) {
          // In the desktop shell there is nothing to fall through to: the popup
          // below is a Google sign-in page, and Google refuses those inside an
          // embedded webview. Falling through only replaced the real reason with
          // a meaningless one, which is what "다시 연동 눌러도 안 됨" looked like.
          if (isDesktopShell()) throw gisError
          // Nor is there when the browser blocked the window: the fallback is
          // another window, which is blocked for the same reason, and the second
          // failure is the one whose message gets shown. Say what happened.
          if (gisError instanceof AuthzError && gisError.message.includes('막았습니다')) throw gisError
          // In a browser, GIS refuses if the site is not listed as an authorised
          // origin on the client, among other setup problems. Connecting still
          // has to work, so fall through to the old popup.
          console.warn('[gcal] GIS 연동 실패, 기존 방식으로 시도합니다', gisError)
        }
      }

      const provider = new GoogleAuthProvider()
      provider.addScope(CALENDAR_SCOPE)
      provider.addScope(CALENDAR_WRITE_SCOPE)
      provider.setCustomParameters({ prompt: 'consent', access_type: 'online' })
      const result = await signInWithPopup(auth, provider)
      const credential = GoogleAuthProvider.credentialFromResult(result)
      const token = credential?.accessToken
      if (!token) throw new Error('액세스 토큰을 받지 못했습니다')
      const expiry = storeToken(token)
      localStorage.setItem('gcal_connected', '1')
      localStorage.setItem(WRITE_KEY, '1')
      set({ token, expiry, wasConnected: true, canWrite: true, loading: false, error: null })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '구글 캘린더 연동 오류'
      const isCancel = msg.includes('popup-closed') || msg.includes('cancelled') || msg.includes('취소')
      set({ loading: false, error: isCancel ? null : msg })
    }
  },

  disconnect: () => {
    // The desktop shell holds a refresh token of its own; leaving it behind
    // would make "연동 해제" reconnect silently on the next reload.
    if (isDesktopShell()) void forgetStoredGrant(FULL_SCOPE)
    localStorage.removeItem('gcal_token')
    localStorage.removeItem('gcal_expiry')
    localStorage.removeItem('gcal_connected')
    localStorage.removeItem(ENABLED_KEY)
    localStorage.removeItem(WRITE_KEY)
    set({ token: null, expiry: null, wasConnected: false, events: [], calendars: [], enabledCalendarIds: null, canWrite: false, error: null, loadedFrom: null, loadedTo: null, fetchedAt: 0 })
  },

  /**
   * Renews the token without asking. Runs on load and whenever a request finds
   * the token gone.
   *
   * Failure is expected and quiet: it means the Google session has lapsed, and
   * the only way through is a click, so the reconnect button comes back rather
   * than an error appearing.
   */
  autoReconnect: async () => {
    const { wasConnected, token, autoRefreshing } = get()
    if (!wasConnected || token || autoRefreshing) return
    if (!auth.currentUser) return

    set({ autoRefreshing: true, error: null })
    try {
      if (GIS_CONFIGURED) {
        const granted = await requestGoogleToken({
          scope: get().canWrite ? FULL_SCOPE : CALENDAR_SCOPE,
          interactive: false,
          hint: auth.currentUser.email ?? undefined,
        })
        const expiry = storeToken(granted.token, granted.expiresIn)
        set({ token: granted.token, expiry, autoRefreshing: false, error: null })
        return
      }

      const provider = new GoogleAuthProvider()
      provider.addScope(CALENDAR_SCOPE)
      provider.setCustomParameters({ prompt: 'none' })
      const result = await signInWithPopup(auth, provider)
      const credential = GoogleAuthProvider.credentialFromResult(result)
      const newToken = credential?.accessToken
      if (!newToken) throw new Error('no token')
      const expiry = storeToken(newToken)
      set({ token: newToken, expiry, autoRefreshing: false, error: null })
    } catch (e: unknown) {
      // Keep wasConnected so the button offers reconnect rather than a fresh setup.
      if (e instanceof AuthzError && !e.needsInteraction) console.warn('[gcal refresh]', e.message)
      set({ autoRefreshing: false })
    }
  },

  setTargetCalendar: (id) => {
    localStorage.setItem(TARGET_KEY, id)
    set({ targetCalendarId: id })
  },

  /**
   * Adds an event to the chosen calendar.
   *
   * The first call widens the grant to include writing, which is the one moment
   * a consent screen is warranted — and it needs the click that triggered it, so
   * this must be called straight from the interaction.
   */
  createEvent: async ({ summary, location, description, startDateTime, endDateTime, attendees, taskId, transparency, timeblock, noteRef }) => {
    const { calendars, targetCalendarId } = get()
    const target = targetCalendarId
      ?? calendars.find(c => c.primary)?.id
      ?? writableCalendars(calendars)[0]?.id
    if (!target) {
      set({ error: '일정을 만들 수 있는 캘린더가 없습니다' })
      return null
    }

    const token = await ensureWriteToken(get, set)
    if (!token) return null

    try {
      const created = await createCalendarEvent(token, { calendarId: target, summary, location, description, startDateTime, endDateTime, attendees, taskId, transparency, timeblock, noteRef })
      const colour = calendars.find(c => c.id === target)?.backgroundColor ?? '#4285f4'
      const ev = toGCalEvent({ ...created, calendarId: target, calendarColor: colour })
      // Show it straight away; the next fetch will confirm it.
      if (ev) {
        set({ events: [...get().events, ev] })
        // 끌어다 놓은 것은 손이 미끄러지기 쉬운 동작이라 되돌릴 수 있어야
        // 합니다. 회의는 안 쌓습니다 — 위 CalUndo의 'create' 참고.
        if (timeblock && !undoing) {
          const stack = [...get().history, { at: Date.now(), kind: 'create' as const, eventId: ev.id }]
          set({ history: stack.slice(-MAX_CAL_HISTORY) })
        }
      }
      return ev?.id ?? null
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '일정 생성 실패'
      if (msg === TOKEN_EXPIRED) {
        set({ token: null, expiry: null, error: '토큰이 만료됐습니다. 다시 연동해 주세요.' })
      } else {
        set({ error: msg })
      }
      return null
    }
  },

  /**
   * 초대에 답합니다 — 화면에서는 바로, 구글에는 곧.
   *
   * 참석자 목록을 통째로 다시 보내야 하는 API라, 우리가 들고 있는 목록이
   * 필요합니다. 그게 비어 있으면(참석자 없는 일정) 답할 것도 없습니다.
   */
  respond: async (eventId, response) => {
    const existing = get().events.find(e => e.id === eventId)
    if (!existing?.attendees?.length) return false
    const token = await ensureWriteToken(get, set)
    if (!token) return false

    const before = get().events
    const optimistic = existing.attendees.map(a => (a.self ? { ...a, responseStatus: response } : a))
    // 누른 순간 점선이 사라져야 합니다. 왕복을 기다리면 두 번 누릅니다.
    set({ events: before.map(e => (e.id === eventId ? { ...e, attendees: optimistic } : e)) })

    try {
      await respondToEvent(token, existing.calendarId, bareEventId(existing), existing.attendees, response)
      return true
    } catch (e: unknown) {
      // 되돌립니다. 실패한 응답이 수락된 것처럼 남아 있으면, 안 간다고 한
      // 회의에 사람들이 나를 기다립니다.
      set({ events: before })
      const msg = e instanceof Error ? e.message : '응답 실패'
      if (msg === TOKEN_EXPIRED) set({ token: null, expiry: null, error: '토큰이 만료됐습니다. 다시 연동해 주세요.' })
      else set({ error: msg })
      return false
    }
  },

  /**
   * 마지막 시간 변경을 되돌립니다.
   *
   * updateEvent를 그대로 씁니다 — 되돌리는 것도 결국 '그 시각으로 옮기기'라,
   * 별도의 길을 내면 낙관적 표시와 실패 되감기를 두 벌 관리하게 됩니다.
   * 다만 그 호출이 다시 스택에 쌓이면 ⌘Z가 두 시각 사이를 영원히 오갑니다.
   * 그래서 되돌리는 동안에는 안 쌓습니다.
   */
  undoLast: async () => {
    const stack = get().history
    const op = stack[stack.length - 1]
    if (!op) return
    set({ history: stack.slice(0, -1) })
    undoing = true
    try {
      if (op.kind === 'create') await get().removeEvent(op.eventId)
      else if ('startDate' in op) await get().updateEvent(op.eventId, {
        startDate: op.startDate, endDate: op.endDate,
      })
      else await get().updateEvent(op.eventId, {
        startDateTime: op.startDateTime,
        endDateTime: op.endDateTime,
      })
    } finally {
      undoing = false
    }
  },

  /**
   * ── 남의 일정을 켜고 끕니다 ────────────────────────────────────────────────
   *
   * 켜면 그 자리에서 지금 보고 있는 기간을 읽어 옵니다. 끄면 그 사람 것만
   * 빼고 나머지는 그대로 둡니다 — 한 사람을 끌 때마다 전부 다시 읽으면
   * 켜고 끄는 것이 느려지고, 남의 일정을 보는 일은 대개 켰다 껐다 하는
   * 일입니다.
   */
  setPeeking: (email, on) => {
    const who = email.toLowerCase().trim()
    if (!who) return
    const now = get().peeking
    const next = on ? [...new Set([...now, who])] : now.filter(e => e !== who)
    if (next.length === now.length && on) return
    set({
      peeking: next,
      ...(on ? {} : { peekEvents: get().peekEvents.filter(e => e.peekOf !== who) }),
    })
    try { localStorage.setItem(PEEK_KEY, JSON.stringify(next)) } catch { /* private mode */ }
    if (on) void get().fetchPeek(get().loadedFrom ?? '', get().loadedTo ?? '')
  },

  fetchPeek: async (from, to) => {
    const { token, peeking } = get()
    if (!token || !peeking.length || !from || !to) return
    set({ peekLoading: true })
    const collected: GCalEvent[] = []
    /** 상세를 못 읽은 사람들. 이들만 모아 한 번에 한가함/바쁨을 묻습니다. */
    const opaque: string[] = []

    for (const who of peeking) {
      try {
        const raw = await fetchEventsForRange(
          token, { id: who, summary: who, backgroundColor: PEEK_COLOR }, from, to,
        )
        // 읽히긴 했는데 상세가 없는 경우가 있습니다(제목 없는 '바쁨'). 그건
        // 구글이 이미 가려서 준 것이라 그대로 씁니다.
        collected.push(...raw
          .map(toGCalEvent)
          .filter((e): e is GCalEvent => !!e)
          .map(e => ({ ...e, calendarColor: PEEK_COLOR, peekOf: who })))
      } catch (e: unknown) {
        if (e instanceof Error && e.message === TOKEN_EXPIRED) { set({ peekLoading: false }); return }
        opaque.push(who)
      }
    }

    if (opaque.length) {
      try {
        const busy = await fetchFreeBusy(token, opaque, from, to)
        for (const [who, slots] of Object.entries(busy)) {
          collected.push(...slots.map((slot, i) => busyToEvent(who, slot, i)))
        }
      } catch { /* 못 물어봤으면 그 사람은 안 그립니다 */ }
    }
    set({ peekEvents: collected, peekLoading: false })
  },

  updateEvent: async (eventId, patch) => {
    const existing = get().events.find(e => e.id === eventId)
    if (!existing) return false
    const token = await ensureWriteToken(get, set)
    if (!token) return false

    const before = get().events
    /**
     * 시간이 바뀌는 패치만 되돌릴 것으로 쌓습니다. 제목이나 아젠다를 고친
     * 것까지 ⌘Z에 걸리면, 시간을 되돌리려고 누른 손이 방금 쓴 문장을
     * 지웁니다 — 그건 편집기가 할 일이고 여기서 할 일이 아닙니다.
     */
    if (!undoing && (patch.startDate || patch.endDate) && existing.allDay) {
      // 종일 일정의 '그 전'은 날짜입니다. 되돌릴 때도 날짜로 보내야 구글이
      // 종일인 채로 둡니다.
      const stack = [...get().history, {
        at: Date.now(), kind: 'time' as const, eventId,
        startDate: existing.start, endDate: existing.end,
      }]
      set({ history: stack.slice(-MAX_CAL_HISTORY) })
    }
    if (!undoing && (patch.startDateTime || patch.endDateTime) && existing.startIso && existing.endIso) {
      const stack = [...get().history, {
        at: Date.now(),
        kind: 'time' as const,
        eventId,
        startDateTime: wallClock(existing.startIso),
        endDateTime: wallClock(existing.endIso),
      }]
      set({ history: stack.slice(-MAX_CAL_HISTORY) })
    }
    // Show the change immediately; a failure puts the old values back.
    set({
      events: before.map(e => e.id === eventId ? {
        ...e,
        summary: patch.summary ?? e.summary,
        location: patch.location ?? e.location,
        // ?? 가 아니라 !== undefined 입니다 — 빈 문자열은 '지웠다'는 뜻이고,
        // ??로 받으면 지운 아젠다가 화면에 계속 남습니다.
        description: patch.description !== undefined ? patch.description : e.description,
        attendees: patch.attendees ? patch.attendees.map(email => ({ email })) : e.attendees,
        startIso: patch.startDateTime ?? e.startIso,
        endIso: patch.endDateTime ?? e.endIso,
        // 종일 일정에는 시각이 없습니다. 날짜 칸만 옮깁니다 — 여기서 시각
        // 모양을 섞으면 화면이 잠깐 다른 종류의 일정처럼 그려집니다.
        start: patch.startDate ?? (patch.startDateTime ?? e.startIso ?? `${e.start}T00:00:00`).slice(0, 10),
        // 들어온 endDate는 구글 모양(안 포함)이고 우리가 들고 있는 end는
        // 포함하는 날짜입니다. 읽어 올 때 하는 그 변환을 여기서도 합니다 —
        // 안 하면 다시 불러오기 전까지 하루 길게 그려집니다.
        end: patch.endDate ? inclusiveEnd(patch.startDate ?? e.start, patch.endDate) : e.end,
      } : e),
    })

    try {
      await updateCalendarEvent(token, existing.calendarId, bareEventId(existing), patch)
      return true
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '일정 수정 실패'
      set({ events: before, error: msg === TOKEN_EXPIRED ? '토큰이 만료됐습니다. 다시 연동해 주세요.' : msg })
      return false
    }
  },

  removeEvent: async (eventId) => {
    const target = get().events.find(e => e.id === eventId)
    if (!target) return
    const token = await ensureWriteToken(get, set)
    if (!token) return
    const previous = get().events
    set({ events: previous.filter(e => e.id !== eventId) })
    try {
      await deleteCalendarEvent(token, target.calendarId, bareEventId(target))
    } catch (e: unknown) {
      set({ events: previous, error: e instanceof Error ? e.message : '일정 삭제 실패' })
    }
  },

  fetchCalendars: async () => {
    const { token, expiry } = get()
    if (!token || !expiry || expiry < Date.now()) return
    try {
      const calendars = await fetchCalendarList(token)
      // First time in, show everything the account can read — including shared
      // team calendars, which is where anything meant for everyone lives.
      const enabled = get().enabledCalendarIds ?? calendars.map(c => c.id)
      localStorage.setItem(ENABLED_KEY, JSON.stringify(enabled))
      set({ calendars, enabledCalendarIds: enabled, error: null })
    } catch (e: unknown) {
      if (e instanceof Error && e.message === TOKEN_EXPIRED) {
        localStorage.removeItem('gcal_token')
        localStorage.removeItem('gcal_expiry')
        set({ token: null, expiry: null, error: '토큰이 만료됐습니다. 다시 연동해 주세요.' })
      }
    }
  },

  setCalendarEnabled: (id, on) => {
    const current = get().enabledCalendarIds ?? get().calendars.map(c => c.id)
    const next = on ? [...new Set([...current, id])] : current.filter(x => x !== id)
    localStorage.setItem(ENABLED_KEY, JSON.stringify(next))

    // The window held in `events` was read for a different set of calendars, and
    // a checkbox has to take effect on the grid behind it — not on whatever the
    // next range change happens to be. Unticking is answered from memory, which
    // is instant; ticking needs the events that were never fetched, so the same
    // window is re-read.
    const { loadedFrom, loadedTo } = get()
    set({
      enabledCalendarIds: next,
      events: get().events.filter(e => next.includes(e.calendarId)),
      fetchedAt: 0,
    })
    if (on && loadedFrom && loadedTo) get().fetchEvents(loadedFrom, loadedTo)
  },

  ensureEvents: async (from, to) => {
    const { loadedFrom, loadedTo, fetchedAt, loading } = get()
    if (loading) return
    const covered = !!loadedFrom && !!loadedTo && loadedFrom <= from && to <= loadedTo
    if (covered && Date.now() - fetchedAt < STALE_MS) return
    await get().fetchEvents(shiftDate(from, -PAD_DAYS), shiftDate(to, PAD_DAYS))
  },

  refreshEvents: async () => {
    const { loadedFrom, loadedTo } = get()
    if (!loadedFrom || !loadedTo) return
    set({ fetchedAt: 0 })
    await get().fetchEvents(loadedFrom, loadedTo)
  },

  /**
   * A read, so it goes through the ordinary token — no consent, no window.
   * Returns an empty list rather than an error when the calendar is not
   * connected: a task with no calendar behind it simply has no events.
   */
  eventsForTask: async (taskId) => {
    const token = await ensureReadToken(get, set)
    if (!token) return []
    const active = await activeCalendars(get)
    if (!active.length) return []
    try {
      const raw = await fetchEventsForTask(token, active, taskId)
      const seen = new Set<string>()
      const out: GCalEvent[] = []
      for (const item of raw) {
        const ev = toGCalEvent(item)
        if (!ev || seen.has(ev.id)) continue
        seen.add(ev.id); out.push(ev)
      }
      return out.sort((a, b) => (a.startIso ?? a.start).localeCompare(b.startIso ?? b.start))
    } catch {
      return []
    }
  },

  findLinkableEvents: async (query) => {
    const token = await ensureReadToken(get, set)
    if (!token) return []
    const active = await activeCalendars(get)
    if (!active.length) return []
    try {
      const raw = await searchEvents(token, active, query)
      const seen = new Set<string>()
      const out: GCalEvent[] = []
      for (const item of raw) {
        const ev = toGCalEvent(item)
        if (!ev || seen.has(ev.id)) continue
        seen.add(ev.id); out.push(ev)
      }
      return out.sort((a, b) => (a.startIso ?? a.start).localeCompare(b.startIso ?? b.start))
    } catch {
      return []
    }
  },

  /**
   * Writing to the event needs the write grant, same as creating one — the
   * link is stored on the event, which is the whole reason it survives being
   * moved or renamed in Google.
   */
  setEventTask: async (eventId, taskId) => {
    const token = await ensureWriteToken(get, set)
    if (!token) return false
    const sep = eventId.indexOf(':')
    const calendarId = eventId.slice(0, sep)
    const bare = eventId.slice(sep + 1)
    try {
      await setEventTaskLink(token, calendarId, bare, taskId)
      // Keep the loaded window in step so the calendar does not have to refetch.
      set({ events: get().events.map(e => e.id === eventId ? { ...e, taskId: taskId ?? undefined } : e) })
      return true
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '일정 연결 실패'
      set({ error: msg === TOKEN_EXPIRED ? '토큰이 만료됐습니다. 다시 연동해 주세요.' : msg })
      return false
    }
  },

  fetchEvents: async (from: string, to: string) => {
    let { token, expiry } = get()
    if (!token || !expiry || expiry < Date.now()) {
      // Expired mid-session. Renew in place rather than making the person click:
      // this is the moment the old code gave up and showed the reconnect button.
      localStorage.removeItem('gcal_token')
      localStorage.removeItem('gcal_expiry')
      set({ token: null, expiry: null })
      await get().autoReconnect()
      ;({ token, expiry } = get())
      if (!token) return
    }
    if (!get().calendars.length) {
      await get().fetchCalendars()
      if (!get().calendars.length) return
    }

    const active = get().calendars.filter(c => (get().enabledCalendarIds ?? []).includes(c.id))
    if (!active.length) { set({ events: [], loading: false, loadedFrom: from, loadedTo: to, fetchedAt: Date.now() }); return }

    set({ loading: true, error: null })
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 15000)
    try {
      const raw = await fetchEventsAcross(token, active, from, to, abort.signal)
      clearTimeout(timer)
      const seen = new Set<string>()
      const events: GCalEvent[] = []
      for (const item of raw) {
        const ev = toGCalEvent(item)
        if (!ev || seen.has(ev.id)) continue
        seen.add(ev.id)
        events.push(ev)
      }
      set({ events, loading: false, loadedFrom: from, loadedTo: to, fetchedAt: Date.now() })
      // 같이 보고 있는 사람들도 같은 기간으로 따라옵니다. 내 것만 새로
      // 읽으면 달을 넘길 때 남의 일정만 옛 기간에 남습니다.
      void get().fetchPeek(from, to)
    } catch (e: unknown) {
      clearTimeout(timer)
      if (e instanceof Error && e.message === TOKEN_EXPIRED) {
        localStorage.removeItem('gcal_token')
        localStorage.removeItem('gcal_expiry')
        set({ token: null, expiry: null, loading: false, error: '토큰이 만료됐습니다. 다시 연동해 주세요.' })
        return
      }
      const msg = e instanceof Error && e.name === 'AbortError'
        ? '요청 시간 초과. 네트워크를 확인해 주세요.'
        : (e instanceof Error ? e.message : '이벤트 로드 오류')
      set({ loading: false, error: msg })
    }
  },
}))
