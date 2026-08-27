import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checklistHtml, noteToMarkdown } from '../dist/note.js'

/**
 * 웹 편집기는 `li[data-type="taskItem"]`만 체크박스 줄로 읽습니다.
 * 그게 없으면 커넥터로 적어 넣은 할 일이 화면에서 불릿으로 바뀝니다 —
 * 저장은 됐는데 화면에서만 다른 것이 되는 자리입니다.
 */
test('커넥터가 적는 체크박스 줄도 편집기가 아는 모양입니다', () => {
  const html = checklistHtml(['커피 주문', '슬랙 답장'])
  assert.match(html, /<ul data-type="taskList">/)
  assert.equal((html.match(/<li data-type="taskItem"/g) ?? []).length, 2)
})

test('적은 것을 다시 읽으면 같은 줄이 나옵니다', () => {
  const md = noteToMarkdown(checklistHtml(['커피 주문']), [])
  assert.match(md, /- \[ \] 커피 주문/)
})
