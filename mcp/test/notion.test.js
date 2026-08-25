import { test } from 'node:test'
import assert from 'node:assert/strict'
import { titleOf, emojiOf, passageIn } from '../dist/notion.js'

test('제목 속성의 이름은 데이터베이스마다 다릅니다', () => {
  // 이름으로 찾으면 '이름'을 쓰는 표에서만 제목이 보입니다.
  assert.equal(titleOf({ properties: { 'Name': { type: 'title', title: [{ plain_text: '9월 결산' }] } } }), '9월 결산')
  assert.equal(titleOf({ properties: { '제목': { type: 'title', title: [{ plain_text: '9월 결산' }] } } }), '9월 결산')
  // 제목 아닌 속성이 앞에 있어도 지나갑니다.
  assert.equal(titleOf({
    properties: {
      '담당': { type: 'people' },
      '무제': { type: 'title', title: [{ plain_text: '기획안' }] },
    },
  }), '기획안')
})

test('데이터베이스는 제목이 최상위에 있습니다', () => {
  assert.equal(titleOf({ object: 'database', title: [{ plain_text: '업무 목록' }] }), '업무 목록')
})

test('제목이 비어 있어도 빈 줄을 내놓지 않습니다', () => {
  assert.equal(titleOf({ properties: { 'Name': { type: 'title', title: [] } } }), '제목 없음')
  assert.equal(titleOf({}), '제목 없음')
})

test('아이콘은 이모지일 때만', () => {
  assert.equal(emojiOf({ icon: { type: 'emoji', emoji: '📌' } }), '📌')
  // 올려 둔 그림 파일은 팔레트 한 줄에 넣을 수 없습니다.
  assert.equal(emojiOf({ icon: { type: 'external', external: { url: 'https://x/y.png' } } }), undefined)
  assert.equal(emojiOf({ icon: null }), undefined)
})

test('찾은 낱말은 원문 그대로 잘라 냅니다', () => {
  const p = passageIn('올해 예산은 최재원 님이 정리합니다', '최재원')
  assert.equal(p.match, '최재원')
  assert.equal(p.before + p.match + p.after, '올해 예산은 최재원 님이 정리합니다')
})

test('대소문자는 안 가리되, 보여 주는 건 문서에 적힌 대로', () => {
  const p = passageIn('The Budget is fixed', 'budget')
  assert.equal(p.match, 'Budget')
})

test('긴 글은 앞뒤만, 잘린 자리는 말줄임으로', () => {
  const long = 'ㄱ'.repeat(200) + '예산' + 'ㄴ'.repeat(200)
  const p = passageIn(long, '예산')
  assert.ok(p.before.startsWith('…'))
  assert.ok(p.after.endsWith('…'))
  assert.ok(p.before.length < 70 && p.after.length < 70)
})

test('없는 낱말은 없다고 답합니다', () => {
  assert.equal(passageIn('올해 예산', '내년'), null)
})
