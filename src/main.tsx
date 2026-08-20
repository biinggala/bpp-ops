import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installExternalLinkHandler } from './lib/desktopLinks'
import { isDesktopShell } from './lib/desktopAuth'
import { installServiceWorker } from './lib/push'

// iOS standalone PWAs mis-report the layout viewport height, leaving a gap
// below the app. Take the max of every height the browser reports; installed
// PWAs cover the entire display, so screen.height is also a valid floor there.
// The desktop shell also reports display-mode: standalone, and it is a window
// that can be any shape — floored to the display height it would draw itself
// taller than the window and clip its own content.
const isStandalone = () =>
  !isDesktopShell() && (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )

/** A CSS length, resolved by measuring an element. env() is not readable in JS. */
const cssPx = (value: string): number => {
  const probe = document.createElement('div')
  probe.style.cssText = `position:fixed;visibility:hidden;bottom:0;height:${value}`
  document.body.appendChild(probe)
  const h = probe.getBoundingClientRect().height
  probe.remove()
  return h
}

/**
 * Stops the bottom bar reserving room for a home indicator that is not over it.
 *
 * On this phone iOS hands the installed app a window 62pt shorter than the
 * screen and leaves that band below it — outside the window, painted by the
 * system, unreachable by us. It still reports safe-area-inset-bottom: 34px, so
 * the bar was padding 34pt out of its own height for an indicator sitting in
 * iOS's band rather than on top of anything of ours. That is a third of the
 * bar's height given away.
 *
 * So: when there is more dead space below the window than the inset claims, the
 * inset is somebody else's problem and --safe-b goes to zero. When the window
 * really does reach the bottom of the screen — a correctly installed app, or any
 * browser — nothing is overridden and the padding stays, because there the
 * indicator genuinely is over the bar.
 */
const setSafeBottom = () => {
  const inset = cssPx('env(safe-area-inset-bottom, 0px)')
  const dead = Math.max(0, screen.height - window.innerHeight)
  const covered = isStandalone() && inset > 0 && dead >= inset - 1
  if (covered) document.documentElement.style.setProperty('--safe-b', '0px')
  else document.documentElement.style.removeProperty('--safe-b')
}

const setAppHeight = () => {
  // The visible area, as the browser itself defines it: visualViewport is the
  // part of the page a person can actually see, with any browser chrome already
  // taken off. In an installed PWA there is no chrome, so it is the whole
  // screen — which is the number this needs and the only one that is right in
  // both modes.
  //
  // Nothing is added to it. Three attempts at flooring this value — at
  // screen.height, at the viewport plus the home indicator's band — each fixed
  // one device and broke another: too short leaves a white strip under the app,
  // too tall pushes the bottom bar off the screen entirely. The floor that
  // survives is in CSS, where 100dvh catches the case of a browser that
  // under-reports, and neither can overshoot the screen.
  const h = window.visualViewport?.height ?? window.innerHeight
  document.documentElement.style.setProperty('--app-h', `${Math.round(h)}px`)
  setSafeBottom()
}
setAppHeight()
window.visualViewport?.addEventListener('resize', setAppHeight)
window.addEventListener('resize', setAppHeight)
window.addEventListener('orientationchange', () => setTimeout(setAppHeight, 100))
// iOS settles the standalone viewport a beat after launch/resume without firing resize
document.addEventListener('visibilitychange', () => setTimeout(setAppHeight, 100))
;[300, 1000, 2500].forEach(ms => setTimeout(setAppHeight, ms))

// In the desktop shell, a link that leaves the app has to be handed to the
// browser; a webview opens nothing on its own.
installExternalLinkHandler()

// The worker is what a push wakes. Registered on every load rather than when
// somebody turns notifications on, so the one that is already subscribed keeps
// receiving after a redeploy replaces the file.
void installServiceWorker()

createRoot(document.getElementById('root')!).render(<App />)
