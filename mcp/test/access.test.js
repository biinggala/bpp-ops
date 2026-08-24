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
