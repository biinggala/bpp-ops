// Google API authorization, via Google Identity Services.
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

/**
 * Asks Google for an API token covering `scope`.
 *
 * `interactive: false` is the refresh path — it must be allowed to fail quietly,
 * because that is what happens when the Google session has gone and the only
 * remedy is for the person to click.
 */
export async function requestGoogleToken(
  { scope, interactive, hint }: { scope: string; interactive: boolean; hint?: string }
): Promise<GrantedToken> {
  await loadGis()
  const oauth2 = window.google?.accounts?.oauth2
  if (!oauth2) throw new AuthzError('구글 인증을 사용할 수 없습니다', true)

  return new Promise<GrantedToken>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => { if (!settled) { settled = true; fn() } }

    const client = oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope,
      hint,
      callback: (response) => finish(() => {
        if (response.access_token) {
          resolve({ token: response.access_token, expiresIn: response.expires_in ?? 3600 })
        } else {
          reject(new AuthzError(response.error ?? '토큰을 받지 못했습니다', true))
        }
      }),
      error_callback: (err) => finish(() => {
        // A refresh that would have needed a window is not an error worth
        // showing — it just means the reconnect button has to come back.
        const blocked = err.type === 'popup_failed_to_open' || err.type === 'popup_closed'
        reject(new AuthzError(err.message ?? '인증이 취소되었습니다', blocked || !interactive))
      }),
    })

    // An empty prompt reuses an existing grant without showing anything; the
    // consent screen only appears on a first connect.
    client.requestAccessToken({ prompt: interactive ? 'consent' : '', hint })
  })
}
