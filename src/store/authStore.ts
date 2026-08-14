import { create } from 'zustand'
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth'
import { ref, set as fbSet } from 'firebase/database'
import { auth, db } from '../lib/firebase'
import { isDesktopShell, signInWithSystemBrowser } from '../lib/desktopAuth'
import { ALLOWED_EMAILS } from '../types'
import type { MemberKey } from '../types'

interface AuthState {
  memberKey: MemberKey | null
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
  memberKey: null,
  uid: null,
  email: null,
  displayName: null,
  photoURL: null,
  loading: true,
  error: null,

  signIn: async () => {
    set({ error: null })
    try {
      // The desktop shell must route through the system browser — Google blocks
      // its sign-in flow inside embedded webviews, so the popup never completes.
      if (isDesktopShell()) {
        await signInWithSystemBrowser()
        return
      }
      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({ prompt: 'select_account' })
      await signInWithPopup(auth, provider)
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : '로그인 오류' })
    }
  },

  signOutUser: async () => {
    await signOut(auth)
    set({ memberKey: null, uid: null, email: null, displayName: null, photoURL: null })
  },

  subscribe: () => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        set({ memberKey: null, uid: null, email: null, displayName: null, photoURL: null, loading: false })
        return
      }
      const email = user.email || ''
      const memberKey = ALLOWED_EMAILS[email] ?? null
      set({ memberKey, uid: user.uid, email, displayName: user.displayName, photoURL: user.photoURL, loading: false, error: null })
      // Write profile so other users can resolve this person's name
      fbSet(ref(db, `cringe/userProfiles/${user.uid}`), {
        email,
        name: user.displayName ?? email.split('@')[0],
        photoURL: user.photoURL ?? null,
      }).catch(() => {})
    })

    return unsub
  },
}))
