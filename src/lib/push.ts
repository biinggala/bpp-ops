import { ref, remove, set as fbSet } from 'firebase/database'
import { auth, db } from './firebase'
import { P } from './paths'
import { isDesktopShell } from './desktopAuth'

/**
 * ── 푸시 알림 ────────────────────────────────────────────────────────────────
 *
 * Web Push, which on this stack means: a service worker to be woken, a
 * subscription stored where the sender can read it, and a VAPID key pair whose
 * public half is below and whose private half only the sender holds.
 *
 * The one platform note worth knowing: **iOS only allows this for an app added
 * to the home screen**, and only if permission is asked from a real tap inside
 * that installed app. Safari-as-a-browser refuses, silently, which is why
 * `pushSupport()` answers with a reason rather than a boolean — a switch that
 * does nothing and says nothing is worse than no switch.
 *
 * The desktop shell has no Push API at all (WKWebView), so it is told plainly
 * to rely on its own OS notifications while it is open, and on the phone when
 * it is not.
 */

/** Public half of the pair. Safe to ship — it is what identifies the sender. */
const VAPID_PUBLIC = 'BI_RGaYUrlhgdXk1iRGJ6tWUN74BSKOuLfGvnsdDNSjLFcYohGiDGG69xsp5sQniu73ncADcwsdOnZ16WsKYkGw'

/** Where the sender lives — the same Cloud Run service as the MCP endpoint. */
export const PUSH_API = 'https://crng-task-manager-1050546278891.asia-northeast3.run.app'

export type PushSupport =
  | { ok: true }
  | { ok: false; reason: string }

export function pushSupport(): PushSupport {
  if (isDesktopShell()) {
    return { ok: false, reason: '데스크톱 앱은 열려 있는 동안 알림을 받습니다. 닫혀 있을 때는 폰으로 옵니다.' }
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, reason: '이 브라우저는 푸시를 지원하지 않습니다' }
  }
  // iOS is the strict one: installed to the home screen, or nothing.
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const installed = window.matchMedia('(display-mode: standalone)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true
  if (iOS && !installed) {
    return { ok: false, reason: '아이폰은 홈 화면에 추가한 뒤에만 알림을 받을 수 있습니다 (공유 → 홈 화면에 추가)' }
  }
  if (Notification.permission === 'denied') {
    return { ok: false, reason: '알림이 차단되어 있습니다. 설정에서 허용으로 바꿔 주세요.' }
  }
  return { ok: true }
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  await navigator.serviceWorker.ready
  return reg
}

/** Registers the worker without asking for anything. Safe to call on load. */
export async function installServiceWorker(): Promise<void> {
  if (isDesktopShell() || !('serviceWorker' in navigator)) return
  try { await registration() } catch (e) { console.warn('[sw]', e) }
}

function urlB64ToUint8(base64: string): Uint8Array {
  const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=')
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

/** A stable id per device, so re-subscribing replaces rather than accumulates. */
function deviceId(): string {
  const KEY = 'bpp_device_id'
  let id = localStorage.getItem(KEY)
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36)
    localStorage.setItem(KEY, id)
  }
  return id
}

/**
 * Asks permission and stores the subscription. **Must be called from a tap** —
 * iOS discards the request otherwise, and the same rule that broke the calendar
 * connection applies here.
 */
export async function enablePush(): Promise<{ ok: true } | { ok: false; reason: string }> {
  const support = pushSupport()
  if (!support.ok) return support

  const uid = auth.currentUser?.uid
  if (!uid) return { ok: false, reason: '로그인이 필요합니다' }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return { ok: false, reason: '알림이 허용되지 않았습니다' }

  try {
    const reg = await registration()
    const existing = await reg.pushManager.getSubscription()
    const sub = existing ?? await reg.pushManager.subscribe({
      // Required by every browser: a push may not be silent.
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8(VAPID_PUBLIC) as BufferSource,
    })
    const json = sub.toJSON() as { endpoint?: string; keys?: Record<string, string> }
    await fbSet(ref(db, P.pushSub(uid, deviceId())), {
      endpoint: json.endpoint ?? sub.endpoint,
      keys: json.keys ?? {},
      ua: navigator.userAgent.slice(0, 180),
      at: Date.now(),
    })
    localStorage.setItem('bpp_push_on', '1')
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : '구독에 실패했습니다' }
  }
}

export async function disablePush(): Promise<void> {
  const uid = auth.currentUser?.uid
  localStorage.removeItem('bpp_push_on')
  try {
    if (uid) await remove(ref(db, P.pushSub(uid, deviceId())))
    const reg = await navigator.serviceWorker?.getRegistration('/')
    const sub = await reg?.pushManager.getSubscription()
    await sub?.unsubscribe()
  } catch { /* already gone */ }
}

export function pushEnabledHere(): boolean {
  try {
    return localStorage.getItem('bpp_push_on') === '1' && Notification.permission === 'granted'
  } catch { return false }
}

/**
 * Asks the sender to push one notice to one person, now.
 *
 * Best effort by design: the notice is already in their inbox by the time this
 * runs, so a failure here costs a buzz, not the information. The server checks
 * the caller's Firebase token — it will not push on the word of a stranger.
 */
export async function pushNotice(toUid: string, title: string, body: string, url = '/') {
  try {
    const token = await auth.currentUser?.getIdToken()
    if (!token) return
    await fetch(`${PUSH_API}/push/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ toUid, title, body, url }),
      keepalive: true,
    })
  } catch { /* the inbox already has it */ }
}
