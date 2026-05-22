import { create } from 'zustand'
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth'
import { auth } from '../lib/firebase'
import { ALLOWED_EMAILS } from '../types'
import type { MemberKey } from '../types'

// 로컬 개발 시 로그인 우회 — 배포 전 false로 변경
const DEV_MODE = true

interface AuthState {
  memberKey: MemberKey | null
  uid: string | null
  email: string | null
  photoURL: string | null
  loading: boolean
  error: string | null

  signIn: () => Promise<void>
  signOutUser: () => Promise<void>
  subscribe: () => () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  memberKey: DEV_MODE ? 'HC' : null,
  uid: DEV_MODE ? 'dev-user' : null,
  email: DEV_MODE ? 'biinggala@crngfriends.com' : null,
  photoURL: null,
  loading: !DEV_MODE,
  error: null,

  signIn: async () => {
    if (DEV_MODE) return
    set({ error: null })
    try {
      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({ prompt: 'select_account' })
      await signInWithPopup(auth, provider)
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : '로그인 오류' })
    }
  },

  signOutUser: async () => {
    if (DEV_MODE) return
    await signOut(auth)
    set({ memberKey: null, uid: null, email: null, photoURL: null })
  },

  subscribe: () => {
    if (DEV_MODE) return () => {}

    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        set({ memberKey: null, uid: null, email: null, photoURL: null, loading: false })
        return
      }
      const email = user.email || ''
      const key = ALLOWED_EMAILS[email]
      if (!key) {
        signOut(auth)
        set({ error: `접근 권한이 없는 계정: ${email}`, loading: false })
        return
      }
      set({ memberKey: key, uid: user.uid, email, photoURL: user.photoURL, loading: false, error: null })
    })

    return unsub
  },
}))
