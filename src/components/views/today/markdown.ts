import { Extension } from '@tiptap/core'
import { wrappingInputRule } from '@tiptap/core'

/**
 * ── 마크다운으로 치기 ────────────────────────────────────────────────────────
 *
 * StarterKit이 이미 대부분을 합니다: `# `, `- `, `1. `, `> `, `**굵게**`,
 * `` `코드` ``, ```` ``` ````, `---`. 손으로 치면 그대로 됩니다.
 *
 * **딱 하나 비어 있던 게 체크박스입니다.** TaskItem 확장에는 입력 규칙이
 * 없어서, 도구 모음의 버튼을 누르지 않으면 체크리스트를 만들 방법이 없었습니다.
 * 노트에 제일 많이 치는 게 그건데요.
 *
 * 세 가지를 다 받습니다 — `- [ ] `, `[] `, `[ ] `. 마크다운을 아는 사람은
 * 앞의 것을 치고, 모르는 사람은 대괄호 두 개를 칩니다. 어느 쪽이 틀린 게
 * 아니라 둘 다 같은 뜻입니다.
 */
export const MarkdownTasks = Extension.create({
  name: 'markdownTasks',

  addInputRules() {
    const taskList = this.editor.schema.nodes.taskList
    const taskItem = this.editor.schema.nodes.taskItem
    if (!taskList || !taskItem) return []
    return [
      wrappingInputRule({
        find: /^\s*(?:[-*]\s+)?\[([ |xX])\]\s$/,
        type: taskList,
        // 대괄호 안에 x가 있었으면 이미 끝난 일로 시작합니다.
        getAttributes: () => ({}),
      }),
    ]
  },
})
