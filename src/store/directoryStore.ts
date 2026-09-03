// 워크스페이스의 **이름 명단**.
//
// 같은 프로젝트에 있는 사람의 이름은 프로필로 옵니다(syncStore가 uid마다
// 읽습니다). 그런데 아직 같은 프로젝트에 없는 동료 — 새로 부르려는 바로 그
// 사람 — 는 uid를 모르니 프로필을 못 읽고, 주소를 끝까지 쳐야 했습니다.
//
// 그래서 회사마다 `orgs/{oid}/directory/{주소}`에 이름을 적어 둡니다. 멤버만
// 읽고, 자기 줄만 씁니다. 여기 있는 건 이름표뿐이고 권한은 여전히 프로젝트
// 멤버십입니다(CLAUDE.md — 라벨은 라벨이고 경계가 아닙니다).
//
// 내 줄은 내가 씁니다: 로그인하면, 프로필 이름이나 별명이 바뀌면, 워크스페이스에
// 새로 들어가면. 값이 같으면 안 씁니다 — 50명이 켤 때마다 같은 값을 다시
// 쓰면 그게 전부 남들 화면의 갱신입니다.

import { create } from 'zustand'
import { off, onValue, ref, set as fbSet } from 'firebase/database'
import { db } from '../lib/firebase'
import { P } from '../lib/paths'
import { useOrgStore } from './orgStore'
import { useUserProfileStore } from './userProfileStore'
import { mergePeople, type Person } from '../lib/people'

export interface DirectoryRow {
  name: string
  nickname?: string
  uid?: string
  at?: number
}

interface DirectoryState {
  /** 워크스페이스 id → 주소(소문자) → 줄 */
  byOrg: Record<string, Record<string, DirectoryRow>>
  start: (uid: string, email: string) => () => void
}

/** `orgs/../directory` 키(쉼표)를 주소로. */
const keyToMail = (key: string) => key.replace(/,/g, '.')

export const useDirectoryStore = create<DirectoryState>((set, get) => ({
  byOrg: {},

  start: (uid, email) => {
    const listeners = new Map<string, () => void>()
    let lastPublished = ''

    const watch = (oids: string[]) => {
      const want = new Set(oids)
      for (const [oid, stop] of listeners) {
        if (!want.has(oid)) {
          stop(); listeners.delete(oid)
          set(s => { const { [oid]: _gone, ...rest } = s.byOrg; return { byOrg: rest } })
        }
      }
      for (const oid of oids) {
        if (listeners.has(oid)) continue
        const r = ref(db, P.orgDirectory(oid))
        const handler = onValue(r, snap => {
          const raw = (snap.val() ?? {}) as Record<string, DirectoryRow | null>
          const rows: Record<string, DirectoryRow> = {}
          for (const [k, v] of Object.entries(raw)) {
            if (v && typeof v.name === 'string') rows[keyToMail(k)] = v
          }
          set(s => ({ byOrg: { ...s.byOrg, [oid]: rows } }))
        }, () => { /* 멤버가 아니면 안 읽힙니다. 그 회사 명단은 비어 있는 것으로 둡니다. */ })
        listeners.set(oid, () => off(r, 'value', handler))
      }
    }

    /**
     * 내 줄을 각 회사에 적습니다. 값이 지난번과 같으면 안 씁니다.
     *
     * 이름이 아직 없으면(프로필이 안 왔으면) 기다립니다 — 주소 앞부분을
     * 이름으로 적어 두면 진짜 이름이 온 뒤 한 번 더 써야 하고, 그 사이
     * 남들에게는 'heegun'이 보입니다.
     */
    const publish = () => {
      const me = useUserProfileStore.getState().profiles[uid]
      if (!me?.name) return
      const orgs = useOrgStore.getState().myOrgs.filter(o => !o.guest).map(o => o.id)
      const row: DirectoryRow = { name: me.name, uid, at: Date.now() }
      if (me.nickname) row.nickname = me.nickname
      const stamp = JSON.stringify([orgs, row.name, row.nickname ?? ''])
      if (stamp === lastPublished) return
      lastPublished = stamp
      for (const oid of orgs) {
        const have = get().byOrg[oid]?.[email.toLowerCase()]
        if (have && have.name === row.name && (have.nickname ?? '') === (row.nickname ?? '') && have.uid === uid) continue
        fbSet(ref(db, P.orgDirectoryRow(oid, email)), row).catch(() => {})
      }
    }

    const sync = () => {
      watch(useOrgStore.getState().myOrgs.filter(o => !o.guest).map(o => o.id))
      publish()
    }
    sync()
    const unOrg = useOrgStore.subscribe((s, prev) => { if (s.myOrgs !== prev.myOrgs) sync() })
    const unProfile = useUserProfileStore.subscribe((s, prev) => { if (s.profiles[uid] !== prev.profiles[uid]) publish() })
    // 명단이 도착한 뒤에 비교해야 '이미 같다'를 알 수 있습니다.
    const unSelf = useDirectoryStore.subscribe((s, prev) => { if (s.byOrg !== prev.byOrg) publish() })

    return () => {
      unOrg(); unProfile(); unSelf()
      for (const stop of listeners.values()) stop()
      listeners.clear()
      set({ byOrg: {} })
    }
  },
}))

/**
 * 어느 회사의 사람들인가.
 *
 * 프로젝트에 소속이 있으면 그 회사 명단만, 없으면 내가 멤버인 모든 회사의
 * 명단입니다 — 소속 없는 프로젝트는 어디에도 걸치니까요(Sidebar의 초대 창
 * 주석과 같은 셈).
 */
export function directoryPeople(byOrg: Record<string, Record<string, DirectoryRow>>, orgId?: string | null): Person[] {
  const pools = orgId ? [byOrg[orgId] ?? {}] : Object.values(byOrg)
  return mergePeople(...pools.map(rows => Object.entries(rows).map(([email, r]) => ({ email, name: r.name, nickname: r.nickname }))))
}
