// Google API authorization, via Google Identity Services — or, in the desktop
// shell, via the system browser (see desktopAuth). GIS asks for the token in a
// popup, and Google refuses its sign-in pages inside an embedded webview, so
// the popup opens onto a wall there.
//
// Firebase's signInWithPopup was doing double duty here: it signs the user into
// the app AND hands back a Google API token. Using it to refresh calendar access
// meant opening a popup, which browsers block unless a click caused it — so the
// hourly refresh silently failed and the reconnect button was effectively
// permanent, worst of all on iOS.
//
// GIS asks for API access on its own, without touching the app's sign-in, and
// re-issues a token without a popup while the Google session is alive. It still
// cannot outlive that session: only a server holding the client secret can keep
// a refresh token, which is a separate decision (see docs).

import { isDesktopShell, authorizeWithSystemBrowser, refreshWithStoredGrant } from './desktopAuth'
import { linkAndWait, serverGoogleKnown, tokenFromServer } from './serverGoogle'
import { ALL_GOOGLE_SCOPE } from './scopes'

/** From the Google Cloud console: APIs & Services → Credentials → Web client. */
export const GOOGLE_CLIENT_ID = '1050546278891-elmuh3saq38q8rsj02li9d3j6q043ko7.apps.googleusercontent.com'

export const GIS_CONFIGURED = GOOGLE_CLIENT_ID.length > 0

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
}

interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string; hint?: string }) => void
}

/**
 * Token clients, kept per scope so a request can open its window without
 * awaiting anything first.
 *
 * This is the whole reason the calendar could not be connected from a phone.
 * Asking for a token opens a window, and a window is only allowed to open while
 * the browser still considers a tap to be "active" — Safari on iOS ends that the
 * moment a network round trip happens, and the first click was doing exactly
 * that: loading the Google script, then asking. Desktop Chrome keeps the
 * activation for a few seconds and never noticed.
 *
 * Warmed up ahead of the click (see `prepareGoogleAuthz`), the click itself does
 * nothing but ask, in the same task the tap arrived in.
 */
const warmClients = new Map<string, TokenClient>()
let pending: ((r: TokenResponse | { error: string; blocked: boolean }) => void) | null = null

interface GisNamespace {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string
        scope: string
        callback: (response: TokenResponse) => void
        error_callback?: (error: { type?: string; message?: string }) => void
        hint?: string
      }) => TokenClient
    }
  }
}

declare global {
  interface Window { google?: GisNamespace }
}

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client'
let scriptPromise: Promise<void> | null = null

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`)
    const script = existing ?? document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => { scriptPromise = null; reject(new Error('구글 인증 스크립트를 불러오지 못했습니다')) }
    if (!existing) document.head.appendChild(script)
  })
  return scriptPromise
}

export interface GrantedToken {
  token: string
  /** Seconds the token is good for, as Google reported it. */
  expiresIn: number
}

export class AuthzError extends Error {
  /** True when the attempt needed the user and there was no user gesture. */
  readonly needsInteraction: boolean
  constructor(message: string, needsInteraction: boolean) {
    super(message)
    this.needsInteraction = needsInteraction
  }
}

/** One client per scope, with a callback that hands the answer to whoever asked. */
function clientFor(scope: string, hint?: string): TokenClient | null {
  const cached = warmClients.get(scope)
  if (cached) return cached
  const oauth2 = window.google?.accounts?.oauth2
  if (!oauth2) return null

  const client = oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope,
    hint,
    callback: (response) => {
      const take = pending
      pending = null
      take?.(response)
    },
    error_callback: (err) => {
      const take = pending
      pending = null
      take?.({
        error: err.message ?? '인증이 취소되었습니다',
        blocked: err.type === 'popup_failed_to_open' || err.type === 'popup_closed',
      })
    },
  })
  warmClients.set(scope, client)
  return client
}

/**
 * Loads the script and builds the client before anyone clicks anything.
 *
 * Called when the connect button appears, so that by the time it is tapped the
 * work that used to spend the tap's permission is already done.
 */
export async function prepareGoogleAuthz(scope: string): Promise<void> {
  if (isDesktopShell()) return
  if (!GIS_CONFIGURED || warmClients.has(scope)) return
  try {
    await loadGis()
    clientFor(scope)
  } catch { /* offline, or the script is blocked — the click will say so */ }
}

/** The half that must not await: asking, with the tap still warm. */
function askWarmClient(
  client: TokenClient,
  { interactive, hint }: { interactive: boolean; hint?: string },
): Promise<GrantedToken> {
  return new Promise<GrantedToken>((resolve, reject) => {
    pending = (r) => {
      if ('access_token' in r && r.access_token) {
        resolve({ token: r.access_token, expiresIn: r.expires_in ?? 3600 })
      } else if ('blocked' in r) {
        reject(new AuthzError(
          r.blocked ? '브라우저가 구글 창을 막았습니다. 다시 눌러 주세요.' : r.error,
          true,
        ))
      } else {
        reject(new AuthzError(r.error ?? '토큰을 받지 못했습니다', true))
      }
    }
    // An empty prompt reuses an existing grant without showing anything; the
    // consent screen only appears on a first connect.
    client.requestAccessToken({ prompt: interactive ? 'consent' : '', hint })
  })
}

/**
 * Asks Google for an API token covering `scope`.
 *
 * Not `async`, deliberately: when the client is already warm the request has to
 * reach `requestAccessToken` in the same task as the click that caused it, and
 * an `async` function's first `await` ends that task. See `warmClients`.
 *
 * `interactive: false` is the refresh path — it must be allowed to fail quietly,
 * because that is what happens when the Google session has gone and the only
 * remedy is for the person to click.
 */
/**
 * 서버에 열쇠가 새로 생겼을 때 부를 것들. 각 연동이 자기 스토어를 등록해 두고,
 * 한 번의 동의가 끝나면 나머지가 조용히 붙습니다.
 */
const linkedListeners: Array<() => void> = []
export function onGoogleLinked(cb: () => void): void { linkedListeners.push(cb) }

export function requestGoogleToken(
  { scope, interactive, hint }: { scope: string; interactive: boolean; hint?: string }
): Promise<GrantedToken> {
  /**
   * ── 서버에 열쇠가 있으면 창이 필요 없습니다 ──────────────────────────────
   *
   * 브라우저가 직접 받는 토큰은 한 시간짜리고, 갱신은 '구글 세션이 살아 있고
   * 브라우저가 허락할 때만' 조용히 됩니다. 사파리와 아이폰은 그 자리를 막아서,
   * 아무것도 안 했는데 몇 시간마다 재연동을 눌러야 했습니다.
   *
   * 열쇠를 서버가 들고 있으면 그 문제가 통째로 없어집니다 — 그리고 연결이
   * 기기가 아니라 **사람**에게 붙어서, 노트북에서 한 번 하면 폰에서도 됩니다.
   * lib/serverGoogle 참고.
   *
   * 켜져 있는지 모르는 동안에는 예전 길로 갑니다. 되던 것을 안 되게 만들지
   * 않습니다 — 이 값은 앱이 뜰 때 미리 물어 둡니다(warmServerGoogle).
   */
  if (serverGoogleKnown()) {
    if (!interactive) return tokenFromServer(scope)
    // 클릭과 같은 순간에 빈 창을 엽니다. 주소를 받아 온 뒤에 열면 브라우저가
    // '사람이 시킨 창'으로 안 칩니다.
    const win = isDesktopShell() ? null : window.open('', '_blank')
    /**
     * 동의는 **한 번에 전부** 청합니다(ALL_GOOGLE_SCOPE). 캘린더를 켜는 사람은
     * 곧 드라이브와 메일도 켤 사람이고, 세 번 동의하게 두면 같은 일을 세 번
     * 시키는 것입니다. 끝나면 다른 연동들에게 알려서 창 없이 붙게 합니다.
     */
    return linkAndWait(scope, hint, win, ALL_GOOGLE_SCOPE).then(granted => {
      // 부른 쪽이 자기 상태를 먼저 적게 한 틱 뒤에 알립니다.
      setTimeout(() => { for (const cb of linkedListeners) { try { cb() } catch { /* 한 연동의 실패가 다른 연동을 막지 않게 */ } } }, 0)
      return granted
    })
  }

  if (isDesktopShell()) return desktopToken({ scope, interactive, hint })

  const warm = warmClients.get(scope)
  if (warm) return askWarmClient(warm, { interactive, hint })

  return (async () => {
    await loadGis()
    const client = clientFor(scope, hint)
    if (!client) throw new AuthzError('구글 인증을 사용할 수 없습니다', true)
    return askWarmClient(client, { interactive, hint })
  })()
}

async function desktopToken(
  { scope, interactive, hint }: { scope: string; interactive: boolean; hint?: string }
): Promise<GrantedToken> {
  // The shell keeps a refresh token, which the browser cannot: only a client
  // holding the secret may redeem one, and here the secret is compiled into
  // the binary. Try that first even when a click is available — it is instant,
  // and it is the whole reason the connection survives past an hour.
  try {
    return await refreshWithStoredGrant(scope)
  } catch { /* nothing stored, or the grant was revoked — ask properly */ }

  if (!interactive) throw new AuthzError('연동을 다시 시작해 주세요', true)
  try {
    return await authorizeWithSystemBrowser(scope, hint)
  } catch (e) {
    throw new AuthzError(e instanceof Error ? e.message : '인증이 취소되었습니다', true)
  }
}
