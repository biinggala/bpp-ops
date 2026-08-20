import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installExternalLinkHandler } from './lib/desktopLinks'
import { isDesktopShell } from './lib/desktopAuth'

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

/**
 * How much of the screen iOS reserves for the home indicator, in px.
 *
 * env(safe-area-inset-bottom) is only readable from CSS, so it is measured off a
 * throwaway element. Worth the trouble: in standalone the viewport is reported
 * without it, and adding it back is what makes the app reach the bottom of the
 * screen instead of leaving a white strip there.
 */
const bottomInset = (): number => {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;visibility:hidden;height:env(safe-area-inset-bottom,0px)'
  document.body.appendChild(probe)
  const h = probe.getBoundingClientRect().height
  probe.remove()
  return h
}

const setAppHeight = () => {
  let h = Math.max(
    window.visualViewport?.height ?? 0,
    window.innerHeight,
    document.documentElement.clientHeight,
  )
  // Portrait standalone: the web view spans the full screen (status bar is
  // translucent), and every height the browser reports leaves the home
  // indicator's band out — so both the screen and the viewport-plus-that-band
  // are floors. Whichever is bigger is the one that reaches the bottom edge.
  if (isStandalone() && window.innerHeight >= window.innerWidth) {
    h = Math.max(h, screen.height, window.innerHeight + bottomInset())
  }
  document.documentElement.style.setProperty('--app-h', `${h}px`)
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

createRoot(document.getElementById('root')!).render(<App />)
