import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shareSeats } from '../.test-build/lib/driveSeats.js'

/**
 * 찾기 결과의 정원을 셋이 나눠 앉습니다 — 이름, 폴더, 내용.
 *
 * 이름 일치가 먼저 다 들어가면 나머지 둘은 한 줄도 못 섭니다. 폴더가 그렇게
 * 잘렸습니다: 구글은 최근에 연 것을 위로 올리는데 폴더는 여는 것이 아니라
 * 지나가는 것이라 점수가 늘 바닥입니다.
 */

test('폴더가 자리를 얻습니다', () => {
  const s = shareSeats({ limit: 20, taken: 0, named: 50, folders: 5, term: true })
  assert.ok(s.folders >= 1)
  assert.ok(s.named > 0)
  assert.ok(s.named + s.folders <= 20)
})

test('자리를 떼되 비워 두지는 않습니다', () => {
  // 폴더가 하나뿐이면 한 자리만 뗍니다. 나머지는 이름 일치가 씁니다.
  const one = shareSeats({ limit: 20, taken: 0, named: 50, folders: 1, term: true })
  assert.equal(one.folders, 1)
  const none = shareSeats({ limit: 20, taken: 0, named: 50, folders: 0, term: true })
  assert.equal(none.folders, 0)
  assert.ok(none.named > one.named)
})

test('이미 앉은 줄만큼 정원이 줄어듭니다', () => {
  const s = shareSeats({ limit: 20, taken: 18, named: 50, folders: 5, term: true })
  assert.ok(s.named + s.folders <= 20 - 18 + s.folders)
  assert.equal(s.named, 0)
})

test('아무것도 안 쳤으면 최근 목록입니다 — 나눌 것이 없습니다', () => {
  const s = shareSeats({ limit: 20, taken: 0, named: 20, folders: 3, term: false })
  assert.deepEqual(s, { named: 20, folders: 0 })
})
