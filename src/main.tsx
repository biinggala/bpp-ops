import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// iOS standalone PWAs mis-report the layout viewport height, leaving a gap
// below the app. Measure the real visible height and drive --app-h from it.
const setAppHeight = () => {
  const h = window.visualViewport?.height ?? window.innerHeight
  document.documentElement.style.setProperty('--app-h', `${h}px`)
}
setAppHeight()
window.visualViewport?.addEventListener('resize', setAppHeight)
window.addEventListener('resize', setAppHeight)
window.addEventListener('orientationchange', () => setTimeout(setAppHeight, 100))

createRoot(document.getElementById('root')!).render(<App />)
