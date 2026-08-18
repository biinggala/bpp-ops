// Characterization tests for database.rules.json.
//
// These do NOT describe desired behaviour. They pin down what the rules do
// TODAY, so that the data-model migration shows up as a visible diff in this
// file rather than as a silent change in who can read what. Tests marked
// "현재 실태" are the ones the migration is meant to break.
//
// Run with: npm run test:rules  (boots the RTDB emulator)

import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { ref, get, set } from 'firebase/database'

const ALICE = { uid: 'alice', email: 'alice@bpp.co.kr' }
const MALLORY = { uid: 'mallory', email: 'mallory@example.com' }

let testEnv

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-bpp-ops',
    database: {
      host: '127.0.0.1',
      port: 9000,
      rules: readFileSync('database.rules.json', 'utf8'),
    },
  })
})

after(async () => { await testEnv?.cleanup() })

beforeEach(async () => {
  await testEnv.clearDatabase()
  // Alice's private project, with Mallory nowhere near it.
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.database()
    await set(ref(db, 'cringe/projects'), [
      { id: 'p1', name: 'Alice 비공개 프로젝트', color: '#000', memberEmails: [ALICE.email], creatorEmail: ALICE.email },
    ])
    await set(ref(db, 'cringe/tasks'), [
      { id: 't1', name: '대외비 업무', projectId: 'p1', assignee: ALICE.email, status: '진행중' },
    ])
    await set(ref(db, 'mcpAuth/secret'), { token: 'do-not-leak' })
  })
})

const authed = who => testEnv.authenticatedContext(who.uid, { email: who.email }).database()

test('현재 실태: 로그인만 하면 남의 프로젝트 데이터가 전부 읽힌다', async () => {
  // Mallory is not a member of p1 and shares nothing with Alice, yet the rules
  // grant her the entire workspace. canAccessProject() hides this in the UI
  // only — it is not enforced here.
  const snap = await assertSucceeds(get(ref(authed(MALLORY), 'cringe')))
  const tasks = snap.val().tasks
  assert.equal(tasks[0].name, '대외비 업무')
})

test('현재 실태: 로그인만 하면 남의 업무를 덮어쓸 수 있다', async () => {
  await assertSucceeds(set(ref(authed(MALLORY), 'cringe/tasks'), []))
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const snap = await get(ref(ctx.database(), 'cringe/tasks'))
    assert.equal(snap.val(), null)  // Alice's task is gone.
  })
})

test('비로그인 사용자는 차단된다', async () => {
  const db = testEnv.unauthenticatedContext().database()
  await assertFails(get(ref(db, 'cringe')))
  await assertFails(set(ref(db, 'cringe/tasks'), []))
})

test('presence는 본인 uid에만 쓸 수 있다', async () => {
  const db = authed(ALICE)
  await assertSucceeds(set(ref(db, `presence/${ALICE.uid}`), { online: true }))
  await assertFails(set(ref(db, `presence/${MALLORY.uid}`), { online: false }))
})

test('mcpAuth는 로그인 여부와 무관하게 아무도 못 읽는다', async () => {
  await assertFails(get(ref(authed(ALICE), 'mcpAuth')))
  await assertFails(set(ref(authed(ALICE), 'mcpAuth/x'), 1))
})
