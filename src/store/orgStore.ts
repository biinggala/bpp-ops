import { create } from 'zustand'
import { onValue, push, ref, remove, set as fbSet, update as fbUpdate, off } from 'firebase/database'
import { db } from '../lib/firebase'
import { P, domainKey } from '../lib/paths'
import { gid } from '../lib/utils'

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

export interface Booking {
  id: string
  roomId: string
  /** 자정부터 분. 타임라인이 쓰는 단위와 같습니다. */
  from: number
  to: number
  by: string
  byName?: string
  title?: string
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

  book: (input: {
    date: string; roomId: string; from: number; to: number
    title?: string; eventId?: string; by: string; byName?: string
  }) => Promise<boolean>
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
        set({ ready: true, orgId: null, name: '', domain: '', rooms: [], bookings: {} })
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
      inner = [
        () => off(metaRef, 'value', metaHandler),
        () => off(roomsRef, 'value', roomsHandler),
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
      set({ orgId: null, name: '', domain: '', rooms: [], bookings: {}, ready: false })
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

  book: async ({ date, roomId, from, to, title, eventId, by, byName }) => {
    const { orgId } = get()
    if (!orgId) return false
    const node = push(ref(db, P.orgBookings(orgId, date)))
    try {
      await fbSet(node, {
        roomId, from, to,
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
