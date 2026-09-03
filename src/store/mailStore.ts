import { create } from 'zustand'
import { unlinkServerGoogle } from '../lib/serverGoogle'
import { auth } from '../lib/firebase'
import { requestGoogleToken, prepareGoogleAuthz, GIS_CONFIGURED, onGoogleLinked } from '../lib/googleAuthz'
import { isDesktopShell, forgetStoredGrant } from '../lib/desktopAuth'
import { GMAIL_SCOPE, TOKEN_EXPIRED, listNeedsReply, type MailThread } from '../lib/gmail'

/**
 * ── 메일 ─────────────────────────────────────────────────────────────────────
 *
 * 드라이브·캘린더와 같은 구조입니다: 브라우저가 직접 구글에게 토큰을 받고,
 * 직접 물어봅니다. 서버가 가운데 없습니다.
 *
 * **여기 안 저장합니다.** 메일 제목과 미리보기를 우리 데이터베이스에 복사해
 * 두면 세 가지가 생깁니다 — 지메일에서 읽었는데 여기서는 안 읽음으로 남는
 * 어긋남, 우리 쪽에도 '읽음'을 만들어야 하는 일, 그리고 회사 메일 제목이
 * 남의 서비스에 한 벌 더 놓이는 것. 볼 때 물어보고, 안 볼 때는 아무 데도
 * 없습니다.
 */

const CONNECTED_KEY = 'mail_connected'
const TOKEN_KEY = 'mail_token'
const EXPIRY_KEY = 'mail_expiry'

/** 다시 물어보기까지. 메일은 분 단위로 급하지 않고, 급한 건 폰이 울립니다. */
export const MAIL_POLL_MS = 4 * 60 * 1000

interface MailState {
  token: string | null
  expiry: number | null
  wasConnected: boolean
  needsReconnect: boolean
  connecting: boolean
  loading: boolean
  error: string | null
  threads: MailThread[]
  /** 마지막으로 물어본 시각. 창을 다시 열 때 너무 자주 묻지 않도록. */
  at: number

  connect: () => Promise<boolean>
  disconnect: () => void
  refresh: (force?: boolean) => Promise<void>
}

function loadStored() {
  try {
    const token = localStorage.getItem(TOKEN_KEY)
    const expiry = Number(localStorage.getItem(EXPIRY_KEY)) || null
    const wasConnected = localStorage.getItem(CONNECTED_KEY) === '1'
    if (token && expiry && expiry > Date.now()) return { token, expiry, wasConnected: true }
    return { token: null, expiry: null, wasConnected }
  } catch { /* private mode */ }
  return { token: null, expiry: null, wasConnected: false }
}

function storeToken(token: string, expiresInSeconds = 3500) {
  const expiry = Date.now() + Math.max(60, expiresInSeconds - 60) * 1000
  try {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(EXPIRY_KEY, String(expiry))
    localStorage.setItem(CONNECTED_KEY, '1')
  } catch { /* private mode */ }
  return expiry
}

/** 연동 버튼을 누르기 전에 구글 클라이언트를 준비해 둡니다. warmDriveAuth와 같은 이유. */
export function warmMailAuth(): void {
  void prepareGoogleAuthz(GMAIL_SCOPE)
  // 캘린더나 드라이브의 동의가 메일 범위까지 청했으면 여기는 창 없이 붙습니다.
  onGoogleLinked(() => {
    const s = useMailStore.getState()
    if (s.token || s.connecting) return
    void requestGoogleToken({ scope: GMAIL_SCOPE, interactive: false, hint: auth.currentUser?.email ?? undefined })
      .then(granted => {
        const expiry = storeToken(granted.token, granted.expiresIn)
        useMailStore.setState({ token: granted.token, expiry, wasConnected: true, needsReconnect: false })
        void useMailStore.getState().refresh(true)
      })
      .catch(() => {})
  })
}

let renewal: Promise<string | null> | null = null

export const useMailStore = create<MailState>((set, get) => ({
  ...loadStored(),
  needsReconnect: false,
  connecting: false,
  loading: false,
  error: null,
  threads: [],
  at: 0,

  connect: async () => {
    if (!GIS_CONFIGURED) {
      set({ error: '구글 클라이언트 ID가 설정되지 않았습니다' })
      return false
    }
    set({ connecting: true, error: null })
    try {
      const granted = await requestGoogleToken({
        scope: GMAIL_SCOPE,
        interactive: true,
        hint: auth.currentUser?.email ?? undefined,
      })
      const expiry = storeToken(granted.token, granted.expiresIn)
      set({ token: granted.token, expiry, wasConnected: true, needsReconnect: false, connecting: false })
      void get().refresh(true)
      return true
    } catch (e) {
      const msg = e instanceof Error ? e.message : '메일 연동 오류'
      const cancelled = msg.includes('취소') || msg.includes('cancel') || msg.includes('popup')
      set({ connecting: false, error: cancelled ? null : msg })
      return false
    }
  },

  disconnect: () => {
    void unlinkServerGoogle(GMAIL_SCOPE).catch(() => {})
    if (isDesktopShell()) void forgetStoredGrant(GMAIL_SCOPE)
    try {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(EXPIRY_KEY)
      localStorage.removeItem(CONNECTED_KEY)
    } catch { /* private mode */ }
    set({ token: null, expiry: null, wasConnected: false, needsReconnect: false, threads: [], at: 0, error: null })
  },

  refresh: async (force = false) => {
    const { token, expiry, wasConnected, needsReconnect, loading, at } = get()
    if (loading) return
    if (!wasConnected || needsReconnect || !GIS_CONFIGURED) return
    if (!force && Date.now() - at < MAIL_POLL_MS) return

    let live = token && expiry && expiry > Date.now() ? token : null
    if (!live) {
      // 한 번에 하나만. GIS는 요청마다 창을 여는데, 여러 곳에서 동시에
      // 부르면 창이 여러 번 뜹니다 — 드라이브에서 겪은 그것입니다.
      if (!renewal) {
        renewal = (async () => {
          try {
            const granted = await requestGoogleToken({
              scope: GMAIL_SCOPE,
              interactive: false,
              hint: auth.currentUser?.email ?? undefined,
            })
            const newExpiry = storeToken(granted.token, granted.expiresIn)
            set({ token: granted.token, expiry: newExpiry, error: null })
            return granted.token
          } catch {
            set({ token: null, expiry: null, needsReconnect: true })
            return null
          } finally { renewal = null }
        })()
      }
      live = await renewal
    }
    if (!live) return

    const me = auth.currentUser?.email
    if (!me) return

    set({ loading: true })
    try {
      const threads = await listNeedsReply(live, me)
      set({ threads, loading: false, error: null, at: Date.now() })
    } catch (e) {
      const msg = e instanceof Error ? e.message : '메일을 읽지 못했습니다'
      if (msg === TOKEN_EXPIRED) set({ token: null, expiry: null })
      // 실패해도 시각은 찍습니다. 안 그러면 오류가 날 때마다 4분에 한 번이
      // 아니라 화면을 그릴 때마다 다시 시도하게 됩니다.
      set({ loading: false, error: msg === TOKEN_EXPIRED ? null : msg, at: Date.now() })
    }
  },
}))
