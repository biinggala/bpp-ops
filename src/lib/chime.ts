/**
 * ── 알림 소리 ────────────────────────────────────────────────────────────────
 *
 * Two short sine notes, synthesized. No file to download, nothing to cache, and
 * nothing that can 404 — which matters because this plays inside a webview that
 * fails silently at everything.
 *
 * It is deliberately quiet and deliberately over in a quarter of a second. Fifty
 * people share an office; a notification sound that announces itself is one
 * everybody turns off, and then nobody hears the ones that matter either.
 *
 * The browser will not make a sound until the person has interacted with the
 * page at least once — an app left open and untouched since it loaded stays
 * silent, and there is no way around that from here.
 */

/** One context, reused. Safari counts them and stops giving them out. */
let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  if (ctx) return ctx
  const Ctor = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try { ctx = new Ctor() } catch { return null }
  return ctx
}

const KEY = 'bpp_notice_sound'

export function chimeEnabled(): boolean {
  try { return localStorage.getItem(KEY) !== '0' } catch { return true }
}

export function setChimeEnabled(on: boolean): void {
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* private mode */ }
}

/** E6 then A6, a rising pair — the shape of "something arrived", not "something broke". */
const NOTES: [freq: number, at: number][] = [[1318.5, 0], [1760, 0.085]]

export function playChime(): void {
  const ac = audio()
  if (!ac) return
  // A context created before the first tap starts suspended; resuming is free
  // and does nothing if it is already running.
  if (ac.state === 'suspended') void ac.resume()

  const master = ac.createGain()
  master.gain.value = 0.07
  master.connect(ac.destination)

  const now = ac.currentTime
  for (const [freq, at] of NOTES) {
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    // A hard start clicks; 8ms of attack and an exponential tail do not.
    gain.gain.setValueAtTime(0, now + at)
    gain.gain.linearRampToValueAtTime(1, now + at + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.2)
    osc.connect(gain).connect(master)
    osc.start(now + at)
    osc.stop(now + at + 0.22)
  }
}
