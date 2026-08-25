import { create } from 'zustand'
import { get as fbGet, onValue, push, ref, remove, set as fbSet, update as fbUpdate, off } from 'firebase/database'
import { db } from '../lib/firebase'
import { P, domainKey, emailKey } from '../lib/paths'
import { gid } from '../lib/utils'
import { useAuthStore } from './authStore'
import { usePrefsStore } from './prefsStore'
import { pickOrg, orgsSettled } from '../lib/pickOrg'

/**
 * ── 조직과 회의실 ────────────────────────────────────────────────────────────
 *
 * 회의를 만들 때 회의실까지 한 번에 잡기 위한 것입니다. 지금까지는 앱에서
 * 일정을 만들고, 따로 예약 사이트에 들어가 같은 시간을 한 번 더 입력해야
 * 했습니다. 같은 결정을 두 번 적는 일입니다.
 *
 * **회의실 목록을 코드에 박지 않습니다.** 이 앱은 블랙페이퍼만 쓰는 게 아닐 수
 * 있고, 회의실은 회사마다 다릅니다. 그래서 조직이 자기 회의실을 등록합니다.
 *
 * **소속은 이메일 도메인입니다.** 초대도 승인도 없습니다 — @bpp.co.kr로
 * 로그인했으면 우리 회사고, 그건 이미 참인 사실이라 따로 관리할 게 없습니다.
 * 조직을 만드는 사람이 첫 사람이고, 그 뒤로는 같은 도메인이면 그냥 들어옵니다.
 *
 * **프로젝트 멤버십을 대신하지 않습니다.** 업무와 프로젝트가 누구에게 보이는지는
 * 계속 프로젝트 멤버십만으로 정해집니다. 조직은 '우리 회사에 회의실이 셋 있다'
 * 같은 공유된 사실을 담는 자리입니다. 여기에 접근 개념을 하나 더 만들면 두 축이
 * 생기고, 두 축은 언젠가 어긋납니다.
 */

export interface Room {
  id: string
  name: string
  /** '대회의실', '3층' 같은 한 줄. 이름만으로 어디인지 모를 때. */
  note?: string
  order?: number
  /**
   * 없애는 대신 끕니다.
   *
   * 방을 지우면 그 방으로 잡아 둔 예약들이 이름을 잃습니다 — 지난 회의가
   * '(삭제된 회의실)'이 되는 것보다, 새로 못 잡는 방으로 남는 편이 낫습니다.
   */
  active?: boolean
}

/** 조직에 공개된 프로젝트 한 줄. 이름은 베껴 둔 사본입니다. */
export interface OrgProject {
  id: string
  name: string
  color?: string
  /** 올린 사람. 물어볼 데가 필요합니다. */
  by?: string
  at?: number
}

/** 참여 요청 한 건. */
export interface JoinRequest {
  projectId: string
  email: string
  name?: string
  at: number
}

export interface Booking {
  id: string
  roomId: string
  /** 자정부터 분. 타임라인이 쓰는 단위와 같습니다. */
  from: number
  to: number
  by: string
  byName?: string
  title?: string
  /**
   * 잡을 때의 방 이름.
   *
   * 이게 있으면 방을 정말 지울 수 있습니다. 없으면 방을 지운 순간 지난
   * 예약들이 '(없어진 회의실)'이 되고, 그래서 처음엔 지우기를 막고 끄기만
   * 뒀습니다 — 오타로 만든 방을 영원히 목록에 두는 값이었죠. 이름을 한 벌
   * 들고 있으면 둘 다 됩니다.
   */
  roomName?: string
  /** 이 예약이 붙어 있는 구글 일정. 일정을 지우면 같이 풀립니다. */
  eventId?: string
  at: number
}

interface OrgState {
  /** 내 도메인의 조직 id. `null`이면 아직 아무도 안 만들었습니다. */
  orgId: string | null
  name: string
  domain: string
  rooms: Room[]
  /**
   * 조직 설정을 고칠 수 있는 사람들 — 이메일 소문자.
   *
   * **회의실 목록에만 미칩니다.** 업무·프로젝트는 계속 프로젝트 멤버십만으로
   * 정해집니다. 여기에 그 힘을 얹으면 접근 축이 두 개가 되고, 축이 두 개면
   * 언젠가 어긋납니다.
   */
  admins: string[]
  /** 조직에 공개된 프로젝트들. 이름만입니다 — 업무는 안 딸려 옵니다. */
  orgProjects: OrgProject[]
  /** 들어오고 싶다는 요청들. 승인은 그 프로젝트 멤버가 합니다. */
  joinRequests: JoinRequest[]
  /** 날짜별 예약. 화면이 보는 날짜만 들어 있습니다. */
  bookings: Record<string, Booking[]>
  /**
   * 내가 **멤버로** 속한 워크스페이스 전부.
   *
   * 한 사람이 두 곳에 걸칠 수 있습니다 — 회사에 다니면서 친구들과 팀을
   * 하거나, 외주로 두 곳에 들어가 있거나. 게스트로만 들어가 있는 곳은
   * 여기 안 들어옵니다: 골라 봐야 회의실도 공개 목록도 못 읽습니다.
   */
  myOrgs: { id: string; name: string }[]
  /** 조직을 찾는 첫 조회가 끝났는가. 그 전에는 '없다'고 말하지 않습니다. */
  ready: boolean
  error: string | null
  /**
   * 지금 이 워크스페이스를 스스로 떠나는 중인가. (내부용)
   *
   * 나가기와 삭제는 **내가 읽을 권한을 스스로 없애는 일**입니다. 그런데 그
   * 순간 회의실 리스너는 아직 붙어 있어서, 규칙이 거절하자마자 '회의실을
   * 읽지 못했습니다'를 띄웁니다. 곧 리스너가 떨어지면서 사라지므로 붉은
   * 글자가 한 번 번쩍합니다.
   *
   * 그 오류는 참이지만 **말할 가치가 없습니다.** 방금 사람이 시킨 일의
   * 결과니까요. 오류 문구가 필요한 경우는 시키지 않았는데 못 읽을 때입니다.
   */
  teardown: boolean

  subscribe: (email: string, uid: string | null) => () => void
  /**
   * 그 날짜들의 예약을 구독합니다.
   *
   * `who`는 **부르는 쪽의 이름**입니다. 처음엔 날짜 배열만 받고 목록에 없는
   * 날짜를 다 놓게 했는데, 부르는 곳이 둘이라(타임라인은 보이는 주 전체, 일정
   * 카드는 그 하루) 나중에 부른 쪽이 앞의 것을 다 껐습니다. 카드를 여는
   * 순간 나머지 날의 예약이 사라졌습니다.
   *
   * 각자 자기 몫만 말하고, 실제로 보는 것은 그 합집합입니다.
   */
  watchDates: (who: string, dates: string[]) => void

  /** 회사 도메인으로. 같은 도메인 전원이 초대 없이 들어옵니다. */
  createOrg: (name: string, email: string) => Promise<boolean>
  /**
   * 도메인 없이, 초대만으로 굴러가는 조직.
   *
   * 지메일만 쓰는 팀·학생 팀·1인에게는 이쪽이 유일한 길입니다. 도메인이
   * 경계 노릇을 못 하는 곳에서 '같은 도메인 = 같은 회사'는 참이 아니고,
   * 그래서 공용 도메인은 막혀 있습니다.
   *
   * 만든 사람이 **owner로 못 박힙니다.** 도메인형의 '관리자가 없으면 누구나'
   * 조항은 도메인이 벽 노릇을 해 줘서 성립하던 것인데, 여기엔 그 벽이
   * 없습니다.
   */
  createInviteOrg: (name: string, email: string) => Promise<boolean>
  addRoom: (name: string, note?: string) => Promise<void>
  updateRoom: (id: string, patch: Partial<Omit<Room, 'id'>>) => Promise<void>
  /** 관리자를 더하거나 뺍니다. 우리 도메인 주소만 됩니다. */
  setAdmin: (email: string, on: boolean) => Promise<boolean>

  /** 프로젝트를 조직 목록에 올리거나 내립니다. 그 프로젝트 멤버만. */
  setProjectShared: (project: { id: string; name: string; color?: string; orgId?: string }, on: boolean) => Promise<boolean>
  /** 이름이 바뀌면 사본도 맞춥니다. 목록에 없으면 아무 일도 안 합니다. */
  syncProjectName: (projectId: string, name: string) => void
  /** 참여를 요청합니다. */
  requestJoin: (projectId: string, email: string, name?: string) => Promise<boolean>
  /** 요청을 지웁니다 — 승인했거나, 거절했거나, 본인이 취소했거나. */
  clearJoinRequest: (projectId: string, email: string) => Promise<void>

  book: (input: {
    date: string; roomId: string; from: number; to: number
    title?: string; eventId?: string; by: string; byName?: string
  }) => Promise<boolean>
  /** 방을 지웁니다. 지난 예약은 잡을 때 적어 둔 이름으로 계속 읽힙니다. */
  removeRoom: (id: string) => Promise<void>
  /**
   * 이 워크스페이스에서 나갑니다.
   *
   * 줄을 지우지 않고 'removed'로 덮습니다 — 도메인형에서 지우면 '명단에 없고
   * 도메인이 맞으면 통과' 조항이 그 자리에서 다시 넣어 줍니다. 나간 것이
   * 아니라 한 바퀴 돈 것이 됩니다.
   */
  leaveOrg: (oid: string, email: string, uid: string) => Promise<boolean>
  /**
   * 워크스페이스를 지웁니다. **프로젝트가 하나도 없을 때만.**
   *
   * 반환값이 남은 프로젝트 수입니다. 0이면 지워졌고, 그보다 크면 아무것도
   * 안 했습니다.
   */
  deleteOrg: (oid: string, email: string, uid: string) => Promise<{ ok: boolean; remaining: number; error?: string }>
  /** 관리자가 아무도 없는 조직을 맡습니다. 규칙도 이걸 허용합니다. */
  claimAdmin: (email: string) => Promise<boolean>
  release: (date: string, bookingId: string) => Promise<void>
  /** 일정을 지우거나 회의실을 바꿀 때. 그 일정에 붙은 예약을 다 풉니다. */
  releaseForEvent: (date: string, eventId: string) => Promise<void>
  /**
   * 예약에 적힌 회의 제목을 고칩니다.
   *
   * 제목은 잡을 때 베껴 둔 사본입니다 — 다른 사람이 방 목록에서 '무슨 회의로
   * 찼는지'를 읽으려면 우리 데이터에 있어야 하고, 구글 일정은 그 사람에게
   * 안 보일 수 있으니까요. 사본이니 늙습니다. 일정 이름을 바꿀 때 같이
   * 고칩니다.
   *
   * 내가 잡은 예약만 고칠 수 있습니다(규칙). 남이 잡아 준 방이면 제목이
   * 옛것으로 남는데, 그건 방이 틀린 것보다 훨씬 가벼운 문제입니다.
   */
  retitleForEvent: (date: string, eventId: string, title: string) => Promise<void>
}

const list = <T,>(node: Record<string, Omit<T, 'id'>> | null | undefined): (T & { id: string })[] =>
  Object.entries(node ?? {}).map(([id, v]) => ({ ...(v as object), id }) as T & { id: string })

/**
 * 두 시간 구간이 겹치는가.
 *
 * 끝과 시작이 같은 것은 겹침이 아닙니다 — 2시에 끝나는 회의와 2시에
 * 시작하는 회의는 같은 방을 쓸 수 있고, 그게 회의실이 돌아가는 방식입니다.
 */
/**
 * 조직의 도메인이 될 수 없는 것들 — 아무나 가질 수 있는 주소.
 *
 * database.rules.json의 orgs/$org/meta와 orgByDomain/$domain에 같은 목록이
 * 있습니다. 여기 있는 건 사람에게 이유를 말하기 위한 사본이고, 실제로 막는
 * 것은 규칙입니다.
 */
export const PUBLIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'naver.com', 'hanmail.net', 'daum.net', 'kakao.com',
  'nate.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'yahoo.co.kr',
  'icloud.com', 'me.com', 'protonmail.com', 'proton.me', 'aol.com',
])

export const overlaps = (a: { from: number; to: number }, b: { from: number; to: number }) =>
  a.from < b.to && b.from < a.to

/**
 * 내가 승인할 수 있는 요청 수.
 *
 * 내가 멤버인 프로젝트로 온 것만 셉니다. 남의 프로젝트에 온 요청은 목록에서
 * 보이긴 하지만 내가 할 수 있는 게 없고, 할 수 없는 일을 배지로 알리면
 * 배지가 '눌러도 아무 일 없는 것'이 됩니다.
 *
 * 훅이 아니라 계산 함수입니다 — 부르는 쪽이 이미 두 스토어를 보고 있고,
 * 여기서 또 구독하면 같은 값을 두 번 듣습니다.
 */
export function pendingJoinCount(joinRequests: JoinRequest[], myProjectIds: Set<string>): number {
  return joinRequests.filter(r => myProjectIds.has(r.projectId)).length
}

export const useOrgStore = create<OrgState>((set, get) => ({
  orgId: null,
  name: '',
  domain: '',
  teardown: false,
  rooms: [],
  myOrgs: [],
  admins: [],
  orgProjects: [],
  joinRequests: [],
  bookings: {},
  ready: false,
  error: null,

  /**
   * ── 조직을 따라갑니다 ─────────────────────────────────────────────────────
   *
   * 색인(`orgByDomain`)을 **한 번 읽는 게 아니라 계속 봅니다.**
   *
   * 처음에는 한 번만 읽었습니다. 앱을 켤 때 조직이 없으면 아무 리스너도 안
   * 걸고 끝났는데, 바로 그 다음에 조직을 만들면 화면의 `orgId`는 채워지지만
   * **아무도 회의실을 듣고 있지 않았습니다.** 방을 추가하면 데이터베이스에는
   * 들어가고 목록에는 안 나타납니다 — '회의실 추가가 안 된다'로 보이지만
   * 실은 쓰기가 아니라 읽기가 없었던 것입니다.
   *
   * 색인은 한 번 정해지고 끝나는 값이 아닙니다. 우리 회사에 조직이 생기는
   * 순간이 있고, 그 순간은 내가 앱을 켜 둔 동안일 수 있습니다. 그러면
   * 옆자리 사람이 조직을 만들어도 내 화면에 바로 들어옵니다.
   */
  subscribe: (email, uid) => {
    let inner: (() => void)[] = []
    const dropInner = () => { inner.forEach(fn => fn()); inner = [] }

    /**
     * 조직을 찾는 길이 둘입니다.
     *
     * **도메인**은 회사 계정으로 로그인한 사람에게 즉시 답합니다. 하지만
     * 도메인 없이 초대만으로 만든 조직은 그 색인에 아예 안 올라갑니다 —
     * 올릴 도메인이 없으니까요. 그런 조직은 **내 색인**(`userOrgs`)이
     * 유일한 길입니다.
     *
     * 도메인 쪽이 우선입니다. 회사 계정으로 들어왔으면 그게 내 회사입니다.
     */
    let fromDomain: string | null = null
    let fromIndex: string | null = null
    let current: string | null = null
    /**
     * 이 사람이 마지막으로 고른 곳. 개인 설정이라 userPrefs에 삽니다.
     *
     * **이 값도 데이터베이스에서 옵니다.** 여기서 한 번 읽는 순간에는 아직
     * 안 와 있고, 그래서 처음 한 바퀴는 언제나 null입니다 — 그러면 아래
     * `apply`가 도메인으로 찾은 곳(회사)에 붙었다가, 설정이 온 뒤에 진짜
     * 고른 곳으로 옮겨 갑니다.
     *
     * 그 사이가 화면에 그대로 보였습니다. 새 워크스페이스에 서 있는 사람이
     * 앱을 켜면 **회사 프로젝트가 한 번 떴다가 사라졌습니다.** 훅에서 아무리
     * 걸러도 소용이 없습니다 — 그 순간에는 정말로 회사에 붙어 있었으니까요.
     *
     * 그래서 설정이 올 때까지 아무 데도 안 붙습니다. `prefsSeen`이 그 문입니다.
     * (안 온 것을 없는 것으로 읽지 않기. 이번엔 여기였습니다.)
     */
    let preferred: string | null = usePrefsStore.getState().activeOrg
    let prefsSeen = usePrefsStore.getState().ready
    /**
     * 두 길이 **각자 한 번씩 대답한 뒤에야** '다 찾아봤다'가 됩니다.
     *
     * 예전엔 도메인 쪽이 대답하는 순간 참이 됐습니다. 그런데 붙을 곳을
     * 목록에서 고르게 바꾸면서, 도메인이 답해도 목록이 아직 안 온 순간이
     * 생겼습니다 — 그 틈에 참이 되면 워크스페이스가 있는 사람에게 '만들기'
     * 화면이 한 번 번쩍합니다. 반대로 아무도 안 세우면 영영 '불러오는 중'에
     * 머뭅니다. 실제로 그렇게 됐고, 이건 그 자리입니다.
     */
    let domainSeen = false
    let orgsSeen = false
    /**
     * **내 색인(`userOrgs`)이 대답했는가.**
     *
     * 이게 없어서 다른 워크스페이스의 프로젝트가 번쩍였습니다. 도메인 쪽이
     * 대답하면 그 자리에서 `recompute()`가 돌고, 그때 `indexIds`는 아직
     * 비어 있습니다 — 그러면 `myOrgs`가 **빈 목록**인 채로 `orgsSeen`이
     * 참이 되고, 네 문이 다 열려서 `ready`가 참이 됩니다.
     *
     * `ready`인데 `myOrgs`가 비어 있으면 거르는 쪽은 '숨길 곳이 하나도 없다'로
     * 읽습니다(게스트가 그런 상태입니다). 그래서 **모든 프로젝트가 한 번
     * 보입니다.** 왼쪽 위에 워크스페이스 이름 대신 'bpp-ops'가 뜨는 그 순간이
     * 정확히 여기입니다.
     *
     * 빈 목록이 '없다'가 아니라 '아직 안 왔다'였습니다. 다섯 번째입니다.
     */
    let indexSeen = false
    const settle = () => {
      if (orgsSettled({ domain: domainSeen, index: indexSeen, roster: orgsSeen, prefs: prefsSeen }) && !get().ready) {
        set({ ready: true })
      }
    }

    /** 내 색인에 적힌 것들. 도메인으로 찾은 곳과 합쳐야 목록이 됩니다. */
    let indexIds: string[] = []
    /** 늦게 온 답이 먼저 온 답을 덮지 않도록. */
    let gen = 0

    /**
     * 내 색인에 적힌 조직 중 내가 **멤버인** 첫 곳.
     *
     * 게스트로 들어가 있는 남의 회사는 안 고릅니다. 골라 봐야 회의실도 공개
     * 목록도 못 읽어서 화면이 오류로 채워집니다 — 게스트에게 그 자리는 아예
     * 없는 편이 맞습니다.
     */
    const myOrgsFrom = async (ids: string[]): Promise<{ id: string; name: string }[]> => {
      const out: { id: string; name: string }[] = []
      for (const oid of [...new Set(ids)].sort()) {
        try {
          const roleSnap = await fbGet(ref(db, P.orgMember(oid, email)))
          const role = (roleSnap.val() as { role?: string } | null)?.role
          /**
           * 나간 사람은 여기서 끝입니다. **도메인이어도요.**
           *
           * 아래 줄이 '도메인으로 찾은 곳은 명단에 없어도 내 곳'이라고
           * 하는데, 나간 사람은 명단에 **비석이 있는** 사람입니다. 둘을 안
           * 가르면 나가자마자 색인이 다시 끌어당기고, 붙었는데 규칙이
           * 거절해서 붉은 권한 오류만 봅니다.
           *
           * 없는 것과 지워진 것은 다릅니다.
           */
          if (role === 'removed') continue
          // 도메인으로 찾은 곳은 명단에 아직 없어도 내 곳입니다 — 규칙도
          // 도메인을 예비 근거로 인정합니다. 첫 로그인이 그 자리입니다.
          if (role !== 'member' && oid !== fromDomain) continue
          const nameSnap = await fbGet(ref(db, `${P.orgMeta(oid)}/name`))
          out.push({ id: oid, name: (nameSnap.val() as string | null) || '이름 없는 워크스페이스' })
        } catch { /* 못 읽으면 내 자리가 아닙니다 */ }
      }
      return out
    }

    const attach = (orgId: string) => {
      const metaRef = ref(db, P.orgMeta(orgId))
      const metaHandler = onValue(metaRef, s => {
        const meta = s.val() as { name?: string; domain?: string } | null
        set({ name: meta?.name ?? '', domain: meta?.domain ?? '' })
      })
      const roomsRef = ref(db, P.orgRooms(orgId))
      const roomsHandler = onValue(roomsRef, s => {
        const rooms = list<Room>(s.val())
          .filter(r => r.name)
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))
        set({ rooms })
      }, e => {
        // 내가 시켜서 못 읽게 된 것이면 아무 말도 안 합니다 — 나가기·삭제가
        // 그 자리입니다. 그 외에는 알려야 합니다: 조용히 빈 목록이 되면
        // 회의실이 없는 것과 못 읽는 것이 화면에서 같아 보입니다.
        if (get().teardown) return void set({ rooms: [] })
        set({ rooms: [], error: e instanceof Error ? `회의실을 읽지 못했습니다: ${e.message}` : null })
      })
      const adminsRef = ref(db, P.orgAdmins(orgId))
      const adminsHandler = onValue(adminsRef, s => {
        const raw = (s.val() ?? {}) as Record<string, boolean>
        set({
          admins: Object.entries(raw)
            .filter(([, on]) => on)
            .map(([key]) => key.replace(/,/g, '.'))
            .sort(),
        })
      }, () => set({ admins: [] }))
      const projectsRef = ref(db, P.orgProjects(orgId))
      const projectsHandler = onValue(projectsRef, s => {
        set({
          orgProjects: list<OrgProject>(s.val())
            .filter(p => p.name)
            .sort((a, b) => a.name.localeCompare(b.name)),
        })
      }, () => set({ orgProjects: [] }))

      // 요청은 통째로 한 번에 읽습니다 — 프로젝트마다 리스너를 두면 프로젝트
      // 수만큼 늘어납니다.
      const joinRef = ref(db, P.orgJoinRequests(orgId))
      const joinHandler = onValue(joinRef, s => {
        const raw = (s.val() ?? {}) as Record<string, Record<string, { at?: number; name?: string }>>
        const out: JoinRequest[] = []
        for (const [projectId, people] of Object.entries(raw)) {
          for (const [key, value] of Object.entries(people ?? {})) {
            out.push({ projectId, email: key.replace(/,/g, '.'), name: value?.name, at: value?.at ?? 0 })
          }
        }
        set({ joinRequests: out.sort((a, b) => a.at - b.at) })
      }, () => set({ joinRequests: [] }))

      inner = [
        () => off(metaRef, 'value', metaHandler),
        () => off(roomsRef, 'value', roomsHandler),
        () => off(adminsRef, 'value', adminsHandler),
        () => off(projectsRef, 'value', projectsHandler),
        () => off(joinRef, 'value', joinHandler),
      ]
      set({ orgId, ready: true, error: null })
    }

    const apply = () => {
      /**
       * **내가 멤버인 곳에만 붙습니다.**
       *
       * 예전에는 색인에 적혀 있으면 붙었습니다. 그런데 게스트로 들어가 있는
       * 곳도 색인에는 적히므로, 게스트가 남의 워크스페이스에 붙었다가 회의실을
       * 못 읽고 붉은 오류를 보게 됐습니다 — 자기 것도 아닌 곳의 권한 오류를요.
       *
       * 고른 곳이 우선, 없으면 도메인으로 찾은 곳, 그다음이 목록의 첫 곳.
       * 셋 다 목록에 있어야 합니다. 목록이 아직 안 왔으면 아무 데도 안 붙고,
       * 오는 대로 다시 판단합니다.
       */
      const ids = get().myOrgs.map(o => o.id)
      /**
       * ── 안전망을 걷어냈습니다 ──────────────────────────────────────────────
       *
       * 여기 이런 줄이 있었습니다:
       *
       *     next = pick ?? (ids.length === 0 ? fromDomain : null)
       *
       * '목록이 못 만들어졌다는 이유로 자기 회사에서 쫓겨나면 안 된다'는
       * 뜻이었는데, **목록이 아직 안 온 것과 목록이 빈 것을 구별하지
       * 못했습니다.** 목록은 비동기로 만들어지므로 처음 한 바퀴는 언제나
       * 비어 있고, 그래서 이 줄은 늘 켜졌습니다 — 멤버인지 한 번도 안 묻고
       * 도메인 색인이 가리키는 곳에 붙었습니다.
       *
       * 개인 지메일로 로그인하면 그 자리에서 남의 워크스페이스에 붙었다가
       * 회의실을 못 읽고 붉은 오류를 봤습니다. 자기 것도 아닌 곳의 권한
       * 오류를요. (안 온 것을 없는 것으로 읽지 않기 — 또 여기입니다.)
       *
       * 걷어내도 잃는 것이 없습니다. 지키려던 경우 — 도메인은 맞는데 명단에
       * 아직 행이 없는 첫 로그인 — 는 `myOrgsFrom`이 이미 통과시킵니다
       * (`oid !== fromDomain` 조항). 목록이 답이 되면 안전망은 두 번째 답이고,
       * 두 번째 답은 첫 답과 다를 때만 티가 납니다.
       */
      const next = pickOrg({ preferred, prefsSeen, fromDomain, fromIndex, ids })
      if (next !== current) {
        current = next
        dropInner()
        if (next) {
          attach(next)
        } else {
          // 오류도 같이 지웁니다. 붙어 있지도 않은 곳의 권한 오류가 화면에
          // 남아 있으면, 읽을 수 없는 것이 무엇인지 아무 말도 안 해 줍니다.
          set({ orgId: null, name: '', domain: '', rooms: [], admins: [], orgProjects: [], joinRequests: [], bookings: {}, error: null })
        }
      }
      settle()
    }

    /**
     * 목록을 다시 만듭니다. **두 길 중 어느 쪽이 바뀌어도** 부릅니다.
     *
     * 예전엔 내 색인이 바뀔 때만 만들었습니다. 그런데 도메인으로 찾은 곳이
     * 그보다 늦게 오면 목록에 안 들어가고, 목록에 없으면 안 붙습니다 —
     * 자기 회사에 로그인했는데 '워크스페이스 만들기' 화면이 뜹니다. 실제로
     * 그렇게 됐고, 이건 그 자리입니다.
     */
    const recompute = () => {
      const ids = [...indexIds]
      if (fromDomain) ids.push(fromDomain)
      const mine = ++gen
      void myOrgsFrom(ids).then(list => {
        if (mine !== gen) return
        set({ myOrgs: list })
        fromIndex = list[0]?.id ?? null
        orgsSeen = true
        apply()
      })
    }

    const indexRef = ref(db, P.orgByDomain(email))
    const indexHandler = onValue(indexRef, snap => {
      fromDomain = (snap.val() as string | null) ?? null
      domainSeen = true
      recompute()
      apply()
    }, () => {
      // 색인을 못 읽었습니다. 없는 것과 구별할 수 없으니 '없음'으로 둡니다.
      fromDomain = null
      domainSeen = true
      recompute()
      apply()
    })

    const myOrgsRef = uid ? ref(db, P.userOrgs(uid)) : null
    const myOrgsHandler = myOrgsRef ? onValue(myOrgsRef, snap => {
      indexIds = Object.keys((snap.val() ?? {}) as Record<string, number>)
      indexSeen = true
      recompute()
    }, () => { indexIds = []; indexSeen = true; recompute() }) : null
    // 로그인은 했는데 uid가 없는 경우입니다. 물어볼 색인이 없으니 그 문은
    // 처음부터 열려 있습니다 — 안 그러면 영영 '불러오는 중'에 머뭅니다.
    if (!myOrgsRef) { indexSeen = true; recompute() }

    // 다른 워크스페이스를 고르면 여기로 옵니다. 스토어 둘을 직접 잇지 않고
    // 설정을 통해 잇는 이유는, 그래야 폰에서 고른 것이 노트북에도 오기
    // 때문입니다 — 취향은 계정에 붙습니다.
    const unsubPrefs = usePrefsStore.subscribe(state => {
      if (state.activeOrg === preferred && state.ready === prefsSeen) return
      preferred = state.activeOrg
      prefsSeen = state.ready
      apply()
    })

    return () => {
      off(indexRef, 'value', indexHandler)
      if (myOrgsRef && myOrgsHandler) off(myOrgsRef, 'value', myOrgsHandler)
      unsubPrefs()
      dropInner()
      for (const fn of Object.values(dateWatchers)) fn()
      for (const key of Object.keys(dateWatchers)) delete dateWatchers[key]
      for (const key of Object.keys(wanted)) delete wanted[key]
      set({ orgId: null, name: '', domain: '', myOrgs: [], rooms: [], admins: [], orgProjects: [], joinRequests: [], bookings: {}, ready: false })
    }
  },

  watchDates: (who, dates) => {
    const { orgId } = get()
    if (!orgId) return
    wanted[who] = dates
    const union = [...new Set(Object.values(wanted).flat())]
    for (const date of union) {
      if (dateWatchers[date]) continue
      const node = ref(db, P.orgBookings(orgId, date))
      const handler = onValue(node, s => {
        set(state => ({ bookings: { ...state.bookings, [date]: list<Booking>(s.val()) } }))
      }, () => {
        set(state => ({ bookings: { ...state.bookings, [date]: [] } }))
      })
      dateWatchers[date] = () => off(node, 'value', handler)
    }
    // 아무도 안 보는 날짜는 놓습니다. 한 달을 넘기며 스크롤하면 리스너가
    // 계속 쌓입니다.
    for (const date of Object.keys(dateWatchers)) {
      if (union.includes(date)) continue
      dateWatchers[date]()
      delete dateWatchers[date]
      set(state => {
        const next = { ...state.bookings }
        delete next[date]
        return { bookings: next }
      })
    }
  },

  /**
   * 도메인 없는 조직. 들어오는 길은 초대뿐입니다.
   *
   * 도메인형과 순서가 다릅니다 — 색인(`orgByDomain`)을 안 씁니다. 이 조직을
   * 찾는 길은 `userOrgs`뿐이고, 그래서 그것을 **반드시** 적어야 합니다.
   * 안 적으면 방금 만든 조직을 자기도 못 찾습니다.
   */
  createInviteOrg: async (name, email) => {
    const uid = useAuthStore.getState().uid
    if (!uid || !name.trim()) return false
    const orgId = gid()
    const me = emailKey(email)
    try {
      // meta가 먼저입니다. 규칙이 owner를 meta에서 읽으므로, 이게 없으면
      // 만든 사람조차 명단에 자기를 못 올립니다.
      await fbSet(ref(db, P.orgMeta(orgId)), {
        name: name.trim(),
        owner: me,
        createdBy: email.toLowerCase(),
        createdAt: Date.now(),
      })
      await fbSet(ref(db, P.orgMember(orgId, email)), { role: 'member', at: Date.now() })
      await fbSet(ref(db, P.orgAdmin(orgId, email)), true)
      // 마지막에 내 색인. 이 쓰기가 구독을 깨웁니다.
      await fbUpdate(ref(db, P.userOrgs(uid)), { [orgId]: Date.now() })
      // 그리고 방금 만든 곳으로 들어갑니다. 안 그러면 이미 다른 워크스페이스에
      // 있던 사람에게는 **아무 일도 안 일어난 것처럼** 보입니다 — 목록에만
      // 한 줄이 늘고 화면은 그대로니까요.
      usePrefsStore.getState().setActiveOrg(email, orgId)
      set({ error: null })
      return true
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '조직을 만들지 못했습니다' })
      return false
    }
  },

  createOrg: async (name, email) => {
    const key = domainKey(email)
    if (!key) return false

    /**
     * 조직의 경계는 도메인입니다. 그 도메인이 회사 것일 때만 경계가 됩니다.
     *
     * gmail.com으로 조직을 만들면 이 앱을 쓰는 **모든 지메일 사용자**가
     * 그 조직의 구성원이 됩니다 — 회의실 목록을 읽고, 예약을 잡고, 조직에
     * 공개된 프로젝트 목록을 봅니다. 도메인이 회사를 뜻하지 않는 곳에서는
     * '같은 도메인 = 같은 회사'라는 전제가 통째로 무너집니다.
     *
     * 데이터베이스 규칙에도 같은 목록이 있습니다. 이 검사는 사람에게 이유를
     * 말해 주기 위한 것이고, 막는 것은 규칙입니다 — 화면을 우회해도 안 됩니다.
     */
    if (PUBLIC_DOMAINS.has(key.replace(/,/g, '.'))) {
      set({ error: '회사 도메인으로만 조직을 만들 수 있습니다. 지메일·네이버 같은 주소는 같은 회사를 뜻하지 않습니다.' })
      return false
    }
    const orgId = gid()
    try {
      // meta를 먼저 씁니다. 규칙이 도메인을 meta에서 읽으므로, 색인이 먼저
      // 생기면 아무도 그 조직에 아무것도 못 씁니다.
      await fbSet(ref(db, P.orgMeta(orgId)), {
        name: name.trim() || key.replace(/,/g, '.'),
        domain: key.replace(/,/g, '.'),
        createdBy: email.toLowerCase(),
        createdAt: Date.now(),
      })
      /**
       * 만든 사람이 첫 관리자입니다.
       *
       * 색인보다 **먼저** 씁니다. 색인이 먼저 생기면 다른 사람 화면에 조직이
       * 뜨는데 관리자는 아직 아무도 없고, 그 틈에 아무나 자기를 관리자로
       * 만들 수 있습니다(규칙의 '관리자 없는 조직' 조항). 틈을 안 만듭니다.
       */
      await fbSet(ref(db, P.orgAdmin(orgId, email)), true)
      await fbSet(ref(db, P.orgByDomain(email)), orgId)
      usePrefsStore.getState().setActiveOrg(email, orgId)
      // orgId를 직접 넣지 않습니다. 색인을 보고 있으므로 이 쓰기가 그
      // 리스너를 깨우고, 거기서 meta와 회의실 구독까지 같이 붙습니다.
      // 손으로 넣으면 화면에는 조직이 있는데 아무도 안 듣는 상태가 됩니다.
      set({ error: null })
      return true
    } catch (e) {
      // 색인이 이미 있으면 누군가 먼저 만든 것입니다 — 오류가 아니라 경쟁입니다.
      set({ error: e instanceof Error ? e.message : '조직을 만들지 못했습니다' })
      return false
    }
  },

  addRoom: async (name, note) => {
    const { orgId, rooms } = get()
    if (!orgId || !name.trim()) return
    const node = push(ref(db, P.orgRooms(orgId)))
    await fbSet(node, {
      name: name.trim(),
      ...(note?.trim() ? { note: note.trim() } : {}),
      order: rooms.length,
      active: true,
    }).catch(e => set({ error: e instanceof Error ? e.message : '회의실 추가 실패' }))
  },

  updateRoom: async (id, patch) => {
    const { orgId } = get()
    if (!orgId) return
    await fbUpdate(ref(db, P.orgRoom(orgId, id)), patch)
      .catch(e => set({ error: e instanceof Error ? e.message : '회의실 수정 실패' }))
  },

  setProjectShared: async (project, on) => {
    const { orgId, admins: _a } = get()
    if (!orgId) return false
    /**
     * **자기 워크스페이스에만 공개합니다.**
     *
     * 여기서 쓰던 `orgId`는 '지금 서 있는 곳'입니다. 워크스페이스가 하나일
     * 때는 그게 곧 그 프로젝트의 곳이었는데, 둘이 되는 순간 아닙니다 —
     * B에 서서 블랙페이퍼 프로젝트를 공개하면 그 **이름이 B의 공개 목록에**
     * 올라갑니다. 내용은 여전히 프로젝트 멤버만 보지만, 이름도 말을 합니다.
     *
     * 옮겨 붙이는 대신 거절합니다. 어느 목록에 올리는지 안 보이는 채로
     * 올라가는 것보다, 그쪽으로 가서 누르는 편이 무슨 일이 일어나는지
     * 분명합니다. (소속이 없는 프로젝트는 지금 서 있는 곳에 올립니다 —
     * 올릴 다른 곳이 없습니다.)
     */
    if (project.orgId && project.orgId !== orgId) {
      set({ error: '다른 워크스페이스의 프로젝트입니다. 그쪽으로 전환한 뒤에 공개해 주세요.' })
      return false
    }
    try {
      if (on) {
        await fbSet(ref(db, P.orgProject(orgId, project.id)), {
          name: project.name,
          ...(project.color ? { color: project.color } : {}),
          by: useAuthStore.getState().email?.toLowerCase() ?? '',
          at: Date.now(),
        })
      } else {
        // 내릴 때 요청도 같이 치웁니다. 목록에 없는 프로젝트에 대한 요청은
        // 아무도 볼 데가 없는 채로 남습니다.
        await remove(ref(db, `${P.orgJoinRequests(orgId)}/${project.id}`)).catch(() => {})
        await remove(ref(db, P.orgProject(orgId, project.id)))
      }
      set({ error: null })
      return true
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '조직 목록을 바꾸지 못했습니다' })
      return false
    }
  },

  /**
   * 이름 사본을 맞춥니다.
   *
   * 사본은 늙습니다 — 프로젝트 이름을 바꾸면 조직 목록에는 옛 이름이 남습니다.
   * 이름을 바꾸는 사람은 그 프로젝트 멤버이므로 규칙상 사본을 쓸 수 있고,
   * 그러니 그 자리에서 같이 고치는 게 맞습니다. 목록에 없는 프로젝트면
   * 아무 일도 안 합니다.
   */
  syncProjectName: (projectId, name) => {
    const { orgId, orgProjects } = get()
    if (!orgId) return
    if (!orgProjects.some(p => p.id === projectId)) return
    void fbUpdate(ref(db, P.orgProject(orgId, projectId)), { name }).catch(() => {})
  },

  requestJoin: async (projectId, email, name) => {
    const { orgId } = get()
    if (!orgId) return false
    try {
      await fbSet(ref(db, P.orgJoinRequest(orgId, projectId, email)), {
        at: Date.now(),
        ...(name ? { name } : {}),
      })
      set({ error: null })
      return true
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '요청을 보내지 못했습니다' })
      return false
    }
  },

  clearJoinRequest: async (projectId, email) => {
    const { orgId } = get()
    if (!orgId) return
    await remove(ref(db, P.orgJoinRequest(orgId, projectId, email)))
      .catch(e => set({ error: e instanceof Error ? e.message : '요청을 지우지 못했습니다' }))
  },

  removeRoom: async (id) => {
    const { orgId } = get()
    if (!orgId) return
    await remove(ref(db, P.orgRoom(orgId, id)))
      .catch(e => set({ error: e instanceof Error ? e.message : '회의실 삭제 실패' }))
  },

  /**
   * 관리자 없는 조직을 맡습니다.
   *
   * 이 조직은 관리자 개념이 생기기 전에 만들어졌습니다. 규칙은 관리자가 없는
   * 조직을 조직원 누구나 맡을 수 있게 해 두었는데(영원히 손 못 대는 조직이
   * 남지 않게 하는 안전장치), 화면에는 그 길이 없어서 자기가 만든 조직을
   * 읽기만 하는 상태가 됐습니다. 규칙이 허용하는 일은 화면에도 있어야 합니다.
   */
  leaveOrg: async (oid, email, uid) => {
    set({ teardown: true })
    try {
      await fbSet(ref(db, P.orgMember(oid, email)), { role: 'removed', at: Date.now() })
      // 내 색인에서도 뺍니다. 안 빼면 다음에 켤 때 후보로 다시 서고,
      // 명단이 'removed'라 못 붙어서 조용히 아무 데도 아닌 상태가 됩니다.
      await remove(ref(db, P.userOrg(uid, oid))).catch(() => {})
      if (usePrefsStore.getState().activeOrg === oid) {
        const next = get().myOrgs.find(o => o.id !== oid)
        if (next) usePrefsStore.getState().setActiveOrg(email, next.id)
      }
      set({ error: null })
      // 리스너가 떨어질 틈을 주고 깃발을 내립니다. 바로 내리면 마지막
      // 거절이 그 뒤에 도착해서 결국 번쩍입니다.
      setTimeout(() => set({ teardown: false, error: null }), 1500)
      return true
    } catch (e) {
      // 실패했으면 아직 여기 있습니다. 깃발을 바로 내리고, 방금 쓴 오류는
      // 그대로 둡니다 — 나중에 지우면 사람이 실패를 못 봅니다.
      set({ teardown: false, error: e instanceof Error ? e.message : '나가지 못했습니다' })
      return false
    }
  },

  deleteOrg: async (oid, email, uid) => {
    /**
     * ── 장부를 먼저 훑습니다 ──────────────────────────────────────────────
     *
     * `owns`에는 이 워크스페이스에 찍힌 프로젝트가 적혀 있는데, 예전에는
     * 넣기만 되고 빼기가 안 돼서 이미 지운 것도 남아 있습니다.
     *
     * 그런데 화면에서는 '지워진 것'과 '내가 멤버가 아닌 것'을 구별할 수가
     * 없습니다 — 둘 다 못 읽으니까요. 그래서 **지워 봅니다.** 규칙은 위에서
     * 다 보므로, 프로젝트가 정말 없어졌으면 통과시키고 살아 있으면 거절
     * 합니다. 남는 줄이 곧 살아 있는 프로젝트입니다.
     */
    let remaining = 0
    set({ teardown: true })
    try {
      const owns = (await fbGet(ref(db, P.orgOwns(oid)))).val() as Record<string, boolean> | null
      for (const pid of Object.keys(owns ?? {})) {
        const gone = await remove(ref(db, `${P.orgOwns(oid)}/${pid}`)).then(() => true).catch(() => false)
        if (!gone) remaining++
      }
    } catch {
      set({ teardown: false })
      return { ok: false, remaining: -1, error: '워크스페이스의 프로젝트를 확인하지 못했습니다' }
    }
    // 못 지운 경우입니다. 아직 여기 있으므로 오류는 다시 말해야 합니다.
    if (remaining > 0) { set({ teardown: false }); return { ok: false, remaining } }

    try {
      // 도메인 색인을 먼저 뺍니다. 워크스페이스가 사라진 뒤에는 규칙이
      // 관리자인지 확인할 곳이 없어서 색인만 남습니다 — 그러면 그 도메인으로
      // 아무도 새 워크스페이스를 못 만듭니다(색인은 한 번만 씁니다).
      // 지금 서 있는 곳일 때만 색인을 건드립니다. `domain`은 '붙어 있는
      // 워크스페이스의 도메인'이라, 다른 곳을 지우는데 이걸 쓰면 엉뚱한
      // 색인을 지웁니다.
      if (oid === get().orgId && get().domain) await remove(ref(db, P.orgByDomain(email))).catch((e: unknown) => console.warn('[org delete] 색인', e))
      await remove(ref(db, P.org(oid)))
      await remove(ref(db, P.userOrg(uid, oid))).catch(() => {})
      set({ error: null })
      // 리스너가 떨어질 틈을 주고 깃발을 내립니다. 바로 내리면 마지막
      // 거절이 그 뒤에 도착해서 결국 번쩍입니다.
      setTimeout(() => set({ teardown: false, error: null }), 1500)
      return { ok: true, remaining: 0 }
    } catch (e) {
      set({ teardown: false })
      return { ok: false, remaining: 0, error: e instanceof Error ? e.message : '워크스페이스를 지우지 못했습니다' }
    }
  },

  claimAdmin: async (email) => {
    const { orgId, admins } = get()
    if (!orgId) return false
    if (admins.length) {
      set({ error: '이미 관리자가 있습니다' })
      return false
    }
    try {
      await fbSet(ref(db, P.orgAdmin(orgId, email)), true)
      set({ error: null })
      return true
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '관리자가 되지 못했습니다' })
      return false
    }
  },

  setAdmin: async (email, on) => {
    const { orgId, domain, admins } = get()
    if (!orgId) return false
    const address = email.trim().toLowerCase()
    /**
     * 도메인형에서는 우리 도메인 주소만 관리자가 됩니다 — 도메인이 곧 경계라
     * 밖의 주소를 세우면 경계가 뚫립니다.
     *
     * **초대형에는 도메인이 없습니다.** 그런데 이 검사가 `@` 하나로 끝나는
     * 문자열을 찾고 있어서 아무 주소도 통과하지 못했고, 오류 문구도 '  주소만
     * 관리자가 될 수 있습니다'로 앞이 빈 채 떴습니다. 그쪽의 경계는 도메인이
     * 아니라 **명단**이라, 명단에 있는 사람인지를 대신 봅니다.
     */
    if (domain) {
      if (!address.endsWith(`@${domain.toLowerCase()}`)) {
        set({ error: `${domain} 주소만 관리자가 될 수 있습니다` })
        return false
      }
    } else {
      const row = await fbGet(ref(db, P.orgMember(orgId, address))).catch(() => null)
      if ((row?.val() as { role?: string } | null)?.role !== 'member') {
        set({ error: '이 워크스페이스의 멤버만 관리자가 될 수 있습니다' })
        return false
      }
    }
    /**
     * 마지막 관리자는 스스로 못 나갑니다.
     *
     * 규칙은 관리자 없는 조직을 아무나 가져갈 수 있게 해 두었습니다 — 영원히
     * 손 못 대는 조직이 생기지 않게 하는 안전장치입니다. 그렇다고 마지막
     * 관리자가 실수로 나가서 회의실 목록이 아무나 고치는 상태가 되는 건
     * 다른 얘기입니다. 나가려면 먼저 다음 사람을 세웁니다.
     */
    if (!on && admins.length <= 1) {
      set({ error: '관리자가 한 명뿐입니다. 다른 사람을 먼저 관리자로 지정해 주세요.' })
      return false
    }
    try {
      if (on) await fbSet(ref(db, `${P.orgAdmins(orgId)}/${emailKey(address)}`), true)
      else await remove(ref(db, `${P.orgAdmins(orgId)}/${emailKey(address)}`))
      set({ error: null })
      return true
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '관리자를 바꾸지 못했습니다' })
      return false
    }
  },

  book: async ({ date, roomId, from, to, title, eventId, by, byName }) => {
    const { orgId } = get()
    if (!orgId) return false
    const node = push(ref(db, P.orgBookings(orgId, date)))
    const roomName = get().rooms.find(r => r.id === roomId)?.name
    try {
      await fbSet(node, {
        roomId, from, to,
        ...(roomName ? { roomName } : {}),
        by: by.toLowerCase(),
        ...(byName ? { byName } : {}),
        ...(title ? { title } : {}),
        ...(eventId ? { eventId } : {}),
        at: Date.now(),
      })
      return true
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '회의실을 잡지 못했습니다' })
      return false
    }
  },

  release: async (date, bookingId) => {
    const { orgId } = get()
    if (!orgId) return
    await remove(ref(db, P.orgBooking(orgId, date, bookingId)))
      .catch(e => set({ error: e instanceof Error ? e.message : '예약을 풀지 못했습니다' }))
  },

  releaseForEvent: async (date, eventId) => {
    const { bookings, release } = get()
    for (const b of bookings[date] ?? []) {
      if (b.eventId === eventId) await release(date, b.id)
    }
  },

  retitleForEvent: async (date, eventId, title) => {
    const { orgId, bookings } = get()
    if (!orgId) return
    for (const b of bookings[date] ?? []) {
      if (b.eventId !== eventId || b.title === title) continue
      await fbUpdate(ref(db, P.orgBooking(orgId, date, b.id)), { title }).catch(() => {})
    }
  },
}))

/** 날짜별 리스너. 스토어 밖에 두는 이유는 이게 상태가 아니라 자원이기 때문입니다. */
const dateWatchers: Record<string, () => void> = {}
/** 누가 어느 날짜를 보고 있는가. 합집합이 실제로 구독하는 날짜입니다. */
const wanted: Record<string, string[]> = {}

/**
 * 없는 날짜를 물었을 때 돌려주는 **같은** 빈 배열.
 *
 * `s.bookings[date] ?? []`로 쓰면 부를 때마다 새 배열이 나옵니다. zustand는
 * 참조로 비교하므로 그건 '값이 매번 바뀐다'는 뜻이고, 그리면 또 바뀌고 또
 * 그리게 됩니다 — React #185(무한 렌더). 업무를 눌렀을 때 '캘린더 로드 오류'가
 * 뜬 것이 이것입니다. 빈 값도 같은 빈 값이어야 합니다.
 */
export const NO_BOOKINGS: Booking[] = []

/**
 * 그 시간에 그 방을 쓰는 예약들.
 *
 * `exceptEventId`는 '이미 내가 이 일정으로 잡아 둔 것'을 뺍니다 — 시간을
 * 30분 미루려는데 자기 자신과 겹친다고 막으면 아무것도 못 고칩니다.
 */
export function clashesFor(
  bookings: Booking[],
  roomId: string,
  range: { from: number; to: number },
  exceptEventId?: string,
): Booking[] {
  return bookings.filter(b =>
    b.roomId === roomId &&
    (!exceptEventId || b.eventId !== exceptEventId) &&
    overlaps(b, range),
  )
}
