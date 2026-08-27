import { test } from 'node:test'
import assert from 'node:assert/strict'
import { needsHomeOrg, homeOrgName } from '../.test-build/lib/homeOrg.js'

const C = (o = {}) => ({ settled: true, candidates: 0, resolved: 0, member: 0, madeBefore: false, ...o })

test('아무 데도 없는 사람에게는 만듭니다', () => {
  assert.equal(needsHomeOrg(C()), true)
})

test('아직 다 못 찾아봤으면 안 만듭니다', () => {
  // 이게 없으면 앱을 켤 때마다 한 개씩 늘어납니다 — 목록은 처음 한 바퀴
  // 언제나 비어 있으니까요.
  assert.equal(needsHomeOrg(C({ settled: false })), false)
})

test('이미 멤버인 곳이 있으면 안 만듭니다', () => {
  // 블랙페이퍼 사람들에게는 아무 일도 안 일어나야 합니다.
  assert.equal(needsHomeOrg(C({ candidates: 1, resolved: 1, member: 1 })), false)
})

test('게스트로만 있는 사람에게는 만듭니다', () => {
  // 남의 회사에 손님으로 있는 것과 내 자리를 갖는 것은 다른 일입니다.
  assert.equal(needsHomeOrg(C({ candidates: 1, resolved: 1, member: 0 })), true)
})

test('후보를 못 읽었으면 안 만듭니다', () => {
  // 있는데 못 읽은 것과 없는 것을 구별할 수 없습니다. 못 읽은 쪽이면
  // 워크스페이스가 둘이 됩니다 — 덜 만드는 쪽으로 틀립니다.
  assert.equal(needsHomeOrg(C({ candidates: 2, resolved: 1, member: 0 })), false)
  assert.equal(needsHomeOrg(C({ candidates: 1, resolved: 0, member: 0 })), false)
})

test('한 번 만들었으면 다시는 안 만듭니다', () => {
  // 만든 워크스페이스를 지운 사람에게 그것이 다시 생기면, 지운 일이 없던
  // 일이 됩니다.
  assert.equal(needsHomeOrg(C({ madeBefore: true })), false)
})

test('사람이 알아보는 이름', () => {
  assert.equal(homeOrgName('희건', 'heegun@bpp.co.kr'), '희건의 워크스페이스')
  assert.equal(homeOrgName(null, 'heegun@bpp.co.kr'), 'heegun의 워크스페이스')
  assert.equal(homeOrgName('  ', 'heegun@bpp.co.kr'), 'heegun의 워크스페이스')
  assert.equal(homeOrgName(null, ''), '내 워크스페이스')
})
