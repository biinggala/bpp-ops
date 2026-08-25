import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tagAllowed, attrAllowed, safeHref } from '../.test-build/lib/sanitizeHtml.js'

// 업무 메모는 그 프로젝트의 아무 멤버나 씁니다 — 초대 링크로 들어온 외부
// 협업자를 포함해서. 그걸 그대로 그리면 그 사람이 심은 코드가 읽는 사람
// 권한으로 돕니다. 여기서 막는 것이 그 판단입니다.

test('실행되는 태그는 안 남는다', () => {
  for (const tag of ['script', 'iframe', 'object', 'embed', 'svg', 'math', 'img', 'form', 'button', 'base', 'link', 'meta', 'style']) {
    assert.equal(tagAllowed(tag), false, `${tag}가 통과했습니다`)
  }
  assert.equal(tagAllowed('SCRIPT'), false)
})

test('편집기가 만드는 것은 남는다', () => {
  for (const tag of ['p', 'strong', 'em', 'ul', 'li', 'a', 'code', 'pre', 'mark', 'h1', 'br']) {
    assert.equal(tagAllowed(tag), true, `${tag}가 막혔습니다`)
  }
})

test('이벤트 핸들러는 이름이 무엇이든 안 남는다', () => {
  // 여기가 핵심입니다. <img src=x onerror="..."> 는 innerHTML로도 실행됩니다.
  for (const a of ['onerror', 'onload', 'onclick', 'onmouseover', 'ONERROR', 'onanimationstart', 'onfocus']) {
    assert.equal(attrAllowed(a), false, `${a}가 통과했습니다`)
  }
})

test('style도 안 남는다', () => {
  assert.equal(attrAllowed('style'), false)
})

test('체크박스 줄에 필요한 표시는 남는다', () => {
  for (const a of ['class', 'href', 'data-checked', 'data-type', 'type', 'checked']) {
    assert.equal(attrAllowed(a), true, `${a}가 막혔습니다`)
  }
})

test('javascript: 링크는 주소가 아니다', () => {
  assert.equal(safeHref('javascript:alert(1)'), null)
  assert.equal(safeHref('  JavaScript:alert(1)'), null)
  assert.equal(safeHref('data:text/html,<script>alert(1)</script>'), null)
  assert.equal(safeHref('vbscript:msgbox'), null)
  // 스킴 없는 //evil.com 은 프로토콜 상대 주소라 바깥으로 나갑니다.
  assert.equal(safeHref('//evil.com'), null)
})

test('평범한 주소는 그대로 지난다', () => {
  assert.equal(safeHref('https://bpp.co.kr'), 'https://bpp.co.kr')
  assert.equal(safeHref('http://bpp.co.kr'), 'http://bpp.co.kr')
  assert.equal(safeHref('mailto:heegun@bpp.co.kr'), 'mailto:heegun@bpp.co.kr')
  assert.equal(safeHref('/?task=abc'), '/?task=abc')
})
