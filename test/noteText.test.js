import { test } from 'node:test'
import assert from 'node:assert/strict'
import { noteText } from '../.test-build/lib/noteText.js'

// 노트를 복사해 슬랙에 붙였을 때 실제로 나오는 글자. 줄 사이가 벌어지고
// 불릿이 사라지던 자리라, 무엇이 나오는지 여기서 못 박습니다.

const label = n => (n.type === 'taskRef' ? '릴서 프로필 촬영' : '견적서.pdf')
const p = t => ({ type: 'paragraph', isBlock: true, textContent: t })
const item = (t, checked) => ({
  type: 'taskItem', isBlock: true, attrs: { checked }, content: [p(t)],
})

test('체크박스 목록이 한 줄에 한 줄로 나옵니다', () => {
  const out = noteText([{
    type: 'taskList', isBlock: true,
    content: [item('드레스 업체 메일', false), item('견적 확인', true)],
  }], label)
  assert.equal(out, '- [ ] 드레스 업체 메일\n- [x] 견적 확인')
})

test('문단 사이는 한 줄만 뜁니다', () => {
  // 프로즈미러 기본 사본은 블록마다 빈 줄을 끼워서 서너 칸씩 벌어졌습니다.
  const out = noteText([p('첫 줄'), p(''), p(''), p('둘째 줄')], label)
  assert.equal(out, '첫 줄\n\n둘째 줄')
})

test('업무 줄과 파일 줄은 이름으로 나옵니다', () => {
  // 문서에는 id만 있어서, 손대지 않으면 붙여 넣었을 때 빈 줄이었습니다.
  const out = noteText([
    { type: 'taskRef', isBlock: true, attrs: {} },
    { type: 'fileRef', isBlock: true, attrs: {} },
  ], label)
  assert.equal(out, '- 릴서 프로필 촬영\n- 견적서.pdf')
})

test('안쪽 목록은 두 칸 들여씁니다', () => {
  const nested = {
    type: 'taskItem', isBlock: true, attrs: { checked: false },
    content: [p('바깥'), {
      type: 'taskList', isBlock: true, content: [item('안쪽', false)],
    }],
  }
  const out = noteText([{ type: 'taskList', isBlock: true, content: [nested] }], label)
  assert.equal(out, '- [ ] 바깥\n  - [ ] 안쪽')
})

test('제목과 번호 목록', () => {
  const out = noteText([
    { type: 'heading', isBlock: true, attrs: { level: 2 }, textContent: '오늘' },
    {
      type: 'orderedList', isBlock: true,
      content: [
        { type: 'listItem', isBlock: true, content: [p('하나')] },
        { type: 'listItem', isBlock: true, content: [p('둘')] },
      ],
    },
  ], label)
  assert.equal(out, '## 오늘\n1. 하나\n2. 둘')
})
