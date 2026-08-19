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
  let h = Math.max(
    window.visualViewport?.height ?? 0,
    window.innerHeight,
    document.documentElement.clientHeight,
  )
  // Portrait standalone: the web view spans the full screen (status bar is translucent)
  if (isStandalone() && window.innerHeight >= window.innerWidth) {
    h = Math.max(h, screen.height)
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
