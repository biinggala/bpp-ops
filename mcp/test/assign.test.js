import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unassignable, assignableEmails } from '../dist/access.js'

// ── 담당자로 지정할 수 있는 사람 ─────────────────────────────────────────────
//
// 이 검사가 없어서, 커넥터로 업무를 만들면서 아무 주소나 담당자로 적을 수
// 있었습니다. 그러면 그 사람은 그 업무를 못 봅니다 - 프로젝트 멤버가 아니니까요.
// 화면에는 이름이 붙어 있는데 본인은 초대받은 적도 없습니다.

const ME = 'me@bpp.co.kr'
const P = {
  id: 'p1', name: 'P', color: '#000',
  memberEmails: [ME, 'teammate@bpp.co.kr'],
  pendingEmails: ['invited@bpp.co.kr'],
  creatorEmail: ME,
}

test('그 프로젝트 멤버는 맡길 수 있다', () => {
  assert.deepEqual(unassignable('teammate@bpp.co.kr', P, ME), [])
  assert.deepEqual(unassignable(`${ME}, teammate@bpp.co.kr`, P, ME), [])
})

test('멤버가 아닌 사람은 못 맡긴다', () => {
  assert.deepEqual(unassignable('stranger@example.com', P, ME), ['stranger@example.com'])
  // 한 명이라도 섞여 있으면 그 사람을 짚어 줍니다.
  assert.deepEqual(unassignable('teammate@bpp.co.kr, stranger@example.com', P, ME), ['stranger@example.com'])
})

test('초대만 받고 아직 안 들어온 사람은 맡길 수 있다', () => {
  // 사람이 이미 부른 사람이고, 들어오는 순간 그 업무가 보입니다.
  assert.deepEqual(unassignable('invited@bpp.co.kr', P, ME), [])
})

test('대소문자와 공백은 같은 사람으로 본다', () => {
  assert.deepEqual(unassignable('  TeamMate@BPP.co.kr ', P, ME), [])
})

test('담당자를 안 적으면 아무 말도 안 한다', () => {
  assert.deepEqual(unassignable(undefined, P, ME), [])
  assert.deepEqual(unassignable('', P, ME), [])
  assert.deepEqual(unassignable('  ,  ', P, ME), [])
})

test('프로젝트 없는 업무는 나만 맡을 수 있다', () => {
  // 남을 적어 봐야 그 사람은 개인 업무를 못 봅니다 - 내 계정 밑에 삽니다.
  assert.deepEqual(unassignable(ME, undefined, ME), [])
  assert.deepEqual(unassignable('teammate@bpp.co.kr', undefined, ME), ['teammate@bpp.co.kr'])
})

test('멤버 목록이 없는 옛 프로젝트에는 만든 사람만', () => {
  // 옛 프로젝트에는 memberEmails가 아예 없기도 합니다. 그럴 때 아무나
  // 통과시키면 이 검사가 있으나 마나입니다.
  const old = { id: 'p2', name: 'P', color: '#000', creatorEmail: ME }
  assert.deepEqual(unassignable(ME, old, ME), [])
  assert.deepEqual(unassignable('teammate@bpp.co.kr', old, ME), ['teammate@bpp.co.kr'])
})

test('맡길 수 있는 사람 목록', () => {
  assert.deepEqual([...assignableEmails(P)].sort(), [ME, 'invited@bpp.co.kr', 'teammate@bpp.co.kr'].sort())
  assert.deepEqual([...assignableEmails(undefined)], [])
})
