import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectsToList } from '../.test-build/lib/orgListing.js'

// 워크스페이스 안의 프로젝트는 목록에 있습니다. 이 규칙이 생기기 전에 만든
// 것들을 멤버가 지나가면서 채우는데, 그 '무엇을 채울지'를 여기서 못 박습니다.

const BPP = 'org-bpp'
const OTHER = 'org-other'

test('목록에 없는 우리 워크스페이스 프로젝트만 고릅니다', () => {
  const picked = projectsToList(
    [{ id: 'a', orgId: BPP }, { id: 'b', orgId: BPP }],
    BPP,
    [{ id: 'a' }],
  )
  assert.deepEqual(picked, ['b'])
})

test('다른 워크스페이스 프로젝트는 안 올립니다', () => {
  // 올리면 그 이름이 엉뚱한 회사 목록에 걸립니다.
  const picked = projectsToList([{ id: 'x', orgId: OTHER }], BPP, [])
  assert.deepEqual(picked, [])
})

test('소속이 아직 안 적힌 옛 프로젝트는 건드리지 않습니다', () => {
  // 소속 도장이 먼저입니다(roster.stampProjects). 도장 없이 올리면 어느
  // 워크스페이스 것인지 모르는 채로 이름만 올라갑니다.
  const picked = projectsToList([{ id: 'loose' }], BPP, [])
  assert.deepEqual(picked, [])
})

test('이미 다 올라가 있으면 아무것도 안 합니다', () => {
  // 여기서 빈 배열이 안 나오면 앱이 매 렌더마다 같은 것을 다시 씁니다.
  const picked = projectsToList([{ id: 'a', orgId: BPP }], BPP, [{ id: 'a' }])
  assert.deepEqual(picked, [])
})
