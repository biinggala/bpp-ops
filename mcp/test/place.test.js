import { test } from 'node:test'
import assert from 'node:assert/strict'
import { placeTask } from '../dist/place.js'

test('프로젝트 업무는 그 프로젝트 자리', () => {
  assert.equal(placeTask({ id: 't1', projectId: 'p1' }, 'personalTasks/u1/t1', 'u1'), 'projects/p1/tasks/t1')
})

test('개인 업무는 있던 자리에 그대로 — 적힌 주소가 남의 것이어도', () => {
  // 공격자 A가 자기 개인 업무에 createdBy: victim을 적어 두어도 자리는 A입니다.
  assert.equal(placeTask({ id: 'x' }, 'personalTasks/attacker/x', 'attacker'), 'personalTasks/attacker/x')
})

test('새로 개인 자리로 가는 업무는 부른 사람 것', () => {
  assert.equal(placeTask({ id: 'n' }, undefined, 'me'), 'personalTasks/me/n')
  assert.equal(placeTask({ id: 'n' }, 'projects/p1/tasks/n', 'me'), 'personalTasks/me/n')
  assert.throws(() => placeTask({ id: 'n' }, undefined, null))
})
