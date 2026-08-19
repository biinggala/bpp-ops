import { create } from 'zustand'
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth'
import { auth } from '../lib/firebase'
import { requestGoogleToken, AuthzError, GIS_CONFIGURED } from '../lib/googleAuthz'
import { fetchCalendarList, fetchEventsAcross, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, writableCalendars, TOKEN_EXPIRED, type GoogleCalendar, type RawCalendarEvent, type EventAttendee } from '../lib/googleCalendar'

export interface GCalEvent {
  id: string
  summary: string
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
}

const ENABLED_KEY = 'gcal_enabled_calendars'

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
  createEvent: (input: { summary: string; startDateTime: string; endDateTime: string; attendees?: string[] }) => Promise<boolean>
  updateEvent: (eventId: string, patch: { summary?: string; startDateTime?: string; endDateTime?: string; attendees?: string[] }) => Promise<boolean>
  removeEvent: (eventId: string) => Promise<void>
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
    attendees: item.attendees,
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

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'
const CALENDAR_WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const WRITE_KEY = 'gcal_can_write'
const TARGET_KEY = 'gcal_target_calendar'

/**
 * Write access is asked for the first time somebody creates an event, not at
 * connect. Most people only ever read the calendar, and there is no reason to
 * put a broader consent screen in front of them for a thing they never do.
 */
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
 * Returns a token that may write, widening the grant the first time.
 *
 * Must be reached straight from a click: the consent screen is a window, and a
 * window with no gesture behind it is blocked.
 */
async function ensureWriteToken(get: () => GCalState, set: Setter): Promise<string | null> {
  if (get().canWrite && get().token) return get().token
  try {
    const granted = await requestGoogleToken({
      scope: `${CALENDAR_SCOPE} ${CALENDAR_WRITE_SCOPE}`,
      interactive: true,
      hint: auth.currentUser?.email ?? undefined,
    })
    storeToken(granted.token, granted.expiresIn)
    localStorage.setItem(WRITE_KEY, '1')
    set({ token: granted.token, expiry: Date.now() + granted.expiresIn * 1000, canWrite: true, error: null })
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
  calendars: [],
  enabledCalendarIds: loadEnabled(),
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
            scope: CALENDAR_SCOPE,
            interactive: true,
            hint: auth.currentUser?.email ?? undefined,
          })
          const expiry = storeToken(granted.token, granted.expiresIn)
          localStorage.setItem('gcal_connected', '1')
          set({ token: granted.token, expiry, wasConnected: true, loading: false, error: null })
          return
        } catch (gisError) {
          // GIS refuses if the site is not listed as an authorised origin on the
          // client, among other setup problems. Connecting still has to work, so
          // fall through to the old popup rather than leaving people stuck.
          console.warn('[gcal] GIS 연동 실패, 기존 방식으로 시도합니다', gisError)
        }
      }

      const provider = new GoogleAuthProvider()
      provider.addScope(CALENDAR_SCOPE)
      provider.setCustomParameters({ prompt: 'consent', access_type: 'online' })
      const result = await signInWithPopup(auth, provider)
      const credential = GoogleAuthProvider.credentialFromResult(result)
      const token = credential?.accessToken
      if (!token) throw new Error('액세스 토큰을 받지 못했습니다')
      const expiry = storeToken(token)
      localStorage.setItem('gcal_connected', '1')
      set({ token, expiry, wasConnected: true, loading: false, error: null })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '구글 캘린더 연동 오류'
      const isCancel = msg.includes('popup-closed') || msg.includes('cancelled') || msg.includes('취소')
      set({ loading: false, error: isCancel ? null : msg })
    }
  },

  disconnect: () => {
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
          scope: get().canWrite ? `${CALENDAR_SCOPE} ${CALENDAR_WRITE_SCOPE}` : CALENDAR_SCOPE,
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
  createEvent: async ({ summary, startDateTime, endDateTime, attendees }) => {
    const { calendars, targetCalendarId } = get()
    const target = targetCalendarId
      ?? calendars.find(c => c.primary)?.id
      ?? writableCalendars(calendars)[0]?.id
    if (!target) {
      set({ error: '일정을 만들 수 있는 캘린더가 없습니다' })
      return false
    }

    const token = await ensureWriteToken(get, set)
    if (!token) return false

    try {
      const created = await createCalendarEvent(token, { calendarId: target, summary, startDateTime, endDateTime, attendees })
      const colour = calendars.find(c => c.id === target)?.backgroundColor ?? '#4285f4'
      const ev = toGCalEvent({ ...created, calendarId: target, calendarColor: colour })
      // Show it straight away; the next fetch will confirm it.
      if (ev) set({ events: [...get().events, ev] })
      return true
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '일정 생성 실패'
      if (msg === TOKEN_EXPIRED) {
        set({ token: null, expiry: null, error: '토큰이 만료됐습니다. 다시 연동해 주세요.' })
      } else {
        set({ error: msg })
      }
      return false
    }
  },

  updateEvent: async (eventId, patch) => {
    const existing = get().events.find(e => e.id === eventId)
    if (!existing) return false
    const token = await ensureWriteToken(get, set)
    if (!token) return false

    const before = get().events
    // Show the change immediately; a failure puts the old values back.
    set({
      events: before.map(e => e.id === eventId ? {
        ...e,
        summary: patch.summary ?? e.summary,
        attendees: patch.attendees ? patch.attendees.map(email => ({ email })) : e.attendees,
        startIso: patch.startDateTime ?? e.startIso,
        endIso: patch.endDateTime ?? e.endIso,
        start: (patch.startDateTime ?? e.startIso ?? `${e.start}T00:00:00`).slice(0, 10),
      } : e),
    })

    try {
      await updateCalendarEvent(token, existing.calendarId, eventId.slice(existing.calendarId.length + 1), patch)
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
      // The stored id is namespaced by calendar; Google wants the bare one.
      await deleteCalendarEvent(token, target.calendarId, eventId.slice(target.calendarId.length + 1))
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
