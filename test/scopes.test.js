import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  coversScope, scopeList, ALL_GOOGLE_SCOPE,
  CALENDAR_SCOPE as CAL, CALENDAR_WRITE_SCOPE as CAL_W,
  DRIVE_SCOPE as DRIVE, DOCS_SCOPE as DOCS, GMAIL_SCOPE as MAIL,
} from '../.test-build/lib/scopes.js'

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

test('한 번의 동의가 세 연동의 범위를 다 덮습니다', () => {
  // 세 스토어가 실제로 쓰는 그 글자들입니다(lib/scopes 한 곳). 여기 하나라도
  // 안 덮이면 그 연동은 동의를 **한 번 더** 시킵니다 — 화면에는 그냥 '연동
  // 안 됨'으로만 보이고, 왜인지는 아무 데도 안 나옵니다.
  assert.equal(coversScope(ALL_GOOGLE_SCOPE, `${CAL} ${CAL_W}`), true)
  assert.equal(coversScope(ALL_GOOGLE_SCOPE, `${DRIVE} ${DOCS}`), true)
  assert.equal(coversScope(ALL_GOOGLE_SCOPE, MAIL), true)
})

test('청하는 목록은 다섯 줄이 다르고, 빈 것이 없습니다', () => {
  const parts = [CAL, CAL_W, DRIVE, DOCS, MAIL]
  assert.equal(new Set(parts).size, 5)
  for (const p of parts) assert.match(p, /^https:\/\/www\.googleapis\.com\/auth\//)
  assert.deepEqual(scopeList(ALL_GOOGLE_SCOPE), [...parts].sort())
})
