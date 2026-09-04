import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectiveRole, projectsToStamp } from '../.test-build/lib/rosterRules.js'

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

/* ── 우리 도메인 사람은 게스트일 수 없습니다 ─────────────────────────────── */

test('도메인이 맞으면 게스트 줄은 멤버로 읽힙니다', () => {
  // 옛 초대가 도메인을 안 보고 적어 둔 줄입니다. 그대로 두면 그 사람은 자기
  // 회사에서 회의실도 명단도 못 봅니다 — 아무도 내린 적이 없는데요.
  assert.equal(effectiveRole('dabin@bpp.co.kr', 'bpp.co.kr', 'guest'), 'member')
  assert.equal(effectiveRole('DABIN@BPP.CO.KR', 'bpp.co.kr', 'guest'), 'member')
})

test('밖의 사람은 그대로 게스트입니다', () => {
  assert.equal(effectiveRole('friend@gmail.com', 'bpp.co.kr', 'guest'), 'guest')
  // 비슷하게 끝나는 주소는 우리 도메인이 아닙니다.
  assert.equal(effectiveRole('someone@notbpp.co.kr', 'bpp.co.kr', 'guest'), 'guest')
})

test('내려간 사람은 도메인이 맞아도 그대로입니다', () => {
  // 'removed'는 잘못 적힌 줄이 아니라 결정입니다. 도메인으로 되살리면
  // 내보내기가 아무 뜻도 없어집니다.
  assert.equal(effectiveRole('gone@bpp.co.kr', 'bpp.co.kr', 'removed'), 'removed')
})

test('도메인 없는 조직에서는 적힌 그대로 — 거기선 명단이 유일한 근거', () => {
  assert.equal(effectiveRole('someone@gmail.com', '', 'guest'), 'guest')
  assert.equal(effectiveRole('someone@gmail.com', null, 'guest'), 'guest')
  assert.equal(effectiveRole('a@bpp.co.kr', 'bpp.co.kr', null), null)
})
