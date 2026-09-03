// 사람을 **이름으로** 찾습니다.
//
// 주소를 외우고 다니는 사람은 없습니다. 초대하려는 사람의 이름을 치면 그
// 사람이 서야 하고, 별명으로 불리는 사람은 별명으로도 서야 합니다. 이 판단을
// 초대 창·참석자 고르기·같이 볼 사람 고르기가 각자 하고 있어서 한 곳에
// 모았습니다 — 한 군데만 별명을 모르면 거기서만 안 찾아집니다.

export interface Person {
  email: string
  name?: string
  nickname?: string
}

/** 화면에 적는 이름. 별명이 있으면 이름 뒤에 붙습니다. */
export function personLabel(p: Person): string {
  const name = (p.name ?? '').trim() || p.email.split('@')[0]
  const nick = (p.nickname ?? '').trim()
  return nick && nick !== name ? `${name} (${nick})` : name
}

/** 이름·별명·주소 어느 것에든 걸리면 참. 빈 검색어는 아무도 안 찾습니다. */
export function matchesPerson(p: Person, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return false
  return (
    p.email.toLowerCase().includes(q) ||
    (p.name ?? '').toLowerCase().includes(q) ||
    (p.nickname ?? '').toLowerCase().includes(q)
  )
}

/**
 * 여러 출처의 사람을 주소 하나로 합칩니다.
 *
 * 프로필(같은 프로젝트의 사람)과 워크스페이스 명단(같은 회사의 사람)이 같은
 * 사람을 둘 다 알 수 있습니다. 먼저 온 쪽의 이름을 두고, 빈 칸만 뒤에 온
 * 쪽으로 채웁니다. 같은 사람이 두 줄로 서면 어느 쪽을 눌러야 할지 모릅니다.
 */
export function mergePeople(...sources: Iterable<Person>[]): Person[] {
  const byMail = new Map<string, Person>()
  for (const src of sources) {
    for (const p of src) {
      const mail = p.email?.trim().toLowerCase()
      if (!mail || !mail.includes('@')) continue
      const have = byMail.get(mail)
      if (!have) { byMail.set(mail, { email: mail, name: p.name, nickname: p.nickname }); continue }
      if (!have.name && p.name) have.name = p.name
      if (!have.nickname && p.nickname) have.nickname = p.nickname
    }
  }
  return [...byMail.values()]
}

/** 검색어에 걸리는 사람만, 빼야 할 주소를 뺀 채로. */
export function searchPeople(people: Person[], query: string, exclude: Iterable<string> = []): Person[] {
  const out = new Set([...exclude].map(e => e.toLowerCase()))
  return people.filter(p => !out.has(p.email.toLowerCase()) && matchesPerson(p, query))
}
