import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assignLanes } from '../.test-build/lib/lanes.js'

const S = (from, to, id) => ({ from, to, id })

test('안 겹치면 한 층입니다', () => {
  const out = assignLanes([S(600, 660, 'a'), S(660, 720, 'b'), S(800, 900, 'c')])
  assert.deepEqual(out.map(o => o.lane), [0, 0, 0])
  assert.equal(out[0].lanes, 1)
})

test('겹치면 아래층으로 비킵니다', () => {
  const out = assignLanes([S(600, 720, 'a'), S(660, 780, 'b')])
  assert.deepEqual(out.map(o => o.lane), [0, 1])
  assert.equal(out[0].lanes, 2)
})

test('앞의 것이 끝난 층은 다시 씁니다', () => {
  // a와 b가 겹쳐 두 층. c는 a가 끝난 뒤라 0층으로 돌아갑니다 — 안 그러면
  // 하루에 예약이 열 건이면 층이 열 개가 되고 줄이 화면을 넘습니다.
  const out = assignLanes([S(600, 700, 'a'), S(650, 900, 'b'), S(720, 800, 'c')])
  assert.deepEqual(out.map(o => [o.item.id, o.lane]), [['a', 0], ['b', 1], ['c', 0]])
  assert.equal(out[0].lanes, 2)
})

test('순서가 뒤죽박죽이어도 같은 답', () => {
  const a = assignLanes([S(600, 700, 'a'), S(650, 900, 'b')])
  const b = assignLanes([S(650, 900, 'b'), S(600, 700, 'a')])
  assert.deepEqual(a.map(o => [o.item.id, o.lane]), b.map(o => [o.item.id, o.lane]))
})

test('비어 있으면 층도 하나 — 0으로 나누지 않게', () => {
  assert.deepEqual(assignLanes([]), [])
})
