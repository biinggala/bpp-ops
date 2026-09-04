import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countDays, dayRange, daysBetween, exclusiveEnd, plusDays, withinRange } from '../.test-build/lib/dayRange.js'

test('뒤로 끌어도 같은 기간입니다', () => {
  assert.deepEqual(dayRange('2026-09-12', '2026-09-15'), { from: '2026-09-12', to: '2026-09-15', days: 4 })
  assert.deepEqual(dayRange('2026-09-15', '2026-09-12'), { from: '2026-09-12', to: '2026-09-15', days: 4 })
})

test('하루는 하루입니다', () => {
  assert.deepEqual(dayRange('2026-09-12', '2026-09-12'), { from: '2026-09-12', to: '2026-09-12', days: 1 })
})

test('달과 해를 넘어도 셉니다', () => {
  assert.equal(countDays('2026-08-30', '2026-09-02'), 4)
  assert.equal(countDays('2026-12-30', '2027-01-02'), 4)
})

test('서머타임이 있는 지역에서도 날 수는 날 수입니다', () => {
  // UTC로 세기 때문에 시계가 한 시간 밀리는 날이 끼어도 하루가 사라지지
  // 않습니다. 종일 일정의 날짜는 순간이 아니라 글자입니다.
  assert.equal(countDays('2026-03-07', '2026-03-10'), 4)
  assert.equal(countDays('2026-10-31', '2026-11-03'), 4)
})

test('구글에 적는 끝 날짜는 그다음 날 — 하루 짧게 잡히면 안 됩니다', () => {
  assert.equal(exclusiveEnd('2026-09-15'), '2026-09-16')
  assert.equal(exclusiveEnd('2026-08-31'), '2026-09-01')
  assert.equal(exclusiveEnd('2026-12-31'), '2027-01-01')
  // 윤년
  assert.equal(exclusiveEnd('2028-02-28'), '2028-02-29')
  assert.equal(exclusiveEnd('2028-02-29'), '2028-03-01')
})

test('칸이 기간 안에 드는가', () => {
  assert.equal(withinRange('2026-09-13', '2026-09-12', '2026-09-15'), true)
  assert.equal(withinRange('2026-09-12', '2026-09-12', '2026-09-15'), true)
  assert.equal(withinRange('2026-09-15', '2026-09-12', '2026-09-15'), true)
  assert.equal(withinRange('2026-09-16', '2026-09-12', '2026-09-15'), false)
})

test('걸쳐 있는 날들을 다 돌려줍니다 — 종일 일정이 첫날에만 뜨던 자리', () => {
  assert.deepEqual(daysBetween('2026-09-12', '2026-09-15'),
    ['2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15'])
  assert.deepEqual(daysBetween('2026-09-12', '2026-09-12'), ['2026-09-12'])
  assert.deepEqual(daysBetween('2026-08-30', '2026-09-01'),
    ['2026-08-30', '2026-08-31', '2026-09-01'])
})

test('아무리 긴 일정도 화면을 삼키지 않습니다', () => {
  // 잘못 만들어진 몇 해짜리 일정 하나가 목록을 통째로 채우면 안 됩니다.
  assert.equal(daysBetween('2020-01-01', '2030-01-01').length, 60)
})

test('며칠 더하기 — 달·해·윤년을 넘어서', () => {
  assert.equal(plusDays('2026-09-12', 3), '2026-09-15')
  assert.equal(plusDays('2026-08-30', 3), '2026-09-02')
  assert.equal(plusDays('2026-12-30', 3), '2027-01-02')
  assert.equal(plusDays('2028-02-27', 2), '2028-02-29')
  assert.equal(plusDays('2026-09-12', 0), '2026-09-12')
})
