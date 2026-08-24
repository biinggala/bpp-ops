import { create } from 'zustand'
import { onValue, ref, update as fbUpdate, off } from 'firebase/database'
import { db } from '../lib/firebase'
import { P } from '../lib/paths'

/**
 * ── 이 사람이 이미 본 것들 ───────────────────────────────────────────────────
 *
 * 두 가지를 기억합니다: 소개를 봤는가, 어느 버전의 업데이트 노트까지 봤는가.
 *
 * **기기가 아니라 계정에 붙습니다.** 노트북에서 소개를 읽었는데 폰에서 또
 * 읽으라고 하면 그건 소개가 아니라 방해입니다. localStorage로 두면 정확히
 * 그렇게 됩니다.
 *
 * 반대로 **드라이브·캘린더 연결은 기기 것입니다** — 토큰이 그 브라우저에
 * 살기 때문에, 폰에서는 폰에서 한 번 더 눌러야 실제로 됩니다. 그래서 소개
 * 마지막 장의 연결 버튼은 '봤음'으로 처리하지 않습니다. 언제든 설정에서
 * 다시 할 수 있어야 하고, 실제로 그 자리에 있습니다.
 */

interface PrefsState {
  /** 소개를 끝까지(또는 건너뛰기로) 본 시각. 없으면 아직 안 봤습니다. */
  onboardedAt: number | null
  /** 마지막으로 읽은 업데이트 노트의 id. */
  seenVersion: string | null
  /**
   * 타임블록을 처음 만든 시각. 없으면 아직 한 번도 안 해 본 사람입니다.
   *
   * 안내를 **한 번 해 보면 사라지게** 하려고 둡니다. 기능을 설명하는 글은
   * 그 기능을 쓰기 전까지만 쓸모가 있고, 그 뒤로는 화면을 차지하는 문장일
   * 뿐입니다. 계정에 붙으므로 노트북에서 해 봤으면 폰에서도 안 뜹니다.
   */
  timeblockAt: number | null
  /**
   * 지금 보고 있는 워크스페이스.
   *
   * **개인 설정입니다.** 한 사람이 두 곳에 걸쳐 있을 때 어느 쪽을 보고 있는지는
   * 취향이지 공유된 사실이 아닙니다 — 남이 전환했다고 내 화면이 따라 바뀌면
   * 아무도 자기 화면을 신뢰할 수 없습니다.
   *
   * 계정에 붙으므로 노트북에서 고른 곳이 폰에서도 그대로입니다.
   */
  activeOrg: string | null
  /**
   * 첫 조회가 끝났는가.
   *
   * 이게 없으면 앱을 켤 때마다 소개가 한 번 번쩍합니다 — 아직 안 읽은
   * `onboardedAt`은 null이고, null은 '안 봤다'와 똑같이 생겼습니다.
   */
  ready: boolean

  subscribe: (email: string) => () => void
  markOnboarded: (email: string) => void
  markSeenVersion: (email: string, id: string) => void
  markTimeblock: (email: string) => void
  setActiveOrg: (email: string, orgId: string) => void
  /** 설정에서 '다시 보기'를 눌렀을 때. 저장된 값은 그대로 두고 이번만 엽니다. */
  replay: 'intro' | 'whatsNew' | null
  setReplay: (v: 'intro' | 'whatsNew' | null) => void
}

export const usePrefsStore = create<PrefsState>((set) => ({
  onboardedAt: null,
  seenVersion: null,
  timeblockAt: null,
  activeOrg: null,
  ready: false,
  replay: null,

  subscribe: (email) => {
    const node = ref(db, P.userPrefs(email))
    const handler = onValue(node, snap => {
      const v = (snap.val() ?? {}) as { onboardedAt?: number; seenVersion?: string; timeblockAt?: number; activeOrg?: string }
      set({
        onboardedAt: v.onboardedAt ?? null,
        seenVersion: v.seenVersion ?? null,
        timeblockAt: v.timeblockAt ?? null,
        activeOrg: v.activeOrg ?? null,
        ready: true,
      })
    }, () => set({ ready: true }))
    return () => {
      off(node, 'value', handler)
      set({ onboardedAt: null, seenVersion: null, timeblockAt: null, activeOrg: null, ready: false, replay: null })
    }
  },

  markOnboarded: (email) => {
    const at = Date.now()
    // 화면을 먼저 닫습니다. 왕복을 기다리면 닫기를 두 번 누릅니다.
    set({ onboardedAt: at })
    void fbUpdate(ref(db, P.userPrefs(email)), { onboardedAt: at }).catch(() => {})
  },

  markSeenVersion: (email, id) => {
    set({ seenVersion: id })
    void fbUpdate(ref(db, P.userPrefs(email)), { seenVersion: id }).catch(() => {})
  },

  markTimeblock: (email) => {
    const at = Date.now()
    set({ timeblockAt: at })
    void fbUpdate(ref(db, P.userPrefs(email)), { timeblockAt: at }).catch(() => {})
  },

  setActiveOrg: (email, orgId) => {
    set({ activeOrg: orgId })
    void fbUpdate(ref(db, P.userPrefs(email)), { activeOrg: orgId }).catch(() => {})
  },

  setReplay: (replay) => set({ replay }),
}))
