import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attendanceOf, awaitingReply, onePerEvent } from '../.test-build/lib/attendance.js'

const ME = 'me@bpp.co.kr'
const PEER = 'peer@bpp.co.kr'

test("동료 캘린더의 'self'는 동료입니다 — 내 초대가 아닙니다", () => {
  // 구독한 동료 캘린더에서 읽은 일정. 구글은 그 캘린더의 주인에게 self를 붙입니다.
  const attendees = [
    { email: PEER, self: true, responseStatus: 'needsAction' },
    { email: 'host@bpp.co.kr', organizer: true, responseStatus: 'accepted' },
  ]
  assert.equal(attendanceOf(attendees, ME), null)
  assert.equal(awaitingReply(attendees, ME), false)
})

test('주소가 맞으면 self가 없어도 내 것입니다', () => {
  const attendees = [
    { email: PEER, self: true, responseStatus: 'accepted' },
    { email: 'Me@BPP.co.kr', responseStatus: 'needsAction' },
  ]
  assert.equal(attendanceOf(attendees, ME)?.email, 'Me@BPP.co.kr')
  assert.equal(awaitingReply(attendees, ME), true)
  assert.equal(awaitingReply([{ email: ME, responseStatus: 'accepted' }], ME), false)
})

test('주최자에게는 안 묻고, 내 주소를 모르면 아무것도 내 것이 아닙니다', () => {
  assert.equal(attendanceOf([{ email: ME, organizer: true }], ME), null)
  assert.equal(attendanceOf([{ email: ME, self: true }], null), null)
  assert.equal(attendanceOf(undefined, ME), null)
})

test('같은 일정의 사본은 내 캘린더 것 하나만 남습니다', () => {
  const events = [
    { id: `${PEER}:ev1`, calendarId: PEER },
    { id: `${ME}:ev1`, calendarId: ME },
    { id: `${PEER}:ev2`, calendarId: PEER },
  ]
  const kept = onePerEvent(events, [ME])
  assert.deepEqual(kept.map(e => e.id).sort(), [`${ME}:ev1`, `${PEER}:ev2`].sort())
})
