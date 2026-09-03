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
import { get as fbGet, off, onValue, ref, set as fbSet } from 'firebase/database'
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
  /**
   * 워크스페이스 id → 주소(소문자) → 줄.
   *
   * 아직 이 앱을 안 켜 본 동료는 이름 줄이 없습니다. 그래도 명단
   * (`orgs/{oid}/members`)에는 있으므로, 그 사람은 주소만으로 섭니다 —
   * 이름은 그 사람이 처음 로그인하는 순간 채워집니다. 여기 있는 워크스페이스는
   * 명단을 **읽을 수 있었던** 곳만입니다. 도메인 없는 워크스페이스에는 이
   * 목록이 없고(규칙), 읽기가 거절되면 여기서도 빠집니다.
   */
  byOrg: Record<string, Record<string, DirectoryRow>>
  start: (uid: string, email: string) => () => void
}

/** 규칙이 허락하는 곳인지 모르니, 읽어 보고 거절되면 없는 곳으로 칩니다. */


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
        // 자리를 먼저 잡아 두 번 붙지 않게 하고, 도메인을 확인한 뒤 붙습니다.
        let stop: (() => void) | null = null
        let cancelled = false
        listeners.set(oid, () => { cancelled = true; stop?.() })
        void fbGet(ref(db, P.orgDomain(oid))).then(snap => {
          /**
           * **도메인 있는 워크스페이스에만** 명단이 있습니다. 개인 워크스페이스나
           * 초대형 팀에서는 아무것도 안 읽습니다 — 규칙이 쓰기를 막아 늘 비어
           * 있지만, 읽기는 조직 노드의 규칙이 상속되어 통과하므로 여기서도
           * 한 번 더 가릅니다. 회사 사람 이름은 회사 안에서만.
           */
          if (cancelled || typeof snap.val() !== 'string' || !snap.val()) return
          stop = attach(oid)
        }).catch(() => { /* 못 읽으면 멤버가 아닙니다. 명단도 없습니다. */ })
      }
    }

    const attach = (oid: string): (() => void) => {
      {
        // 이름 줄과 명단을 따로 받아 합칩니다. 둘 중 하나만 와도 그립니다.
        let named: Record<string, DirectoryRow> | null = null
        let roster: string[] | null = null
        const merge = () => {
          const rows: Record<string, DirectoryRow> = {}
          for (const mail of roster ?? []) rows[mail] = { name: '' }
          for (const [mail, row] of Object.entries(named ?? {})) rows[mail] = row
          set(s => ({ byOrg: { ...s.byOrg, [oid]: rows } }))
        }
        const drop = () => set(s => { const { [oid]: _gone, ...rest } = s.byOrg; return { byOrg: rest } })

        const dirRef = ref(db, P.orgDirectory(oid))
        const dirHandler = onValue(dirRef, snap => {
          const raw = (snap.val() ?? {}) as Record<string, DirectoryRow | null>
          named = {}
          for (const [k, v] of Object.entries(raw)) {
            if (v && typeof v.name === 'string') named[keyToMail(k)] = v
          }
          merge()
        }, () => {
          // 도메인 없는 워크스페이스거나 내가 멤버가 아닙니다. 여기엔 명단이 없습니다.
          named = null; roster = null; drop()
        })
        const rosterRef = ref(db, P.orgMembers(oid))
        const rosterHandler = onValue(rosterRef, snap => {
          const raw = (snap.val() ?? {}) as Record<string, { role?: string } | null>
          roster = Object.entries(raw).filter(([, v]) => v?.role === 'member').map(([k]) => keyToMail(k))
          // 이름 줄을 못 읽는 곳이면 명단도 안 씁니다 — 문은 하나여야 합니다.
          if (named !== null) merge()
        }, () => { roster = null })
        return () => { off(dirRef, 'value', dirHandler); off(rosterRef, 'value', rosterHandler) }
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
      // 명단이 읽힌 곳에만 씁니다. 안 읽히는 곳은 규칙이 쓰기도 거절합니다.
      const orgs = Object.keys(get().byOrg)
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
 * 어느 회사의 사람들인가 — **한 회사만.**
 *
 * 프로젝트에 소속이 있으면 그 회사 명단, 없으면 아무것도 없습니다. 소속 없는
 * 프로젝트에 내가 속한 회사들의 이름을 다 내놓으면, 개인 프로젝트에 부르는
 * 자리가 회사 사람 이름을 훑는 자리가 됩니다. 회사 사람은 회사 프로젝트에서만.
 */
export function directoryPeople(byOrg: Record<string, Record<string, DirectoryRow>>, orgId?: string | null): Person[] {
  if (!orgId) return []
  const rows = byOrg[orgId] ?? {}
  return mergePeople(Object.entries(rows).map(([email, r]) => ({ email, name: r.name || undefined, nickname: r.nickname })))
}
