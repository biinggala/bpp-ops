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

/** Set only by an explicit '끄기'. Its absence means 'on wherever possible'. */
const OFF_KEY = 'bpp_push_off'

/** Where the sender lives — the same Cloud Run service as the MCP endpoint. */
export const PUSH_API = 'https://crng-task-manager-1050546278891.asia-northeast3.run.app'

export type PushSupport =
  | { ok: true }
  | { ok: false; reason: string }

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/**
 * The facts iOS decides on, printed next to a failure.
 *
 * Guessing at what iOS is doing cost this project four wrong attempts on the
 * bottom bar; measuring ended it in one screenshot. Same trick here — a refusal
 * that arrives with `standalone=0` is a different bug from one with
 * `standalone=1`, and nobody can tell them apart from the word "denied".
 */
function context(reg?: ServiceWorkerRegistration | null): string {
  const version = /(?:iPhone )?OS (\d+)[._](\d+)/.exec(navigator.userAgent)
  const worker = reg
    ? (reg.active ? 'active' : reg.waiting ? 'waiting' : reg.installing ? 'installing' : 'none')
    : 'no-reg'
  return [
    `standalone=${isInstalled() ? 1 : 0}`,
    version ? `iOS ${version[1]}.${version[2]}` : null,
    `perm=${Notification.permission}`,
    `sw=${worker}`,
    reg ? `scope=${new URL(reg.scope).pathname}` : null,
    'PushManager' in window ? null : 'PushManager 없음',
  ].filter(Boolean).join(' · ')
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
    return { ok: false, reason: '데스크톱 앱은 푸시를 받을 수 없습니다 (웹뷰에 Push 기능이 없음). 앱이 열려 있는 동안은 화면 위에 알림이 뜨고, 닫혀 있을 때는 폰으로 옵니다.' }
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, reason: '이 브라우저는 푸시를 지원하지 않습니다' }
  }
  // iOS is the strict one: installed to the home screen, or nothing.
  if (isIOS() && !isInstalled()) {
    return { ok: false, reason: '아이폰은 홈 화면에 추가한 뒤에만 알림을 받을 수 있습니다 (공유 → 홈 화면에 추가)' }
  }
  if (Notification.permission === 'denied') {
    return { ok: false, reason: `${deniedHelp()} (${context()})` }
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

  // Held outside the try so a failure can report the worker's actual state —
  // 'permission denied' with a worker that never activated is a different bug
  // from the same words with a live one.
  let reg: ServiceWorkerRegistration | null = null
  try {
    reg = await readyRegistration()
    const sub = await reg.pushManager.getSubscription() ?? await subscribe(reg)
    const json = sub.toJSON() as { endpoint?: string; keys?: Record<string, string> }
    await fbSet(ref(db, P.pushSub(uid, deviceId())), {
      endpoint: json.endpoint ?? sub.endpoint,
      keys: json.keys ?? {},
      ua: navigator.userAgent.slice(0, 180),
      at: Date.now(),
    })
    localStorage.setItem('bpp_push_on', '1')
    localStorage.removeItem(OFF_KEY)
    return { ok: true }
  } catch (e) {
    if (Notification.permission === 'denied') return { ok: false, reason: `${deniedHelp()} (${context(reg)})` }
    // The name is the half that identifies the failure, and a bare message like
    // "permission denied" identifies nothing — so both are shown. Somebody has
    // to be able to report this from a phone.
    const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    return { ok: false, reason: `${detail || '구독 실패'} (${context(reg)})` }
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

/**
 * A real OS notification, drawn without any push at all.
 *
 * `showNotification()` on a live service worker is a local call — no server, no
 * subscription, no VAPID. On an installed iPhone app it draws the same banner a
 * push would, which means **the phone can have proper notifications while the
 * app is running even if push never works**. Push earns its keep only for the
 * app that is closed.
 *
 * It is also the sharpest test of whether the granted permission is real: this
 * uses the notification permission and nothing else, so a failure here says the
 * permission is a lie, and a success says the problem is the push service.
 */
export async function showLocalNotice(
  title: string, body: string, url = '/', tag = 'bpp-ops',
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (isDesktopShell() || !('serviceWorker' in navigator)) {
    return { ok: false, reason: '이 앱에서는 OS 알림을 띄울 수 없습니다' }
  }
  if (Notification.permission !== 'granted') {
    return { ok: false, reason: `알림 권한이 없습니다 (perm=${Notification.permission})` }
  }
  try {
    const reg = await readyRegistration()
    await reg.showNotification(title, {
      body, tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { url },
    })
    return { ok: true }
  } catch (e) {
    const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    return { ok: false, reason: `${detail} (${context()})` }
  }
}

export async function disablePush(): Promise<void> {
  const uid = auth.currentUser?.uid
  localStorage.removeItem('bpp_push_on')
  // Remembered, so the next load does not turn it straight back on.
  try { localStorage.setItem(OFF_KEY, '1') } catch { /* private mode */ }
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

/** '이 기기에서는 됐다'고 한 사람만 꺼져 있습니다 — 그 외에는 켜는 게 기본입니다. */
function optedOut(): boolean {
  try { return localStorage.getItem(OFF_KEY) === '1' } catch { return false }
}

/**
 * 기본값은 켜짐.
 *
 * 스위치를 찾아 눌러야 알림이 오는 건 기본값이 틀린 것입니다. 그렇다고 페이지가
 * 열리자마자 권한 창을 띄울 수는 없습니다 — 묻지도 않은 허락을 요구하는 앱은
 * 사람들이 '거부'를 누르고, 아이폰은 한 번 거부하면 되돌릴 방법이 없습니다.
 *
 * 그래서 조용히 되는 데까지만 합니다. 이미 권한이 있는 기기(다른 기기에서
 * 켰거나, 전에 켰다가 앱을 다시 깐 경우)는 아무것도 묻지 않고 바로 구독합니다.
 * 권한을 물어야 하는 기기는 설정 창의 스위치가 그 한 번의 탭을 받습니다.
 */
export async function autoEnablePush(): Promise<void> {
  try {
    if (optedOut()) return
    if (Notification.permission !== 'granted') return
    if (!pushSupport().ok) return
    if (pushEnabledHere()) return
    await enablePush()
  } catch { /* best effort */ }
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
