import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth'
import { auth } from './firebase'

// Google refuses its sign-in flow inside embedded webviews, so the desktop shell
// cannot use signInWithPopup. There the native shell drives the standard
// installed-app flow (loopback redirect + system browser) and returns an ID
// token; only the PKCE values are produced here, via WebCrypto.

interface TauriGlobal {
  core: { invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> }
}

function tauri(): TauriGlobal | null {
  return (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__ ?? null
}

/** True when running inside the Tauri desktop shell rather than a browser. */
export function isDesktopShell(): boolean {
  return tauri() !== null
}

/** Calls a native command. Throws in a browser, where there is no shell. */
export function invokeDesktop<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const shell = tauri()
  if (!shell) return Promise.reject(new Error('데스크톱 앱에서만 사용할 수 있습니다'))
  return shell.core.invoke<T>(cmd, args)
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The PKCE pair the native flow needs; made here so the shell carries no crypto. */
export async function createPkce(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const verifierBytes = new Uint8Array(32)
  crypto.getRandomValues(verifierBytes)
  const codeVerifier = base64Url(verifierBytes)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
  return { codeVerifier, codeChallenge: base64Url(new Uint8Array(digest)) }
}

export async function signInWithSystemBrowser(): Promise<void> {
  if (!isDesktopShell()) throw new Error('데스크톱 앱에서만 사용할 수 있는 로그인 방식입니다')
  const { codeVerifier, codeChallenge } = await createPkce()
  const idToken = await invokeDesktop<string>('google_sign_in', { codeChallenge, codeVerifier })
  await signInWithCredential(auth, GoogleAuthProvider.credential(idToken))
}

/**
 * Grants an API scope — Calendar, Drive — through the system browser.
 *
 * Google Identity Services does this with a popup, and Google refuses its
 * sign-in pages inside an embedded webview, so in the desktop shell that popup
 * opens onto a wall: the connect button appeared to do nothing. This is the same
 * loopback flow sign-in already uses.
 */
/**
 * Renews from a grant the shell remembered, with no browser and no click.
 *
 * Throws when there is nothing stored — including on shells built before this
 * existed, where the command is simply unknown — and the caller falls back to
 * asking properly.
 */
export async function refreshWithStoredGrant(
  scope: string,
): Promise<{ token: string; expiresIn: number }> {
  const res = await invokeDesktop<{ access_token?: string; expires_in?: number }>(
    'google_refresh',
    { scope },
  )
  if (!res.access_token) throw new Error('저장된 연동으로 토큰을 받지 못했습니다')
  return { token: res.access_token, expiresIn: res.expires_in ?? 3600 }
}

/** Drops the remembered grant. What disconnecting means on the native side. */
export async function forgetStoredGrant(scope: string): Promise<void> {
  try { await invokeDesktop('google_forget', { scope }) } catch { /* nothing to forget */ }
}

export async function authorizeWithSystemBrowser(
  scope: string,
  loginHint?: string,
): Promise<{ token: string; expiresIn: number }> {
  const { codeVerifier, codeChallenge } = await createPkce()
  const res = await invokeDesktop<{ access_token?: string; expires_in?: number; error?: string }>(
    'google_authorize',
    { scope, codeChallenge, codeVerifier, loginHint },
  )
  if (!res.access_token) throw new Error(res.error ?? '토큰을 받지 못했습니다')
  return { token: res.access_token, expiresIn: res.expires_in ?? 3600 }
}
