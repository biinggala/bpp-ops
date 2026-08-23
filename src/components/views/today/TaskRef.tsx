import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useTaskStore } from '../../../store/taskStore'
import { useUiStore } from '../../../store/uiStore'
import { useProjectStore } from '../../../store/projectStore'
import { haptic } from '../../../lib/haptics'
import { daysFrom } from '../../../lib/utils'

/**
 * ── 노트 안의 업무 ───────────────────────────────────────────────────────────
 *
 * 노트에는 두 종류의 줄이 있습니다.
 *
 * **자유 체크리스트** — '커피 주문', '슬랙 답장'. 손으로 친 글자고, 내 노트에만
 * 삽니다. 체크해도 아무 일도 일어나지 않습니다. 태스크로 만들기 애매한 것들이
 * 갈 곳이 없어서 이 화면을 만든 거니까, 이쪽이 가벼워야 합니다.
 *
 * **업무 참조** — 이것. 진짜 태스크를 가리킵니다.
 *
 * 참조는 **id만 저장하고 이름과 상태는 그릴 때마다 읽습니다.** 그래서 남이
 * 이름을 바꾸면 내 노트에도 바뀌어 있고, 남이 끝내면 내 오늘 목록에서도 끝나
 * 있습니다. 이름을 복사해 두었다면 오늘 아침의 사본을 붙들고 하루를 보내게
 * 됩니다.
 *
 * 체크는 한 방향으로만 흐릅니다: 여기서 체크하면 그 태스크가 완료가 됩니다.
 * 반대로 담당자·마감일·프로젝트는 여기서 못 고칩니다 — 이름을 누르면 상세
 * 창이 열리고, 그게 그걸 고치는 곳입니다. 노트는 일이 사는 곳이 아니라 오늘의
 * 결정이 사는 곳입니다.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    taskRef: {
      insertTaskRef: (taskId: string) => ReturnType
    }
  }
}

export const TaskRef = Node.create({
  name: 'taskRef',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      taskId: {
        default: null,
        parseHTML: el => (el as HTMLElement).getAttribute('data-task-id'),
        renderHTML: attrs => (attrs.taskId ? { 'data-task-id': attrs.taskId } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-task-ref]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-task-ref': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(TaskRefView)
  },

  addCommands() {
    return {
      insertTaskRef: (taskId: string) => ({ commands }) =>
        commands.insertContent({ type: this.name, attrs: { taskId } }),
    }
  },
})

function TaskRefView({ node, deleteNode }: NodeViewProps) {
  const taskId = node.attrs.taskId as string | null
  const task = useTaskStore(s => s.tasks.find(t => t.id === taskId))
  const updateTask = useTaskStore(s => s.updateTask)
  const openTaskDetail = useUiStore(s => s.openTaskDetail)
  const projects = useProjectStore(s => s.projects)

  // 지워진 업무. 줄을 조용히 없애 버리면 어제 세운 계획이 말없이 줄어듭니다.
  if (!task) {
    return (
      <NodeViewWrapper as="div" contentEditable={false} style={ROW}>
        <span style={{ ...BOX, borderStyle: 'dashed' }} />
        <span style={{ fontSize: 14, color: 'var(--t3)', textDecoration: 'line-through' }}>
          삭제된 업무
        </span>
        <button onClick={() => deleteNode()} style={REMOVE} aria-label="줄 지우기">×</button>
      </NodeViewWrapper>
    )
  }

  const done = task.status === '완료'
  const project = task.projectId ? projects.find(p => p.id === task.projectId) : undefined
  const diff = task.due ? daysFrom(task.due, new Date()) : null
  const late = diff !== null && diff < 0 && !done

  const toggle = () => {
    haptic('toggle')
    updateTask(task.id, { status: done ? '진행중' : '완료', ...(done ? {} : { progress: 100 }) })
  }

  return (
    <NodeViewWrapper as="div" contentEditable={false} style={ROW} data-drag-handle>
      <button onClick={toggle} aria-label={done ? '완료 취소' : '완료'} style={{
        ...BOX,
        border: done ? '2px solid #448361' : '2px solid var(--bd2)',
        background: done ? '#448361' : 'transparent',
        color: '#fff', fontSize: 10, cursor: 'pointer', padding: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{done ? '✓' : ''}</button>

      <span
        onClick={() => openTaskDetail(task.id)}
        style={{
          fontSize: 14, lineHeight: 1.6, cursor: 'pointer', minWidth: 0,
          color: done ? 'var(--t3)' : 'var(--t1)',
          textDecoration: done ? 'line-through' : 'none',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >{task.name || '(이름 없음)'}</span>

      {project && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, fontSize: 11, color: 'var(--t3)' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: project.color }} />
          {project.name}
        </span>
      )}

      {diff !== null && !done && (
        <span style={{
          flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 'var(--r1)',
          background: late ? 'var(--danger-l)' : 'var(--bg3)',
          color: late ? 'var(--danger)' : 'var(--t3)',
        }}>
          {late ? `D+${Math.abs(diff)}` : diff === 0 ? 'D-Day' : `D-${diff}`}
        </span>
      )}

      {/* 노트에서 빼는 것과 업무를 지우는 건 다른 일입니다. 이건 앞의 것. */}
      <button onClick={() => deleteNode()} title="오늘 목록에서 빼기" style={REMOVE}>×</button>
    </NodeViewWrapper>
  )
}

const ROW: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '3px 6px', margin: '1px -6px', borderRadius: 'var(--r2)',
}

const BOX: React.CSSProperties = {
  width: 16, height: 16, flexShrink: 0, borderRadius: '50%',
  border: '2px solid var(--bd2)', display: 'inline-block',
}

const REMOVE: React.CSSProperties = {
  marginLeft: 'auto', flexShrink: 0,
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--t3)', fontSize: 14, lineHeight: 1, padding: '0 2px',
  fontFamily: 'var(--font)',
}
