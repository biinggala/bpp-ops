import React from 'react'
import { useFilteredTasks } from '../../../hooks/useFilteredTasks'
import { useTaskStore } from '../../../store/taskStore'
import { useUiStore } from '../../../store/uiStore'
import { useMilestoneStore } from '../../../store/milestoneStore'
import { CategoryBadge, PriorityBadge } from '../../shared/Badge'
import { AssigneeGroup } from '../../shared/Avatar'
import { ProgressBar } from '../../shared/ProgressBar'
import { fmtDate, isOverdue } from '../../../lib/utils'
import type { Task, Milestone } from '../../../types'

const COLS = [
  { label: '업무', flex: 3.5 },
  { label: '스페이스', flex: 1.2 },
  { label: '담당자', flex: 1.2 },
  { label: '상태', flex: 1 },
  { label: '마감일', flex: 0.9 },
  { label: '우선순위', flex: 0.8 },
  { label: '진행률', flex: 1.2 },
  { label: '메모', flex: 1.8 },
]

function daysFrom(dateStr: string, base: Date) {
  return Math.round((new Date(dateStr).setHours(0, 0, 0, 0) - base.getTime()) / 86400000)
}

export function TableView() {
  const filteredTasks = useFilteredTasks()
  const allTasks = useTaskStore(s => s.tasks)
  const { deleteTask, updateTask } = useTaskStore()
  const { openTaskModal, setDetailTaskId, projectId } = useUiStore()
  const milestones = useMilestoneStore(s => s.milestones)
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set())
  const [collapsedMs, setCollapsedMs] = React.useState<Set<string>>(new Set())
  const today = React.useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])

  const rootTasks = filteredTasks.filter(t => !t.parentId)
  const getChildren = (id: string) => allTasks.filter(t => t.parentId === id)

  const toggle = (id: string) =>
    setCollapsed(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const toggleMs = (id: string) =>
    setCollapsedMs(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const makeHandlers = (task: Task) => ({
    onOpen: () => setDetailTaskId(task.id),
    onEdit: (e: React.MouseEvent) => { e.stopPropagation(); openTaskModal(task.id) },
    onDelete: (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!confirm('삭제할까요?')) return
      getChildren(task.id).forEach(c => deleteTask(c.id))
      deleteTask(task.id)
    },
    onStatusChange: (s: Task['status']) => updateTask(task.id, { status: s }),
    onAddSubtask: (e: React.MouseEvent) => { e.stopPropagation(); openTaskModal(undefined, task.id) },
    onMilestoneChange: (msId: string | undefined) => updateTask(task.id, { milestoneId: msId }),
  })

  const projectMilestones = milestones
    .filter(m => m.projectId === projectId)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))

  const isGrouped = !!(projectId && projectMilestones.length > 0)

  const colHeader = (
    <div style={{ display: 'flex', background: 'var(--bg2)', borderBottom: '2px solid var(--bd)' }}>
      {COLS.map((c, i) => (
        <div key={c.label} style={{ flex: c.flex, padding: '7px 12px', fontSize: 11, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.04em', borderRight: i < COLS.length - 1 ? '1px solid var(--bd)' : 'none' }}>
          {c.label}
        </div>
      ))}
    </div>
  )

  const addBtn = (
    <button
      onClick={() => openTaskModal()}
      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', fontSize: 13, color: 'var(--t3)', background: 'transparent', border: 'none', borderTop: '1px solid var(--bd)', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font)', transition: 'background .1s' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg3)'; e.currentTarget.style.color = 'var(--t2)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t3)' }}
    >
      <span style={{ fontSize: 16, lineHeight: 1, marginTop: -1 }}>+</span> 업무 추가
    </button>
  )

  const renderRows = (tasks: Task[], showPicker: boolean) =>
    tasks.map(task => {
      const children = getChildren(task.id)
      const hasChildren = children.length > 0
      const isExpanded = !collapsed.has(task.id)
      const h = makeHandlers(task)
      return (
        <React.Fragment key={task.id}>
          <Row
            task={task}
            hasChildren={hasChildren}
            isExpanded={isExpanded}
            childCount={children.length}
            doneCount={children.filter(c => c.status === '완료').length}
            milestones={showPicker ? projectMilestones : []}
            showMilestonePicker={showPicker}
            onToggle={() => toggle(task.id)}
            {...h}
          />
          {hasChildren && isExpanded && children.map((child, idx) => {
            const ch = makeHandlers(child)
            return (
              <Row
                key={child.id}
                task={child}
                isChild
                isLastChild={idx === children.length - 1}
                milestones={showPicker ? projectMilestones : []}
                showMilestonePicker={showPicker}
                {...ch}
              />
            )
          })}
        </React.Fragment>
      )
    })

  if (isGrouped) {
    const grouped: Record<string, Task[]> = {}
    for (const ms of projectMilestones) grouped[ms.id] = []
    const unassigned: Task[] = []
    for (const task of rootTasks) {
      if (task.milestoneId && grouped[task.milestoneId] !== undefined) {
        grouped[task.milestoneId].push(task)
      } else {
        unassigned.push(task)
      }
    }

    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        <div style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r4)', overflow: 'hidden', minWidth: 860 }}>
          {colHeader}
          {projectMilestones.map(ms => {
            const msTasks = grouped[ms.id] ?? []
            const isCollapsed = collapsedMs.has(ms.id)
            const completed = msTasks.filter(t => t.status === '완료').length
            const diff = daysFrom(ms.dueDate, today)
            return (
              <React.Fragment key={ms.id}>
                <MilestoneHeader
                  milestone={ms}
                  taskCount={msTasks.length}
                  completed={completed}
                  diff={diff}
                  collapsed={isCollapsed}
                  onToggle={() => toggleMs(ms.id)}
                  onAddTask={() => openTaskModal(undefined, undefined, ms.id)}
                />
                {!isCollapsed && renderRows(msTasks, true)}
              </React.Fragment>
            )
          })}

          {/* Unassigned */}
          {unassigned.length > 0 && (
            <React.Fragment>
              <UnassignedHeader
                count={unassigned.length}
                collapsed={collapsedMs.has('__none__')}
                onToggle={() => toggleMs('__none__')}
                onAddTask={() => openTaskModal()}
              />
              {!collapsedMs.has('__none__') && renderRows(unassigned, true)}
            </React.Fragment>
          )}

          {addBtn}
        </div>
      </div>
    )
  }

  // Flat view
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
      <div style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r4)', overflow: 'hidden', minWidth: 860 }}>
        {colHeader}
        {renderRows(rootTasks, !!projectId)}
        {addBtn}
      </div>
    </div>
  )
}

// ── MilestoneHeader (Jira-style section header) ───────────────────────────────

function MilestoneHeader({ milestone, taskCount, completed, diff, collapsed, onToggle, onAddTask }: {
  milestone: Milestone; taskCount: number; completed: number; diff: number
  collapsed: boolean; onToggle: () => void; onAddTask: () => void
}) {
  const [hovered, setHovered] = React.useState(false)
  const overdue = diff < 0
  const close = diff >= 0 && diff <= 7
  const accent = overdue ? '#ef4444' : close ? '#f59e0b' : '#8b5cf6'
  const progress = taskCount ? Math.round(completed / taskCount * 100) : 0

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--bg2)', borderBottom: '1px solid var(--bd)', borderLeft: `3px solid ${accent}` }}
    >
      <button
        onClick={onToggle}
        style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--t3)', fontSize: 9, borderRadius: 3, flexShrink: 0, fontFamily: 'var(--font)' }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg4)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        {collapsed ? '▶' : '▼'}
      </button>

      <span style={{ fontSize: 11, color: accent, flexShrink: 0 }}>◆</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{milestone.name}</span>
      <span style={{ fontSize: 11, color: 'var(--t3)' }}>{milestone.dueDate}</span>

      <span style={{
        fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 'var(--r1)', flexShrink: 0,
        background: overdue ? 'rgba(239,68,68,.1)' : close ? 'rgba(245,158,11,.1)' : 'rgba(139,92,246,.1)',
        color: accent,
      }}>
        {overdue ? `D+${Math.abs(diff)}` : `D-${diff}`}
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4, flexShrink: 0 }}>
        <div style={{ width: 72, height: 4, background: 'var(--bd)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progress}%`, background: accent, borderRadius: 2, transition: 'width .3s' }} />
        </div>
        <span style={{ fontSize: 11, color: 'var(--t3)', whiteSpace: 'nowrap' }}>{completed}/{taskCount} 완료</span>
      </div>

      {hovered && (
        <button
          onClick={e => { e.stopPropagation(); onAddTask() }}
          style={{ marginLeft: 'auto', padding: '3px 8px', fontSize: 11, borderRadius: 'var(--r1)', border: `1px solid ${accent}`, background: 'transparent', color: accent, cursor: 'pointer', fontFamily: 'var(--font)', flexShrink: 0 }}
          onMouseEnter={e => { e.currentTarget.style.background = overdue ? 'rgba(239,68,68,.07)' : close ? 'rgba(245,158,11,.07)' : 'rgba(139,92,246,.07)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
          + 업무
        </button>
      )}
    </div>
  )
}

// ── UnassignedHeader ──────────────────────────────────────────────────────────

function UnassignedHeader({ count, collapsed, onToggle, onAddTask }: {
  count: number; collapsed: boolean; onToggle: () => void; onAddTask: () => void
}) {
  const [hovered, setHovered] = React.useState(false)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--bg2)', borderBottom: '1px solid var(--bd)', borderLeft: '3px solid var(--bd)' }}
    >
      <button
        onClick={onToggle}
        style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--t3)', fontSize: 9, borderRadius: 3, flexShrink: 0, fontFamily: 'var(--font)' }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg4)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        {collapsed ? '▶' : '▼'}
      </button>
      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--t2)' }}>마일스톤 미배정</span>
      <span style={{ fontSize: 11, color: 'var(--t3)', background: 'var(--bg3)', borderRadius: 10, padding: '1px 7px' }}>{count}</span>
      {hovered && (
        <button
          onClick={e => { e.stopPropagation(); onAddTask() }}
          style={{ marginLeft: 'auto', padding: '3px 8px', fontSize: 11, borderRadius: 'var(--r1)', border: '1px solid var(--bd)', background: 'transparent', color: 'var(--t2)', cursor: 'pointer', fontFamily: 'var(--font)', flexShrink: 0 }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          + 업무
        </button>
      )}
    </div>
  )
}

// ── MilestonePicker (inline popover) ─────────────────────────────────────────

function MilestonePicker({ milestoneId, milestones, onChange }: {
  milestoneId: string | undefined
  milestones: Milestone[]
  onChange: (id: string | undefined) => void
}) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  const current = milestones.find(m => m.id === milestoneId)

  React.useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 3,
          padding: '2px 6px', borderRadius: 'var(--r2)', fontFamily: 'var(--font)',
          fontSize: 11, cursor: 'pointer',
          border: current ? '1px solid rgba(139,92,246,.3)' : '1px solid transparent',
          background: current ? 'rgba(139,92,246,.08)' : 'var(--bg3)',
          color: current ? '#8b5cf6' : 'var(--t3)',
        }}
        onMouseEnter={e => { if (!current) { e.currentTarget.style.borderColor = 'var(--bd)'; e.currentTarget.style.color = 'var(--t2)' } }}
        onMouseLeave={e => { if (!current) { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.color = 'var(--t3)' } }}
      >
        <span style={{ fontSize: 8 }}>◆</span>
        <span>{current ? current.name : '미배정'}</span>
        <span style={{ fontSize: 7, opacity: .5 }}>▾</span>
      </button>

      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 3px)', left: 0, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r3)', boxShadow: 'var(--sh-md)', zIndex: 300, minWidth: 200, padding: '4px 0' }}>
          <PickerRow
            onClick={() => { onChange(undefined); setOpen(false) }}
            active={!milestoneId}
            label="— 없음 (미배정)"
            accent={false}
          />
          {milestones.map(m => (
            <PickerRow
              key={m.id}
              onClick={() => { onChange(m.id); setOpen(false) }}
              active={m.id === milestoneId}
              label={`◆ ${m.name}`}
              sub={m.dueDate}
              accent
            />
          ))}
        </div>
      )}
    </div>
  )
}

function PickerRow({ onClick, active, label, sub, accent }: {
  onClick: () => void; active: boolean; label: string; sub?: string; accent?: boolean
}) {
  return (
    <div
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 12px', fontSize: 12, cursor: 'pointer', color: active ? (accent ? '#8b5cf6' : 'var(--t1)') : 'var(--t2)', fontWeight: active ? 500 : 400, background: active && accent ? 'rgba(139,92,246,.06)' : 'transparent', transition: 'background .07s' }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg3)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
    >
      <span>{label}</span>
      {sub && <span style={{ fontSize: 10, color: 'var(--t3)' }}>{sub}</span>}
    </div>
  )
}

// ── Row ───────────────────────────────────────────────────────────────────────

function Row({
  task, isChild = false, isLastChild = false,
  hasChildren = false, isExpanded = true,
  childCount = 0, doneCount = 0,
  milestones = [], showMilestonePicker = false,
  onToggle, onOpen, onEdit, onDelete, onStatusChange, onAddSubtask, onMilestoneChange,
}: {
  task: Task; isChild?: boolean; isLastChild?: boolean
  hasChildren?: boolean; isExpanded?: boolean; childCount?: number; doneCount?: number
  milestones?: Milestone[]; showMilestonePicker?: boolean
  onToggle?: () => void; onOpen: () => void
  onEdit: (e: React.MouseEvent) => void; onDelete: (e: React.MouseEvent) => void
  onStatusChange: (s: Task['status']) => void; onAddSubtask?: (e: React.MouseEvent) => void
  onMilestoneChange?: (id: string | undefined) => void
}) {
  const [hovered, setHovered] = React.useState(false)
  const overdue = isOverdue(task.due, task.status)

  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', cursor: 'pointer',
        background: isChild ? (hovered ? 'rgba(55,53,47,.03)' : 'var(--bg2)') : (hovered ? 'var(--bg3)' : 'transparent'),
        borderBottom: `1px solid var(--bd)`,
        borderLeft: `3px solid ${hovered ? 'var(--ac)' : 'transparent'}`,
        transition: 'background .08s',
        opacity: task.status === '완료' ? .55 : 1,
      }}
    >
      {/* 업무명 */}
      <div style={{ flex: 3.5, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 5, minHeight: 38, overflow: 'hidden', borderRight: '1px solid var(--bd)' }}>
        {isChild ? (
          <div style={{ width: 20, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', paddingLeft: 16 }}>
            <span style={{ fontSize: 10, color: 'var(--t3)', lineHeight: 1 }}>└</span>
          </div>
        ) : (
          <button
            onClick={e => { e.stopPropagation(); onToggle?.() }}
            style={{ width: 18, height: 18, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: hasChildren ? 'pointer' : 'default', borderRadius: 3, padding: 0, color: 'var(--t3)', fontSize: 9, visibility: hasChildren ? 'visible' : 'hidden' }}
            onMouseEnter={e => { if (hasChildren) { e.currentTarget.style.background = 'var(--bg4)'; e.currentTarget.style.color = 'var(--t1)' } }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t3)' }}
          >
            {isExpanded ? '▼' : '▶'}
          </button>
        )}

        <span style={{ fontSize: 13, fontWeight: !isChild && hasChildren ? 500 : 400, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--t1)' }}>
          {task.name}
        </span>

        {hasChildren && !isExpanded && (
          <span style={{ fontSize: 10, color: 'var(--t3)', background: 'var(--bg4)', borderRadius: 10, padding: '1px 6px', flexShrink: 0 }}>
            {doneCount}/{childCount}
          </span>
        )}

        {/* Milestone picker — visible on hover OR when assigned */}
        {showMilestonePicker && (hovered || task.milestoneId) && onMilestoneChange && (
          <MilestonePicker
            milestoneId={task.milestoneId}
            milestones={milestones}
            onChange={onMilestoneChange}
          />
        )}

        {hovered && (
          <div style={{ display: 'flex', gap: 2, marginLeft: 2, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            {!isChild && onAddSubtask && (
              <RowBtn onClick={onAddSubtask} title="하위 업무 추가" accent>+ 하위</RowBtn>
            )}
            <RowBtn onClick={onEdit} title="수정">✎</RowBtn>
            <RowBtn onClick={onDelete} title="삭제" danger>✕</RowBtn>
          </div>
        )}
      </div>

      {/* 스페이스 */}
      <Cell flex={1.2}>{task.cat ? <CategoryBadge cat={task.cat} /> : <Dash />}</Cell>
      {/* 담당자 */}
      <Cell flex={1.2}><AssigneeGroup assignee={task.assignee} size={20} /></Cell>
      {/* 상태 */}
      <Cell flex={1}>
        <select
          value={task.status}
          onClick={e => e.stopPropagation()}
          onChange={e => onStatusChange(e.target.value as Task['status'])}
          style={{ border: 'none', background: 'transparent', fontSize: 12, cursor: 'pointer', outline: 'none', color: 'var(--t2)', fontFamily: 'var(--font)', appearance: 'none', width: '100%' }}
        >
          <option>진행중</option>
          <option>대기</option>
          <option>검토중</option>
          <option>완료</option>
        </select>
      </Cell>
      {/* 마감일 */}
      <Cell flex={0.9}>
        {task.due ? (
          <span style={{ fontSize: 12, color: overdue ? '#ef4444' : 'var(--t2)', fontWeight: overdue ? 500 : 400 }}>
            {overdue && '⚠ '}{fmtDate(task.due)}
          </span>
        ) : <Dash />}
      </Cell>
      {/* 우선순위 */}
      <Cell flex={0.8}><PriorityBadge priority={task.priority} /></Cell>
      {/* 진행률 */}
      <Cell flex={1.2}><ProgressBar value={task.progress} /></Cell>
      {/* 메모 */}
      <Cell flex={1.8} last>
        <span style={{ fontSize: 12, color: 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.memo || ''}</span>
      </Cell>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Cell({ children, flex, last }: { children?: React.ReactNode; flex: number; last?: boolean }) {
  return (
    <div style={{ flex, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 4, minHeight: 38, overflow: 'hidden', borderRight: last ? 'none' : '1px solid var(--bd)' }}>
      {children}
    </div>
  )
}

function Dash() {
  return <span style={{ color: 'var(--t3)', fontSize: 12 }}>—</span>
}

function RowBtn({ children, onClick, title, danger, accent }: {
  children: React.ReactNode; onClick: (e: React.MouseEvent) => void; title: string; danger?: boolean; accent?: boolean
}) {
  return (
    <span
      onClick={onClick}
      title={title}
      style={{ height: 22, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, cursor: 'pointer', border: accent ? '1px solid var(--ac)' : 'none', padding: accent ? '0 7px' : '0', width: accent ? 'auto' : 22, color: danger ? '#ef4444' : accent ? 'var(--ac)' : 'var(--t2)', background: accent ? 'var(--ac-l)' : 'transparent', transition: 'background .08s', fontFamily: 'var(--font)' }}
      onMouseEnter={e => { e.currentTarget.style.background = danger ? 'rgba(239,68,68,.08)' : accent ? 'rgba(35,131,226,.18)' : 'var(--bg4)' }}
      onMouseLeave={e => { e.currentTarget.style.background = accent ? 'var(--ac-l)' : 'transparent' }}
    >
      {children}
    </span>
  )
}
