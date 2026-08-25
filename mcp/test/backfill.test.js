import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decide, orgOf, emailKey } from '../dist/backfill.js'

const BPP = { id: 'bpp', domain: 'bpp.co.kr', members: { 'heegun@bpp,co,kr': 'member', 'judo0179@gmail,com': 'guest' } }
// 도메인 없이 초대만으로 굴러가는 워크스페이스.
const CREW = { id: 'crew', members: { 'jin@gmail,com': 'member', 'min@gmail,com': 'member' } }
const ORGS = [BPP, CREW]

test('명단이 먼저, 도메인이 그다음', () => {
  assert.equal(orgOf('heegun@bpp.co.kr', ORGS), 'bpp')
  // 아직 한 번도 안 들어와 명단에 없는 직원 — 도메인이 답합니다.
  assert.equal(orgOf('newbie@bpp.co.kr', ORGS), 'bpp')
  // 도메인이 없는 워크스페이스에서는 명단이 유일한 근거입니다.
  assert.equal(orgOf('jin@gmail.com', ORGS), 'crew')
})

test('게스트는 소속의 근거가 못 됩니다', () => {
  // 외부 협업자는 여러 회사에 걸칠 수 있습니다. 그 사람이 있다는 것만으로
  // 프로젝트를 우리 것으로 찍으면 남의 회사 프로젝트에 도장을 찍게 됩니다.
  assert.equal(orgOf('judo0179@gmail.com', ORGS), null)
  assert.equal(orgOf('nobody@example.com', ORGS), null)
})

test('만든 사람이 제일 좋은 근거', () => {
  const v = decide({ id: 'p1', creatorEmail: 'heegun@bpp.co.kr', memberEmails: ['heegun@bpp.co.kr'] }, ORGS)
  assert.equal(v.orgId, 'bpp')
})

test('이미 찍힌 것은 안 건드립니다', () => {
  // 한 번 쓰면 규칙이 덮어쓰기를 거절합니다. 여기서도 손대지 않습니다.
  const v = decide({ id: 'p2', orgId: 'crew', creatorEmail: 'heegun@bpp.co.kr' }, ORGS)
  assert.equal(v.orgId, undefined)
  assert.equal(v.why, '이미 찍혀 있음')
})

test('만든 사람이 없으면 멤버들이 한 곳을 가리킬 때만', () => {
  // 옛 프로젝트에는 creatorEmail이 없습니다.
  const one = decide({ id: 'p3', memberEmails: ['heegun@bpp.co.kr', 'judo0179@gmail.com'] }, ORGS)
  assert.equal(one.orgId, 'bpp')   // 게스트는 안 세므로 갈리지 않습니다

  const split = decide({ id: 'p4', memberEmails: ['heegun@bpp.co.kr', 'jin@gmail.com'] }, ORGS)
  assert.equal(split.orgId, undefined)
  assert.match(split.why, /두 곳 이상/)
})

test('근거가 하나도 없으면 안 찍고 보고합니다', () => {
  const v = decide({ id: 'p5', memberEmails: ['nobody@example.com'] }, ORGS)
  assert.equal(v.orgId, undefined)
  assert.match(v.why, /근거 없음/)
})

test('이메일 키는 점을 전부 쉼표로', () => {
  assert.equal(emailKey('A.B@bpp.co.kr'), 'a,b@bpp,co,kr')
})
