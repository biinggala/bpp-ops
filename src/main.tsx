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
