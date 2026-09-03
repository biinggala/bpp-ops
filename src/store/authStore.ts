import { create } from 'zustand'
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth'
import { ref, get as fbGet, update as fbUpdate } from 'firebase/database'
import { auth, db } from '../lib/firebase'
import { isDesktopShell, signInWithSystemBrowser } from '../lib/desktopAuth'
import { P } from '../lib/paths'

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
    set({ uid: null, email: null, displayName: null, photoURL: null })
  },

  subscribe: () => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        set({ uid: null, email: null, displayName: null, photoURL: null, loading: false })
        return
      }
      const email = user.email || ''
      set({ uid: user.uid, email, displayName: user.displayName, photoURL: user.photoURL, loading: false, error: null })
      /**
       * 남들이 내 이름을 찾을 수 있게 프로필을 맞춥니다.
       *
       * 이름은 **직접 고친 적이 없을 때만** 구글 것으로 둡니다. 설정에서 고친
       * 이름을 로그인마다 덧씌우면 고친 게 다음 날 사라집니다. 주소와 사진은
       * 늘 맞춥니다 — 그건 구글이 맞습니다.
       */
      const profile = ref(db, P.userProfile(user.uid))
      const googleName = user.displayName ?? email.split('@')[0]
      fbGet(profile)
        .then(snap => {
          const have = snap.val() as { customName?: boolean; name?: string } | null
          const patch: Record<string, unknown> = { email, photoURL: user.photoURL ?? null }
          if (!have?.customName || !have?.name) patch.name = googleName
          // 직접 고친 이름이 있으면 그게 '내 이름'입니다 — 알림에 찍히는 이름,
          // 사이드바의 이름, 휴지통에 남는 이름이 전부 여기서 나갑니다.
          else set({ displayName: have.name })
          return fbUpdate(profile, patch)
        })
        .catch(() => fbUpdate(profile, { email, photoURL: user.photoURL ?? null }).catch(() => {}))
    })

    return unsub
  },
}))
