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
import { ref, get, set, remove } from 'firebase/database'

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
