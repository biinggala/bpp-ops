import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checklistHtml, taskRefHtml } from '../.test-build/lib/noteHtml.js'

/**
 * 편집기는 `ul[data-type="taskList"] > li[data-type="taskItem"]`만 체크박스
 * 줄로 읽습니다. data-type이 빠지면 taskList 안이 비게 되고, 프로즈미러가
 * 던집니다 — `Invalid content for node taskList: <>`. 넣는 쪽에서 그 예외가
 * 나면 누른 사람 눈에는 단추가 안 눌립니다.
 */
test('체크박스 줄에는 data-type이 붙습니다', () => {
  const html = checklistHtml(['세금계산서 발행', '슬랙 답장'])
  assert.match(html, /<ul data-type="taskList">/)
  assert.equal((html.match(/<li data-type="taskItem"/g) ?? []).length, 2)
  // 눌렸는지는 별개의 값입니다. 이것만으로는 체크박스 줄이 안 됩니다.
  assert.equal((html.match(/data-checked="false"/g) ?? []).length, 2)
})

test('빈 목록은 빈 글자입니다', () => {
  // 빈 taskList를 넣는 것이 바로 프로즈미러가 던지는 그 모양입니다.
  assert.equal(checklistHtml([]), '')
  assert.equal(taskRefHtml([]), '')
})

test('사람이 친 글자는 태그가 되지 않습니다', () => {
  const html = checklistHtml(['<img src=x onerror=alert(1)>'])
  assert.doesNotMatch(html, /<img/)
  assert.match(html, /&lt;img/)
})

test('업무 줄은 id만 싣습니다', () => {
  assert.equal(taskRefHtml(['t1', 't2']),
    '<div data-task-ref data-task-id="t1"></div><div data-task-ref data-task-id="t2"></div>')
})
