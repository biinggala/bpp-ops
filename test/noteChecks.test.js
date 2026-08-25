import { test } from 'node:test'
import assert from 'node:assert/strict'
import { noteRefOf, parseNoteRef, newBlockId, checksIn, setCheck } from '../.test-build/lib/noteChecks.js'

/**
 * 시간 축의 블록이 노트의 어느 줄에서 왔는지를 기억하는 방법.
 *
 * DOM을 쓰는 두 함수(checksIn·setCheck)는 노드에 DOMParser가 없어 여기서
 * 못 돌립니다 — 브라우저에서만 도는 코드입니다. 실려 다니는 열쇠 쪽만 봅니다.
 */

test('날짜와 줄 id가 한 덩어리로 실립니다', () => {
  assert.equal(noteRefOf('2026-08-25', 'ab12cd34'), '2026-08-25|ab12cd34')
  assert.deepEqual(parseNoteRef('2026-08-25|ab12cd34'), { date: '2026-08-25', bid: 'ab12cd34' })
})

test('망가진 열쇠는 없는 것으로 답합니다', () => {
  // 없는 것을 조용히 성공으로 치면, 눌리지 않는 네모가 눌리는 척합니다.
  assert.equal(parseNoteRef(undefined), null)
  assert.equal(parseNoteRef(''), null)
  assert.equal(parseNoteRef('2026-08-25'), null)     // 줄 id가 없음
  assert.equal(parseNoteRef('|ab12'), null)          // 날짜가 없음
  assert.equal(parseNoteRef('2026-08-25|'), null)    // 세로줄만 있고 뒤가 빔
})

test('줄 id에 세로줄이 안 들어갑니다', () => {
  // 들어가면 날짜와 id를 가르는 자리가 둘이 됩니다.
  for (let i = 0; i < 200; i++) assert.ok(!newBlockId().includes('|'))
})

test('줄 id는 매번 다릅니다', () => {
  const seen = new Set()
  for (let i = 0; i < 500; i++) seen.add(newBlockId())
  assert.equal(seen.size, 500)
})

test('브라우저 밖에서는 DOM을 안 건드립니다', () => {
  // html이 없으면(아직 안 온 노트) 파싱까지 가기 전에 답합니다.
  assert.deepEqual(checksIn(null), {})
  assert.equal(setCheck(null, 'ab12', true), null)
})
