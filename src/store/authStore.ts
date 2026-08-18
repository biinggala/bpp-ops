import { create } from 'zustand'
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth'
import { auth } from '../lib/firebase'

interface AuthState {
  uid: string | null
  email: string | null
  displayName: string | null
  photoURL: string | null
  loading: boolean
  error: string | null

  signIn: () => Promise<void>
  signOutUser: () => Promise<void>
  subscribe: () => () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  uid: null,
  email: null,
  displayName: null,
  photoURL: null,
  loading: true,
  error: null,

  signIn: async () => {
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
    await signOut(auth)
    set({ uid: null, email: null, displayName: null, photoURL: null })
  },

  subscribe: () => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        set({ uid: null, email: null, displayName: null, photoURL: null, loading: false })
        return
      }
      // 멤버 연결은 이메일 기준으로 memberStore에서 해석한다 (useCurrentMember).
      set({ uid: user.uid, email: user.email || '', displayName: user.displayName, photoURL: user.photoURL, loading: false, error: null })
    })

    return unsub
  },
}))
