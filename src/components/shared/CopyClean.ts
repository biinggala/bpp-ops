import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { DOMSerializer, type Node as PMNode } from '@tiptap/pm/model'
import { noteText, type NoteNode } from '../../lib/noteText'
import { useTaskStore } from '../../store/taskStore'

/**
 * ── 밖으로 붙여 넣을 때 ──────────────────────────────────────────────────────
 *
 * 노트를 복사해 슬랙에 붙이면 줄 사이가 서너 칸씩 벌어지고 불릿이 통째로
 * 사라졌습니다. 두 가지가 겹쳐 있었습니다.
 *
 * **글자 쪽.** 프로즈미러의 기본 글자 사본은 블록마다 빈 줄을 하나씩 끼웁니다.
 * 체크박스 줄은 `목록 > 줄 > 문단` 세 겹이라 한 줄 옮기는 데 빈 줄이 여러 개
 * 붙었습니다. 그리고 목록 표시는 애초에 안 실립니다 — 불릿은 화면이 그리는
 * 것이지 글자가 아니니까요.
 *
 * **HTML 쪽.** 체크박스 줄의 기본 HTML은 `<li>` 안에 `<label><input>`과
 * `<div>`가 들어앉은 모양입니다. 받는 쪽은 그 안쪽 덩어리들을 각각 한 줄로
 * 펴서, 한 줄이 서너 줄이 됩니다. 업무 줄과 파일 줄은 더 나빴습니다 — 이름이
 * 화면에서만 살고 문서에는 id만 있어서, 붙여 넣으면 **빈 줄**이었습니다.
 *
 * 그래서 두 사본을 다 우리가 만듭니다. HTML은 받는 쪽이 아는 모양(`ul`/`li`/
 * `p`)으로만, 글자는 마크다운으로 — 슬랙도 노션도 이 둘은 읽습니다.
 */

/** 화면에만 살던 이름들. 붙여 넣는 사람에게는 이게 그 줄의 전부입니다. */
function labelOf(node: PMNode): string {
  if (node.type.name === 'taskRef') {
    const id = node.attrs.taskId as string | null
    const task = id ? useTaskStore.getState().tasks.find(t => t.id === id) : undefined
    return task?.name ?? '(삭제된 업무)'
  }
  if (node.type.name === 'fileRef') return (node.attrs.title as string) || '파일'
  return ''
}

/** 프로즈미러 조각을 값만 있는 모양으로. 여기부터는 lib/noteText가 답합니다. */
function toPlain(fragment: { forEach: (f: (n: PMNode) => void) => void }): NoteNode[] {
  const out: NoteNode[] = []
  fragment.forEach(node => {
    const kids: NoteNode[] = []
    node.content.forEach(child => kids.push(...toPlain({ forEach: f => f(child) })))
    out.push({
      type: node.type.name,
      isBlock: node.isBlock,
      ...(node.isText && node.text ? { text: node.text } : {}),
      textContent: node.textContent,
      attrs: node.attrs as NoteNode['attrs'],
      content: kids,
    })
  })
  return out
}

export const CopyClean = Extension.create({
  name: 'copyClean',

  addProseMirrorPlugins() {
    const { schema } = this.editor
    const base = DOMSerializer.fromSchema(schema)

    /**
     * 받는 쪽이 아는 모양으로만 그립니다.
     *
     * 체크는 취소선으로 옮깁니다. `data-checked`는 우리끼리만 아는 말이고,
     * 붙여 넣은 사람이 보는 것은 글자뿐이라 — 끝난 일과 안 끝난 일이 똑같이
     * 보이면 그 목록은 거짓말을 합니다.
     */
    const nodes: Record<string, (node: PMNode) => unknown> = {
      ...base.nodes,
      taskList: () => ['ul', 0],
      taskItem: (node: PMNode) => (node.attrs.checked ? ['li', ['s', 0]] : ['li', 0]),
    }
    if (schema.nodes.taskRef) nodes.taskRef = (node: PMNode) => ['p', labelOf(node)]
    if (schema.nodes.fileRef) nodes.fileRef = (node: PMNode) => ['p', labelOf(node)]

    const clean = new DOMSerializer(nodes as never, base.marks)

    return [
      new Plugin({
        key: new PluginKey('copyClean'),
        props: {
          clipboardSerializer: clean,
          clipboardTextSerializer: slice => noteText(toPlain(slice.content), n => labelOf(n as never)),
        },
      }),
    ]
  },
})
