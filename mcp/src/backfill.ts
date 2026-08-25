// ── 프로젝트에 소속 도장을 찍습니다 ──────────────────────────────────────────
//
// 앱이 켜질 때마다 하는 일과 같습니다(웹의 lib/roster.ts). 다만 앱은 **그 사람이
// 속한 프로젝트만** 찍을 수 있어서, 아무도 안 켠 프로젝트는 영영 도장이 안
// 찍힙니다. 출장이나 휴가면 몇 주가 되고요.
//
// 여기는 관리자 SDK라 전부 보입니다. 한 번 돌리면 사람을 기다릴 일이 없습니다.
//
// **도장이 없는 프로젝트는 테넌트 벽 밖에 있습니다.** 규칙이 '소속이 안 적혔으면
// 통과'라서요 — 속도 문제가 아니라 아직 안 잠긴 문입니다.
//
//   node dist/backfill.js          무엇을 찍을지 보여만 줍니다
//   node dist/backfill.js --apply  실제로 찍습니다

import { initDb } from './store.js'

interface OrgInfo {
  id: string
  domain?: string
  /** 이메일키 → 'member' | 'guest' | 'removed' */
  members: Record<string, string>
}

interface ProjectInfo {
  id: string
  name?: string
  orgId?: string
  creatorEmail?: string
  /**
   * 이 프로젝트의 사람들, 주소로.
   *
   * `meta.memberEmails`는 **화면에 보여 주려고 베껴 둔 사본**이라 옛 프로젝트
   * 에는 아예 없습니다. 진짜 멤버는 `members/{계정id}`에 계정 id로 있고,
   * 주소는 `userProfiles`에서 옵니다. 사본만 보고 '근거 없음'이라고 답하던
   * 것이 못 정한 일곱 개의 원인이었습니다.
   */
  memberEmails?: string[]
  /** 멤버가 몇 명인지. 0명이면 그건 버려진 프로젝트라는 뜻입니다. */
  memberCount?: number
}

export const emailKey = (e: string) => e.toLowerCase().trim().replace(/\./g, ',')

/**
 * 이 주소가 어느 워크스페이스 사람인가.
 *
 * 명단이 먼저 답합니다 — 도메인 없이 초대만으로 굴러가는 워크스페이스에서는
 * 도메인이 아무 말도 못 합니다. 명단에 없으면 도메인으로 봅니다: 아직 한 번도
 * 안 들어온 직원이 그 자리입니다.
 *
 * **게스트는 근거가 못 됩니다.** 외부 협업자는 여러 회사에 걸쳐 있을 수 있고,
 * 그 사람이 있다는 것만으로 프로젝트의 소속을 정하면 남의 회사 프로젝트에
 * 도장을 찍게 됩니다.
 */
export function orgOf(email: string, orgs: OrgInfo[]): string | null {
  const key = emailKey(email)
  const named = orgs.find(o => o.members[key] === 'member')
  if (named) return named.id

  const at = email.lastIndexOf('@')
  if (at < 0) return null
  const domain = email.slice(at + 1).toLowerCase().trim()
  const byDomain = orgs.filter(o => o.domain && o.domain.toLowerCase() === domain)
  // 한 도메인에 워크스페이스는 하나입니다. 둘이면 데이터가 이상한 것이고,
  // 그럴 때 찍는 것보다 안 찍고 보고하는 편이 낫습니다.
  return byDomain.length === 1 ? byDomain[0].id : null
}

export interface Verdict {
  projectId: string
  name?: string
  orgId?: string
  /** 왜 그렇게 정했는지, 혹은 왜 못 정했는지. 사람이 읽습니다. */
  why: string
}

/**
 * 프로젝트 하나의 소속을 정합니다. **애매하면 안 찍습니다.**
 *
 * 소속은 한 번 쓰면 규칙이 덮어쓰기를 거절합니다. 틀리게 찍으면 되돌릴 방법이
 * 없으므로, 근거가 갈리면 사람에게 넘깁니다.
 */
export function decide(p: ProjectInfo, orgs: OrgInfo[]): Verdict {
  if (p.orgId) return { projectId: p.id, name: p.name, why: '이미 찍혀 있음' }

  // 만든 사람이 제일 좋은 근거입니다. 그 사람이 그 자리에서 만든 것이니까요.
  if (p.creatorEmail) {
    const oid = orgOf(p.creatorEmail, orgs)
    if (oid) return { projectId: p.id, name: p.name, orgId: oid, why: `만든 사람 ${p.creatorEmail}` }
  }

  // 만든 사람이 안 적힌 옛 프로젝트. 멤버들이 가리키는 곳이 **하나뿐일 때만**
  // 씁니다. 둘로 갈리면 그건 우리가 정할 일이 아닙니다.
  const found = new Set<string>()
  for (const m of p.memberEmails ?? []) {
    const oid = orgOf(m, orgs)
    if (oid) found.add(oid)
  }
  if (found.size === 1) {
    const oid = [...found][0]
    return { projectId: p.id, name: p.name, orgId: oid, why: `멤버 전원이 한 곳(${p.memberEmails?.length ?? 0}명)` }
  }
  if (found.size > 1) {
    return { projectId: p.id, name: p.name, why: `멤버가 두 곳 이상에 걸침 (${[...found].join(', ')}) — 사람이 정해야 합니다` }
  }
  if (!p.memberEmails?.length) {
    return {
      projectId: p.id, name: p.name,
      why: p.memberCount ? `멤버 ${p.memberCount}명이 있는데 주소를 못 찾았습니다 — 프로필이 없는 계정들` : '멤버가 아무도 없습니다 — 버려진 프로젝트로 보입니다',
    }
  }
  return { projectId: p.id, name: p.name, why: `근거 없음 — ${p.memberEmails.join(', ')} 중 아무도 명단에 없습니다` }
}

/**
 * ── 매달리지 않게 ───────────────────────────────────────────────────────────
 *
 * RTDB는 인증이 거절돼도 **오류를 안 줍니다.** 경고 한 줄을 찍고 조용히 계속
 * 다시 시도합니다 — 연결이 잠깐 끊긴 것과 권한이 없는 것을 구별하지 않으니까요.
 * 그래서 권한 없는 열쇠로 부르면 이 스크립트가 영원히 서 있습니다. 실제로
 * 12분을 그렇게 보냈고, 화면에는 아무 말도 없었습니다.
 *
 * 기다릴 만큼 기다린 뒤에는 **왜 그런지 짐작을 적어** 놓고 끝냅니다. 답 없이
 * 매달리는 것보다 틀릴 수 있는 짐작이 낫습니다.
 */
function withDeadline<T>(work: Promise<T>, seconds: number, what: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(
      `${what}: ${seconds}초 동안 답이 없습니다.\n` +
      '  거의 언제나 권한 문제입니다 — 이 열쇠에 실시간 데이터베이스 권한이 없으면\n' +
      '  Firebase는 거절 대신 재시도를 반복합니다.\n' +
      '  GCP 콘솔 → IAM → 이 서비스 계정에 "Firebase Realtime Database 관리자"를 주세요.',
    )), seconds * 1000)),
  ])
}

async function main() {
  const apply = process.argv.includes('--apply')

  // 어느 계정으로 붙는지 먼저 말합니다. IAM에서 찾아야 할 이름이 그것입니다.
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  if (raw) {
    try {
      const json = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'))
      console.log(`서비스 계정: ${json.client_email}`)
    } catch { console.log('서비스 계정: (JSON을 못 읽었습니다)') }
  } else {
    console.log('서비스 계정: 런타임 기본 자격증명')
  }
  console.log(`데이터베이스: ${process.env.FIREBASE_DATABASE_URL}\n`)

  const db = initDb()

  console.log('워크스페이스와 프로젝트를 읽는 중…')
  const [orgSnap, projSnap, profileSnap] = await withDeadline(Promise.all([
    db.ref('orgs').get(),
    db.ref('projects').get(),
    db.ref('userProfiles').get(),
  ]), 30, '데이터베이스 읽기')

  // 계정 id → 주소. 옛 프로젝트의 멤버를 읽으려면 이 표가 있어야 합니다.
  const emailByUid = new Map<string, string>()
  for (const [uid, prof] of Object.entries((profileSnap.val() ?? {}) as Record<string, { email?: string }>)) {
    const e = (prof?.email ?? '').toLowerCase()
    if (e) emailByUid.set(uid, e)
  }

  const orgs: OrgInfo[] = Object.entries((orgSnap.val() ?? {}) as Record<string, {
    meta?: { domain?: string }
    members?: Record<string, { role?: string }>
  }>).map(([id, node]) => ({
    id,
    domain: node.meta?.domain,
    members: Object.fromEntries(
      Object.entries(node.members ?? {}).map(([k, v]) => [k, v?.role ?? '']),
    ),
  }))

  const projects: ProjectInfo[] = Object.entries((projSnap.val() ?? {}) as Record<string, {
    meta?: { name?: string; orgId?: string; creatorEmail?: string; memberEmails?: string[] }
    members?: Record<string, unknown>
  }>).map(([id, node]) => {
    const uids = Object.keys(node.members ?? {})
    // 사본과 실제 멤버를 합칩니다. 둘 중 하나만 있는 프로젝트가 섞여 있습니다.
    const emails = new Set<string>((node.meta?.memberEmails ?? []).map(e => e.toLowerCase()))
    for (const uid of uids) {
      const e = emailByUid.get(uid)
      if (e) emails.add(e)
    }
    return {
      id,
      name: node.meta?.name,
      orgId: node.meta?.orgId,
      creatorEmail: node.meta?.creatorEmail,
      memberEmails: [...emails],
      memberCount: uids.length,
    }
  })

  console.log(`워크스페이스 ${orgs.length}개 · 프로젝트 ${projects.length}개\n`)

  const verdicts = projects.map(p => decide(p, orgs))
  const already = verdicts.filter(v => v.why === '이미 찍혀 있음')
  const todo = verdicts.filter(v => v.orgId && v.why !== '이미 찍혀 있음')
  const stuck = verdicts.filter(v => !v.orgId && v.why !== '이미 찍혀 있음')

  console.log(`이미 찍힘 ${already.length}개`)
  console.log(`\n■ 찍을 것 ${todo.length}개`)
  for (const v of todo) console.log(`   ${v.projectId}  ${v.name ?? '(이름 없음)'}  → ${v.orgId}   [${v.why}]`)
  console.log(`\n■ 못 정한 것 ${stuck.length}개`)
  for (const v of stuck) console.log(`   ${v.projectId}  ${v.name ?? '(이름 없음)'}   [${v.why}]`)
  if (stuck.length) {
    console.log('\n  못 정한 것은 그냥 두는 편이 낫습니다. 소속은 한 번 쓰면 못 바꾸고,')
    console.log('  도장이 없는 프로젝트는 지금까지처럼 굴러갑니다 — 다만 테넌트 벽 밖입니다.')
  }

  if (!apply) {
    console.log('\n보여 주기만 했습니다. 실제로 찍으려면 --apply 를 붙이세요.')
    return
  }

  // 프로젝트 쪽과 워크스페이스 쪽 둘 다. 한 번에 쓰므로 반만 적히는 일이
  // 없습니다 — 둘이 어긋나면 규칙이 한쪽만 보고 판단하게 됩니다.
  const writes: Record<string, unknown> = {}
  for (const v of todo) {
    writes[`projects/${v.projectId}/meta/orgId`] = v.orgId
    writes[`orgs/${v.orgId}/owns/${v.projectId}`] = true
  }
  if (!Object.keys(writes).length) {
    console.log('\n찍을 것이 없습니다.')
    return
  }
  await withDeadline(db.ref().update(writes), 30, '데이터베이스 쓰기')
  console.log(`\n${todo.length}개 찍었습니다.`)
}

// 테스트가 이 파일을 읽을 때는 안 돕니다.
if (process.argv[1]?.endsWith('backfill.js')) {
  main()
    .then(() => process.exit(0))
    .catch(err => { console.error('[backfill]', err instanceof Error ? err.message : err); process.exit(1) })
}
