import { create } from 'zustand'
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth'
import { auth } from '../lib/firebase'
import { fetchCalendarList, fetchEventsAcross, TOKEN_EXPIRED, type GoogleCalendar, type RawCalendarEvent } from '../lib/googleCalendar'

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
}

const ENABLED_KEY = 'gcal_enabled_calendars'

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
  loading: boolean
  error: string | null
  connect: () => Promise<void>
  disconnect: () => void
  fetchCalendars: () => Promise<void>
  setCalendarEnabled: (id: string, on: boolean) => void
  fetchEvents: (from: string, to: string) => Promise<void>
  autoReconnect: () => Promise<void>
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

function storeToken(token: string) {
  const expiry = Date.now() + 3500 * 1000  // ~58 minutes
  localStorage.setItem('gcal_token', token)
  localStorage.setItem('gcal_expiry', String(expiry))
  return expiry
}

export const useGCalStore = create<GCalState>((set, get) => ({
  ...loadStored(),
  autoRefreshing: false,
  events: [],
  calendars: [],
  enabledCalendarIds: loadEnabled(),
  loading: false,
  error: null,

  // Full connect: always shows consent screen. Called by user tapping the button.
  connect: async () => {
    set({ error: null, loading: true })
    try {
      const provider = new GoogleAuthProvider()
      provider.addScope('https://www.googleapis.com/auth/calendar.readonly')
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
      const isCancel = msg.includes('popup-closed') || msg.includes('cancelled')
      set({ loading: false, error: isCancel ? null : msg })
    }
  },

  disconnect: () => {
    localStorage.removeItem('gcal_token')
    localStorage.removeItem('gcal_expiry')
    localStorage.removeItem('gcal_connected')
    localStorage.removeItem(ENABLED_KEY)
    set({ token: null, expiry: null, wasConnected: false, events: [], calendars: [], enabledCalendarIds: null, error: null })
  },

  // Silent background reconnect: no consent screen, no visible popup if Google session is active.
  // Falls back gracefully if blocked (iOS Safari) — user will see the reconnect button.
  autoReconnect: async () => {
    const { wasConnected, token, autoRefreshing } = get()
    if (!wasConnected || token || autoRefreshing) return
    if (!auth.currentUser) return

    set({ autoRefreshing: true, error: null })
    try {
      const provider = new GoogleAuthProvider()
      provider.addScope('https://www.googleapis.com/auth/calendar.readonly')
      // prompt:'none' = silent if Google session active; throws interaction_required if not
      provider.setCustomParameters({ prompt: 'none' })
      const result = await signInWithPopup(auth, provider)
      const credential = GoogleAuthProvider.credentialFromResult(result)
      const newToken = credential?.accessToken
      if (!newToken) throw new Error('no token')
      const expiry = storeToken(newToken)
      set({ token: newToken, expiry, autoRefreshing: false, error: null })
    } catch {
      // Silent failure: popup blocked or session expired.
      // Don't clear wasConnected — user can still manually reconnect.
      set({ autoRefreshing: false })
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
    set({ enabledCalendarIds: next })
  },

  fetchEvents: async (from: string, to: string) => {
    const { token, expiry, calendars, enabledCalendarIds } = get()
    if (!token || !expiry || expiry < Date.now()) {
      localStorage.removeItem('gcal_token')
      localStorage.removeItem('gcal_expiry')
      set({ token: null, expiry: null })
      return
    }
    if (!calendars.length) {
      await get().fetchCalendars()
      if (!get().calendars.length) return
    }

    const active = get().calendars.filter(c => (get().enabledCalendarIds ?? []).includes(c.id))
    if (!active.length) { set({ events: [], loading: false }); return }

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
      set({ events, loading: false })
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
