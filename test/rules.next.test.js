// Tests for database.rules.json — the rules that take effect at cutover.
//
// The pair to test/rules.test.js: the two "현재 실태" cases there (any signed-in
// account reads the whole workspace, and can delete anyone's tasks) are the
// first two cases denied here. That contrast is the point of the migration.
//
// Run with: npm run test:rules

import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { ref, get, set, remove, query, orderByChild, startAt } from 'firebase/database'

const ALICE = { uid: 'alice', email: 'alice@bpp.co.kr' }
const BOB = { uid: 'bob', email: 'bob@bpp.co.kr' }
const MALLORY = { uid: 'mallory', email: 'mallory@example.com' }

// A project Alice owns. Bob is invited by email but has not joined yet.
const PID = 'p1'
const INVITE = 'abc12345'

let testEnv

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-bpp-ops-next',
    database: {
      host: '127.0.0.1',
      port: 9000,
      rules: readFileSync('database.rules.json', 'utf8'),
    },
  })
})

after(async () => { await testEnv?.cleanup() })

const emailKey = e => e.replace(/\./g, ',')

beforeEach(async () => {
  await testEnv.clearDatabase()
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.database()
    await set(ref(db, `projects/${PID}`), {
      meta: { id: PID, name: 'Alice 프로젝트', color: '#000', inviteCode: INVITE, creatorEmail: ALICE.email, teamId: null },
      members: { [ALICE.uid]: INVITE },
      tasks: { t1: { id: 't1', name: '대외비 업무', status: '진행중' } },
      milestones: { m1: { id: 'm1', name: '1차 납품', dueDate: '2026-09-01' } },
    })
    await set(ref(db, `userIndex/${ALICE.uid}/projects/${PID}`), true)
    await set(ref(db, `invitesByEmail/${emailKey(BOB.email)}/${PID}`), INVITE)
    await set(ref(db, `personalTasks/${ALICE.uid}/pt1`), { id: 'pt1', name: '개인 메모' })
    await set(ref(db, `userProfiles/${ALICE.uid}`), { email: ALICE.email, name: 'Alice' })
    await set(ref(db, 'mcpAuth/secret'), { token: 'do-not-leak' })
    await set(ref(db, `notionAuth/${ALICE.uid}`), { accessToken: 'do-not-leak' })
    await set(ref(db, `notionLinked/${ALICE.uid}`), { workspace: 'BPP', at: 1 })
  })
})

// 구글 로그인은 email_verified를 언제나 참으로 실어 보냅니다. 규칙 여러 곳이
// 그걸 검사하므로(확인 안 된 주소로 도메인을 주장할 수 있으면 검사가 아닙니다),
// 여기 토큰에도 실어야 실제와 같은 조건이 됩니다.
const authed = who => testEnv.authenticatedContext(who.uid, { email: who.email, email_verified: true }).database()

/* ── 핵심: 지금 뚫려 있는 두 가지가 막힌다 ─────────────────────────────── */

test('남남은 프로젝트를 읽을 수 없다', async () => {
  await assertFails(get(ref(authed(MALLORY), `projects/${PID}`)))
  await assertFails(get(ref(authed(MALLORY), `projects/${PID}/tasks`)))
})

test('남남은 남의 업무를 지울 수 없다', async () => {
  await assertFails(remove(ref(authed(MALLORY), `projects/${PID}/tasks/t1`)))
  await assertFails(set(ref(authed(MALLORY), `projects/${PID}/tasks`), null))
})

test('프로젝트 목록을 통째로 훑을 수 없다', async () => {
  // 부모를 읽으려면 모든 자식에 대한 권한이 필요하므로, 워크스페이스 열거가 불가능하다.
  await assertFails(get(ref(authed(MALLORY), 'projects')))
  await assertFails(get(ref(authed(ALICE), 'projects')))
})

/* ── 멤버는 정상적으로 쓸 수 있다 ──────────────────────────────────────── */

test('멤버는 자기 프로젝트를 읽고 쓴다', async () => {
  const db = authed(ALICE)
  const snap = await assertSucceeds(get(ref(db, `projects/${PID}`)))
  assert.equal(snap.val().tasks.t1.name, '대외비 업무')
  await assertSucceeds(set(ref(db, `projects/${PID}/tasks/t2`), { id: 't2', name: '새 업무' }))
  await assertSucceeds(set(ref(db, `projects/${PID}/meta/name`), '이름 변경'))
})

test('내 프로젝트 목록(userIndex)은 본인만 읽고 쓴다', async () => {
  await assertSucceeds(get(ref(authed(ALICE), `userIndex/${ALICE.uid}`)))
  await assertFails(get(ref(authed(MALLORY), `userIndex/${ALICE.uid}`)))
  await assertFails(set(ref(authed(MALLORY), `userIndex/${ALICE.uid}/projects/x`), true))
})

/* ── 초대 ──────────────────────────────────────────────────────────────── */

test('초대코드를 알면 스스로 멤버가 될 수 있다', async () => {
  const db = authed(BOB)
  await assertFails(get(ref(db, `projects/${PID}`)))              // 가입 전엔 안 보이고
  await assertSucceeds(set(ref(db, `projects/${PID}/members/${BOB.uid}`), INVITE))
  await assertSucceeds(set(ref(db, `userIndex/${BOB.uid}/projects/${PID}`), true))
  const snap = await assertSucceeds(get(ref(db, `projects/${PID}`)))  // 가입 후엔 보인다
  assert.equal(snap.val().tasks.t1.name, '대외비 업무')
})

test('초대코드가 틀리면 가입할 수 없다', async () => {
  await assertFails(set(ref(authed(MALLORY), `projects/${PID}/members/${MALLORY.uid}`), 'wrong-code'))
  await assertFails(set(ref(authed(MALLORY), `projects/${PID}/members/${MALLORY.uid}`), true))
})

test('남의 이름으로 멤버를 끼워넣을 수 없다', async () => {
  // 코드를 알더라도 본인 uid 외에는 추가 불가 (멤버가 아닌 사람 기준)
  await assertFails(set(ref(authed(MALLORY), `projects/${PID}/members/${BOB.uid}`), INVITE))
})

test('이메일 초대함은 본인 것만 읽힌다', async () => {
  const snap = await assertSucceeds(get(ref(authed(BOB), `invitesByEmail/${emailKey(BOB.email)}`)))
  assert.equal(snap.val()[PID], INVITE)
  await assertFails(get(ref(authed(MALLORY), `invitesByEmail/${emailKey(BOB.email)}`)))
  await assertFails(get(ref(authed(MALLORY), 'invitesByEmail')))
})

test('점이 여러 개인 이메일도 초대함 키가 맞아떨어진다', async () => {
  // 규칙의 replace()가 첫 번째 점만 바꾸면 여기서 깨진다.
  const KIM = { uid: 'kim', email: 'kim.min.su@corp.co.kr' }
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await set(ref(ctx.database(), `invitesByEmail/${emailKey(KIM.email)}/${PID}`), INVITE)
  })
  const snap = await assertSucceeds(get(ref(authed(KIM), `invitesByEmail/${emailKey(KIM.email)}`)))
  assert.equal(snap.val()[PID], INVITE)
})

/* ── 개인 업무 · 프로필 · 기타 ─────────────────────────────────────────── */

test('개인 업무는 생성자만 볼 수 있다', async () => {
  await assertSucceeds(get(ref(authed(ALICE), `personalTasks/${ALICE.uid}`)))
  await assertFails(get(ref(authed(MALLORY), `personalTasks/${ALICE.uid}`)))
  await assertFails(get(ref(authed(MALLORY), 'personalTasks')))
  await assertFails(set(ref(authed(MALLORY), `personalTasks/${ALICE.uid}/x`), { name: '침입' }))
})

test('프로필은 여기 속한 사람에게만, uid를 알아야 읽힌다', async () => {
  // 이름 표시를 위해 개별 조회는 허용하되, 계정 전수 조사는 막는다.
  //
  // 그리고 **아무 구글 계정에게나 열려 있지 않습니다.** 이 앱의 로그인은
  // 누구나 통과하므로, '로그인했으면 됨'은 사실상 조건이 아닙니다. 프로젝트가
  // 하나라도 있는 사람 — userIndex에 이름이 있는 사람만 지나갑니다.
  await assertFails(get(ref(authed(BOB), `userProfiles/${ALICE.uid}`)))

  await testEnv.withSecurityRulesDisabled(async ctx => {
    await set(ref(ctx.database(), `userIndex/${BOB.uid}/projects/${PID}`), true)
  })
  await assertSucceeds(get(ref(authed(BOB), `userProfiles/${ALICE.uid}`)))
  await assertFails(get(ref(authed(BOB), 'userProfiles')))
  await assertFails(set(ref(authed(BOB), `userProfiles/${ALICE.uid}`), { name: '변조' }))

  // 자기 것은 언제나 읽고 씁니다. 아직 아무 프로젝트에도 안 들어온 새 사람이
  // 자기 프로필을 못 읽으면 그건 다른 문제가 됩니다.
  await assertSucceeds(set(ref(authed(MALLORY), `userProfiles/${MALLORY.uid}`), { email: MALLORY.email, name: 'M' }))
  await assertSucceeds(get(ref(authed(MALLORY), `userProfiles/${MALLORY.uid}`)))
  await assertFails(get(ref(authed(MALLORY), `userProfiles/${ALICE.uid}`)))
})

test('비로그인 사용자는 아무것도 못 한다', async () => {
  const db = testEnv.unauthenticatedContext().database()
  await assertFails(get(ref(db, `projects/${PID}`)))
  await assertFails(get(ref(db, 'spaces')))
  await assertFails(set(ref(db, `projects/${PID}/tasks/t9`), { name: 'x' }))
})

test('mcpAuth는 여전히 아무도 못 읽는다', async () => {
  await assertFails(get(ref(authed(ALICE), 'mcpAuth')))
  await assertFails(set(ref(authed(ALICE), 'mcpAuth/x'), 1))
})

// 노션 열쇠는 본인도 못 읽습니다. 앱은 열쇠가 필요 없고 — 검색은 서버가
// 대신 갑니다 — 읽을 수 있으면 확장 프로그램 하나가 그 사람 노션을 통째로
// 가져갈 수 있는 값이 브라우저에 놓입니다.
test('노션 열쇠는 본인조차 못 읽는다', async () => {
  await assertFails(get(ref(authed(ALICE), `notionAuth/${ALICE.uid}`)))
  await assertFails(set(ref(authed(ALICE), `notionAuth/${ALICE.uid}`), { accessToken: 'mine' }))
  await assertFails(get(ref(authed(MALLORY), `notionAuth/${ALICE.uid}`)))
})

test('붙었다는 표시만 본인이 읽고, 아무도 못 쓴다', async () => {
  await assertSucceeds(get(ref(authed(ALICE), `notionLinked/${ALICE.uid}`)))
  await assertFails(get(ref(authed(BOB), `notionLinked/${ALICE.uid}`)))
  // 서버만 씁니다. 앱이 쓸 수 있으면 안 붙여 놓고 붙은 척할 수 있고, 그러면
  // 검색이 조용히 빈 결과를 주는 상태가 '연결됨'으로 보입니다.
  await assertFails(set(ref(authed(ALICE), `notionLinked/${ALICE.uid}`), { workspace: '가짜' }))
})

test('휴지통은 그 프로젝트 멤버만 읽고 쓴다', async () => {
  const item = { task: { name: '지운 업무', status: '대기' }, at: 1, by: 'Alice' }

  // 멤버는 넣고 꺼낼 수 있습니다 — 지우는 사람과 되살리는 사람이 같은 사람들
  // 입니다. 새 경계를 만들지 않았습니다.
  await assertSucceeds(set(ref(authed(ALICE), `trash/${PID}/t1`), item))
  await assertSucceeds(get(ref(authed(ALICE), `trash/${PID}`)))
  await assertSucceeds(remove(ref(authed(ALICE), `trash/${PID}/t1`)))

  // 남남은 아무것도 못 합니다. 지운 업무도 업무입니다.
  await assertFails(get(ref(authed(MALLORY), `trash/${PID}`)))
  await assertFails(set(ref(authed(MALLORY), `trash/${PID}/t2`), item))

  // 초대만 받고 아직 안 들어온 사람도 마찬가지입니다.
  await assertFails(get(ref(authed(BOB), `trash/${PID}`)))
})

test('휴지통에는 업무와 지운 시각이 있어야 한다', async () => {
  // 되살리려면 그때 그 모습이 통째로 있어야 합니다. 시각이 없으면 언제 지운
  // 것인지 못 말하고, 그러면 목록을 정렬할 수도 오래된 것을 걷어낼 수도
  // 없습니다.
  await assertFails(set(ref(authed(ALICE), `trash/${PID}/t3`), { task: { name: 'x' } }))
  await assertFails(set(ref(authed(ALICE), `trash/${PID}/t4`), { at: 1 }))
  await assertSucceeds(set(ref(authed(ALICE), `trash/${PID}/t5`), { task: { name: 'x' }, at: 1 }))
})

test('개인 업무의 휴지통은 본인만 연다', async () => {
  const item = { task: { name: '개인 메모' }, at: 1 }
  await assertSucceeds(set(ref(authed(ALICE), `personalTrash/${ALICE.uid}/pt1`), item))
  await assertSucceeds(get(ref(authed(ALICE), `personalTrash/${ALICE.uid}`)))
  await assertFails(get(ref(authed(BOB), `personalTrash/${ALICE.uid}`)))
  await assertFails(set(ref(authed(BOB), `personalTrash/${ALICE.uid}/pt2`), item))
})

/* ── 워크스페이스 만들기 ─────────────────────────────────────────────────────
 *
 * 규칙에 조직 테스트가 하나도 없었습니다. 그래서 초대형 워크스페이스를 아무도
 * 못 만드는 상태로 배포됐습니다 — 관리자 조항이 `$mail.endsWith('@' + 도메인)`을
 * 요구하는데 초대형에는 도메인이 없어서, `null.replace(...)`가 되어 그 줄이
 * 언제나 거짓이었습니다. 화면에는 PERMISSION_DENIED 한 줄만 떴고요.
 *
 * 그래서 여기서는 조건을 흉내 내지 않고 **orgStore.createInviteOrg가 실제로
 * 쓰는 네 줄을 그 순서 그대로** 씁니다. 한 줄이라도 막히면 사람도 못 만듭니다.
 */

const GMAIL = { uid: 'gm', email: 'someone@gmail.com' }
const key = e => e.toLowerCase().replace(/\./g, ',')

test('도메인 없는 워크스페이스를 끝까지 만들 수 있다', async () => {
  const db = authed(GMAIL)
  const oid = 'inv1'
  const me = key(GMAIL.email)

  // 1. meta — 규칙이 owner를 여기서 읽으므로 이게 먼저입니다.
  await assertSucceeds(set(ref(db, `orgs/${oid}/meta`), {
    name: '팀플', owner: me, createdBy: GMAIL.email, createdAt: 1,
  }))
  // 2. 내 명단 행
  await assertSucceeds(set(ref(db, `orgs/${oid}/members/${me}`), { role: 'member', at: 1 }))
  // 3. 관리자 — 여기가 막혀 있었습니다
  await assertSucceeds(set(ref(db, `orgs/${oid}/admins/${me}`), true))
  // 4. 내 색인. 이 조직을 찾는 유일한 길이라 빠지면 자기도 못 찾습니다.
  await assertSucceeds(set(ref(db, `userOrgs/${GMAIL.uid}/${oid}`), 1))

  // 만들었으면 읽혀야 합니다 — 회의실까지.
  await assertSucceeds(get(ref(db, `orgs/${oid}/meta`)))
  await assertSucceeds(get(ref(db, `orgs/${oid}/rooms`)))
  await assertSucceeds(set(ref(db, `orgs/${oid}/rooms/r1`), { name: '큰 방', order: 0 }))
})

test('도메인 없는 워크스페이스에서 명단 밖 사람은 관리자가 못 된다', async () => {
  const db = authed(GMAIL)
  const oid = 'inv2'
  const me = key(GMAIL.email)
  await assertSucceeds(set(ref(db, `orgs/${oid}/meta`), { name: '팀플', owner: me, createdAt: 1 }))
  await assertSucceeds(set(ref(db, `orgs/${oid}/members/${me}`), { role: 'member', at: 1 }))
  await assertSucceeds(set(ref(db, `orgs/${oid}/admins/${me}`), true))

  // 경계가 도메인에서 명단으로 바뀐 것이지 없어진 것이 아닙니다.
  await assertFails(set(ref(db, `orgs/${oid}/admins/${key(MALLORY.email)}`), true))

  // 게스트도 안 됩니다 — 관리자는 멤버 중에서만.
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await set(ref(ctx.database(), `orgs/${oid}/members/${key(MALLORY.email)}`), { role: 'guest', at: 1 })
  })
  await assertFails(set(ref(db, `orgs/${oid}/admins/${key(MALLORY.email)}`), true))
})

test('도메인형에서는 여전히 그 도메인 주소만 관리자가 된다', async () => {
  const oid = 'dom1'
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.database()
    await set(ref(db, `orgs/${oid}/meta`), { name: '블랙페이퍼', domain: 'bpp.co.kr' })
    await set(ref(db, `orgs/${oid}/members/${key(ALICE.email)}`), { role: 'member', at: 1 })
    await set(ref(db, `orgs/${oid}/admins/${key(ALICE.email)}`), true)
  })
  const db = authed(ALICE)
  await assertSucceeds(set(ref(db, `orgs/${oid}/admins/${key(BOB.email)}`), true))
  // 도메인 밖 주소는 관리자로 못 세웁니다. 초대형을 열어 주면서 이쪽이
  // 같이 열리면 안 됩니다 — 도메인이 곧 그 워크스페이스의 벽입니다.
  await assertFails(set(ref(db, `orgs/${oid}/admins/${key(MALLORY.email)}`), true))
})

/**
 * 남의 워크스페이스에 게스트로 들어가 있는 사람.
 *
 * 화면 쪽 버그(orgStore.apply의 안전망)가 이 사람을 남의 조직에 붙였고, 그때
 * 붉은 권한 오류가 떴습니다. 규칙이 막는 것 자체는 맞습니다 — 그걸 못 박아
 * 둡니다. 화면이 애초에 안 붙는 것이 고친 내용이고요.
 */
test('게스트는 그 워크스페이스의 회의실을 못 읽는다', async () => {
  const oid = 'dom2'
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.database()
    await set(ref(db, `orgs/${oid}/meta`), { name: '블랙페이퍼', domain: 'bpp.co.kr' })
    await set(ref(db, `orgs/${oid}/members/${key(MALLORY.email)}`), { role: 'guest', at: 1 })
    await set(ref(db, `orgs/${oid}/rooms/r1`), { name: '큰 방' })
    await set(ref(db, `userOrgs/${MALLORY.uid}/${oid}`), 1)
  })
  await assertFails(get(ref(authed(MALLORY), `orgs/${oid}/rooms`)))
})

// ── 알림함은 남이 나에게 쓰는 자리입니다 ─────────────────────────────────────
//
// 그래서 열려 있어야 하는데, 그 틈으로 **아무나 아무에게나** 쓸 수 있었습니다.
// 쓰기 조건이 '로그인했나' 하나였고, 보낸 사람 이름(by)은 그냥 글자라
// 규칙이 확인할 수 없었습니다. 이메일 주소는 추측 가능합니다 —
// 'mallory@example.com'로 로그인해서 alice@bpp.co.kr의 알림함에
// '대표님이 업무를 배정했습니다'를 꽂을 수 있었습니다.

const notice = (byEmail, extra = {}) => ({
  kind: 'assigned', by: '대표님', at: 1, taskName: '급한 건', ...(byEmail ? { byEmail } : {}), ...extra,
})

test('남의 이름으로 알림을 못 보낸다', async () => {
  const db = authed(MALLORY)
  // 보낸 사람 주소를 아예 안 적는 것 — 예전에는 이게 통했습니다.
  await assertFails(set(ref(db, `notices/${key(ALICE.email)}/n1`), notice(null)))
  // 남의 주소를 적는 것.
  await assertFails(set(ref(db, `notices/${key(ALICE.email)}/n2`), notice(ALICE.email)))
  await assertFails(set(ref(db, `notices/${key(ALICE.email)}/n3`), notice('ceo@bpp.co.kr')))
})

test('자기 이름으로는 남에게 알림을 보낼 수 있다', async () => {
  // 담당자를 지정하면 상대 알림함에 한 줄이 갑니다. 그건 막으면 안 됩니다.
  await assertSucceeds(set(ref(authed(BOB), `notices/${key(ALICE.email)}/n4`), notice(BOB.email)))
})

test('받은 사람은 읽음 표시를 할 수 있다', async () => {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await set(ref(ctx.database(), `notices/${key(ALICE.email)}/n5`), notice(BOB.email))
    // 이 고침 전에 쌓인 알림에는 byEmail이 없습니다. 그것도 읽음 표시가 돼야
    // 합니다 — 안 그러면 지난 알림이 영영 안 읽은 채로 남습니다.
    await set(ref(ctx.database(), `notices/${key(ALICE.email)}/old`), notice(null))
  })
  const db = authed(ALICE)
  await assertSucceeds(set(ref(db, `notices/${key(ALICE.email)}/n5/read`), true))
  await assertSucceeds(set(ref(db, `notices/${key(ALICE.email)}/old/read`), true))
  await assertSucceeds(remove(ref(db, `notices/${key(ALICE.email)}/n5`)))
  // 남의 알림함은 여전히 못 고칩니다.
  await assertFails(set(ref(authed(MALLORY), `notices/${key(ALICE.email)}/old/read`), true))
})

// ── 관리자 자리 선점 ─────────────────────────────────────────────────────────
//
// '관리자가 아직 하나도 없으면 아무 멤버나 세울 수 있다'는 조항이 있습니다.
// 처음 만드는 사람을 위한 것인데, 만든 사람이 누구인지 적혀 있으면 그 사람만
// 쓸 수 있어야 합니다. 안 그러면 관리자가 비어 있는 워크스페이스에서 아무나
// 자기를 관리자로 만듭니다.

test('관리자가 비어 있어도 만든 사람만 첫 관리자를 세운다', async () => {
  const oid = 'dom3'
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.database()
    await set(ref(db, `orgs/${oid}/meta`), { name: '블랙페이퍼', domain: 'bpp.co.kr', createdBy: ALICE.email })
    await set(ref(db, `orgs/${oid}/members/${key(BOB.email)}`), { role: 'member', at: 1 })
  })
  await assertFails(set(ref(authed(BOB), `orgs/${oid}/admins/${key(BOB.email)}`), true))
  await assertSucceeds(set(ref(authed(ALICE), `orgs/${oid}/admins/${key(ALICE.email)}`), true))
})

test('만든 사람이 안 적힌 옛 워크스페이스는 예전대로 둔다', async () => {
  // 여기서 조이면 관리자가 비어 있고 createdBy도 없는 워크스페이스는
  // 아무도 관리자가 될 수 없습니다 — 회의실을 영영 못 고칩니다.
  const oid = 'dom4'
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.database()
    await set(ref(db, `orgs/${oid}/meta`), { name: '블랙페이퍼', domain: 'bpp.co.kr' })
    await set(ref(db, `orgs/${oid}/members/${key(BOB.email)}`), { role: 'member', at: 1 })
  })
  await assertSucceeds(set(ref(authed(BOB), `orgs/${oid}/admins/${key(BOB.email)}`), true))
})

// ── 프로젝트 삭제 ────────────────────────────────────────────────────────────
//
// 업무 하나를 지우면 휴지통으로 가지만 프로젝트는 통째로 사라집니다. 휴지통이
// 없습니다. 그런데 멤버면 누구나 지울 수 있었습니다 - 초대 링크로 어제 들어온
// 사람도요.
//
// 이제 만든 사람과 그 워크스페이스의 관리자만 지웁니다. 지우는 것 말고
// 나머지(업무 고치기, 멤버 넣기)는 멤버 전부 그대로입니다.

const PROJ = (extra = {}) => ({
  meta: { id: 'del', name: '지울 프로젝트', color: '#000', inviteCode: INVITE, ...extra },
  members: { [ALICE.uid]: INVITE, [BOB.uid]: INVITE },
  tasks: { t1: { id: 't1', name: '업무', status: '대기' } },
})

const seed = async (project, extra) => {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.database()
    await set(ref(db, 'projects/del'), project)
    if (extra) await extra(db)
  })
}

test('만든 사람은 지운다', async () => {
  await seed(PROJ({ creatorEmail: ALICE.email }))
  await assertSucceeds(remove(ref(authed(ALICE), 'projects/del')))
})

test('그냥 멤버는 못 지운다', async () => {
  await seed(PROJ({ creatorEmail: ALICE.email }))
  await assertFails(remove(ref(authed(BOB), 'projects/del')))
  // 지우는 것만 막습니다. 하던 일은 그대로 합니다.
  await assertSucceeds(set(ref(authed(BOB), 'projects/del/tasks/t1/status'), '완료'))
})

test('워크스페이스 관리자는 지운다', async () => {
  const oid = 'dom5'
  await seed(PROJ({ creatorEmail: ALICE.email, orgId: oid }), async db => {
    await set(ref(db, `orgs/${oid}/meta`), { name: '블랙페이퍼', domain: 'bpp.co.kr' })
    await set(ref(db, `orgs/${oid}/members/${key(ALICE.email)}`), { role: 'member', at: 1 })
    await set(ref(db, `orgs/${oid}/members/${key(BOB.email)}`), { role: 'member', at: 1 })
    await set(ref(db, `orgs/${oid}/admins/${key(BOB.email)}`), true)
  })
  await assertSucceeds(remove(ref(authed(BOB), 'projects/del')))
})

test('다른 워크스페이스의 관리자는 못 지운다', async () => {
  const mine = 'dom6'
  const other = 'dom7'
  await seed(PROJ({ creatorEmail: ALICE.email, orgId: mine }), async db => {
    for (const oid of [mine, other]) {
      await set(ref(db, `orgs/${oid}/meta`), { name: '블랙페이퍼', domain: 'bpp.co.kr' })
      await set(ref(db, `orgs/${oid}/members/${key(ALICE.email)}`), { role: 'member', at: 1 })
      await set(ref(db, `orgs/${oid}/members/${key(BOB.email)}`), { role: 'member', at: 1 })
    }
    // 밥은 **다른** 워크스페이스의 관리자입니다.
    await set(ref(db, `orgs/${other}/admins/${key(BOB.email)}`), true)
  })
  await assertFails(remove(ref(authed(BOB), 'projects/del')))
})

test('만든 사람이 안 적혀 있으면 명단 첫 사람', async () => {
  // 옛 프로젝트에는 creatorEmail이 없습니다. 화면이 쓰는 것과 같은 기준입니다.
  await seed(PROJ({ memberEmails: [ALICE.email, BOB.email] }))
  await assertFails(remove(ref(authed(BOB), 'projects/del')))
  await assertSucceeds(remove(ref(authed(ALICE), 'projects/del')))
})

test('근거가 아무것도 없는 옛 프로젝트는 예전대로 둔다', async () => {
  // creatorEmail도 memberEmails도 소속도 없는 것들이 실제로 있습니다.
  // 여기서 조이면 아무도 못 지우는 프로젝트가 영영 남습니다.
  await seed(PROJ())
  await assertSucceeds(remove(ref(authed(BOB), 'projects/del')))
})

test('멤버가 아니면 여전히 아무것도 못 한다', async () => {
  await seed(PROJ({ creatorEmail: ALICE.email }))
  await assertFails(remove(ref(authed(MALLORY), 'projects/del')))
  await assertFails(get(ref(authed(MALLORY), 'projects/del')))
})

// ── 워크스페이스에서 나가기 ──────────────────────────────────────────────────
//
// 나가는 길이 아예 없었습니다. 자기 명단 줄은 **만들 수만** 있고 고칠 수는
// 없었거든요(!data.exists()).
//
// 지우지 않고 'removed'로 덮습니다. 도메인형에서 줄을 지우면 '명단에 없고
// 도메인이 맞으면 통과' 조항이 그 자리에서 다시 넣어 줍니다 - 나간 것이
// 아니라 한 바퀴 돈 것이 됩니다. 비석이 필요합니다.

const org = async (oid, meta, rows = {}) => {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.database()
    await set(ref(db, `orgs/${oid}/meta`), meta)
    for (const [mail, row] of Object.entries(rows)) {
      await set(ref(db, `orgs/${oid}/members/${key(mail)}`), row)
    }
  })
}

test('스스로 나갈 수 있다', async () => {
  await org('w1', { name: 'W', domain: 'bpp.co.kr' }, { [ALICE.email]: { role: 'member', at: 1 } })
  await assertSucceeds(set(ref(authed(ALICE), `orgs/w1/members/${key(ALICE.email)}`), { role: 'removed', at: 2 }))
})

test('나간 뒤에는 그 워크스페이스를 못 읽는다', async () => {
  await org('w2', { name: 'W', domain: 'bpp.co.kr' }, { [ALICE.email]: { role: 'removed', at: 2 } })
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await set(ref(ctx.database(), 'orgs/w2/rooms/r1'), { name: '큰 방' })
  })
  // 도메인이 맞아도 안 됩니다. 비석이 도메인 조항보다 앞섭니다.
  await assertFails(get(ref(authed(ALICE), 'orgs/w2/rooms')))
})

test('남을 대신 내보낼 수는 없다', async () => {
  await org('w3', { name: 'W', domain: 'bpp.co.kr' }, {
    [ALICE.email]: { role: 'member', at: 1 },
    [BOB.email]: { role: 'member', at: 1 },
  })
  await assertFails(set(ref(authed(ALICE), `orgs/w3/members/${key(BOB.email)}`), { role: 'removed', at: 2 }))
})

test('나가면서 자기를 관리자로 올릴 수는 없다', async () => {
  await org('w4', { name: 'W', domain: 'bpp.co.kr' }, { [ALICE.email]: { role: 'member', at: 1 } })
  // role이 'removed'가 아니면 이 갈래를 못 씁니다.
  await assertFails(set(ref(authed(ALICE), `orgs/w4/members/${key(ALICE.email)}`), { role: 'member', at: 2, by: 'x' }))
})

// ── 없어진 프로젝트의 장부 줄 ────────────────────────────────────────────────
//
// orgs/{}/owns 는 넣기만 되고 빼기가 안 됐습니다. 프로젝트를 지워도 줄이
// 남아서, 이 장부는 '지금 이 워크스페이스에 뭐가 있나'에 답을 못 했습니다.
// 워크스페이스 삭제를 안전하게 막으려면 그 답이 정확해야 합니다.

test('프로젝트가 없어진 뒤에만 장부에서 뺄 수 있다', async () => {
  await org('w5', { name: 'W', domain: 'bpp.co.kr' }, { [ALICE.email]: { role: 'member', at: 1 } })
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.database()
    await set(ref(db, 'orgs/w5/owns/p1'), true)
    await set(ref(db, 'projects/p1'), {
      meta: { id: 'p1', name: 'P', color: '#000', inviteCode: INVITE, orgId: 'w5' },
      members: { [ALICE.uid]: INVITE },
    })
  })
  // 살아 있는 프로젝트는 장부에서 못 뺍니다 — 그러면 삭제 문이 거짓으로 열립니다.
  await assertFails(remove(ref(authed(ALICE), 'orgs/w5/owns/p1')))
  await testEnv.withSecurityRulesDisabled(async ctx => { await remove(ref(ctx.database(), 'projects/p1')) })
  await assertSucceeds(remove(ref(authed(ALICE), 'orgs/w5/owns/p1')))
})

// ── 워크스페이스 지우기 ──────────────────────────────────────────────────────
//
// **워크스페이스 노드가 사라지면 그 소속 프로젝트를 아무도 영영 못 읽습니다.**
// 규칙이 프로젝트의 소속을 보고 그 워크스페이스의 명단을 찾는데, 찾을 곳이
// 없어지니까요. 도장은 한 번 찍히면 다른 값으로 못 바꿉니다.
//
// 그래서 프로젝트가 하나라도 남아 있으면 못 지웁니다. 이건 불편이 아니라
// 되돌릴 수 없는 일을 막는 문입니다.

test('워크스페이스 노드가 사라지면 그 프로젝트가 잠긴다', async () => {
  // 이 사실이 아래 모든 조건의 이유입니다. 여기서 초록불이면 나머지는
  // 지나친 조심이 아닙니다.
  await org('w6', { name: 'W', domain: 'bpp.co.kr' }, { [ALICE.email]: { role: 'member', at: 1 } })
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.database()
    await set(ref(db, 'projects/locked'), {
      meta: { id: 'locked', name: 'P', color: '#000', inviteCode: INVITE, orgId: 'w6' },
      members: { [ALICE.uid]: INVITE },
    })
  })
  await assertSucceeds(get(ref(authed(ALICE), 'projects/locked')))
  await testEnv.withSecurityRulesDisabled(async ctx => { await remove(ref(ctx.database(), 'orgs/w6')) })
  await assertFails(get(ref(authed(ALICE), 'projects/locked')))
})

test('프로젝트가 남아 있으면 못 지운다', async () => {
  await org('w7', { name: 'W', domain: 'bpp.co.kr' }, { [ALICE.email]: { role: 'member', at: 1 } })
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.database()
    await set(ref(db, `orgs/w7/admins/${key(ALICE.email)}`), true)
    await set(ref(db, 'orgs/w7/owns/p1'), true)
  })
  await assertFails(remove(ref(authed(ALICE), 'orgs/w7')))
})

test('공개 목록에 이름이 남아 있어도 못 지운다', async () => {
  await org('w8', { name: 'W', domain: 'bpp.co.kr' }, { [ALICE.email]: { role: 'member', at: 1 } })
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.database()
    await set(ref(db, `orgs/w8/admins/${key(ALICE.email)}`), true)
    await set(ref(db, 'orgs/w8/projects/p1'), { id: 'p1', name: 'P' })
  })
  await assertFails(remove(ref(authed(ALICE), 'orgs/w8')))
})

test('비어 있으면 관리자가 지운다', async () => {
  await org('w9', { name: 'W', domain: 'bpp.co.kr' }, { [ALICE.email]: { role: 'member', at: 1 } })
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await set(ref(ctx.database(), `orgs/w9/admins/${key(ALICE.email)}`), true)
    await set(ref(ctx.database(), 'orgs/w9/rooms/r1'), { name: '큰 방' })
  })
  await assertSucceeds(remove(ref(authed(ALICE), 'orgs/w9')))
})

test('관리자가 아니면 못 지운다', async () => {
  await org('w10', { name: 'W', domain: 'bpp.co.kr' }, {
    [ALICE.email]: { role: 'member', at: 1 },
    [BOB.email]: { role: 'member', at: 1 },
  })
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await set(ref(ctx.database(), `orgs/w10/admins/${key(ALICE.email)}`), true)
  })
  await assertFails(remove(ref(authed(BOB), 'orgs/w10')))
})

test('지우는 것 말고는 이 자리가 열리지 않는다', async () => {
  // 여기에 쓰기를 열면 그 아래 모든 칸이 같이 열립니다 — 명단도 관리자도요.
  await org('w11', { name: 'W', domain: 'bpp.co.kr' }, { [ALICE.email]: { role: 'member', at: 1 } })
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await set(ref(ctx.database(), `orgs/w11/admins/${key(ALICE.email)}`), true)
  })
  // 관리자여도 통째로는 못 씁니다. 지우는 것만 열려 있습니다.
  await assertFails(set(ref(authed(ALICE), 'orgs/w11'), { meta: { name: '통째로' } }))
  // 관리자가 명단을 고치는 것은 원래 되는 일입니다(그쪽 규칙). 여기서 연
  // 문이 그것까지 넓히지 않았는지만 봅니다 — 관리자가 아닌 사람으로.
  await assertFails(set(ref(authed(BOB), 'orgs/w11'), null))
  await assertFails(set(ref(authed(MALLORY), 'orgs/w11'), null))
})

test('도메인 색인은 그 워크스페이스의 관리자만 지운다', async () => {
  await org('w12', { name: 'W', domain: 'bpp.co.kr' }, {
    [ALICE.email]: { role: 'member', at: 1 },
    [BOB.email]: { role: 'member', at: 1 },
  })
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await set(ref(ctx.database(), `orgs/w12/admins/${key(ALICE.email)}`), true)
    await set(ref(ctx.database(), 'orgByDomain/bpp,co,kr'), 'w12')
  })
  await assertFails(remove(ref(authed(BOB), 'orgByDomain/bpp,co,kr')))
  await assertSucceeds(remove(ref(authed(ALICE), 'orgByDomain/bpp,co,kr')))
})

// ── 만든 사람 ────────────────────────────────────────────────────────────────
//
// 관리자끼리 서로 대등해서, 아무 관리자나 **만든 사람을 관리자에서 내릴 수**
// 있었습니다. 도메인형에서는 그게 영구입니다 — 되찾는 조항이 '관리자가 하나도
// 없을 때'라, 내린 사람이 남아 있으면 안 비니까요.
//
// 두 줄로 막습니다: 만든 사람은 **언제나** 돌아올 수 있고, **남이 못 내립니다.**
//
// owner는 콤마 형태로, createdBy는 점 형태로 저장됩니다(각각 createInviteOrg와
// createOrg). 규칙 세 곳이 이미 그렇게 비교하고 있어서 모양을 맞춥니다 —
// 실제 데이터가 정답이고 규칙이 따라가야 합니다.

test('만든 사람을 남이 관리자에서 못 내린다 (도메인형)', async () => {
  const oid = 'f1'
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.database()
    await set(ref(db, `orgs/${oid}/meta`), { name: 'W', domain: 'bpp.co.kr', createdBy: ALICE.email })
    await set(ref(db, `orgs/${oid}/members/${key(ALICE.email)}`), { role: 'member', at: 1 })
    await set(ref(db, `orgs/${oid}/members/${key(BOB.email)}`), { role: 'member', at: 1 })
    await set(ref(db, `orgs/${oid}/admins/${key(ALICE.email)}`), true)
    await set(ref(db, `orgs/${oid}/admins/${key(BOB.email)}`), true)
  })
  await assertFails(remove(ref(authed(BOB), `orgs/${oid}/admins/${key(ALICE.email)}`)))
  // 관리자끼리 서로 세우고 내리는 것은 그대로입니다 — 만든 사람만 다릅니다.
  await assertSucceeds(remove(ref(authed(ALICE), `orgs/${oid}/admins/${key(BOB.email)}`)))
})

test('만든 사람을 남이 관리자에서 못 내린다 (초대형)', async () => {
  const oid = 'f2'
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.database()
    await set(ref(db, `orgs/${oid}/meta`), { name: 'W', owner: key(ALICE.email) })
    await set(ref(db, `orgs/${oid}/members/${key(ALICE.email)}`), { role: 'member', at: 1 })
    await set(ref(db, `orgs/${oid}/members/${key(BOB.email)}`), { role: 'member', at: 1 })
    await set(ref(db, `orgs/${oid}/admins/${key(ALICE.email)}`), true)
    await set(ref(db, `orgs/${oid}/admins/${key(BOB.email)}`), true)
  })
  await assertFails(remove(ref(authed(BOB), `orgs/${oid}/admins/${key(ALICE.email)}`)))
})

test('만든 사람은 관리자가 남아 있어도 되찾는다', async () => {
  // 되찾는 조항이 '관리자가 하나도 없을 때'뿐이었습니다. 누가 나를 내려
  // 두고 자기는 남아 있으면 영영 안 비어서 못 돌아왔습니다.
  const oid = 'f3'
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.database()
    await set(ref(db, `orgs/${oid}/meta`), { name: 'W', domain: 'bpp.co.kr', createdBy: ALICE.email })
    await set(ref(db, `orgs/${oid}/members/${key(ALICE.email)}`), { role: 'member', at: 1 })
    await set(ref(db, `orgs/${oid}/members/${key(BOB.email)}`), { role: 'member', at: 1 })
    await set(ref(db, `orgs/${oid}/admins/${key(BOB.email)}`), true)
  })
  await assertSucceeds(set(ref(authed(ALICE), `orgs/${oid}/admins/${key(ALICE.email)}`), true))
  // 만든 사람이 아니면 그냥 멤버는 여전히 스스로 관리자가 못 됩니다.
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await set(ref(ctx.database(), `orgs/${oid}/members/${key(MALLORY.email)}`), { role: 'member', at: 1 })
  })
  await assertFails(set(ref(authed(MALLORY), `orgs/${oid}/admins/${key(MALLORY.email)}`), true))
})

test('만든 사람을 나중에 바꿔칠 수 없다', async () => {
  // 이게 없으면 위 보호가 아무 소용이 없습니다 — 관리자가 meta를 고쳐서
  // 자기를 만든 사람으로 적으면 그만입니다.
  const oid = 'f4'
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.database()
    await set(ref(db, `orgs/${oid}/meta`), { name: 'W', domain: 'bpp.co.kr', createdBy: ALICE.email })
    await set(ref(db, `orgs/${oid}/members/${key(BOB.email)}`), { role: 'member', at: 1 })
    await set(ref(db, `orgs/${oid}/admins/${key(BOB.email)}`), true)
  })
  await assertFails(set(ref(authed(BOB), `orgs/${oid}/meta`), { name: 'W', domain: 'bpp.co.kr', createdBy: BOB.email }))
  // 이름 바꾸기는 그대로 됩니다.
  await assertSucceeds(set(ref(authed(BOB), `orgs/${oid}/meta`), { name: '새 이름', domain: 'bpp.co.kr', createdBy: ALICE.email }))
})

test('초대형 만든 사람은 관리자가 비어도 되찾고, 지울 수 있다', async () => {
  // 어제 넣은 삭제 규칙의 owner 갈래가 모양이 안 맞아 죽어 있었습니다.
  const oid = 'f5'
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.database()
    await set(ref(db, `orgs/${oid}/meta`), { name: 'W', owner: key(ALICE.email) })
    await set(ref(db, `orgs/${oid}/members/${key(ALICE.email)}`), { role: 'member', at: 1 })
  })
  await assertSucceeds(remove(ref(authed(ALICE), `orgs/${oid}`)))
})

// ── 워크스페이스에 부르는 것과 프로젝트에 부르는 것 ──────────────────────────
//
// 전에는 같은 손짓이었습니다. 초대형에서 프로젝트에 사람을 부르면 그 사람이
// 워크스페이스 **멤버**가 됐고, 그래서 프로젝트 초대 링크를 잘못 누른 사람이
// 회사 명단에 들어왔습니다.
//
// 이제 프로젝트 초대는 게스트 자리까지만 만듭니다. 그건 그 프로젝트를 읽기
// 위해 꼭 필요한 것이고(3단계 벽), 그 이상은 아닙니다. 워크스페이스 멤버로
// 부르는 것은 설정에 따로 있습니다.
//
// 규칙 자체는 둘 다 예전부터 허용합니다 — 갈라놓은 것은 화면 쪽입니다.
// 여기서는 그 두 문이 각각 열려 있는지, 그리고 게스트가 멤버의 자리까지는
// 못 가는지를 못 박습니다.

test('초대형에서 멤버가 남을 멤버로 부를 수 있다', async () => {
  const oid = 'inv1'
  await org(oid, { name: 'W', owner: key(ALICE.email) }, { [ALICE.email]: { role: 'member', at: 1 } })
  await assertSucceeds(set(ref(authed(ALICE), `orgs/${oid}/members/${key(BOB.email)}`), { role: 'member', at: 2 }))
})

test('초대형에서 멤버가 남을 게스트로도 부를 수 있다', async () => {
  // 프로젝트에 부를 때 쓰는 문입니다.
  const oid = 'inv2'
  await org(oid, { name: 'W', owner: key(ALICE.email) }, { [ALICE.email]: { role: 'member', at: 1 } })
  await assertSucceeds(set(ref(authed(ALICE), `orgs/${oid}/members/${key(MALLORY.email)}`), { role: 'guest', at: 2 }))
})

test('게스트는 스스로 멤버가 못 된다', async () => {
  // 여기가 열려 있으면 갈라 놓은 것이 아무 소용이 없습니다 — 프로젝트로
  // 들어온 사람이 자기를 승급시키면 그만입니다.
  const oid = 'inv3'
  await org(oid, { name: 'W', owner: key(ALICE.email) }, {
    [ALICE.email]: { role: 'member', at: 1 },
    [MALLORY.email]: { role: 'guest', at: 1 },
  })
  await assertFails(set(ref(authed(MALLORY), `orgs/${oid}/members/${key(MALLORY.email)}`), { role: 'member', at: 2 }))
})

test('게스트는 남을 못 부른다', async () => {
  const oid = 'inv4'
  await org(oid, { name: 'W', owner: key(ALICE.email) }, {
    [ALICE.email]: { role: 'member', at: 1 },
    [MALLORY.email]: { role: 'guest', at: 1 },
  })
  await assertFails(set(ref(authed(MALLORY), `orgs/${oid}/members/${key(BOB.email)}`), { role: 'member', at: 2 }))
  await assertFails(set(ref(authed(MALLORY), `orgs/${oid}/members/${key(BOB.email)}`), { role: 'guest', at: 2 }))
})

test('명단에서 남을 내리는 것은 관리자만', async () => {
  const oid = 'inv5'
  await org(oid, { name: 'W', owner: key(ALICE.email) }, {
    [ALICE.email]: { role: 'member', at: 1 },
    [BOB.email]: { role: 'member', at: 1 },
  })
  // 밥은 멤버지만 관리자가 아닙니다.
  await assertFails(set(ref(authed(BOB), `orgs/${oid}/members/${key(ALICE.email)}`), { role: 'removed', at: 2 }))
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await set(ref(ctx.database(), `orgs/${oid}/admins/${key(ALICE.email)}`), true)
  })
  await assertSucceeds(set(ref(authed(ALICE), `orgs/${oid}/members/${key(BOB.email)}`), { role: 'removed', at: 2 }))
})

/**
 * ── 회의실 규칙 ─────────────────────────────────────────────────────────────
 *
 * '낮에 얼마나 오래 잡을 수 있나'를 워크스페이스가 정합니다. 방 목록과 같은
 * 힘으로 고칩니다 — 둘 다 모두가 함께 쓰는 회의실에 대한 결정이고, 하나만
 * 관리자 것이면 규칙이 두 개가 됩니다.
 */
test('회의실 규칙은 관리자만 고친다', async () => {
  const oid = 'rr1'
  await org(oid, { name: 'W', domain: 'bpp.co.kr' }, {
    [ALICE.email]: { role: 'member', at: 1 },
    [BOB.email]: { role: 'member', at: 1 },
  })
  const rule = { maxMinutes: 120, from: 600, to: 1080 }

  /*
    관리자를 먼저 세웁니다. 관리자가 **아무도 없는** 도메인 워크스페이스에서는
    그 도메인 사람 누구나 맡을 수 있는 것이 규칙이고(영원히 손 못 대는 조직이
    생기지 않게 하는 안전장치), 그 상태로는 밥도 통과합니다 — 처음에 이걸
    빼먹고 규칙이 샌다고 읽을 뻔했습니다.
  */
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await set(ref(ctx.database(), `orgs/${oid}/admins/${key(ALICE.email)}`), true)
  })

  // 밥은 멤버지만 관리자가 아닙니다.
  await assertFails(set(ref(authed(BOB), `orgs/${oid}/roomRule`), rule))
  await assertSucceeds(set(ref(authed(ALICE), `orgs/${oid}/roomRule`), rule))
  // 읽는 것은 멤버 전부입니다 — 왜 안 잡히는지 알아야 하니까요.
  await assertSucceeds(get(ref(authed(BOB), `orgs/${oid}/roomRule`)))
})

test('말이 안 되는 회의실 규칙은 안 들어간다', async () => {
  const oid = 'rr2'
  await org(oid, { name: 'W', domain: 'bpp.co.kr' }, { [ALICE.email]: { role: 'member', at: 1 } })
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await set(ref(ctx.database(), `orgs/${oid}/admins/${key(ALICE.email)}`), true)
  })
  const db = authed(ALICE)
  // 끝이 시작보다 앞이면 '붐비는 시간'이 없는 것이 아니라 말이 안 되는 것입니다.
  await assertFails(set(ref(db, `orgs/${oid}/roomRule`), { maxMinutes: 120, from: 1080, to: 600 }))
  // 0분이면 아무도 방을 못 잡습니다 — 관리자가 실수로 회의실을 잠급니다.
  await assertFails(set(ref(db, `orgs/${oid}/roomRule`), { maxMinutes: 0, from: 600, to: 1080 }))
  await assertFails(set(ref(db, `orgs/${oid}/roomRule`), { maxMinutes: '두 시간', from: 600, to: 1080 }))
  // 빠진 값이 있으면 나머지가 무엇인지 알 수 없습니다.
  await assertFails(set(ref(db, `orgs/${oid}/roomRule`), { maxMinutes: 120 }))
})

/**
 * ── 장비 ─────────────────────────────────────────────────────────────────────
 *
 * 목록은 회의실과 같은 힘으로 고칩니다 — 관리자. 예약은 전원이 합니다.
 *
 * 겹침은 **규칙이 못 봅니다.** 형제 줄을 훑을 수 없어서 '이 시간에 이미 누가
 * 잡았나'를 물을 자리가 없습니다(회의실도 같습니다). 그건 화면이 막습니다.
 * 여기서 지키는 것은 그 아래 것들입니다 — 남의 예약을 못 지우고, 남의
 * 이름으로 못 잡고, 사유 없이 못 잡습니다.
 */
const asAdmin = async (oid, who) => {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await set(ref(ctx.database(), `orgs/${oid}/admins/${key(who.email)}`), true)
  })
}

const GEAR_ROW = by => ({
  gearId: 'cam1', from: '2026-08-27', to: '2026-08-29',
  fromMin: 0, toMin: 1440, long: true,
  by: by.email, reason: '촬영', at: 1,
})

test('장비 목록은 관리자만 고치고, 멤버는 읽는다', async () => {
  const oid = 'g1'
  await org(oid, { name: 'W', domain: 'bpp.co.kr' }, {
    [ALICE.email]: { role: 'member', at: 1 },
    [BOB.email]: { role: 'member', at: 1 },
  })
  // 관리자 없는 도메인 워크스페이스는 누구나 맡을 수 있는 것이 규칙이라,
  // 먼저 한 명을 세워 두지 않으면 밥도 통과합니다.
  await asAdmin(oid, ALICE)

  await assertFails(set(ref(authed(BOB), `orgs/${oid}/gear/cam1`), { name: 'A7S3' }))
  await assertSucceeds(set(ref(authed(ALICE), `orgs/${oid}/gear/cam1`), { name: 'A7S3' }))
  await assertSucceeds(get(ref(authed(BOB), `orgs/${oid}/gear/cam1`)))
  // 이름 없는 장비는 목록에서 이름을 잃습니다.
  await assertFails(set(ref(authed(ALICE), `orgs/${oid}/gear/cam2`), { note: '렌즈' }))
})

test('장비는 멤버 누구나 잡는다', async () => {
  const oid = 'g2'
  await org(oid, { name: 'W', domain: 'bpp.co.kr' }, {
    [ALICE.email]: { role: 'member', at: 1 },
    [BOB.email]: { role: 'member', at: 1 },
  })
  await asAdmin(oid, ALICE)
  await assertSucceeds(set(ref(authed(BOB), `orgs/${oid}/gearBookings/b1`), GEAR_ROW(BOB)))
  // 바깥 사람은 못 잡습니다.
  await assertFails(set(ref(authed(MALLORY), `orgs/${oid}/gearBookings/b2`), GEAR_ROW(MALLORY)))
})

test('남의 이름으로 잡거나, 사유 없이 잡을 수 없다', async () => {
  const oid = 'g3'
  await org(oid, { name: 'W', domain: 'bpp.co.kr' }, {
    [ALICE.email]: { role: 'member', at: 1 },
    [BOB.email]: { role: 'member', at: 1 },
  })
  const db = authed(BOB)
  // 앨리스 이름을 달고 잡으면 현황판이 거짓말을 합니다.
  await assertFails(set(ref(db, `orgs/${oid}/gearBookings/b1`), GEAR_ROW(ALICE)))
  // 사유는 비워 둘 수 없습니다 — 나갔다 오는 물건이라 '왜'가 남아야 합니다.
  await assertFails(set(ref(db, `orgs/${oid}/gearBookings/b2`), { ...GEAR_ROW(BOB), reason: '' }))
  // 반납일이 대여일보다 빠르면 구간이 아닙니다.
  await assertFails(set(ref(db, `orgs/${oid}/gearBookings/b3`), { ...GEAR_ROW(BOB), from: '2026-08-29', to: '2026-08-27' }))
  // 하루를 넘는 시각은 없습니다.
  await assertFails(set(ref(db, `orgs/${oid}/gearBookings/b4`), { ...GEAR_ROW(BOB), long: false, fromMin: 600, toMin: 2000 }))
})

test('남의 예약은 못 푼다 — 관리자는 푼다', async () => {
  const oid = 'g4'
  await org(oid, { name: 'W', domain: 'bpp.co.kr' }, {
    [ALICE.email]: { role: 'member', at: 1 },
    [BOB.email]: { role: 'member', at: 1 },
  })
  await asAdmin(oid, ALICE)
  await assertSucceeds(set(ref(authed(BOB), `orgs/${oid}/gearBookings/b1`), GEAR_ROW(BOB)))

  await testEnv.withSecurityRulesDisabled(async ctx => {
    await set(ref(ctx.database(), `orgs/${oid}/gearBookings/b2`), GEAR_ROW(ALICE))
  })
  // 밥은 앨리스 것을 못 건드립니다.
  await assertFails(remove(ref(authed(BOB), `orgs/${oid}/gearBookings/b2`)))
  // 자기 것은 풉니다.
  await assertSucceeds(remove(ref(authed(BOB), `orgs/${oid}/gearBookings/b1`)))
  // 관리자는 막힌 예약을 풀어 줄 수 있어야 합니다 — 빌린 사람이 휴가일 때
  // 아무도 그 카메라를 못 쓰는 상태가 남으면 안 됩니다.
  await assertSucceeds(remove(ref(authed(ALICE), `orgs/${oid}/gearBookings/b2`)))
})

test('소속팀은 자기 것과, 관리자면 남의 것도 정한다', async () => {
  const oid = 'g5'
  await org(oid, { name: 'W', domain: 'bpp.co.kr' }, {
    [ALICE.email]: { role: 'member', at: 1 },
    [BOB.email]: { role: 'member', at: 1 },
  })
  await asAdmin(oid, ALICE)
  await assertFails(set(ref(authed(BOB), `orgs/${oid}/teams/t1`), { name: '촬영팀' }))
  await assertSucceeds(set(ref(authed(ALICE), `orgs/${oid}/teams/t1`), { name: '촬영팀' }))

  // 자기 소속은 자기가 답합니다 — 오십 명을 관리자 한 명이 채우게 두면
  // 아무도 안 채웁니다. 소속은 경계가 아니라 이름표라 안전합니다.
  await assertSucceeds(set(ref(authed(BOB), `orgs/${oid}/teamOf/${key(BOB.email)}`), 't1'))
  // 남의 소속은 관리자만.
  await assertFails(set(ref(authed(BOB), `orgs/${oid}/teamOf/${key(ALICE.email)}`), 't1'))
  await assertSucceeds(set(ref(authed(ALICE), `orgs/${oid}/teamOf/${key(BOB.email)}`), 't1'))
})

test('장비에 종류를 적고, 같이 잡은 것끼리 묶습니다', async () => {
  const oid = 'g6'
  await org(oid, { name: 'W', domain: 'bpp.co.kr' }, {
    [ALICE.email]: { role: 'member', at: 1 },
    [BOB.email]: { role: 'member', at: 1 },
  })
  await asAdmin(oid, ALICE)
  await assertSucceeds(set(ref(authed(ALICE), `orgs/${oid}/gear/cam1`), { name: 'FX3', kind: '카메라' }))
  // 종류는 한 줄짜리 이름표입니다. 문단이 들어오면 목록이 아니라 글이 됩니다.
  await assertFails(set(ref(authed(ALICE), `orgs/${oid}/gear/cam2`), { name: 'A7C', kind: 'x'.repeat(31) }))

  // 촬영 한 번에 카메라와 조명이 같이 나갑니다. 저장은 장비마다 한 줄이고,
  // 같이 잡은 표(group)를 나눠 갖습니다.
  const db = authed(BOB)
  await assertSucceeds(set(ref(db, `orgs/${oid}/gearBookings/b1`), { ...GEAR_ROW(BOB), group: 'trip1' }))
  await assertSucceeds(set(ref(db, `orgs/${oid}/gearBookings/b2`), { ...GEAR_ROW(BOB), gearId: 'light1', group: 'trip1' }))
})

/**
 * ── 게스트는 이름만 봅니다 ───────────────────────────────────────────────────
 *
 * 게스트는 워크스페이스 노드를 못 읽습니다. 그래서 화면에서 그 자리가 아예
 * 없었고, 초대받은 사람은 자기가 어디에 초대된 건지 알 방법이 없었습니다 —
 * 프로젝트 하나가 출처 없이 떠 있었습니다.
 *
 * 이름 하나만 엽니다. `meta` 통째로 열면 owner 주소와 도메인까지 같이 나가고,
 * 그건 물어본 적 없는 것입니다. 회의실·장비·명단·공개 목록은 그대로 닫혀
 * 있습니다 — 여는 것은 이름 한 줄이지 자리가 아닙니다.
 */
test('게스트는 워크스페이스 이름만 읽는다', async () => {
  const oid = 'gv1'
  await org(oid, { name: '블랙페이퍼', domain: 'bpp.co.kr', owner: 'alice@bpp,co,kr' }, {
    [ALICE.email]: { role: 'member', at: 1 },
    [MALLORY.email]: { role: 'guest', at: 1 },
  })
  await asAdmin(oid, ALICE)
  await assertSucceeds(set(ref(authed(ALICE), `orgs/${oid}/rooms/r1`), { name: '대회의실' }))

  const guest = authed(MALLORY)
  await assertSucceeds(get(ref(guest, `orgs/${oid}/meta/name`)))
  // 나머지는 그대로 닫혀 있습니다.
  await assertFails(get(ref(guest, `orgs/${oid}/meta`)))
  await assertFails(get(ref(guest, `orgs/${oid}/meta/owner`)))
  await assertFails(get(ref(guest, `orgs/${oid}/rooms`)))
  await assertFails(get(ref(guest, `orgs/${oid}/members`)))
  await assertFails(get(ref(guest, `orgs/${oid}/projects`)))
  await assertFails(get(ref(guest, `orgs/${oid}`)))
  // 이름을 고치지도 못합니다.
  await assertFails(set(ref(guest, `orgs/${oid}/meta`), { name: '내 회사' }))
})

test('명단에 없는 바깥 사람은 이름도 못 읽는다', async () => {
  const oid = 'gv2'
  await org(oid, { name: '블랙페이퍼', domain: 'bpp.co.kr' }, { [ALICE.email]: { role: 'member', at: 1 } })
  // 게스트 자리조차 없는 사람. 워크스페이스 이름은 '우리가 누구인지'라서,
  // 아무 관계도 없는 사람에게까지 열 이유가 없습니다.
  await assertFails(get(ref(authed(MALLORY), `orgs/${oid}/meta/name`)))
})

test('내보낸 사람은 이름도 다시 못 읽는다', async () => {
  const oid = 'gv3'
  await org(oid, { name: '블랙페이퍼', domain: 'bpp.co.kr' }, {
    [ALICE.email]: { role: 'member', at: 1 },
    [MALLORY.email]: { role: 'removed', at: 2 },
  })
  await assertFails(get(ref(authed(MALLORY), `orgs/${oid}/meta/name`)))
})

test('멤버는 장비 예약을 질의로 읽는다', async () => {
  const oid = 'gq1'
  await org(oid, { name: 'W', domain: 'bpp.co.kr' }, {
    [ALICE.email]: { role: 'member', at: 1 },
    [MALLORY.email]: { role: 'guest', at: 1 },
  })
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await set(ref(ctx.database(), `orgs/${oid}/gearBookings/b1`), GEAR_ROW(ALICE))
  })
  // 현황판이 실제로 보내는 질의입니다. 통째로 읽는 것과 다릅니다 — 색인이
  // 없으면 여기서 막히고, 화면에는 붉은 permission_denied로 나옵니다.
  const q = query(ref(authed(ALICE), `orgs/${oid}/gearBookings`), orderByChild('to'), startAt('2026-01-01'))
  await assertSucceeds(get(q))
  // 게스트는 못 읽습니다.
  await assertFails(get(query(ref(authed(MALLORY), `orgs/${oid}/gearBookings`), orderByChild('to'), startAt('2026-01-01'))))
})

/**
 * 회의실 예약도 관리자가 풀 수 있어야 합니다.
 *
 * 장비는 이미 그랬는데 회의실만 아니었습니다 — 그런데 현황판은 관리자에게
 * '예약 풀기'를 보여 줍니다. **눌러도 안 되는 것을 눌리게 두면 그건 고장으로
 * 보입니다.** 이유도 장비와 같습니다: 잡아 둔 사람이 휴가인데 그 방이 하루
 * 종일 막혀 있으면, 아무도 못 푸는 자리가 남습니다.
 */
test('회의실 예약 — 남의 것은 못 풀고, 관리자는 푼다', async () => {
  const oid = 'rb1'
  await org(oid, { name: 'W', domain: 'bpp.co.kr' }, {
    [ALICE.email]: { role: 'member', at: 1 },
    [BOB.email]: { role: 'member', at: 1 },
  })
  await asAdmin(oid, ALICE)
  const row = { roomId: 'r1', from: 600, to: 660, by: BOB.email, at: 1 }
  await assertSucceeds(set(ref(authed(BOB), `orgs/${oid}/bookings/2026-08-27/b1`), row))
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await set(ref(ctx.database(), `orgs/${oid}/bookings/2026-08-27/b2`), { ...row, by: 'carol@bpp.co.kr' })
  })
  // 밥은 남의 것을 못 건드립니다.
  await assertFails(remove(ref(authed(BOB), `orgs/${oid}/bookings/2026-08-27/b2`)))
  // 자기 것은 풉니다.
  await assertSucceeds(remove(ref(authed(BOB), `orgs/${oid}/bookings/2026-08-27/b1`)))
  // 관리자는 막힌 방을 풀어 줄 수 있습니다.
  await assertSucceeds(remove(ref(authed(ALICE), `orgs/${oid}/bookings/2026-08-27/b2`)))
})
