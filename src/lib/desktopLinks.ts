import { isDesktopShell, invokeDesktop } from './desktopAuth'
import { safeExternalUrl } from './utils'

/**
 * ── Links that leave the app ─────────────────────────────────────────────────
 *
 * `target="_blank"` and `window.open` do nothing in the desktop shell. A webview
 * has no tabs to open into, and unless the host is asked to handle the request
 * it declines silently — so every Drive file, calendar entry and pasted URL in
 * the app was a link that visibly did nothing when clicked. Nothing to report,
 * nothing in a console anybody was looking at.
 *
 * One capture-phase listener catches them all and hands the address to the real
 * browser, which is where a signed-in Google or GitHub session actually lives.
 */

export async function openExternal(url: string): Promise<void> {
  const safe = safeExternalUrl(url)
  if (!safe) return
  if (isDesktopShell()) {
    try {
      await invokeDesktop('open_external', { url: safe })
      return
    } catch { /* an older shell has no such command; fall through */ }
  }
  window.open(safe, '_blank', 'noopener')
}

/** Installed once, at startup. A no-op in a browser, which needs none of this. */
export function installExternalLinkHandler(): void {
  if (!isDesktopShell()) return

  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0) return
    const anchor = (event.target as Element | null)?.closest?.('a')
    if (!anchor) return

    const href = anchor.getAttribute('href')
    const safe = href ? safeExternalUrl(href) : null
    if (!safe) return
    // The app's own origin is where we already are.
    try { if (new URL(safe).origin === window.location.origin) return } catch { return }

    event.preventDefault()
    void openExternal(safe)
  }, true)
}
