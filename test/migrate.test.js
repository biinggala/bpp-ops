// Covers scripts/migrate.mjs — the file-to-file conversion run at cutover.
//
// The last test is the one that matters most: it takes the converted output,
// loads it into the emulator under the NEW rules, and checks that the people
// who should see a project can and that a stranger cannot. Counting rows only
// proves the shape; this proves the result is actually usable.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { ref, get, set } from 'firebase/database'
import { migrate, emailKey } from '../scripts/migrate.mjs'

const ALICE = { uid: 'uid-alice', email: 'alice@bpp.co.kr' }
const BOB = { uid: 'uid-bob', email: 'bob@bpp.co.kr' }
const NEWBIE_EMAIL = 'newbie@bpp.co.kr'      // 초대만 받고 로그인한 적 없음
const MALLORY = { uid: 'uid-mallory', email: 'mallory@example.com' }

// Shaped like a real export: arrays at the top level, profiles keyed by uid.
function sourceExport() {
  return {
    cringe: {
      savedAt: 1750000000000,
      projects: [
        { id: 'p1', name: '고객사 A 리뉴얼', color: '#2383e2', inviteCode: 'invite-p1',
          creatorEmail: ALICE.email, memberEmails: [ALICE.email, BOB.email, NEWBIE_EMAIL] },
        { id: 'p2', name: '초대코드 없는 프로젝트', color: '#059669', memberEmails: [ALICE.email] },
      ],
      milestones: [
        { id: 'm1', projectId: 'p1', name: '1차 납품', dueDate: '2026-09-01' },
        { id: 'm9', projectId: 'gone', name: '사라진 프로젝트의 마일스톤', dueDate: '2026-09-01' },
      ],
      tasks: [
        { id: 't1', name: '와이어프레임', projectId: 'p1', milestoneId: 'm1', assignee: ALICE.email, status: '진행중' },
        { id: 't2', name: '디자인 시안', projectId: 'p1', assignee: BOB.email, status: '대기' },
        { id: 't3', name: '견적서 정리', projectId: 'p2', assignee: ALICE.email, status: '완료' },
        { id: 't4', name: '개인 메모', createdBy: ALICE.email, status: '대기' },
        { id: 't5', name: '주인 없는 업무', status: '대기' },
        { id: 't6', name: '없어진 프로젝트의 업무', projectId: 'gone', status: '대기' },
      ],
      spaces: [{ id: 's1', name: 'Production', color: '#ef4444' }],
      userProfiles: {
        [ALICE.uid]: { email: ALICE.email, name: '앨리스' },
        [BOB.uid]: { email: BOB.email, name: '밥' },
        [MALLORY.uid]: { email: MALLORY.email, name: '맬러리' },
      },
    },
    presence: { [ALICE.uid]: { online: false } },
  }
}

test('업무가 하나도 유실되지 않는다', () => {
  const { report } = migrate(sourceExport())
  assert.equal(report.balanced, true)
  assert.equal(report.counts.in.tasks, 6)
  // 4건은 배치되고 2건은 주인을 못 찾아 보고서에 남는다 — 조용히 사라지지 않는다.
  assert.equal(report.counts.out.tasksInProjects, 3)
  assert.equal(report.counts.out.personalTasks, 1)
  assert.equal(report.counts.out.orphanTasks, 2)
})

test('업무가 프로젝트별 서랍으로 들어간다', () => {
  const { data } = migrate(sourceExport())
  assert.deepEqual(Object.keys(data.projects.p1.tasks).sort(), ['t1', 't2'])
  assert.deepEqual(Object.keys(data.projects.p2.tasks), ['t3'])
  assert.deepEqual(Object.keys(data.projects.p1.milestones), ['m1'])
})

test('로그인한 적 있는 사람은 계정 id로 멤버가 된다', () => {
  const { data } = migrate(sourceExport())
  assert.deepEqual(Object.keys(data.projects.p1.members).sort(), [ALICE.uid, BOB.uid])
  assert.equal(data.projects.p1.members[ALICE.uid], 'invite-p1')
  assert.equal(data.userIndex[ALICE.uid].projects.p1, true)
  assert.equal(data.userIndex[BOB.uid].projects.p1, true)
})

test('로그인한 적 없는 사람은 대기 중인 초대로 남는다', () => {
  const { data, report } = migrate(sourceExport())
  assert.equal(data.invitesByEmail[emailKey(NEWBIE_EMAIL)].p1, 'invite-p1')
  assert.equal(report.pendingInvites.length, 1)
  assert.equal(report.pendingInvites[0].email, NEWBIE_EMAIL)
  // 멤버로 들어가서는 안 된다 — 계정이 없으므로 열어줄 대상 자체가 없다.
  assert.equal(Object.values(data.projects.p1.members).length, 2)
})

test('개인 업무는 생성자에게 간다', () => {
  const { data } = migrate(sourceExport())
  assert.deepEqual(Object.keys(data.personalTasks[ALICE.uid]), ['t4'])
})

test('주인을 못 찾은 업무는 이유와 함께 보고된다', () => {
  const { report } = migrate(sourceExport())
  const reasons = report.orphanTasks.map(o => `${o.task.id}:${o.reason}`)
  assert.equal(reasons.some(r => r.startsWith('t5:') && r.includes('생성자 정보 없음')), true)
  assert.equal(reasons.some(r => r.startsWith('t6:') && r.includes('gone')), true)
})

test('--orphan-owner를 주면 주인 없는 개인 업무를 넘겨받는다', () => {
  const { data, report } = migrate(sourceExport(), { orphanOwner: ALICE.email })
  assert.deepEqual(Object.keys(data.personalTasks[ALICE.uid]).sort(), ['t4', 't5'])
  // 없어진 프로젝트를 가리키던 업무는 여전히 넘기지 않는다 — 소속이 불명확하다.
  assert.equal(report.counts.out.orphanTasks, 1)
})

test('초대코드가 없던 프로젝트는 새로 발급받는다', () => {
  const { data, report } = migrate(sourceExport())
  const code = data.projects.p2.meta.inviteCode
  assert.equal(typeof code, 'string')
  assert.ok(code.length >= 6, '규칙이 6자 이상을 요구한다')
  assert.equal(report.generatedInviteCodes[0].pid, 'p2')
  // 멤버 값은 그 프로젝트의 코드와 일치해야 규칙을 통과한다.
  assert.equal(data.projects.p2.members[ALICE.uid], code)
})

test('옛 데이터는 되돌리기용으로 그대로 남는다', () => {
  const { data } = migrate(sourceExport())
  assert.deepEqual(data.cringe.tasks.length, 6)
  const dropped = migrate(sourceExport(), { keepLegacy: false })
  assert.equal(dropped.data.cringe, undefined)
})

/* ── 실제 규칙 위에서의 리허설 ────────────────────────────────────────── */

let testEnv

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-bpp-ops-migrate',
    database: {
      host: '127.0.0.1',
      port: 9000,
      rules: readFileSync('database.rules.next.json', 'utf8'),
    },
  })
})

after(async () => { await testEnv?.cleanup() })

test('리허설: 옮긴 데이터를 새 규칙 위에 올리면 그대로 쓸 수 있다', async () => {
  const { data } = migrate(sourceExport())

  await testEnv.clearDatabase()
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await set(ref(ctx.database(), '/'), data)
  })

  const as = who => testEnv.authenticatedContext(who.uid, { email: who.email }).database()

  // 멤버는 자기 프로젝트와 업무를 정상적으로 본다.
  const alice = await assertSucceeds(get(ref(as(ALICE), 'projects/p1')))
  assert.equal(alice.val().tasks.t1.name, '와이어프레임')
  assert.equal(alice.val().milestones.m1.name, '1차 납품')

  const index = await assertSucceeds(get(ref(as(ALICE), `userIndex/${ALICE.uid}/projects`)))
  assert.deepEqual(Object.keys(index.val()).sort(), ['p1', 'p2'])

  // 앨리스의 개인 업무는 앨리스만.
  await assertSucceeds(get(ref(as(ALICE), `personalTasks/${ALICE.uid}`)))
  await assertFails(get(ref(as(BOB), `personalTasks/${ALICE.uid}`)))

  // 밥은 p1만 멤버이고 p2는 아니다.
  await assertSucceeds(get(ref(as(BOB), 'projects/p1')))
  await assertFails(get(ref(as(BOB), 'projects/p2')))

  // 남남은 아무것도 못 본다 — 이사 전에는 전부 보였다.
  await assertFails(get(ref(as(MALLORY), 'projects/p1')))
  await assertFails(get(ref(as(MALLORY), 'projects')))
  await assertFails(get(ref(as(MALLORY), 'cringe')))   // 남겨둔 옛 데이터도 잠겨 있다
})

test('리허설: 초대만 받은 사람은 로그인하면 초대장을 찾아 들어올 수 있다', async () => {
  const { data } = migrate(sourceExport())
  await testEnv.clearDatabase()
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await set(ref(ctx.database(), '/'), data)
  })

  const NEWBIE = { uid: 'uid-newbie', email: NEWBIE_EMAIL }
  const db = testEnv.authenticatedContext(NEWBIE.uid, { email: NEWBIE.email }).database()

  await assertFails(get(ref(db, 'projects/p1')))                       // 아직은 못 본다
  const inbox = await assertSucceeds(get(ref(db, `invitesByEmail/${emailKey(NEWBIE_EMAIL)}`)))
  const code = inbox.val().p1

  await assertSucceeds(set(ref(db, `projects/p1/members/${NEWBIE.uid}`), code))
  await assertSucceeds(set(ref(db, `userIndex/${NEWBIE.uid}/projects/p1`), true))

  const after = await assertSucceeds(get(ref(db, 'projects/p1')))      // 이제 보인다
  assert.equal(after.val().tasks.t2.name, '디자인 시안')
})
