import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useTaskStore } from '../../../store/taskStore'
import { useUiStore } from '../../../store/uiStore'
import { useProjectStore } from '../../../store/projectStore'
import { useMilestoneStore } from '../../../store/milestoneStore'
import { haptic } from '../../../lib/haptics'
import { daysFrom } from '../../../lib/utils'
import { StatusMark } from '../../shared/StatusMark'
import { useMenu, Menu, MenuList, MenuItem } from '../../shared/Menu'
import { STATUS_LIST, statusAccent, type Status } from '../../../types'

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
 * **여기 있는 건 체크박스가 아니라 상태입니다.** 처음엔 동그란 체크박스였는데,
 * 그건 일이 끝났거나 안 끝났거나 둘 중 하나라는 말입니다. 우리 업무는 대기 ·
 * 진행중 · 검토중 · 완료 네 가지고, 하루 중에 제일 자주 일어나는 변화는
 * '완료'가 아니라 '진행중으로 옮김'입니다. 체크박스는 그걸 표현할 수 없어서
 * 한 번 누르면 무조건 완료로 보내 버렸습니다 — 아직 하는 중인 일을요.
 *
 * 그래서 목록·보드와 같은 표시(StatusMark)를 쓰고, 누르면 네 상태가 나옵니다.
 * 자유 체크리스트는 그대로 체크박스입니다. 그쪽은 정말로 둘 중 하나니까요.
 *
 * 담당자·마감일·프로젝트는 여기서 못 고칩니다 — 이름을 누르면 상세 창이
 * 열리고, 그게 그걸 고치는 곳입니다. 노트는 일이 사는 곳이 아니라 오늘의
 * 결정이 사는 곳입니다.
 */

/** 왼쪽 목록에서 노트로 끌어올 때 실려 오는 것. 업무 id 하나면 충분합니다. */
export const TASK_DND = 'application/x-bpp-task'

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
  const allTasks = useTaskStore(s => s.tasks)
  const milestones = useMilestoneStore(s => s.milestones)
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
  const parent = allTasks.find(t => t.id === task.parentId)
  const milestone = milestones.find(m => m.id === task.milestoneId)
  const diff = task.due ? daysFrom(task.due, new Date()) : null
  const late = diff !== null && diff < 0 && !done

  const setStatus = (next: Status) => {
    if (next === task.status) return
    haptic('toggle')
    // 완료로 옮길 때만 진행률을 같이 채웁니다. 완료에서 나올 때 0으로
    // 되돌리면 그동안 한 일이 없던 일이 됩니다.
    updateTask(task.id, { status: next, ...(next === '완료' ? { progress: 100 } : {}) })
  }

  return (
    /**
     * ── 하위 업무는 한 칸 들어갑니다 ─────────────────────────────────────────
     *
     * 노트에 늘어놓으면 상위든 하위든 똑같이 생긴 한 줄이라, 그중 어떤 것이
     * 다른 무엇의 일부인지가 화면에서 사라집니다. 승격으로 만든 줄은 특히
     * 그렇습니다 — 만들 때는 부모를 골랐는데 만들고 나면 그 사실이 안 보입니다.
     *
     * 들여쓰기는 한눈에 보이게 하고, 이름은 정확하게 말합니다. 부모가 노트의
     * 바로 위 줄이라는 보장이 없으므로 선으로 잇지는 않습니다 — 그건 없는
     * 관계를 그리는 일입니다.
     */
    <NodeViewWrapper as="div" contentEditable={false} style={{ ...ROW, marginLeft: parent ? 16 : -6 }} data-drag-handle>
      {parent && (
        <span aria-hidden style={{
          flexShrink: 0, width: 10, marginLeft: -4, marginRight: -2,
          color: 'var(--t3)', fontSize: 11, lineHeight: 1,
        }}>↳</span>
      )}
      <StatusPick status={task.status} onPick={setStatus} />

      <span
        onClick={() => openTaskDetail(task.id)}
        style={{
          fontSize: 14, lineHeight: 1.7, cursor: 'pointer', minWidth: 0,
          color: done ? 'var(--t3)' : 'var(--t1)',
          textDecoration: done ? 'line-through' : 'none',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >{task.name || '(이름 없음)'}</span>

      {/*
        어디 소속인지 한 조각.

        부모가 있으면 **부모 이름**입니다 — 프로젝트는 부모가 이미 말하고
        있고, 이 줄이 답해야 하는 건 '무엇의 일부인가'입니다. 부모가 없고
        마일스톤이 있으면 마일스톤, 둘 다 없으면 프로젝트.

        점 색깔은 어느 쪽이든 프로젝트 것입니다. 이름이 무엇으로 바뀌든
        '어느 프로젝트'는 색이 계속 말해 줍니다.
      */}
      {(parent || milestone || project) && (
        <span
          onClick={parent ? () => openTaskDetail(parent.id) : undefined}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
            fontSize: 11, color: 'var(--t3)', maxWidth: 180,
            cursor: parent ? 'pointer' : 'default',
          }}
        >
          {project && <span style={{ width: 6, height: 6, borderRadius: '50%', background: project.color, flexShrink: 0 }} />}
          {!parent && milestone && <span style={{ flexShrink: 0 }}>◇</span>}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {parent ? parent.name || '이름 없음' : milestone ? milestone.name : project?.name}
          </span>
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

/**
 * 상태를 보여 주고, 누르면 바꾸는 것.
 *
 * 표시는 목록·보드와 같은 StatusMark입니다. 오늘 화면에서만 다른 모양을 쓰면
 * 같은 값을 두 가지로 배우게 됩니다.
 */
function StatusPick({ status, onPick }: { status: Status; onPick: (s: Status) => void }) {
  const m = useMenu()
  return (
    <span ref={m.rootRef} style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
      <button
        onClick={e => m.toggleAt(e.currentTarget, 148, 200)}
        aria-label={`상태: ${status}`}
        title={status}
        style={{
          width: 20, height: 20, borderRadius: '50%', border: 'none', padding: 0, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: m.open ? 'var(--bg3)' : 'transparent',
          color: statusAccent(status), fontFamily: 'var(--font)',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
        onMouseLeave={e => (e.currentTarget.style.background = m.open ? 'var(--bg3)' : 'transparent')}
      >
        <StatusMark status={status} size={14} />
      </button>
      {m.open && (
        <Menu pos={m.pos} panelRef={m.panelRef} width={148}>
          <MenuList>
            {STATUS_LIST.map(s => (
              <MenuItem key={s} selected={s === status} onSelect={() => { onPick(s); m.setOpen(false) }}>
                <span style={{ color: statusAccent(s), display: 'flex' }}><StatusMark status={s} size={12} /></span>
                {s}
              </MenuItem>
            ))}
          </MenuList>
        </Menu>
      )}
    </span>
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
