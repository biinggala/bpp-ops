import { create } from 'zustand'
import { onValue, off, orderByChild, push, query, ref, remove, set as fbSet, startAt, update as fbUpdate } from 'firebase/database'
import { db } from '../lib/firebase'
import { P } from '../lib/paths'
import { fmtYMD } from '../lib/utils'
import { gearClash, gearRangeError, type GearBooking, type GearRange } from '../lib/gear'

/**
 * ── 장비 ─────────────────────────────────────────────────────────────────────
 *
 * 회의실 옆에 두지 않고 스토어를 따로 냈습니다. 회의실은 일정을 만드는 길
 * 위에 있어서 앱 어디서나 필요하지만, 장비는 **자기 화면 하나**가 전부입니다.
 * 늘 듣고 있을 이유가 없어서 그 화면이 열릴 때만 붙습니다.
 *
 * 세 가지가 여기 삽니다.
 *
 *   장비 목록   회의실 목록과 같습니다. 관리자가 고칩니다.
 *   팀 목록     '어느 팀이 잡았나'를 말하기 위한 이름표입니다. **경계가
 *               아닙니다** — 팀이 다르다고 안 보이는 것은 없습니다.
 *   예약        오늘 이후에 끝나는 것만 읽습니다. 지난 예약은 서버에 남아
 *               있지만 아무도 안 물어서 안 실려 옵니다.
 */

export interface Team {
  id: string
  name: string
  order?: number
}

export interface Gear {
  id: string
  name: string
  /** '35mm 렌즈', '2번 삼각대' 같은 한 줄. */
  note?: string
  order?: number
  /**
   * '카메라', '조명', '송수신기' 같은 묶음.
   *
   * 목록을 따로 관리하지 않습니다 — 여기 적힌 값에서 뽑아냅니다. 관리하는
   * 목록을 두면 빈 종류와, 지워진 종류를 가리키는 장비가 생깁니다.
   * `src/lib/gear.ts`의 groupGear 참고.
   */
  kind?: string
  /** 고장 났거나 수리 중. 지우는 대신 끕니다 — 회의실과 같은 이유입니다. */
  active?: boolean
}

interface GearState {
  ready: boolean
  gear: Gear[]
  teams: Team[]
  /** 이메일(점 있는 주소) → 팀 id. */
  teamOf: Record<string, string>
  bookings: GearBooking[]
  error: string | null
  clearError: () => void

  /** 그 화면이 열려 있는 동안만. 돌려주는 함수를 부르면 놓습니다. */
  subscribe: (orgId: string) => () => void

  addGear: (name: string, note?: string, kind?: string) => Promise<void>
  /** `kind: null`은 종류를 지웁니다 — 빈 문자열을 남기면 '종류 없음'이 값이 됩니다. */
  updateGear: (id: string, patch: Partial<Omit<Gear, 'id' | 'kind'>> & { kind?: string | null }) => Promise<void>
  removeGear: (id: string) => Promise<void>

  addTeam: (name: string) => Promise<void>
  renameTeam: (id: string, name: string) => Promise<void>
  removeTeam: (id: string) => Promise<void>
  /** null이면 소속을 지웁니다. */
  setMemberTeam: (email: string, teamId: string | null) => Promise<boolean>

  /**
   * 한 번의 예약에 **장비 여럿**.
   *
   * 촬영을 나가면 카메라 하나, 렌즈 둘, 조명 셋, 삼각대가 같은 날 같은 이유로
   * 같이 나갑니다. 한 개씩 잡게 하면 같은 폼을 일곱 번 채우게 되고, 그러면
   * 여섯 번째쯤에서 사유가 달라집니다.
   *
   * 저장은 **장비마다 한 줄**입니다 — 겹침을 재는 자리(gearClash)와 현황판의
   * 줄이 둘 다 장비 하나를 봅니다. 대신 같이 잡은 것들은 `group`을 공유해서,
   * 화면에서는 한 건으로 읽히고 풀 때도 한 번에 풀립니다.
   */
  book: (input: GearRange & {
    gearIds: string[]
    by: string
    byName?: string
    team?: string
    reason: string
    extra?: string
  }) => Promise<boolean>
  /** 한 줄만. */
  release: (id: string) => Promise<boolean>
  /** 같이 잡은 것 전부. 화면에서 한 건으로 보이는 것은 한 번에 풀려야 합니다. */
  releaseGroup: (group: string) => Promise<boolean>
}

function list<T>(raw: unknown): (T & { id: string })[] {
  if (!raw || typeof raw !== 'object') return []
  return Object.entries(raw as Record<string, T>).map(([id, v]) => ({ ...(v as T), id }))
}

let orgIdNow: string | null = null

export const useGearStore = create<GearState>((set, get) => ({
  ready: false,
  gear: [],
  teams: [],
  teamOf: {},
  bookings: [],
  error: null,
  clearError: () => set({ error: null }),

  subscribe: (orgId) => {
    orgIdNow = orgId
    const gearRef = ref(db, P.orgGear(orgId))
    const gearHandler = onValue(gearRef, s => {
      set({
        gear: list<Gear>(s.val())
          .filter(g => g.name)
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)),
        ready: true,
      })
    }, e => set({ gear: [], ready: true, error: e instanceof Error ? `장비 목록을 읽지 못했습니다: ${e.message}` : null }))

    const teamsRef = ref(db, P.orgTeams(orgId))
    const teamsHandler = onValue(teamsRef, s => {
      set({
        teams: list<Team>(s.val())
          .filter(t => t.name)
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)),
      })
    }, () => set({ teams: [] }))

    const teamOfRef = ref(db, P.orgTeamOf(orgId))
    const teamOfHandler = onValue(teamOfRef, s => {
      const raw = (s.val() ?? {}) as Record<string, string>
      const out: Record<string, string> = {}
      for (const [key, tid] of Object.entries(raw)) {
        if (typeof tid === 'string' && tid) out[key.replace(/,/g, '.')] = tid
      }
      set({ teamOf: out })
    }, () => set({ teamOf: {} }))

    /*
      **오늘 이후에 끝나는 것만.** 반납일로 색인해 두었으므로 이 한 줄이
      '아직 안 끝난 예약 전부'입니다 — 어제 시작해 다음 주에 돌아오는 장기
      대여도 여기 걸립니다. 시작일로 색인했다면 그게 빠졌을 겁니다.
    */
    const bookRef = query(ref(db, P.orgGearBookings(orgId)), orderByChild('to'), startAt(fmtYMD(new Date())))
    const bookHandler = onValue(bookRef, s => {
      set({
        bookings: list<GearBooking>(s.val())
          .filter(b => b.gearId && b.from && b.to)
          .sort((a, b) => a.from.localeCompare(b.from) || a.fromMin - b.fromMin),
      })
    }, e => set({ bookings: [], error: e instanceof Error ? `예약을 읽지 못했습니다: ${e.message}` : null }))

    return () => {
      off(gearRef, 'value', gearHandler)
      off(teamsRef, 'value', teamsHandler)
      off(teamOfRef, 'value', teamOfHandler)
      off(bookRef, 'value', bookHandler)
      orgIdNow = null
      set({ ready: false, gear: [], teams: [], teamOf: {}, bookings: [] })
    }
  },

  addGear: async (name, note, kind) => {
    if (!orgIdNow || !name.trim()) return
    const node = push(ref(db, P.orgGear(orgIdNow)))
    await fbSet(node, {
      name: name.trim(),
      ...(note?.trim() ? { note: note.trim() } : {}),
      ...(kind?.trim() ? { kind: kind.trim() } : {}),
      order: get().gear.length,
      active: true,
    }).catch(e => set({ error: e instanceof Error ? e.message : '장비를 더하지 못했습니다' }))
  },

  updateGear: async (id, patch) => {
    if (!orgIdNow) return
    await fbUpdate(ref(db, P.orgGearItem(orgIdNow, id)), patch)
      .catch(e => set({ error: e instanceof Error ? e.message : '장비를 고치지 못했습니다' }))
  },

  removeGear: async (id) => {
    if (!orgIdNow) return
    await remove(ref(db, P.orgGearItem(orgIdNow, id)))
      .catch(e => set({ error: e instanceof Error ? e.message : '장비를 지우지 못했습니다' }))
  },

  addTeam: async (name) => {
    if (!orgIdNow || !name.trim()) return
    const node = push(ref(db, P.orgTeams(orgIdNow)))
    await fbSet(node, { name: name.trim(), order: get().teams.length })
      .catch(e => set({ error: e instanceof Error ? e.message : '팀을 더하지 못했습니다' }))
  },

  renameTeam: async (id, name) => {
    if (!orgIdNow || !name.trim()) return
    await fbUpdate(ref(db, P.orgTeam(orgIdNow, id)), { name: name.trim() })
      .catch(e => set({ error: e instanceof Error ? e.message : '팀 이름을 바꾸지 못했습니다' }))
  },

  /**
   * 팀을 지웁니다. **소속은 안 지웁니다.**
   *
   * 남은 소속은 화면에서 그냥 안 보입니다. 오십 명의 줄을 지우려면 오십 번
   * 써야 하고, 그중 몇 개가 실패하면 절반만 지워진 상태가 남습니다. 그리고
   * 지난 예약은 잡을 때의 팀 이름을 사본으로 들고 있어서 계속 읽힙니다.
   */
  removeTeam: async (id) => {
    if (!orgIdNow) return
    await remove(ref(db, P.orgTeam(orgIdNow, id)))
      .catch(e => set({ error: e instanceof Error ? e.message : '팀을 지우지 못했습니다' }))
  },

  setMemberTeam: async (email, teamId) => {
    if (!orgIdNow) return false
    const address = email.trim().toLowerCase()
    if (!address) return false
    try {
      const node = ref(db, P.orgMyTeam(orgIdNow, address))
      if (teamId) await fbSet(node, teamId)
      else await remove(node)
      set({ error: null })
      return true
    } catch (e) {
      set({ error: e instanceof Error && /permission/i.test(e.message)
        ? '내 소속과, 관리자면 남의 소속을 정할 수 있습니다.'
        : e instanceof Error ? e.message : '소속을 정하지 못했습니다' })
      return false
    }
  },

  book: async ({ gearIds, from, to, fromMin, toMin, long, by, byName, team, reason, extra }) => {
    if (!orgIdNow) return false
    const ids = [...new Set(gearIds)].filter(Boolean)
    if (!ids.length) { set({ error: '장비를 하나 이상 담아 주세요.' }); return false }
    const range: GearRange = { from, to, fromMin, toMin, ...(long ? { long: true } : {}) }
    /*
      마지막 문입니다. 화면이 먼저 막고 누가 잡고 있는지도 말해 주지만,
      화면과 규칙 사이에는 늘 시간이 조금 있습니다.
    */
    const bad = gearRangeError(range)
    if (bad) { set({ error: bad }); return false }
    if (!reason.trim()) { set({ error: '사용 내용을 적어 주세요.' }); return false }

    // **먼저 전부 봅니다.** 하나씩 쓰면서 검사하면 다섯 개 중 넷이 들어간
    // 뒤에 다섯 번째가 막히고, 절반만 잡힌 예약이 남습니다.
    const { bookings, gear, teams } = get()
    for (const gearId of ids) {
      const held = gearClash(bookings, gearId, range)
      if (held) {
        const name = gear.find(g => g.id === gearId)?.name ?? '장비'
        set({ error: `'${name}'은 이미 ${held.byName || held.by} 님이 잡아 두었습니다.` })
        return false
      }
    }

    const teamName = teams.find(t => t.id === team)?.name
    const group = push(ref(db, P.orgGearBookings(orgIdNow))).key ?? ''
    const written: string[] = []
    try {
      for (const gearId of ids) {
        const node = push(ref(db, P.orgGearBookings(orgIdNow)))
        await fbSet(node, {
          gearId, from, to, fromMin, toMin,
          ...(long ? { long: true } : {}),
          ...(gear.find(g => g.id === gearId)?.name ? { gearName: gear.find(g => g.id === gearId)!.name } : {}),
          ...(group ? { group } : {}),
          by: by.toLowerCase(),
          ...(byName ? { byName } : {}),
          ...(team ? { team } : {}),
          ...(teamName ? { teamName } : {}),
          reason: reason.trim(),
          ...(extra?.trim() ? { extra: extra.trim() } : {}),
          at: Date.now(),
        })
        if (node.key) written.push(node.key)
      }
      set({ error: null })
      return true
    } catch (e) {
      // 중간에 막히면 쓴 것을 도로 걷습니다 — 반만 잡힌 예약은 아무도 못 읽고,
      // 다음 사람에게는 '차 있는데 왜 차 있는지 모르는 자리'가 됩니다.
      for (const id of written) await remove(ref(db, P.orgGearBooking(orgIdNow, id))).catch(() => {})
      set({ error: e instanceof Error ? e.message : '장비를 잡지 못했습니다' })
      return false
    }
  },

  releaseGroup: async (group) => {
    if (!orgIdNow || !group) return false
    const rows = get().bookings.filter(b => b.group === group)
    for (const row of rows) {
      if (!await get().release(row.id)) return false
    }
    return true
  },

  release: async (id) => {
    if (!orgIdNow) return false
    try {
      await remove(ref(db, P.orgGearBooking(orgIdNow, id)))
      set({ error: null })
      return true
    } catch (e) {
      set({ error: e instanceof Error && /permission/i.test(e.message)
        ? '잡은 사람만 풀 수 있습니다.'
        : e instanceof Error ? e.message : '예약을 풀지 못했습니다' })
      return false
    }
  },
}))

/** 내 소속 팀. 없으면 null — **안 정한 것과 못 읽은 것을 안 가릅니다**(둘 다 없음). */
export function teamOfEmail(teamOf: Record<string, string>, teams: Team[], email: string | null | undefined): Team | null {
  if (!email) return null
  const tid = teamOf[email.toLowerCase()]
  return teams.find(t => t.id === tid) ?? null
}
