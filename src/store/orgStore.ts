import { create } from 'zustand'
import { onValue, push, ref, remove, set as fbSet, update as fbUpdate, off } from 'firebase/database'
import { db } from '../lib/firebase'
import { P, domainKey, emailKey } from '../lib/paths'
import { gid } from '../lib/utils'
import { useAuthStore } from './authStore'

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
  /** 조직을 찾는 첫 조회가 끝났는가. 그 전에는 '없다'고 말하지 않습니다. */
  ready: boolean
  error: string | null

  subscribe: (email: string) => () => void
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

  createOrg: (name: string, email: string) => Promise<boolean>
  addRoom: (name: string, note?: string) => Promise<void>
  updateRoom: (id: string, patch: Partial<Omit<Room, 'id'>>) => Promise<void>
  /** 관리자를 더하거나 뺍니다. 우리 도메인 주소만 됩니다. */
  setAdmin: (email: string, on: boolean) => Promise<boolean>

  /** 프로젝트를 조직 목록에 올리거나 내립니다. 그 프로젝트 멤버만. */
  setProjectShared: (project: { id: string; name: string; color?: string }, on: boolean) => Promise<boolean>
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
  /** 관리자가 아무도 없는 조직을 맡습니다. 규칙도 이걸 허용합니다. */
  claimAdmin: (email: string) => Promise<boolean>
  release: (date: string, bookingId: string) => Promise<void>
  /** 일정을 지우거나 회의실을 바꿀 때. 그 일정에 붙은 예약을 다 풉니다. */
  releaseForEvent: (date: string, eventId: string) => Promise<void>
}

const list = <T,>(node: Record<string, Omit<T, 'id'>> | null | undefined): (T & { id: string })[] =>
  Object.entries(node ?? {}).map(([id, v]) => ({ ...(v as object), id }) as T & { id: string })

/**
 * 두 시간 구간이 겹치는가.
 *
 * 끝과 시작이 같은 것은 겹침이 아닙니다 — 2시에 끝나는 회의와 2시에
 * 시작하는 회의는 같은 방을 쓸 수 있고, 그게 회의실이 돌아가는 방식입니다.
 */
export const overlaps = (a: { from: number; to: number }, b: { from: number; to: number }) =>
  a.from < b.to && b.from < a.to

export const useOrgStore = create<OrgState>((set, get) => ({
  orgId: null,
  name: '',
  domain: '',
  rooms: [],
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
  subscribe: (email) => {
    let inner: (() => void)[] = []
    const dropInner = () => { inner.forEach(fn => fn()); inner = [] }

    const indexRef = ref(db, P.orgByDomain(email))
    const indexHandler = onValue(indexRef, snap => {
      const orgId = (snap.val() as string | null) ?? null
      dropInner()
      if (!orgId) {
        set({ ready: true, orgId: null, name: '', domain: '', rooms: [], admins: [], orgProjects: [], joinRequests: [], bookings: {} })
        return
      }

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
        // 규칙이 거절한 것도 알려야 합니다. 조용히 빈 목록이 되면 회의실이
        // 없는 것과 못 읽는 것이 화면에서 같아 보입니다.
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
    }, () => {
      // 색인을 못 읽었습니다. 없는 것과 구별할 수 없으니 '없음'으로 둡니다.
      set({ ready: true, orgId: null })
    })

    return () => {
      off(indexRef, 'value', indexHandler)
      dropInner()
      for (const fn of Object.values(dateWatchers)) fn()
      for (const key of Object.keys(dateWatchers)) delete dateWatchers[key]
      for (const key of Object.keys(wanted)) delete wanted[key]
      set({ orgId: null, name: '', domain: '', rooms: [], admins: [], orgProjects: [], joinRequests: [], bookings: {}, ready: false })
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

  createOrg: async (name, email) => {
    const key = domainKey(email)
    if (!key) return false
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
    if (!address.endsWith(`@${domain.toLowerCase()}`)) {
      set({ error: `${domain} 주소만 관리자가 될 수 있습니다` })
      return false
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
