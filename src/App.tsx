import { useEffect } from 'react'
import { useAuthStore } from './store/authStore'
import { LoginPage } from './pages/LoginPage'
import { AppPage } from './pages/AppPage'
import { Crash } from './components/shared/Crash'
import { useShallow } from 'zustand/react/shallow'

export default function App() {
  const { uid, loading, subscribe } = useAuthStore(useShallow(s => ({ uid: s.uid, loading: s.loading, subscribe: s.subscribe })))

  useEffect(() => {
    // Capture invite code from URL before it gets lost during login redirect
    const params = new URLSearchParams(window.location.search)
    const invite = params.get('invite')
    if (invite) {
      sessionStorage.setItem('pending_invite', invite)
      window.history.replaceState({}, '', window.location.pathname)
    }
    const unsub = subscribe()
    return unsub
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-[#f2f2f7]">
        <div className="text-[14px] text-gray-400">로딩 중...</div>
      </div>
    )
  }

  // 앱 전체를 감쌉니다. 렌더 중에 예외가 나면 하얀 화면이 되는데, 그건
  // 사용자에게 '앱이 죽었다'와 '인터넷이 끊겼다'를 구별할 방법을 주지
  // 않습니다. Crash 참고.
  return <Crash>{uid ? <AppPage /> : <LoginPage />}</Crash>
}
