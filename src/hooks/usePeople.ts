// 부를 수 있는 사람들 — 이름표까지 한 번에.
//
// 두 출처를 합칩니다. 프로필(같은 프로젝트의 사람, uid마다 읽음)과 회사
// 이름 명단(같은 워크스페이스의 멤버 전원). 초대 창·참석자 고르기·같이 볼
// 사람 고르기가 전부 이걸 씁니다 — 한 곳에서만 별명을 모르면 거기서만 안
// 찾아지니까요.

import { useMemo } from 'react'
import { useUserProfileStore } from '../store/userProfileStore'
import { useDirectoryStore, directoryPeople } from '../store/directoryStore'
import { mergePeople, personLabel, type Person } from '../lib/people'

export function usePeople(orgId?: string | null): {
  people: Person[]
  /** 이름 (별명). 모르는 주소는 앞부분만. */
  labelOf: (email: string) => string
  /** 이 회사 명단에 있는 주소들. 프로젝트 밖 사람을 후보에 세울 때 씁니다. */
  directoryEmails: string[]
} {
  const profiles = useUserProfileStore(s => s.profiles)
  const byOrg = useDirectoryStore(s => s.byOrg)
  return useMemo(() => {
    const fromDirectory = directoryPeople(byOrg, orgId)
    const people = mergePeople(
      Object.values(profiles).map(p => ({ email: p.email, name: p.name, nickname: p.nickname })),
      fromDirectory,
    )
    const byMail = new Map(people.map(p => [p.email, p]))
    return {
      people,
      labelOf: (email: string) => {
        const p = byMail.get(email.toLowerCase())
        return p ? personLabel(p) : email.split('@')[0]
      },
      directoryEmails: fromDirectory.map(p => p.email),
    }
  }, [profiles, byOrg, orgId])
}
