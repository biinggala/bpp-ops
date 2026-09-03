import { create } from 'zustand'
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth'
import { ref, get as fbGet, update as fbUpdate } from 'firebase/database'
import { auth, db } from '../lib/firebase'
import { isDesktopShell, signInWithSystemBrowser } from '../lib/desktopAuth'
import { P } from '../lib/paths'
import { migratePersonal } from '../lib/migratePersonal'
import { clearInbox } from '../lib/notify'

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
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        set({ uid: null, email: null, displayName: null, photoURL: null, loading: false })
        return
      }
      const email = user.email || ''
      /**
       * 주소 열쇠로 남아 있는 노트·설정을 계정 열쇠로 옮긴 **뒤에** 로그인을
       * 알립니다. 먼저 알리면 설정 구독이 빈 새 자리를 읽고 '개인 워크스페이스가
       * 없다'고 판단해 하나 더 만듭니다.
       */
      await migratePersonal(user.uid, email)
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
          /**
           * 처음 보는 계정이면 이 주소의 알림함을 비웁니다.
           *
           * 알림함은 남이 나에게 쓰는 자리라 주소로 남아 있어야 합니다. 그러면
           * 퇴사자 주소를 물려받은 신입이 전임자의 알림을 봅니다. 이 계정이
           * 처음 로그인하는 것이면 그 안의 알림은 전부 이 사람 것이 아닙니다.
           */
          if (!snap.exists()) void clearInbox(email)
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
