import { useEffect } from 'react'
import { useAuthStore } from './store/authStore'
import { LoginPage } from './pages/LoginPage'
import { AppPage } from './pages/AppPage'

export default function App() {
  const { uid, loading, subscribe } = useAuthStore()

  useEffect(() => {
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

  return uid ? <AppPage /> : <LoginPage />
}
