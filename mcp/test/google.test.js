import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coversScope, mergeScopes, scopeList } from '../dist/google.js'

const CAL = 'https://www.googleapis.com/auth/calendar.readonly'
const CAL_W = 'https://www.googleapis.com/auth/calendar.events'
const DRIVE = 'https://www.googleapis.com/auth/drive.readonly'

test('순서와 중복은 뜻이 없습니다', () => {
  assert.deepEqual(scopeList(`${DRIVE}  ${CAL} ${CAL}`), [CAL, DRIVE].sort())
})

/**
 * 허락받지 않은 범위로 토큰을 내주면 앱은 연결된 줄 알고 구글에서 403을
 * 받습니다 — 고칠 자리가 어딘지 아무도 모르는 실패입니다.
 */
test('허락받은 범위만 덮습니다', () => {
  assert.equal(coversScope(`${CAL} ${DRIVE}`, DRIVE), true)
  assert.equal(coversScope(CAL, `${CAL} ${CAL_W}`), false)
  assert.equal(coversScope(null, CAL), false)
  // 빈 요청을 '다 덮는다'로 읽으면, 범위를 안 실은 실수가 연결로 보입니다.
  assert.equal(coversScope(`${CAL} ${DRIVE}`, ''), false)
})

/**
 * 두 번째 연동에서 구글이 돌려주는 범위에는 이번에 허락한 것만 들어 있을 수
 * 있습니다. 그걸 그대로 덮어쓰면 먼저 켜 둔 연동이 조용히 끊깁니다.
 */
test('허락은 쌓입니다', () => {
  assert.equal(mergeScopes(CAL, DRIVE), [CAL, DRIVE].sort().join(' '))
  assert.equal(mergeScopes(`${CAL} ${DRIVE}`, CAL), [CAL, DRIVE].sort().join(' '))
  assert.equal(mergeScopes(null, CAL), CAL)
  assert.equal(mergeScopes(CAL, null), CAL)
})
