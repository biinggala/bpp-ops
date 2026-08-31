import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coversScope, scopeList } from '../.test-build/lib/scopes.js'

const CAL = 'https://www.googleapis.com/auth/calendar.readonly'
const CAL_W = 'https://www.googleapis.com/auth/calendar.events'
const DRIVE = 'https://www.googleapis.com/auth/drive.readonly'

test('순서와 중복은 뜻이 없습니다', () => {
  assert.deepEqual(scopeList(`${DRIVE}  ${CAL} ${CAL}`), [CAL, DRIVE].sort())
  assert.deepEqual(scopeList(''), [])
  assert.deepEqual(scopeList(null), [])
})

test('덮는지는 낱개로 봅니다', () => {
  assert.equal(coversScope(`${CAL} ${DRIVE}`, DRIVE), true)
  assert.equal(coversScope(`${DRIVE} ${CAL}`, `${CAL} ${DRIVE}`), true)
  // 하나라도 빠지면 못 덮습니다 — 반쯤 허락은 허락이 아닙니다.
  assert.equal(coversScope(CAL, `${CAL} ${CAL_W}`), false)
  assert.equal(coversScope('', CAL), false)
  assert.equal(coversScope(null, CAL), false)
})

test('빈 요청은 덮은 것이 아닙니다', () => {
  // '아무것도 안 원한다'를 '다 덮는다'로 읽으면, 범위를 안 실어 보낸 실수가
  // 연결된 것처럼 보입니다.
  assert.equal(coversScope(`${CAL} ${DRIVE}`, ''), false)
  assert.equal(coversScope(`${CAL} ${DRIVE}`, '   '), false)
})
