import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blockOnDay } from '../.test-build/lib/timeblock.js'

const ev = (o) => ({ allDay: false, ...o })

const events = [
  ev({ id: 'a', taskId: 't1', start: '2026-08-27', startIso: '2026-08-27T20:00:00+09:00', endIso: '2026-08-27T21:00:00+09:00' }),
  ev({ id: 'b', taskId: 't2', start: '2026-08-30', startIso: '2026-08-30T09:00:00+09:00', endIso: '2026-08-30T10:00:00+09:00' }),
  ev({ id: 'c', taskId: 't3', start: '2026-08-30', allDay: true }),
]

/**
 * 며칠 전에 잡아 둔 블록이 오늘 줄에 붙던 것. '어제 못 끝낸 것 가져오기'로
 * 지난 업무를 오늘 노트에 담으면 늘 이렇게 됐습니다 — 오늘은 아무 시간도
 * 안 정했는데 화면은 20시에 한다고 말합니다.
 */
test('다른 날에 잡힌 블록은 오늘 줄에 안 붙습니다', () => {
  assert.equal(blockOnDay(events, 't1', '2026-08-30'), null)
  assert.equal(blockOnDay(events, 't1', '2026-08-27')?.id, 'a')
})

test('그 날의 블록은 찾습니다', () => {
  assert.equal(blockOnDay(events, 't2', '2026-08-30')?.id, 'b')
})

test('종일 일정은 시간이 아닙니다', () => {
  assert.equal(blockOnDay(events, 't3', '2026-08-30'), null)
})

test('없는 것과 아직 모르는 것 둘 다 null입니다', () => {
  // 날짜를 아직 모르는 동안 아무 블록이나 골라 붙이면, 그게 바로 이 버그입니다.
  assert.equal(blockOnDay(events, 't2', undefined), null)
  assert.equal(blockOnDay(events, null, '2026-08-30'), null)
  assert.equal(blockOnDay(events, 't9', '2026-08-30'), null)
})

test('시각이 반쪽인 일정은 안 씁니다', () => {
  const half = [ev({ id: 'd', taskId: 't4', start: '2026-08-30', startIso: '2026-08-30T09:00:00+09:00' })]
  assert.equal(blockOnDay(half, 't4', '2026-08-30'), null)
})
