import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withCreation, activityLine, ORIGIN_ID } from '../.test-build/lib/activityView.js'

const E = (kind, at) => ({ id: String(at), kind, by: '누군가', at })

test('만든 기록이 없으면 맨 뒤에 세웁니다', () => {
  // 목록은 최신순이라 맨 뒤가 가장 오래된 자리 — 만든 일이 첫 일입니다.
  const out = withCreation([E('changed', 200), E('changed', 100)], { by: '최희건', title: '어쩌구' })
  assert.equal(out.length, 3)
  assert.equal(out[2].kind, 'created')
  assert.equal(out[2].by, '최희건')
  assert.equal(out[2].id, ORIGIN_ID)
  // 시각은 모릅니다. 지어내지 않습니다.
  assert.equal(out[2].at, 0)
})

test('이미 진짜 기록이 있으면 아무것도 안 합니다', () => {
  // 같은 문장이 두 번 서면 둘 중 하나는 거짓으로 보입니다.
  const real = [E('changed', 200), E('created', 100)]
  assert.equal(withCreation(real, { by: '최희건' }), real)
})

test('누가 만들었는지 모르면 줄을 안 만듭니다', () => {
  const only = [E('changed', 200)]
  assert.equal(withCreation(only, null), only)
  assert.equal(withCreation(only, { by: '' }), only)
})

test('문장', () => {
  assert.equal(activityLine('created', '브랜드필름 편집'), "'브랜드필름 편집' 업무를 만들었습니다")
  assert.equal(activityLine('deleted', '어쩌구'), "'어쩌구' 업무를 삭제했습니다")
  // 이름을 모르면 이름 없이. 빈 따옴표를 세우지 않습니다.
  assert.equal(activityLine('created'), '업무를 만들었습니다')
  assert.equal(activityLine('changed', '어쩌구'), '수정했습니다')
  assert.equal(activityLine('restored', '어쩌구'), '휴지통에서 되살렸습니다')
})
