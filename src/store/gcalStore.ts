import { create } from 'zustand'
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth'
import { auth } from '../lib/firebase'

export interface GCalEvent {
  id: string
  summary: string
  start: string      // YYYY-MM-DD
  end: string        // YYYY-MM-DD
  startTime?: string // e.g. "9:30am", "8pm" — only for timed (non-all-day) events
  allDay: boolean
  htmlLink: string
}

interface GCalState {
  token: string | null
  expiry: number | null
  wasConnected: boolean   // persists in localStorage; survives token expiry
  autoRefreshing: boolean // true while silent background reconnect is in progress
  events: GCalEvent[]
  loading: boolean
  error: string | null
  connect: () => Promise<void>
  disconnect: () => void
  fetchEvents: (from: string, to: string) => Promise<void>
  autoReconnect: () => Promise<void>
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
    set({ token: null, expiry: null, wasConnected: false, events: [], error: null })
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

  fetchEvents: async (from: string, to: string) => {
    const { token, expiry } = get()
    if (!token || !expiry || expiry < Date.now()) {
      localStorage.removeItem('gcal_token')
      localStorage.removeItem('gcal_expiry')
      set({ token: null, expiry: null })
      return
    }
    set({ loading: true, error: null })
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 10000)
    try {
      const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events')
      url.searchParams.set('timeMin', `${from}T00:00:00Z`)
      url.searchParams.set('timeMax', `${to}T23:59:59Z`)
      url.searchParams.set('singleEvents', 'true')
      url.searchParams.set('orderBy', 'startTime')
      url.searchParams.set('maxResults', '500')

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
        signal: abort.signal,
      })
      clearTimeout(timer)

      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem('gcal_token')
        localStorage.removeItem('gcal_expiry')
        let detail = ''
        try { const b = await res.json(); detail = b?.error?.message ?? '' } catch { /* ignore */ }
        const msg = res.status === 401
          ? '토큰이 만료됐습니다. 다시 연동해 주세요.'
          : `캘린더 접근 권한 없음${detail ? ': ' + detail : ''}. 연동을 다시 해 주세요.`
        // Keep wasConnected so user sees reconnect button rather than initial connect
        set({ token: null, expiry: null, loading: false, error: msg })
        return
      }
      if (!res.ok) throw new Error(`GCal API 오류: ${res.status}`)

      const data = await res.json()
      const seenIds = new Set<string>()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const events: GCalEvent[] = (data.items ?? []).flatMap((item: any) => {
        if (!item.id || seenIds.has(item.id)) return []
        seenIds.add(item.id)
        try {
          const allDay = !!item.start?.date
          const start = allDay
            ? item.start.date
            : item.start?.dateTime?.slice(0, 10) ?? ''
          if (!start) return []
          let end = allDay
            ? item.end?.date ?? start
            : item.end?.dateTime?.slice(0, 10) ?? start
          if (!end) end = start
          if (allDay && end > start) {
            const d = new Date(end + 'T00:00:00')
            d.setDate(d.getDate() - 1)
            end = d.toISOString().slice(0, 10)
          }
          if (end < start) end = start
          let startTime: string | undefined
          if (!allDay && item.start?.dateTime) {
            const d = new Date(item.start.dateTime)
            const h = d.getHours(); const m = d.getMinutes()
            const ampm = h >= 12 ? 'pm' : 'am'
            const h12 = h % 12 || 12
            startTime = m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`
          }
          return [{ id: item.id, summary: item.summary ?? '(제목 없음)', start, end, startTime, allDay, htmlLink: item.htmlLink ?? '' }]
        } catch { return [] }
      })
      set({ events, loading: false })
    } catch (e: unknown) {
      clearTimeout(timer)
      const msg = e instanceof Error && e.name === 'AbortError'
        ? '요청 시간 초과. 네트워크를 확인해 주세요.'
        : (e instanceof Error ? e.message : '이벤트 로드 오류')
      set({ loading: false, error: msg })
    }
  },
}))
