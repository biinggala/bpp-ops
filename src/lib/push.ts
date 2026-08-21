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

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isInstalled(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true
}

/**
 * What to say once permission is 'denied'.
 *
 * The usual advice — "allow it in settings" — is wrong on iOS. A web app that
 * has been refused once gets no entry in Settings at all, so there is nothing
 * to switch back; the only way through is to remove the home-screen icon and
 * add it again, which is a fact worth stating rather than letting somebody hunt
 * for a switch that does not exist.
 */
function deniedHelp(): string {
  return isIOS()
    ? '알림이 차단됐습니다. 아이폰은 한 번 거절하면 설정에 항목 자체가 생기지 않습니다 — 홈 화면 아이콘을 지우고 다시 추가한 뒤 켜 주세요.'
    : '알림이 차단되어 있습니다. 주소창 왼쪽 자물쇠 → 알림 → 허용으로 바꿔 주세요.'
}

export function pushSupport(): PushSupport {
  if (isDesktopShell()) {
    return { ok: false, reason: '데스크톱 앱은 열려 있는 동안 알림을 받습니다. 닫혀 있을 때는 폰으로 옵니다.' }
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, reason: '이 브라우저는 푸시를 지원하지 않습니다' }
  }
  // iOS is the strict one: installed to the home screen, or nothing.
  if (isIOS() && !isInstalled()) {
    return { ok: false, reason: '아이폰은 홈 화면에 추가한 뒤에만 알림을 받을 수 있습니다 (공유 → 홈 화면에 추가)' }
  }
  if (Notification.permission === 'denied') {
    return { ok: false, reason: deniedHelp() }
  }
  return { ok: true }
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  await navigator.serviceWorker.ready
  return reg
}

/**
 * The worker registered at load, without registering it again.
 *
 * `register()` + `ready` is a round trip, and on iOS a round trip inside a tap
 * handler is what ends the tap — see the rule in docs/desktop-updates.md. The
 * worker is already installed by the time anybody can press the switch, so this
 * is normally a single resolved promise.
 */
async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/')
  if (existing?.active) return existing
  return registration()
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
 * Subscribes this device, and asks for permission on the way.
 *
 * **Order matters, and it is not the obvious one.** Safari raises its own
 * permission prompt from inside `subscribe()`, so asking first with
 * `requestPermission()` buys nothing and costs the one thing that is scarce: by
 * the time an awaited prompt has resolved, iOS has ended the tap's user
 * activation and `subscribe()` is refused with a bare "permission denied". The
 * same rule that broke the calendar connection, in a new place.
 *
 * So: subscribe straight from the tap, and keep `requestPermission()` as the
 * fallback for the browsers that want to be asked explicitly.
 */
export async function enablePush(): Promise<{ ok: true } | { ok: false; reason: string }> {
  const support = pushSupport()
  if (!support.ok) return support

  const uid = auth.currentUser?.uid
  if (!uid) return { ok: false, reason: '로그인이 필요합니다' }

  try {
    const reg = await readyRegistration()
    const sub = await reg.pushManager.getSubscription() ?? await subscribe(reg)
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
    if (Notification.permission === 'denied') return { ok: false, reason: deniedHelp() }
    // The name is the half that identifies the failure, and a bare message like
    // "permission denied" identifies nothing — so both are shown. Somebody has
    // to be able to report this from a phone.
    const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    return { ok: false, reason: detail || '구독에 실패했습니다' }
  }
}

function pushOptions(): PushSubscriptionOptionsInit {
  return {
    // Required by every browser: a push may not be silent.
    userVisibleOnly: true,
    applicationServerKey: urlB64ToUint8(VAPID_PUBLIC) as BufferSource,
  }
}

async function subscribe(reg: ServiceWorkerRegistration): Promise<PushSubscription> {
  try {
    return await reg.pushManager.subscribe(pushOptions())
  } catch (e) {
    // Chrome and Firefox refuse to prompt from subscribe(); they want the ask.
    if (Notification.permission === 'default') {
      if (await Notification.requestPermission() !== 'granted') {
        throw new Error('알림이 허용되지 않았습니다')
      }
      return await reg.pushManager.subscribe(pushOptions())
    }
    throw e
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
