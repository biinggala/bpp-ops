// 명단과 소속을 정하는 **판단**들. 값만 받고 값만 돌려줍니다.
//
// firebase를 안 씁니다. 그래야 테스트가 이 판단들을 직접 붙들 수 있습니다 —
// 스토어와 데이터베이스를 붙들고 있으면 '명단이 이렇게 생겼을 때'를 만들어
// 볼 수가 없고, 이 파일이 답하는 질문들이 전부 그 모양입니다.
//
// 쓰는 쪽(읽고 쓰는 일)은 roster.ts입니다.

import { emailKey } from './paths'

export type OrgRole = 'member' | 'guest' | 'removed'

export interface OrgMemberRow {
  role: OrgRole
  /** 명단에 들어온 시각. */
  at: number
  /** 게스트를 들인 사람. 자동 가입한 멤버에게는 없습니다. */
  by?: string
}

/**
 * 도메인만 보고 정하는 자리.
 *
 * 도메인이 맞으면 멤버, 아니면 게스트입니다. 도메인이 **없는 조직**(초대만으로
 * 굴러가는 팀)은 이 함수가 답할 문제가 아닙니다 — 거기서는 초대하는 사람이
 * 고릅니다. 여기서 게스트로 답하는 건 "도메인으로는 멤버라 할 근거가 없다"는
 * 뜻이지 그 사람의 최종 자리가 아닙니다.
 */
export function roleForDomain(email: string, domain: string | null | undefined): 'member' | 'guest' {
  const d = (domain ?? '').toLowerCase().trim()
  if (!d) return 'guest'
  return email.toLowerCase().trim().endsWith('@' + d) ? 'member' : 'guest'
}

/**
 * 명단에 적힌 자리와 도메인이 어긋날 때, **진짜 자리**.
 *
 * 도메인형 워크스페이스에서 그 도메인 주소는 게스트일 수 없습니다 — 로그인하는
 * 것만으로 멤버니까요. 그런데 예전 초대는 도메인을 안 보고 게스트 줄을 적었고
 * (projectStore.addMember의 옛 판), 그 줄이 남은 사람은 자기 회사에서 **강등된
 * 채로** 지냅니다: 회의실·장비도, 명단도, 초대받지 않은 프로젝트도 안 열립니다.
 * 이제 규칙이 그런 줄을 새로 못 만들게 하지만, 이미 적힌 줄은 그대로 남습니다.
 *
 * 내려간 사람(`removed`)은 건드리지 않습니다. 그건 잘못 적힌 줄이 아니라
 * **결정**이고, 도메인으로 되살리면 내보내기가 아무 뜻도 없어집니다.
 *
 * 도메인이 없는 조직에서는 명단이 유일한 근거라 적힌 그대로입니다.
 */
export function effectiveRole(
  email: string,
  domain: string | null | undefined,
  role: OrgRole | null | undefined,
): OrgRole | null {
  if (!role) return null
  if (role !== 'guest') return role
  return roleForDomain(email, domain) === 'member' ? 'member' : 'guest'
}

/**
 * 명단에 아직 없어서 새로 적어야 할 사람들을 고릅니다.
 *
 * ── 이제 아무도 안 부릅니다 ─────────────────────────────────────────────────
 *
 * 1단계의 백필이었습니다. 명단이 생기기 전부터 프로젝트에 있던 외부 협업자를
 * 한 번 훑어 적어 넣는 일 — 그 일은 끝났습니다.
 *
 * 그런데 이건 **아무도 초대한 적 없는 사람을 명단에 올립니다.** 재료가
 * '내 프로젝트에서 같이 일하는 사람 전부'라서, 누군가의 프로젝트에 한 번
 * 낀 적이 있으면 그것만으로 그 회사 명단에 이름이 오릅니다. 그리고 명단에
 * 오르는 순간 관리자 화면에 그 사람을 **멤버로 올리는 토글**이 생깁니다 —
 * 부른 적도 없는 사람에게요.
 *
 * 지금은 부르는 길이 둘 다 제대로 있습니다. 주소로 부르면 초대가 그 자리에서
 * 게스트 줄을 만들고(projectStore.addMember), 링크로 들어오면 자기가 자기
 * 자리에 앉습니다(claimGuestSeats). 셋째 길은 필요 없고, 셋째 길만 사람을
 * 안 물어보고 적었습니다.
 *
 * 함수는 남겨 둡니다 — 테스트가 이 판단을 붙들고 있고, 판단 자체는 여전히
 * 맞습니다(누가 빠져 있나). 부르는 곳이 없을 뿐입니다.
 */
export function guestsToAdd(
  peers: string[],
  domain: string,
  roster: Record<string, OrgMemberRow | null> | null,
): string[] {
  const have = new Set(Object.keys(roster ?? {}))
  const out = new Set<string>()
  for (const raw of peers) {
    const mail = raw.toLowerCase().trim()
    if (!mail || !mail.includes('@')) continue
    if (have.has(emailKey(mail))) continue
    if (roleForDomain(mail, domain) !== 'guest') continue
    out.add(mail)
  }
  return [...out].sort()
}

/**
 * ── 프로젝트의 소속 ─────────────────────────────────────────────────────────
 *
 * docs/tenants.md의 **2단계**. 사람 다음은 프로젝트입니다.
 *
 * 두 군데에 적습니다. `projects/{pid}/meta/orgId`는 프로젝트에서 시작해
 * "이건 어느 회사 것인가"를 묻는 길이고, `orgs/{oid}/owns/{pid}`는 회사에서
 * 시작해 "우리 프로젝트가 무엇무엇인가"를 묻는 길입니다. 규칙과 MCP가 각각
 * 다른 쪽에서 물어보기 때문에 둘 다 필요합니다.
 *
 * 사본이 둘이면 늙습니다. 그래서 **둘 다 한 번만 쓰입니다** — 규칙이 이미
 * 있는 값을 덮는 것을 거절합니다. 프로젝트의 소속은 한 번 정해지면 안
 * 바뀝니다. 회사를 옮겨야 하는 프로젝트가 생기면 그건 사람이 결정해서
 * 하는 일이지, 앱이 배경에서 조용히 할 일이 아닙니다.
 *
 * **아직 아무것도 안 막습니다.** 규칙은 이 값을 검사하지 않고, 화면도 안
 * 읽습니다. 3단계에서 읽는 쪽을 옮길 때 비로소 벽이 됩니다.
 */
export interface StampableProject {
  id: string
  orgId?: string
  creatorEmail?: string
}

/**
 * 도장을 찍어도 되는 프로젝트를 고릅니다.
 *
 * 이미 소속이 적힌 것은 건드리지 않습니다. 그리고 **만든 사람이 우리 도메인이
 * 아니면 건너뜁니다** — 내가 남의 회사 프로젝트에 게스트로 들어가 있을 수
 * 있고, 그 프로젝트를 내 회사 것으로 도장 찍으면 그 순간 소속이 틀립니다.
 * 한 번 쓰면 못 고치는 값이라 틀리면 되돌릴 방법도 없습니다.
 *
 * 만든 사람이 안 적힌 옛 프로젝트는 **도메인이 있는 워크스페이스에서만**
 * 찍습니다. 이 앱을 쓰는 회사가 하나뿐이던 시절의 것이라 달리 볼 여지가
 * 없다는 뜻이었는데, 이제 사람마다 개인 워크스페이스가 하나씩 생깁니다 —
 * 거기서 이 조항이 켜지면, 내가 멤버로만 들어가 있던 옛 프로젝트가 **내 개인
 * 워크스페이스 것으로 도장이 찍힙니다.** 한 번 쓰면 못 고치는 값입니다.
 *
 * 도메인이 있다는 것은 '회사가 있고 그 회사 사람들이 쓴다'는 뜻이라, 거기서는
 * 옛 추론이 그대로 맞습니다.
 */
export function projectsToStamp(
  projects: StampableProject[],
  domain: string,
  roster: Record<string, OrgMemberRow | null> | null,
): string[] {
  const isOurs = (creator: string) =>
    roster?.[emailKey(creator)]?.role === 'member' || roleForDomain(creator, domain) === 'member'
  return projects
    .filter(p => !p.orgId)
    .filter(p => (p.creatorEmail ? isOurs(p.creatorEmail) : !!domain))
    .map(p => p.id)
}

