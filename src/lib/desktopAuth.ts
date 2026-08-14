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

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function signInWithSystemBrowser(): Promise<void> {
  const shell = tauri()
  if (!shell) throw new Error('데스크톱 앱에서만 사용할 수 있는 로그인 방식입니다')

  const verifierBytes = new Uint8Array(32)
  crypto.getRandomValues(verifierBytes)
  const codeVerifier = base64Url(verifierBytes)

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
  const codeChallenge = base64Url(new Uint8Array(digest))

  const idToken = await shell.core.invoke<string>('google_sign_in', {
    codeChallenge,
    codeVerifier,
  })
  await signInWithCredential(auth, GoogleAuthProvider.credential(idToken))
}
