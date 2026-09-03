import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calendarColour, eventColour } from '../.test-build/lib/gcalColors.js'

test('API의 옛 캘린더 색은 구글 화면 색으로 바뀝니다', () => {
  assert.equal(calendarColour('#9fe1e7'), '#039be5')   // Peacock
  assert.equal(calendarColour('#F83A22'), '#d50000')   // Tomato, 대소문자 무관
})

test('사람이 직접 고른 색은 그대로입니다', () => {
  assert.equal(calendarColour('#123456'), '#123456')
  assert.equal(calendarColour(''), '#4285f4')
})

test('일정에 칠한 색이 캘린더 색보다 먼저입니다', () => {
  assert.equal(eventColour('11', '#9fe1e7'), '#d50000')
  assert.equal(eventColour(undefined, '#9fe1e7'), '#039be5')
  // 모르는 id는 캘린더 색으로 물러납니다.
  assert.equal(eventColour('99', '#9fe1e7'), '#039be5')
})
