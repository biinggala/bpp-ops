import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  accessibleProjectIds,
  assigneeAliases,
  canAccessProject,
  isAssignedTo,
  isTaskVisible,
  readableAssignee,
} from '../dist/access.js'

const ME = 'me@bpp.co.kr'
const OTHER = 'other@bpp.co.kr'

const mine = { id: 'p1', name: 'Mine', color: '#000', memberEmails: [ME] }
const theirs = { id: 'p2', name: 'Theirs', color: '#000', memberEmails: [OTHER] }
const madeByMe = { id: 'p3', name: 'Created', color: '#000', creatorEmail: ME }
const orphan = { id: 'p4', name: 'No owner', color: '#000' }

test('project access follows membership or creation only', () => {
  assert.equal(canAccessProject(mine, ME), true)
  assert.equal(canAccessProject(madeByMe, ME), true)
  assert.equal(canAccessProject(theirs, ME), false)
  // No ownership data must NOT fall back to "public".
  assert.equal(canAccessProject(orphan, ME), false)
})

test('membership check is case-insensitive', () => {
  assert.equal(canAccessProject({ ...mine, memberEmails: ['ME@BPP.CO.KR'] }, ME), true)
})

test("tasks in another member's project are invisible", () => {
  const ids = accessibleProjectIds([mine, theirs, madeByMe, orphan], ME)
  assert.deepEqual([...ids].sort(), ['p1', 'p3'])

  const visible = { id: 't1', projectId: 'p1', assignee: '', name: 'a' }
  const hidden = { id: 't2', projectId: 'p2', assignee: '', name: 'b' }
  assert.equal(isTaskVisible(visible, ME, ids), true)
  assert.equal(isTaskVisible(hidden, ME, ids), false)
})

test('a task with no project stays private to the account it is stored under', () => {
  const ids = accessibleProjectIds([mine], ME)
  const someoneElses = { id: 't3', assignee: OTHER, createdBy: OTHER, name: 'private' }
  // Having access to *some* project must not expose unrelated personal tasks.
  assert.equal(isTaskVisible(someoneElses, ME, ids), false)

  assert.equal(isTaskVisible({ id: 't4', createdBy: ME, assignee: '', name: 'x' }, ME, ids), true)

  // Being named as assignee is not a grant: personalTasks/$uid is readable by
  // that account alone, so the app could never show this task either.
  assert.equal(isTaskVisible({ id: 't5', createdBy: OTHER, assignee: ME, name: 'y' }, ME, ids), false)
})

test('a task with no project can only be assigned to its owner', () => {
  // The picker in the app offers nobody else; this is the same rule on the
  // server, where the Admin SDK is past the database rules.
  assert.equal(readableAssignee(undefined, `${ME}, ${OTHER}`, ME), ME)
  assert.equal(readableAssignee(undefined, OTHER, ME), '')

  // A project task is left alone — that boundary is project membership.
  assert.equal(readableAssignee('p1', `${ME}, ${OTHER}`, ME), `${ME}, ${OTHER}`)
})

test('an address matches itself whatever its case', () => {
  const HC = 'someone@bpp.co.kr'
  assert.deepEqual(assigneeAliases(HC), [HC])
  assert.deepEqual(assigneeAliases('Someone@BPP.co.kr').sort(), ['Someone@BPP.co.kr', HC].sort())

  // 대소문자만 다른 같은 주소는 같은 사람입니다.
  assert.equal(isAssignedTo({ id: 't7', assignee: HC, name: 'z' }, HC), true)
  assert.equal(isAssignedTo({ id: 't7b', assignee: 'Someone@BPP.co.kr', name: 'z' }, HC), true)
  assert.equal(isAssignedTo({ id: 't8', assignee: 'other@bpp.co.kr', name: 'z' }, HC), false)
})

test('multi-assignee fields match on any member', () => {
  const t = { id: 't9', assignee: `${OTHER}, ${ME}`, name: 'shared' }
  assert.equal(isAssignedTo(t, ME), true)
  assert.equal(isAssignedTo(t, 'nobody@bpp.co.kr'), false)
})

// ── 워크스페이스 명단도 봅니다 ────────────────────────────────────────────────
//
// 프로젝트 멤버십 위에 한 겹 더 있습니다. 이 서버는 관리자 SDK라 규칙을 안
// 지나가므로, 그 겹을 여기서 다시 세워야 합니다.
import { orgAllows } from '../dist/access.js'

test('명단에 살아 있으면 통과 — 게스트도', () => {
  assert.equal(orgAllows('member', 'bpp.co.kr', 'a@bpp.co.kr'), true)
  assert.equal(orgAllows('guest', 'bpp.co.kr', 'out@gmail.com'), true)
})

test('내보낸 사람은 커넥터로도 못 읽습니다', () => {
  // 웹은 닫히는데 커넥터는 열려 있으면, 벽을 세운 곳이 하나뿐인 것입니다.
  assert.equal(orgAllows('removed', 'bpp.co.kr', 'a@bpp.co.kr'), false)
  // 도메인이 맞아도 막힙니다 — 비석이 도메인을 이깁니다.
  assert.equal(orgAllows('removed', 'bpp.co.kr', 'gone@bpp.co.kr'), false)
})

test('뜻을 모르는 값에는 문을 안 엽니다', () => {
  assert.equal(orgAllows('owner', 'bpp.co.kr', 'a@bpp.co.kr'), false)
})

test('줄이 없으면 도메인이 답합니다', () => {
  // 회사 계정의 첫 로그인. 명단에 아직 행이 없습니다.
  assert.equal(orgAllows(undefined, 'bpp.co.kr', 'new@bpp.co.kr'), true)
  assert.equal(orgAllows(undefined, 'bpp.co.kr', 'out@gmail.com'), false)
  // 도메인이 없는 워크스페이스(초대형)에서는 줄이 없으면 아무것도 아닙니다.
  assert.equal(orgAllows(undefined, undefined, 'a@bpp.co.kr'), false)
  assert.equal(orgAllows(null, '', 'a@bpp.co.kr'), false)
})
