import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectsToStamp } from '../.test-build/lib/rosterRules.js'

const P = (id, o = {}) => ({ id, ...o })
const roster = { 'alice@bpp,co,kr': { role: 'member', at: 1 }, 'out@gmail,com': { role: 'guest', at: 1 } }

test('이미 소속이 적힌 것은 안 건드립니다', () => {
  assert.deepEqual(projectsToStamp([P('a', { orgId: 'x', creatorEmail: 'alice@bpp.co.kr' })], 'bpp.co.kr', roster), [])
})

test('우리 사람이 만든 것만 찍습니다', () => {
  const list = [
    P('mine', { creatorEmail: 'alice@bpp.co.kr' }),
    P('guest', { creatorEmail: 'out@gmail.com' }),
  ]
  assert.deepEqual(projectsToStamp(list, 'bpp.co.kr', roster), ['mine'])
})

test('만든 사람이 안 적힌 옛 프로젝트 — 도메인이 있을 때만', () => {
  const old = [P('legacy')]
  // 회사 워크스페이스에서는 찍습니다. 앱을 쓰는 회사가 하나뿐이던 시절의
  // 것이라 달리 볼 여지가 없습니다.
  assert.deepEqual(projectsToStamp(old, 'bpp.co.kr', roster), ['legacy'])
  // 개인 워크스페이스에서는 안 찍습니다. 여기서 찍으면 내가 멤버로만 들어가
  // 있던 남의 옛 프로젝트가 내 것으로 도장이 찍히고, 한 번 쓰면 못 고칩니다.
  assert.deepEqual(projectsToStamp(old, '', { 'me@gmail,com': { role: 'member', at: 1 } }), [])
})

test('개인 워크스페이스에서는 내가 만든 것만 찍힙니다', () => {
  const mine = { 'me@gmail,com': { role: 'member', at: 1 } }
  const list = [P('mine', { creatorEmail: 'me@gmail.com' }), P('theirs', { creatorEmail: 'someone@else.com' })]
  assert.deepEqual(projectsToStamp(list, '', mine), ['mine'])
})
