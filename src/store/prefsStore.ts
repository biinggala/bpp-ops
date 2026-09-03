import { create } from 'zustand'
import { reportProblem } from '../lib/notify'
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
   * 개인 워크스페이스를 만들어 준 적이 있는가(그 id).
   *
   * 만들었다는 사실을 **계정에** 적습니다. 기기에 적으면 폰에서 한 번 더
   * 만들어지고, 안 적으면 그 워크스페이스를 지운 사람에게 다음 로그인에
   * 또 생깁니다 — 지운 일이 없던 일이 됩니다.
   */
  homeOrg: string | null
  /**
   * 캘린더에서 **꺼 둔** 것들.
   *
   * **기기가 아니라 계정에 붙습니다.** 연결(토큰)은 이 브라우저 것이지만,
   * '어느 캘린더를 보는가'는 취향입니다 — 노트북에서 끈 것이 폰에서 다시
   * 켜져 있으면 그건 저장이 아닙니다. 데스크톱 앱을 껐다 켜면 매번 구독 중인
   * 캘린더가 전부 쏟아지던 것도 이것이 브라우저 저장소에만 있어서였습니다.
   *
   * **켠 것이 아니라 꺼 둔 것을 적습니다.** 켠 것을 적으면 나중에 구글에서
   * 캘린더를 하나 더 만들었을 때 그게 목록에 안 뜹니다 — 안 켠 것과 아직
   * 없던 것이 같아지니까요. 끈 것만 적으면 새로 생긴 것은 그냥 보입니다.
   *
   * 줄바꿈으로 이어 붙인 한 문자열로 저장합니다. 캘린더 id에는 `.`과 `@`가
   * 들어 있는데 그건 실시간 데이터베이스의 키로 못 씁니다.
   */
  hiddenCalendars: string[]
  /**
   * 이 값을 **한 번이라도 적은 적이 있는가.**
   *
   * 없는 것과 '아무것도 안 껐다'가 똑같이 빈 배열로 생겼습니다. 그대로
   * 두면, 이 기능이 생기기 전부터 기기에 저장해 둔 사람이 앱을 켜는 순간
   * 계정 쪽의 빈 값이 그걸 덮어써서 캘린더가 전부 켜집니다 — 고치려던 바로
   * 그 증상입니다. 처음 한 번은 덮어쓰는 대신 기기 것을 계정으로 옮깁니다.
   */
  hiddenSeen: boolean
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
  setHomeOrg: (email: string, orgId: string) => void
  setHiddenCalendars: (email: string, ids: string[]) => void
  /** 설정에서 '다시 보기'를 눌렀을 때. 저장된 값은 그대로 두고 이번만 엽니다. */
  replay: 'intro' | 'whatsNew' | null
  setReplay: (v: 'intro' | 'whatsNew' | null) => void
}

export const usePrefsStore = create<PrefsState>((set) => ({
  onboardedAt: null,
  seenVersion: null,
  timeblockAt: null,
  activeOrg: null,
  homeOrg: null,
  hiddenCalendars: [],
  hiddenSeen: false,
  ready: false,
  replay: null,

  subscribe: (email) => {
    const node = ref(db, P.userPrefs(email))
    const handler = onValue(node, snap => {
      const v = (snap.val() ?? {}) as {
        onboardedAt?: number; seenVersion?: string; timeblockAt?: number
        activeOrg?: string; homeOrg?: string; hiddenCalendars?: string
      }
      set({
        onboardedAt: v.onboardedAt ?? null,
        seenVersion: v.seenVersion ?? null,
        timeblockAt: v.timeblockAt ?? null,
        activeOrg: v.activeOrg ?? null,
        homeOrg: v.homeOrg ?? null,
        hiddenCalendars: (v.hiddenCalendars ?? '').split('\n').filter(Boolean),
        hiddenSeen: v.hiddenCalendars !== undefined,
        ready: true,
      })
    }, () => set({ ready: true }))
    return () => {
      off(node, 'value', handler)
      set({ onboardedAt: null, seenVersion: null, timeblockAt: null, activeOrg: null, homeOrg: null, hiddenCalendars: [], hiddenSeen: false, ready: false, replay: null })
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

  setHomeOrg: (email, orgId) => {
    set({ homeOrg: orgId })
    void fbUpdate(ref(db, P.userPrefs(email)), { homeOrg: orgId }).catch(() => {})
  },

  setActiveOrg: (email, orgId) => {
    set({ activeOrg: orgId })
    void fbUpdate(ref(db, P.userPrefs(email)), { activeOrg: orgId }).catch(() => {})
  },

  setHiddenCalendars: (email, ids) => {
    set({ hiddenCalendars: ids, hiddenSeen: true })
    void fbUpdate(ref(db, P.userPrefs(email)), { hiddenCalendars: ids.join('\n') }).catch(() => reportProblem('캘린더 설정을 저장하지 못했습니다. 새로 열면 되돌아갑니다.'))
  },

  setReplay: (replay) => set({ replay }),
}))
