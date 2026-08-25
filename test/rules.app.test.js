// Replays the exact write shapes the app produces against the new rules.
//
// The stores were rewritten to per-entity paths; the risk is not that the code
// is wrong in the abstract but that a payload it sends is refused once the rules
// are live. Each test here mirrors one store action byte for byte.

import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { ref, get, set, update, remove } from 'firebase/database'

const ALICE = { uid: 'alice', email: 'alice@bpp.co.kr' }
const BOB = { uid: 'bob', email: 'bob@bpp.co.kr' }
const emailKey = e => e.toLowerCase().replace(/\./g, ',')

let testEnv
before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-bpp-ops-app',
    database: { host: '127.0.0.1', port: 9000, rules: readFileSync('database.rules.json', 'utf8') },
  })
})
after(async () => { await testEnv?.cleanup() })
beforeEach(async () => { await testEnv.clearDatabase() })

// 구글 로그인은 email_verified를 언제나 참으로 실어 보냅니다. 규칙 여러 곳이
// 그걸 검사하므로(확인 안 된 주소로 도메인을 주장할 수 있으면 검사가 아닙니다),
// 여기 토큰에도 실어야 실제와 같은 조건이 됩니다.
const as = who => testEnv.authenticatedContext(who.uid, { email: who.email, email_verified: true }).database()

test('projectStore.addProject: 프로젝트와 내 목록을 한 번에 쓴다', async () => {
  const db = as(ALICE)
  const pid = 'newproj', code = 'abc12345'
  await assertSucceeds(update(ref(db), {
    [`projects/${pid}`]: {
      meta: { id: pid, name: '새 프로젝트', color: '#2383e2', inviteCode: code, creatorEmail: ALICE.email, memberEmails: [ALICE.email], teamId: null },
      members: { [ALICE.uid]: code },
    },
    [`userIndex/${ALICE.uid}/projects/${pid}`]: true,
  }))
  const snap = await assertSucceeds(get(ref(db, `projects/${pid}`)))
  assert.equal(snap.val().meta.name, '새 프로젝트')
})

test('projectStore.addProject: 자기를 멤버로 넣지 않으면 거부된다', async () => {
  await assertFails(set(ref(as(ALICE), 'projects/sneaky'), {
    meta: { id: 'sneaky', name: 'x', inviteCode: 'abc12345' },
    members: { [BOB.uid]: 'abc12345' },
  }))
})

test('taskStore: 업무 생성·수정·이동·삭제가 전부 통과한다', async () => {
  const db = as(ALICE)
  const pid = 'p1', other = 'p2', code = 'abc12345'
  for (const id of [pid, other]) {
    await assertSucceeds(update(ref(db), {
      [`projects/${id}`]: { meta: { id, name: id, inviteCode: code }, members: { [ALICE.uid]: code } },
      [`userIndex/${ALICE.uid}/projects/${id}`]: true,
    }))
  }
  // addTask — projectId는 경로가 말해주므로 레코드에 담지 않는다
  await assertSucceeds(set(ref(db, `projects/${pid}/tasks/t1`), { id: 't1', name: '업무', status: '대기', progress: 0, memo: '' }))
  // updateTask — 바뀐 필드만
  await assertSucceeds(update(ref(db, `projects/${pid}/tasks/t1`), { status: '진행중', milestoneId: null }))
  // 프로젝트 간 이동 = 지우고 새로 쓰기
  await assertSucceeds(remove(ref(db, `projects/${pid}/tasks/t1`)))
  await assertSucceeds(set(ref(db, `projects/${other}/tasks/t1`), { id: 't1', name: '업무', status: '진행중' }))
  // reorderTasks — order만 갱신
  await assertSucceeds(update(ref(db, `projects/${other}/tasks/t1`), { order: 3 }))
  await assertSucceeds(remove(ref(db, `projects/${other}/tasks/t1`)))
})

test('taskStore: 개인 업무는 personalTasks/내uid에 쓴다', async () => {
  const db = as(ALICE)
  await assertSucceeds(set(ref(db, `personalTasks/${ALICE.uid}/t9`), { id: 't9', name: '개인', status: '대기' }))
  await assertFails(set(ref(as(BOB), `personalTasks/${ALICE.uid}/t8`), { id: 't8', name: '남의 것' }))
})

test('projectStore.addMember: meta의 대기 목록과 상대 초대함을 함께 쓴다', async () => {
  const db = as(ALICE)
  const pid = 'p1', code = 'abc12345'
  await assertSucceeds(update(ref(db), {
    [`projects/${pid}`]: { meta: { id: pid, name: 'P', inviteCode: code, memberEmails: [ALICE.email] }, members: { [ALICE.uid]: code } },
    [`userIndex/${ALICE.uid}/projects/${pid}`]: true,
  }))
  await assertSucceeds(update(ref(db), {
    [`projects/${pid}/meta/pendingEmails`]: [BOB.email],
    [`invitesByEmail/${emailKey(BOB.email)}/${pid}`]: { code, name: 'P' },
  }))
  // 초대받은 사람은 자기 초대함을 읽을 수 있어야 한다
  const inbox = await assertSucceeds(get(ref(as(BOB), `invitesByEmail/${emailKey(BOB.email)}`)))
  assert.equal(inbox.val()[pid].code, code)
})

test('projectStore.joinProject: 멤버가 된 뒤에야 meta를 정리할 수 있다', async () => {
  const pid = 'p1', code = 'abc12345'
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await set(ref(ctx.database(), `projects/${pid}`), {
      meta: { id: pid, name: 'P', inviteCode: code, memberEmails: [ALICE.email], pendingEmails: [BOB.email] },
      members: { [ALICE.uid]: code },
    })
    await set(ref(ctx.database(), `invitesByEmail/${emailKey(BOB.email)}/${pid}`), { code, name: 'P' })
  })
  const db = as(BOB)

  // 순서가 중요하다: 멤버가 되기 전에는 meta를 건드릴 수 없으므로 한 번에 못 보낸다.
  await assertFails(update(ref(db), {
    [`projects/${pid}/members/${BOB.uid}`]: code,
    [`projects/${pid}/meta/memberEmails`]: [ALICE.email, BOB.email],
  }))

  await assertSucceeds(set(ref(db, `projects/${pid}/members/${BOB.uid}`), code))
  await assertSucceeds(set(ref(db, `userIndex/${BOB.uid}/projects/${pid}`), true))
  await assertSucceeds(update(ref(db), {
    [`projects/${pid}/meta/memberEmails`]: [ALICE.email, BOB.email],
    [`projects/${pid}/meta/pendingEmails`]: [],
    [`invitesByEmail/${emailKey(BOB.email)}/${pid}`]: null,
  }))
})

test('projectStore.removeMember: 표시 목록과 members를 함께 지운다', async () => {
  const pid = 'p1', code = 'abc12345'
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await set(ref(ctx.database(), `projects/${pid}`), {
      meta: { id: pid, name: 'P', inviteCode: code, memberEmails: [ALICE.email, BOB.email] },
      members: { [ALICE.uid]: code, [BOB.uid]: code },
    })
  })
  await assertSucceeds(update(ref(as(ALICE)), {
    [`projects/${pid}/meta/memberEmails`]: [ALICE.email],
    [`projects/${pid}/meta/pendingEmails`]: [],
    [`projects/${pid}/members/${BOB.uid}`]: null,
    [`invitesByEmail/${emailKey(BOB.email)}/${pid}`]: null,
  }))
  // 쫓겨난 사람은 더 이상 열 수 없다
  await assertFails(get(ref(as(BOB), `projects/${pid}`)))
})

test('authStore: 로그인할 때 자기 프로필을 쓴다', async () => {
  await assertSucceeds(set(ref(as(ALICE), `userProfiles/${ALICE.uid}`), {
    email: ALICE.email, name: '앨리스', photoURL: null,
  }))
  await assertFails(set(ref(as(BOB), `userProfiles/${ALICE.uid}`), { email: ALICE.email, name: '변조' }))
})

test('presenceStore의 쓰기가 통과한다', async () => {
  const db = as(ALICE)
  await assertSucceeds(set(ref(db, `presence/${ALICE.uid}`), { who: ALICE.uid, name: '앨리스', online: true, lastSeen: 1, currentTask: null }))
})

/**
 * spaces는 워크스페이스가 하나였던 시절의 전역 목록입니다. 만드는 버튼이
 * 사라진 뒤로 아무도 못 만드는데 규칙만 남아 있었고, 그 조건이 '프로젝트가
 * 하나라도 있나'였습니다 — 낯선 사람이 로그인해서 자기 프로젝트를 하나
 * 만들면(그건 누구나 됩니다) 회사의 스페이스 목록을 읽고 지울 수 있었습니다.
 *
 * 프로젝트가 있는 멀쩡한 멤버로 확인합니다. 이 사람조차 못 열어야 닫힌 것입니다.
 */
test('spaces는 프로젝트가 있는 멤버도 못 읽는다', async () => {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.database()
    await set(ref(db, `userIndex/${ALICE.uid}/projects/p0`), true)
    await set(ref(db, 'spaces/s1'), { id: 's1', name: 'Production', color: '#ef4444' })
  })
  const db = as(ALICE)
  await assertFails(get(ref(db, 'spaces')))
  await assertFails(get(ref(db, 'spaces/s1')))
  await assertFails(set(ref(db, 'spaces/s2'), { id: 's2', name: '새 스페이스', color: '#000' }))
})
