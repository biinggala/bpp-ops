import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useTaskStore } from '../../../store/taskStore'
import { useUiStore } from '../../../store/uiStore'
import { useProjectStore } from '../../../store/projectStore'
import { useMilestoneStore } from '../../../store/milestoneStore'
import { useSyncStore } from '../../../store/syncStore'
import { useGCalStore } from '../../../store/gcalStore'
import { TIMEBLOCK_ATTR } from '../../../lib/timeblock'
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
  const ready = useSyncStore(s => s.ready)
  /**
   * 이 업무에 붙은 시간. 일정 쪽에 업무 id가 실려 있어서(lib/timeblock) 찾을
   * 수 있습니다. 없으면 아직 시간을 안 정한 것이고, 그건 흠이 아니라 대부분의
   * 줄이라 아무 표시도 하지 않습니다.
   */
  const blockAt = useGCalStore(s =>
    s.events.find(e => e.taskId === taskId && !e.allDay)?.startTime)
  const updateTask = useTaskStore(s => s.updateTask)
  const openTaskDetail = useUiStore(s => s.openTaskDetail)
  const projects = useProjectStore(s => s.projects)

  /**
   * ── 아직 안 온 것과 지워진 것 ─────────────────────────────────────────────
   *
   * 둘 다 '못 찾음'으로 같아 보였습니다. 그래서 앱을 켜면 어제 담아 둔 업무
   * 줄들이 몇 초 동안 **'삭제된 업무'라고 자신 있게** 적혀 있었습니다.
   * 없는 것과 아직 안 온 것은 다른 말입니다.
   *
   * ready는 '첫 그림이 다 왔다'는 뜻입니다(syncStore). 그 전까지는 들어올
   * 것의 모양만 놓아 둡니다.
   */
  if (!task && !ready) {
    return (
      <NodeViewWrapper as="div" contentEditable={false} style={ROW}>
        <span className="bpp-skel" style={{ width: 16, height: 16, borderRadius: '50%', flexShrink: 0 }} />
        <span className="bpp-skel" style={{ width: 160, height: 11 }} />
      </NodeViewWrapper>
    )
  }

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
  // 하위 업무에 마일스톤이 안 적혀 있으면 부모의 것을 씁니다. 마일스톤은
  // 가족 단위로 붙는 것이고, 부모가 그 안에 있으면 자식도 그 안입니다.
  const milestone = milestones.find(m => m.id === (task.milestoneId || parent?.milestoneId))
  const diff = task.due ? daysFrom(task.due, new Date()) : null
  const late = diff !== null && diff < 0 && !done

  const setStatus = (next: Status) => {
    if (next === task.status) return
    haptic('toggle')
    // 완료로 옮길 때만 진행률을 같이 채웁니다. 완료에서 나올 때 0으로
    // 되돌리면 그동안 한 일이 없던 일이 됩니다.
    updateTask(task.id, { status: next, ...(next === '완료' ? { progress: 100 } : {}) })
  }

  /**
   * ── 소속은 한 조각, 표시는 하나 ────────────────────────────────────────────
   *
   * 세 번 틀리고 네 번째입니다. 앞의 셋이 각각 어디서 틀렸는지 적어 둡니다.
   *
   * **들여쓰기 + ↳** — 줄 왼쪽에 붙으니 '바로 위 줄이 부모'라고 말했습니다.
   * 노트의 줄 순서는 사람이 정하므로 위에 있는 것은 대개 남남입니다.
   *
   * **제목 위 빵가루 한 줄** — 두 줄 사이에 놓여서 어느 줄 것인지 알 수
   * 없었고, 부모가 마침 위 줄이면 같은 글자가 두 번 나왔습니다. 그리고 어떤
   * 줄은 한 줄, 어떤 줄은 두 줄이 되어 목록의 결이 깨졌습니다.
   *
   * 빵가루로 옮긴 이유였던 '제목이 잘린다'는 **폭 문제였고 자리 문제가
   * 아니었습니다.** 제목만 줄어들 수 있게(minWidth: 0) 두고 뒤쪽 칩은
   * 안 줄어들게(flexShrink: 0) 두었으니 손실을 제목이 다 먹은 것입니다.
   * 줄어드는 쪽을 바꾸면 그 자리에서 해결됩니다.
   *
   * 그래서 **모든 줄이 한 줄, 같은 모양**입니다:
   * `[상태] 제목 · [소속] · [D-day] · [×]`
   *
   * **소속은 사슬입니다.** 처음엔 하나만 골라 보여 줬는데(하위면 부모, 아니면
   * 마일스톤), 그러면 하위 업무가 어느 마일스톤 밑인지가 사라지고 무엇보다
   * **한 칸짜리라 깊이가 안 보입니다** — '◇ 브랜딩'과 '↳ 로고 시안'이 같은
   * 자리에 같은 크기로 앉아 있으니 둘이 같은 층으로 읽힙니다.
   *
   *   상위 업무   `◇ 브랜딩`
   *   하위 업무   `◇ 브랜딩 › ↳ 로고 시안`
   *
   * 칸이 둘이면 두 단계 아래라는 게 세는 것 없이 보입니다. 앞 칸은 늘 '가장
   * 넓은 담는 곳'(마일스톤, 없으면 프로젝트)이고 뒤 칸은 부모입니다.
   *
   * 좁아지면 **앞 칸이 먼저** 줄어듭니다(shrink 3 대 1). 답에 더 가까운 건
   * 부모 쪽이고, 앞 칸은 색만 남아도 어느 프로젝트인지 말해 줍니다.
   *
   * 표시는 한 칸에 하나 — 마일스톤 ◇, 프로젝트 ●, 부모 ↳. 색은 셋 다
   * 프로젝트 색이라 이름이 무엇으로 바뀌든 '어느 프로젝트'는 색이 계속
   * 말해 줍니다.
   */
  const chain: { mark: string; name: string; go?: () => void; weak: boolean }[] = []
  if (milestone) chain.push({ mark: '◇', name: milestone.name, weak: true })
  else if (project) chain.push({ mark: '●', name: project.name, weak: true })
  if (parent) chain.push({ mark: '↳', name: parent.name || '이름 없음', go: () => openTaskDetail(parent.id), weak: false })

  return (
    <NodeViewWrapper
      as="div"
      contentEditable={false}
      style={ROW}
      data-drag-handle
      /**
       * 시간 축으로 끌 수 있는 줄이라는 표시. 무엇을 싣는지는 document의
       * 처리기가 여기 적힌 것을 읽어서 정합니다 — lib/timeblock에 왜 거기
       * 있어야 하는지 적어 뒀습니다(프로즈미러가 dataTransfer를 지웁니다).
       */
      {...{ [TIMEBLOCK_ATTR]: '', 'data-timeblock-task': task.id, 'data-timeblock-name': task.name || '이름 없음' }}
    >
      <StatusPick status={task.status} onPick={setStatus} />

      <span
        onClick={() => openTaskDetail(task.id)}
        style={{
          fontSize: 14, lineHeight: 1.7, cursor: 'pointer',
          // 제목이 먼저 자리를 갖고, 남는 만큼을 소속이 씁니다.
          flex: '1 1 auto', minWidth: 60,
          color: done ? 'var(--t3)' : 'var(--t1)',
          textDecoration: done ? 'line-through' : 'none',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >{task.name || '(이름 없음)'}</span>

      {chain.length > 0 && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          // 좁아지면 **이쪽이** 줄어듭니다. 제목은 마지막까지 지킵니다.
          flex: '0 1 auto', minWidth: 0, maxWidth: 320,
          fontSize: 11, color: 'var(--t3)',
        }}>
          {/* 칸과 구분자를 같은 층에 둡니다 — shrink 무게는 형제끼리만
              겨루므로, 칸을 한 겹 감싸면 무게가 서로 안 보입니다. */}
          {chain.map((seg, i) => [
            i > 0 && <span key={`s${i}`} style={{ flexShrink: 0, opacity: 0.5 }}>›</span>,
            <span
              key={i}
              onClick={seg.go}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                // 앞 칸(마일스톤·프로젝트)이 뒤 칸(부모)보다 세 배 빨리 줄어듭니다.
                flexGrow: 0, flexShrink: seg.weak ? 3 : 1, flexBasis: 'auto', minWidth: 0,
                cursor: seg.go ? 'pointer' : 'default',
              }}
            >
              <span style={{
                flexShrink: 0, color: project?.color ?? 'var(--t3)',
                fontSize: seg.mark === '●' ? 8 : 11, lineHeight: 1,
              }}>
                {seg.mark}
              </span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {seg.name}
              </span>
            </span>,
          ])}
        </span>
      )}

      {/* 시간이 정해졌으면 그것부터. D-day는 '언제까지'고 이건 '언제' —
          오늘 화면에서 먼저 궁금한 쪽은 뒤엣것입니다. */}
      {blockAt && (
        <span style={{
          flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '1px 6px',
          borderRadius: 'var(--r1)', background: 'var(--ac-l)', color: 'var(--ac)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {blockAt}
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
