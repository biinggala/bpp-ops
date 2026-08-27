import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dayNo, dayYMD, gearSpan, gearOverlaps, gearClash, coversDay, gearDays,
  gearWhen, gearRangeError, MAX_GEAR_DAYS, groupGear, gearKinds, NO_KIND,
} from '../.test-build/lib/gear.js'

const T = (from, fromMin, to, toMin) => ({ from, to, fromMin, toMin })
const L = (from, to) => ({ from, to, fromMin: 0, toMin: 1440, long: true })

test('날짜 글자를 날 수로, 다시 글자로', () => {
  assert.equal(dayYMD(dayNo('2026-08-27')), '2026-08-27')
  assert.equal(dayNo('2026-08-28') - dayNo('2026-08-27'), 1)
  // 월이 넘어가도, 해가 넘어가도.
  assert.equal(dayNo('2027-01-01') - dayNo('2026-12-31'), 1)
})

test('장기 예약은 대여일 00:00부터 반납일 24:00까지', () => {
  const s = gearSpan(L('2026-08-27', '2026-08-29'))
  assert.equal(s.end - s.start, 3 * 1440)
})

test('시간 예약끼리 겹치면 겹칩니다', () => {
  assert.equal(gearOverlaps(T('2026-08-27', 600, '2026-08-27', 720), T('2026-08-27', 660, '2026-08-27', 780)), true)
  // 맞닿는 것은 안 겹칩니다 — 12시에 반납하고 12시에 빌려 갑니다.
  assert.equal(gearOverlaps(T('2026-08-27', 600, '2026-08-27', 720), T('2026-08-27', 720, '2026-08-27', 780)), false)
})

test('장기 예약과 시간 예약도 같은 자로 잽니다', () => {
  // 금요일 15시에 나가 월요일 11시에 돌아오는 예약. 토요일 종일과 겹칩니다.
  const trip = T('2026-08-28', 900, '2026-08-31', 660)
  assert.equal(gearOverlaps(trip, L('2026-08-29', '2026-08-29')), true)
  // 월요일 12시부터는 안 겹칩니다.
  assert.equal(gearOverlaps(trip, T('2026-08-31', 720, '2026-08-31', 780)), false)
})

test('먼저 잡은 사람을 찾아 줍니다', () => {
  const held = [
    { id: 'a', gearId: 'cam', ...L('2026-08-27', '2026-08-30'), by: 'x@bpp.co.kr', reason: '촬영', at: 1 },
    { id: 'b', gearId: 'mic', ...L('2026-08-27', '2026-08-30'), by: 'y@bpp.co.kr', reason: '녹음', at: 1 },
  ]
  assert.equal(gearClash(held, 'cam', T('2026-08-28', 600, '2026-08-28', 660))?.id, 'a')
  // 다른 장비는 안 봅니다.
  assert.equal(gearClash(held, 'tripod', T('2026-08-28', 600, '2026-08-28', 660)), null)
  // 자기 자신과는 안 겹칩니다 — 안 그러면 시간을 30분도 못 고칩니다.
  assert.equal(gearClash(held, 'cam', L('2026-08-27', '2026-08-30'), 'a'), null)
})

test('현황판이 칠할 칸', () => {
  const r = L('2026-08-27', '2026-08-29')
  assert.equal(coversDay(r, '2026-08-26'), false)
  assert.equal(coversDay(r, '2026-08-27'), true)
  assert.equal(coversDay(r, '2026-08-29'), true)
  assert.equal(coversDay(r, '2026-08-30'), false)
  assert.equal(gearDays(r), 3)
})

test('사람이 읽는 한 줄', () => {
  assert.equal(gearWhen(T('2026-08-27', 600, '2026-08-27', 720)), '8/27 10:00–12:00')
  assert.equal(gearWhen(L('2026-08-27', '2026-08-27')), '8/27 종일')
  assert.equal(gearWhen(L('2026-08-27', '2026-09-03')), '8/27 → 9/3 · 8일')
})

test('말이 안 되는 예약은 이유를 돌려줍니다', () => {
  assert.equal(gearRangeError(L('2026-08-27', '2026-08-29')), null)
  assert.match(gearRangeError(L('2026-08-29', '2026-08-27')), /빠릅니다/)
  assert.match(gearRangeError(T('2026-08-27', 720, '2026-08-27', 600)), /빨라요/)
  assert.match(gearRangeError(L('2026-01-01', '2027-01-01')), new RegExp(`${MAX_GEAR_DAYS}일`))
  assert.match(gearRangeError(L('', '')), /날짜/)
})

const G = (name, kind) => ({ name, ...(kind ? { kind } : {}) })

test('종류로 묶고, 먼저 만든 종류가 앞에 섭니다', () => {
  const gear = [G('A7S3', '카메라'), G('아리 조명', '조명'), G('A7C', '카메라'), G('삼각대')]
  const groups = groupGear(gear)
  assert.deepEqual(groups.map(g => g.kind), ['카메라', '조명', NO_KIND])
  assert.deepEqual(groups[0].items.map(i => i.name), ['A7S3', 'A7C'])
  // 종류 없는 것은 늘 맨 아래입니다 — 목록 맨 앞에 있어도.
  assert.equal(groupGear([G('삼각대'), G('A7S3', '카메라')]).map(g => g.kind).pop(), NO_KIND)
  // 고르라고 내미는 목록에는 '종류 없음'이 없습니다. 그건 종류가 아닙니다.
  assert.deepEqual(gearKinds(gear), ['카메라', '조명'])
})

test('앞뒤 공백은 같은 종류입니다', () => {
  // 손으로 적는 값이라 '조명'과 '조명 '이 다른 묶음이 되면 목록이 둘로 쪼개집니다.
  assert.equal(groupGear([G('a', '조명'), G('b', ' 조명 ')]).length, 1)
})

test('그 날 몇 대가 나가 있나', async () => {
  const { busyCount } = await import('../.test-build/lib/gear.js')
  const held = [
    { id: '1', gearId: 'mic1', ...L('2026-08-27', '2026-08-29'), by: 'a', reason: 'x', at: 1 },
    { id: '2', gearId: 'mic2', ...T('2026-08-28', 600, '2026-08-28', 720), by: 'b', reason: 'x', at: 1 },
    // 같은 날 같은 장비에 예약이 둘 — 연달아 두 팀이 씁니다. 그래도 한 대입니다.
    { id: '3', gearId: 'mic2', ...T('2026-08-28', 780, '2026-08-28', 900), by: 'c', reason: 'x', at: 1 },
  ]
  const ids = ['mic1', 'mic2', 'mic3', 'mic4']
  assert.equal(busyCount(held, ids, '2026-08-27'), 1)
  assert.equal(busyCount(held, ids, '2026-08-28'), 2)
  assert.equal(busyCount(held, ids, '2026-08-29'), 1)
  assert.equal(busyCount(held, ids, '2026-08-30'), 0)
  // 다른 묶음의 장비는 안 셉니다.
  assert.equal(busyCount(held, ['mic3'], '2026-08-28'), 0)
})
