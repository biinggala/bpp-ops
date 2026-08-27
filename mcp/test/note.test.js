import { test } from 'node:test'
import assert from 'node:assert/strict'
import { noteMarkdownFor, noteToMarkdown } from '../dist/note.js'

const ME = 'me@bpp.co.kr'
const OTHER = 'other@bpp.co.kr'

const ref = id => `<div data-task-ref data-task-id="${id}"></div>`

const mineInProject = { id: 't1', name: '내 프로젝트 업무', status: '진행', projectId: 'p1' }
const theirsInProject = { id: 't2', name: '남의 프로젝트 업무', status: '진행', projectId: 'p9' }
const theirPersonal = { id: 't3', name: '남의 개인 업무', status: '완료', createdBy: OTHER }

const all = [mineInProject, theirsInProject, theirPersonal]
const accessible = new Set(['p1'])

test('노트에 적힌 id 중 볼 수 있는 것만 이름이 나옵니다', () => {
  const html = ref('t1') + ref('t2') + ref('t3')
  const md = noteMarkdownFor(html, all, ME, accessible)

  assert.match(md, /내 프로젝트 업무/)
  // 노트 본문은 그 사람이 직접 쓰는 자리라, 아무 id나 적어 넣을 수 있습니다.
  // 못 보는 업무는 이름도 상태도 새 나가면 안 됩니다.
  assert.doesNotMatch(md, /남의 프로젝트 업무/)
  assert.doesNotMatch(md, /남의 개인 업무/)
  assert.equal(md.split('\n').filter(l => l.includes('삭제된 업무')).length, 2)
})

test('거르기 전의 노트는 그대로 폅니다', () => {
  const md = noteToMarkdown(ref('t1'), all)
  assert.match(md, /내 프로젝트 업무/)
})
