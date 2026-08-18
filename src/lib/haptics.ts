/**
 * ── Touch feedback ───────────────────────────────────────────────────────────
 *
 * What actually works, so nobody is surprised later:
 *
 * - **Android** (Chrome, Firefox, Samsung Internet): `navigator.vibrate` works.
 *   The buzz is a real one, and short durations read as a tap rather than a
 *   phone call.
 * - **iPhone**: Apple has never shipped the Vibration API — not in Safari, not
 *   in a home-screen PWA, not in any wrapper, because they all run WebKit. The
 *   crisp taps in native iOS apps come from an API the web cannot reach.
 *
 *   There is one narrow exception, used below: since iOS 17.4 a
 *   `<input type="checkbox" switch>` plays the system's toggle haptic when it
 *   flips. Driving a hidden one is the only way a web page gets a tap out of an
 *   iPhone. It is a side effect of a UI control, not an API, so it is
 *   best-effort — it may stop working whenever Safari decides otherwise.
 *
 * Everything here fails silently. Feedback that is not available is not an
 * error, and a phone that cannot buzz should behave exactly as before.
 */

type Pattern = number | number[]

/** Short enough to read as a tap. Anything past ~40ms starts to feel like a buzz. */
const PATTERNS = {
  /** Selecting something: a row, a tab, a date. */
  tap: 8,
  /** A value changed — status, priority, a checkbox. */
  toggle: 14,
  /** Finishing something. The one place a little more weight is earned. */
  success: [12, 30, 18] as number[],
  /** A press-and-hold registering, before the menu appears. */
  longPress: 28,
  /** Something was refused. */
  warn: [24, 40, 24] as number[],
} satisfies Record<string, Pattern>

export type Haptic = keyof typeof PATTERNS

/**
 * Off for people who asked for less.
 *
 * There is no "prefers-reduced-haptics" query, but anyone who turned on reduced
 * motion has told the system they want fewer involuntary sensations, and a
 * phone buzzing at every tap is squarely that.
 */
function wanted(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false
  // Pointer-driven devices do not have a vibrator, and a laptop with a
  // touchscreen should not start humming because the API happens to exist.
  return window.matchMedia?.('(hover: none) and (pointer: coarse)').matches ?? false
}

let iosSwitch: HTMLInputElement | null = null

/**
 * The iOS 17.4+ toggle trick.
 *
 * A switch input off-screen, flipped by a synthetic click. Safari plays the
 * system toggle haptic; the element is never seen and never submitted.
 */
function iosTap() {
  try {
    if (!iosSwitch) {
      const el = document.createElement('input')
      el.type = 'checkbox'
      // Unknown to every other engine, which simply ignores it.
      el.setAttribute('switch', '')
      el.setAttribute('aria-hidden', 'true')
      el.tabIndex = -1
      el.style.cssText = 'position:fixed;top:-100px;left:-100px;width:0;height:0;opacity:0;pointer-events:none'
      document.body.appendChild(el)
      iosSwitch = el
    }
    iosSwitch.checked = !iosSwitch.checked
    iosSwitch.dispatchEvent(new Event('change', { bubbles: false }))
  } catch { /* the page works fine without it */ }
}

export function haptic(kind: Haptic = 'tap'): void {
  if (!wanted()) return
  const pattern = PATTERNS[kind]
  try {
    if (typeof navigator.vibrate === 'function' && navigator.vibrate(pattern)) return
  } catch { /* fall through */ }
  // Nothing vibrated — either the API is missing (iPhone) or the platform
  // declined. The switch trick is the only thing left to try.
  iosTap()
}
