import { test } from 'node:test'
import assert from 'node:assert/strict'
import { primeMinutes, roomTooLong, DEFAULT_ROOM_RULE, roomRuleNote } from '../.test-build/lib/roomRule.js'

// 회의실은 낮 10–18시를 2시간까지만. 재는 것은 회의의 길이가 아니라 그
// 시간대를 차지한 만큼입니다.

const R = (fromH, toH) => ({ from: fromH * 60, to: toH * 60 })
const tooLong = r => roomTooLong(r, DEFAULT_ROOM_RULE)
const prime = r => primeMinutes(r, DEFAULT_ROOM_RULE)

test('낮 두 시간은 됩니다', () => {
  assert.equal(tooLong(R(13, 15)), false)
  assert.equal(prime(R(13, 15)), 120)
})

test('낮 세 시간은 안 됩니다', () => {
  assert.equal(tooLong(R(10, 13)), true)
})

test('저녁은 얼마든지', () => {
  // 18시부터는 붐비지 않습니다.
  assert.equal(tooLong(R(18, 22)), false)
  assert.equal(prime(R(18, 22)), 0)
})

test('이른 아침도 얼마든지', () => {
  assert.equal(tooLong(R(6, 10)), false)
})

test('낮에 걸치면 걸친 만큼만 셉니다', () => {
  // 17–20시는 낮에서 한 시간만 가져갑니다. 길이로 재면 세 시간이라 막히는데,
  // 막을 이유가 없는 회의입니다.
  assert.equal(prime(R(17, 20)), 60)
  assert.equal(tooLong(R(17, 20)), false)
  // 8–13시는 낮을 세 시간 차지합니다.
  assert.equal(prime(R(8, 13)), 180)
  assert.equal(tooLong(R(8, 13)), true)
})

test('딱 2시간은 통과합니다', () => {
  // 경계에서 '초과'인지 '이상'인지가 갈립니다.
  assert.equal(tooLong(R(16, 18)), false)
  assert.equal(tooLong({ from: 16 * 60, to: 18 * 60 + 15 }), false)
  assert.equal(tooLong({ from: 15 * 60 + 45, to: 18 * 60 }), true)
})

test('규칙 숫자는 회사가 정합니다', () => {
  // 방이 열 개인 회사와 두 개인 회사에 같은 두 시간을 물릴 이유가 없습니다.
  const loose = { maxMinutes: 240, from: 9 * 60, to: 21 * 60 }
  assert.equal(roomTooLong(R(13, 16), loose), false)   // 세 시간도 됩니다
  assert.equal(roomTooLong(R(13, 18), loose), true)    // 다섯 시간은 안 됩니다
  // 붐비는 시간대도 회사가 정합니다 — 9시부터라 8–10시는 한 시간만 셉니다.
  assert.equal(primeMinutes(R(8, 10), loose), 60)
})

test('안내 문구가 정한 값을 그대로 말합니다', () => {
  // 화면에 '2시간'이라고 적혀 있는데 실제로는 4시간까지 되면, 그 문구는
  // 규칙을 설명하는 것이 아니라 거짓말입니다.
  const note = roomRuleNote({ maxMinutes: 90, from: 9 * 60, to: 21 * 60 })
  assert.match(note, /9시–21시/)
  assert.match(note, /1시간 30분/)
})
