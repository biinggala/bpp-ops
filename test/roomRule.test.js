import { test } from 'node:test'
import assert from 'node:assert/strict'
import { primeMinutes, roomTooLong } from '../.test-build/lib/roomRule.js'

// 회의실은 낮 10–18시를 2시간까지만. 재는 것은 회의의 길이가 아니라 그
// 시간대를 차지한 만큼입니다.

const R = (fromH, toH) => ({ from: fromH * 60, to: toH * 60 })

test('낮 두 시간은 됩니다', () => {
  assert.equal(roomTooLong(R(13, 15)), false)
  assert.equal(primeMinutes(R(13, 15)), 120)
})

test('낮 세 시간은 안 됩니다', () => {
  assert.equal(roomTooLong(R(10, 13)), true)
})

test('저녁은 얼마든지', () => {
  // 18시부터는 붐비지 않습니다.
  assert.equal(roomTooLong(R(18, 22)), false)
  assert.equal(primeMinutes(R(18, 22)), 0)
})

test('이른 아침도 얼마든지', () => {
  assert.equal(roomTooLong(R(6, 10)), false)
})

test('낮에 걸치면 걸친 만큼만 셉니다', () => {
  // 17–20시는 낮에서 한 시간만 가져갑니다. 길이로 재면 세 시간이라 막히는데,
  // 막을 이유가 없는 회의입니다.
  assert.equal(primeMinutes(R(17, 20)), 60)
  assert.equal(roomTooLong(R(17, 20)), false)
  // 8–13시는 낮을 세 시간 차지합니다.
  assert.equal(primeMinutes(R(8, 13)), 180)
  assert.equal(roomTooLong(R(8, 13)), true)
})

test('딱 2시간은 통과합니다', () => {
  // 경계에서 '초과'인지 '이상'인지가 갈립니다.
  assert.equal(roomTooLong(R(16, 18)), false)
  assert.equal(roomTooLong({ from: 16 * 60, to: 18 * 60 + 15 }), false)
  assert.equal(roomTooLong({ from: 15 * 60 + 45, to: 18 * 60 }), true)
})
