import { create } from 'zustand'
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth'
import { auth } from '../lib/firebase'

export interface GCalEvent {
  id: string
  summary: string
  start: string   // YYYY-MM-DD (normalized to date only)
  end: string     // YYYY-MM-DD exclusive for all-day, inclusive for timed
  allDay: boolean
  htmlLink: string
}

interface GCalState {
  token: string | null
  expiry: number | null
  events: GCalEvent[]
  loading: boolean
  error: string | null
  connect: () => Promise<void>
  disconnect: () => void
  fetchEvents: (from: string, to: string) => Promise<void>
}

function loadStored(): { token: string | null; expiry: number | null } {
  try {
    const token = localStorage.getItem('gcal_token')
    const expiry = Number(localStorage.getItem('gcal_expiry') ?? 0)
    if (token && expiry > Date.now()) return { token, expiry }
  } catch { /* ignore */ }
  return { token: null, expiry: null }
}

export const useGCalStore = create<GCalState>((set, get) => ({
  ...loadStored(),
  events: [],
  loading: false,
  error: null,

  connect: async () => {
    set({ error: null, loading: true })
    try {
      const provider = new GoogleAuthProvider()
      provider.addScope('https://www.googleapis.com/auth/calendar.readonly')
      const result = await signInWithPopup(auth, provider)
      const credential = GoogleAuthProvider.credentialFromResult(result)
      const token = credential?.accessToken
      if (!token) throw new Error('액세스 토큰을 받지 못했습니다')
      const expiry = Date.now() + 3500 * 1000  // ~58 minutes
      localStorage.setItem('gcal_token', token)
      localStorage.setItem('gcal_expiry', String(expiry))
      set({ token, expiry, loading: false, error: null })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '구글 캘린더 연동 오류'
      // User closed the popup — not an error to show
      const isCancel = msg.includes('popup-closed') || msg.includes('cancelled')
      set({ loading: false, error: isCancel ? null : msg })
    }
  },

  disconnect: () => {
    localStorage.removeItem('gcal_token')
    localStorage.removeItem('gcal_expiry')
    set({ token: null, expiry: null, events: [], error: null })
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
    try {
      const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events')
      url.searchParams.set('timeMin', `${from}T00:00:00Z`)
      url.searchParams.set('timeMax', `${to}T23:59:59Z`)
      url.searchParams.set('singleEvents', 'true')
      url.searchParams.set('orderBy', 'startTime')
      url.searchParams.set('maxResults', '500')

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (res.status === 401) {
        localStorage.removeItem('gcal_token')
        localStorage.removeItem('gcal_expiry')
        set({ token: null, expiry: null, loading: false, error: '토큰이 만료됐습니다. 다시 연동해 주세요.' })
        return
      }
      if (!res.ok) throw new Error(`GCal API 오류: ${res.status}`)

      const data = await res.json()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const events: GCalEvent[] = (data.items ?? []).map((item: any) => {
        const allDay = !!item.start?.date
        const start = allDay
          ? item.start.date
          : item.start?.dateTime?.slice(0, 10) ?? ''
        // All-day end is exclusive in GCal; make it inclusive for display
        let end = allDay
          ? item.end?.date ?? start
          : item.end?.dateTime?.slice(0, 10) ?? start
        if (allDay && end > start) {
          // subtract 1 day to make inclusive
          const d = new Date(end + 'T00:00:00')
          d.setDate(d.getDate() - 1)
          end = d.toISOString().slice(0, 10)
        }
        return { id: item.id, summary: item.summary ?? '(제목 없음)', start, end, allDay, htmlLink: item.htmlLink ?? '' }
      })
      set({ events, loading: false })
    } catch (e: unknown) {
      set({ loading: false, error: e instanceof Error ? e.message : '이벤트 로드 오류' })
    }
  },
}))
