// 소속을 적어 두는 곳 — 사람도, 프로젝트도.
//
// docs/tenants.md의 **1단계**입니다. 화면은 아직 이 명단을 한 글자도 읽지
// 않습니다. 여기서 하는 일은 채우는 것뿐이고, 잘못되면 지우면 그만입니다.
//
// 왜 채우냐면, 소속이 "이메일 도메인이 맞나"라는 **계산**인 동안에는 도메인이
// 다른 사람을 담을 자리가 없기 때문입니다. 지금 프로젝트 멤버 열여섯 중
// 다섯이 개인 지메일입니다 — 외부 협업자고, 앞으로도 들어옵니다. 벽을
// 도메인으로 세우면 그 다섯이 튕기고, "단, 프로젝트 멤버는 통과"라고 예외를
// 두면 벽이 세워진 그 자리에서 뚫립니다.
//
// 명단이면 게스트는 예외가 아니라 **이름이 적힌 사람**입니다. 벽은 계속 한
// 줄이고("명단에 있나"), 게스트와 멤버의 차이는 접근 권한이 아니라 회사
// 전체가 공유하는 자리가 보이느냐입니다.

import { get as fbGet, ref, update } from 'firebase/database'
import { db } from './firebase'
import { emailKey, P } from './paths'

export type {
  OrgRole, OrgMemberRow, StampableProject,
} from './rosterRules'
export { roleForDomain, guestsToAdd, projectsToStamp, effectiveRole } from './rosterRules'
import type { OrgMemberRow, StampableProject } from './rosterRules'
import { effectiveRole, guestsToAdd, projectsToStamp, roleForDomain } from './rosterRules'

/**
 * 명단과 색인을 한 번 맞춥니다. 빠진 것만 적고, 있는 것은 안 건드립니다.
 *
 * 스크립트가 아니라 앱이 합니다. 서비스 계정 키를 어딘가에 두지 않아도 되고,
 * 사람이 들어올 때마다 저절로 맞습니다. 쓸 것이 없으면 아무 일도 안 하므로
 * 두 번째 사람부터는 읽기 한 번으로 끝납니다.
 *
 * 게스트 자신은 아직 자기 `userOrgs`를 못 채웁니다 — 자기가 어느 조직에
 * 속하는지 알아내려면 조직을 알아야 하는데, 그게 바로 이 색인이 답하는
 * 질문이니까요. 초대장에 조직을 실어 보내는 2단계에서 풀립니다.
 */
export async function syncRoster(input: {
  orgId: string
  domain: string
  uid: string
  email: string
}): Promise<void> {
  const { orgId, domain, uid, email } = input
  const at = Date.now()

  // 내가 어느 조직인지부터. 이건 나만 쓰는 자리라 언제나 됩니다.
  try {
    await update(ref(db, P.userOrgs(uid)), { [orgId]: at })
  } catch (e) {
    console.warn('[roster] 조직 색인을 못 적었습니다', e)
  }

  /**
   * ── 내 자리가 게스트로 적혀 있으면, 로그인할 때 바로잡습니다 ─────────────
   *
   * 우리 도메인 주소는 게스트일 수 없습니다(effectiveRole 참고). 예전 초대가
   * 도메인을 안 보고 적어 둔 줄이 남아 있으면 그 사람은 자기 회사에서 강등된
   * 채로 지냅니다 — 그리고 **스스로 알아챌 방법도 없습니다.** 화면에는 그냥
   * 회의실 탭이 없고 명단이 안 열릴 뿐입니다.
   *
   * 명단 전체는 못 읽습니다(멤버만 읽습니다). 내 줄 하나는 읽을 수 있고,
   * 규칙이 이 한 번의 고쳐 쓰기를 허락합니다 — 게스트에서 멤버로, 도메인이
   * 맞을 때만. 내려간 사람은 여기 안 걸립니다: 그 줄은 'removed'입니다.
   */
  try {
    const mineSnap = await fbGet(ref(db, P.orgMember(orgId, email)))
    const mineRole = (mineSnap.val() as { role?: OrgMemberRow['role'] } | null)?.role ?? null
    if (mineRole === 'guest' && effectiveRole(email, domain, 'guest') === 'member') {
      await update(ref(db, P.orgMember(orgId, email)), { role: 'member', at })
    }
  } catch (e) {
    // 못 고쳐도 로그인은 계속됩니다. 다음 로그인에 다시 해 봅니다.
    console.warn('[roster] 내 자리를 바로잡지 못했습니다', e)
  }

  let roster: Record<string, OrgMemberRow | null> | null = null
  try {
    roster = (await fbGet(ref(db, P.orgMembers(orgId)))).val()
  } catch {
    // 명단을 못 읽는다는 건 이 회사의 멤버가 아니라는 뜻입니다. 게스트이거나,
    // 아직 아무 관계도 없거나. 어느 쪽이든 여기서 할 일이 없습니다.
    return
  }

  // 내가 멤버인가. **명단이 먼저 답합니다** — 도메인 없는 조직에서는
  // 도메인이 아무 말도 못 하고, 거기서는 명단이 유일한 근거입니다.
  const myRow = roster?.[emailKey(email)]
  const iAmMember = myRow ? myRow.role === 'member' : roleForDomain(email, domain) === 'member'
  if (!iAmMember) return

  const writes: Record<string, OrgMemberRow> = {}
  // 자기 자리를 자기가 앉는 건 **도메인이 맞을 때만**입니다. 규칙도 그렇습니다.
  if (!myRow && roleForDomain(email, domain) === 'member') {
    writes[emailKey(email)] = { role: 'member', at }
  }
  /*
    게스트 백필은 걷어냈습니다. 부른 적 없는 사람이 명단에 쌓이던 자리입니다 —
    위 guestsToAdd의 주석 참고. 명단을 채우는 것은 이제 초대뿐입니다.
  */
  if (Object.keys(writes).length === 0) return

  // 한 줄이 거절당하면 전체가 거절당합니다. 그래서 한 번에 몰지 않고 각자
  // 씁니다 — 게스트 한 명이 막힌다고 나머지가 같이 안 적히면, 다음에 누가
  // 들어와도 같은 자리에서 또 막힙니다.
  await Promise.all(
    Object.entries(writes).map(([key, row]) =>
      update(ref(db, `${P.orgMembers(orgId)}/${key}`), row as unknown as Record<string, unknown>)
        .catch(e => console.warn('[roster] 명단에 못 적었습니다', key, e)),
    ),
  )
}


/**
 * 소속을 적습니다. 빠진 것만, 있는 것은 안 건드립니다.
 *
 * 명단과 같은 방식입니다 — 스크립트 한 번이 아니라 앱이 지나가면서 맞춥니다.
 * 프로젝트는 계속 생기므로 한 번 찍어 두는 것으로는 곧 다시 빠집니다.
 */
export async function stampProjects(input: {
  orgId: string
  domain: string
  projects: StampableProject[]
}): Promise<void> {
  const { orgId, domain, projects } = input
  if (projects.every(p => p.orgId)) return

  let owned: Record<string, boolean> | null = null
  let roster: Record<string, OrgMemberRow | null> | null = null
  try {
    owned = (await fbGet(ref(db, P.orgOwns(orgId)))).val()
    roster = (await fbGet(ref(db, P.orgMembers(orgId)))).val()
  } catch {
    // 명단에 아직 없는 사람입니다. 도장은 못 찍지만 곧 찍힙니다.
    return
  }

  // 도메인이 없는 조직에서는 '우리 도메인 사람인가'가 답을 못 합니다.
  // 그럴 때 소속을 말해 주는 건 명단뿐입니다.
  const wanted = projectsToStamp(projects, domain, roster)
  if (wanted.length === 0) return

  await Promise.all(
    wanted.flatMap(pid => [
      update(ref(db, P.projectMeta(pid)), { orgId })
        .catch(e => console.warn('[tenant] 프로젝트에 소속을 못 적었습니다', pid, e)),
      owned?.[pid]
        ? Promise.resolve()
        : update(ref(db, P.orgOwns(orgId)), { [pid]: true })
            .catch(e => console.warn('[tenant] 조직 목록에 못 넣었습니다', pid, e)),
    ]),
  )
}

/**
 * 초대장에 실려 온 조직을 내 색인에 적습니다.
 *
 * 게스트가 자기 회사를 알아내는 **유일한 길**입니다. 도메인으로 찾는 길은
 * 도메인이 안 맞으니 막혀 있고, 명단을 읽으려면 조직 id를 알아야 하는데 그게
 * 바로 묻고 있는 질문이라 순환입니다. 초대장은 그 사람이 합류하기 전에 볼 수
 * 있는 유일한 것이고, 그래서 여기에 조직을 실어 보냅니다.
 *
 * 1단계에서 열어 둔 구멍이 여기서 닫힙니다.
 */
export async function claimInvitedOrgs(uid: string, orgIds: string[]): Promise<void> {
  const unique = [...new Set(orgIds.filter(Boolean))]
  if (unique.length === 0) return
  const at = Date.now()
  await update(ref(db, P.userOrgs(uid)), Object.fromEntries(unique.map(oid => [oid, at])))
    .catch(e => console.warn('[tenant] 초대받은 조직을 못 적었습니다', e))
}

/**
 * ── 게스트 자리에 스스로 앉습니다 ───────────────────────────────────────────
 *
 * 3단계에서 벽이 서면, 명단에 없는 사람은 그 회사 프로젝트를 못 읽습니다.
 * 그런데 방금 초대 링크로 들어온 외부 협업자는 아직 명단에 없습니다 —
 * 옆에서 누군가 앱을 켜서 `syncRoster`가 돌아 줘야 적히는데, 그게 5분 뒤일지
 * 사흘 뒤일지 알 수가 없습니다. 그 사이 그 사람은 **방금 초대받은 프로젝트가
 * 안 보입니다.** 그건 못 쓰는 앱입니다.
 *
 * 그래서 자기 자리는 자기가 앉습니다. 규칙도 허용합니다 — 단, **행이 아예
 * 없을 때만**입니다.
 *
 * 이게 벽을 뚫는 것은 아닙니다. 게스트 자리에 앉아도 프로젝트 멤버가 아니면
 * 아무것도 안 열립니다. 이 명단이 실제로 하는 일은 두 가지고, 둘 다 그대로
 * 입니다 —
 *
 * 1. **내보내기.** `removed`가 적힌 사람은 도메인이 맞아도, 스스로 앉으려
 *    해도 막힙니다. 행이 있으니까요.
 * 2. **명단이 사실이 되는 것.** 누가 이 회사 것을 보고 있는지 한 곳에서
 *    읽힙니다.
 *
 * 나중에 초대가 유일한 문이 되면 이 자가 등록을 끄고 진짜 허가 목록으로
 * 조일 수 있습니다. 지금은 아직 초대 링크라는 문이 하나 더 있습니다.
 */
export async function claimGuestSeats(uid: string, email: string, orgIds: string[]): Promise<void> {
  const unique = [...new Set(orgIds.filter(Boolean))]
  if (unique.length === 0) return
  const at = Date.now()
  await Promise.all(
    unique.map(async oid => {
      /**
       * **이미 명단에 있으면 손대지 않습니다.**
       *
       * 규칙에도 '행이 없을 때만'이 있지만, 그것만 믿으면 안 됩니다 —
       * 관리자에게는 명단을 고칠 권한이 따로 있어서 그 조항으로 통과합니다.
       * 실제로 그렇게 됐습니다: 어느 워크스페이스에 붙었는지 못 정한 동안
       * 이 함수가 자기 회사를 '남의 것'으로 보고 불렸고, 관리자였던 사람이
       * **자기 자신을 게스트로 강등**시켰습니다. 그 순간 회의실도 워크스페이스
       * 이름도 전부 닫혔습니다.
       *
       * 규칙이 막아 주기를 기대하지 말고, 부르는 쪽이 먼저 안 하는 게 맞습니다.
       */
      const mine = await fbGet(ref(db, P.orgMember(oid, email))).catch(() => null)
      if (mine?.exists()) return
      /**
       * **우리 도메인이면 게스트가 아니라 멤버입니다.** 초대 링크로 처음
       * 들어온 신입이 여기서 자기 회사의 게스트로 적혔습니다 — 링크에 실린
       * 회사가 자기 회사라는 걸 아무도 안 봤습니다. 도메인은 멤버가 아니어도
       * 읽힐 수 있게 되어 있고, 규칙도 도메인이 맞으면 멤버 자가 등록을
       * 허락합니다(게스트로는 거절합니다).
       */
      const domain = await fbGet(ref(db, P.orgDomain(oid))).then(s => (typeof s.val() === 'string' ? s.val() as string : '')).catch(() => '')
      const role = domain && roleForDomain(email, domain) === 'member' ? 'member' : 'guest'
      await update(ref(db, P.orgMember(oid, email)), { role, at }).catch(() => {})
    }),
  )
  await claimInvitedOrgs(uid, unique)
}
