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
  })
})

const authed = who => testEnv.authenticatedContext(who.uid, { email: who.email }).database()

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

test('프로필은 uid를 알아야 읽히고, 전체 목록은 열 수 없다', async () => {
  // 이름 표시를 위해 개별 조회는 허용하되, 계정 전수 조사는 막는다.
  await assertSucceeds(get(ref(authed(BOB), `userProfiles/${ALICE.uid}`)))
  await assertFails(get(ref(authed(BOB), 'userProfiles')))
  await assertFails(set(ref(authed(BOB), `userProfiles/${ALICE.uid}`), { name: '변조' }))
  await assertSucceeds(set(ref(authed(BOB), `userProfiles/${BOB.uid}`), { email: BOB.email, name: 'Bob' }))
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
