import React from 'react'
import { useFilteredTasks } from '../../../hooks/useFilteredTasks'
import { useTaskStore } from '../../../store/taskStore'
import { useUiStore } from '../../../store/uiStore'
import { useMilestoneStore } from '../../../store/milestoneStore'
import { useProjectStore } from '../../../store/projectStore'
import { CategoryBadge, PriorityBadge, TagBadge } from '../../shared/Badge'
import { AssigneeGroup } from '../../shared/Avatar'
import { ProgressBar } from '../../shared/ProgressBar'
import { ContextMenu } from '../../shared/ContextMenu'
import { fmtDate, isOverdue } from '../../../lib/utils'
import type { Task, Milestone, Status, Priority } from '../../../types'

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

type CtxState = { x: number; y: number; task: Task } | null

export function TableView() {
  const filteredTasks = useFilteredTasks()
  const allTasks = useTaskStore(s => s.tasks)
  const { deleteTask, updateTask } = useTaskStore()
  const { openTaskModal, openTaskDetail, projectId } = useUiStore()
  const { milestones, updateMilestone } = useMilestoneStore()
  const projects = useProjectStore(s => s.projects)
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set())
  const [collapsedMs, setCollapsedMs] = React.useState<Set<string>>(new Set())
  const [collapsedPj, setCollapsedPj] = React.useState<Set<string>>(new Set())
  const [ctxMenu, setCtxMenu] = React.useState<CtxState>(null)
  const today = React.useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])

  const rootTasks = filteredTasks.filter(t => !t.parentId)
  const getChildren = (id: string) => allTasks.filter(t => t.parentId === id)

  const toggle = (id: string) =>
    setCollapsed(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleMs = (id: string) =>
    setCollapsedMs(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const togglePj = (id: string) =>
    setCollapsedPj(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const makeHandlers = (task: Task) => ({
    onOpen: () => openTaskDetail(task.id),
    onUpdate: (patch: Partial<Task>) => updateTask(task.id, patch),
    onMilestoneChange: (msId: string | undefined) => updateTask(task.id, { milestoneId: msId }),
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, task }) },
  })

  const colHeader = (
    <div style={{ display: 'flex', background: 'var(--bg2)', borderBottom: '2px solid var(--bd)' }}>
      {COLS.map((c, i) => (
        <div key={c.label} style={{ flex: c.flex, padding: '8px 12px', fontSize: 12, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.04em', borderRight: i < COLS.length - 1 ? '1px solid var(--bd)' : 'none' }}>
          {c.label}
        </div>
      ))}
    </div>
  )

  const addBtn = (milestoneId?: string) => (
    <button
      onClick={() => openTaskModal(undefined, undefined, milestoneId)}
      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', fontSize: 13, color: 'var(--t3)', background: 'transparent', border: 'none', borderTop: '1px solid var(--bd)', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font)', transition: 'background .1s' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg3)'; e.currentTarget.style.color = 'var(--t2)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t3)' }}
    >
      <span style={{ fontSize: 16, lineHeight: 1, marginTop: -1 }}>+</span> 업무 추가
    </button>
  )

  // Render task rows with explicit milestone list for picker
  const renderRows = (tasks: Task[], pickerMilestones: Milestone[]) =>
    tasks.map(task => {
      const children = getChildren(task.id)
      const hasChildren = children.length > 0
      const isExpanded = !collapsed.has(task.id)
      const h = makeHandlers(task)
      return (
        <React.Fragment key={task.id}>
          <Row task={task} hasChildren={hasChildren} isExpanded={isExpanded}
            childCount={children.length} doneCount={children.filter(c => c.status === '완료').length}
            milestones={pickerMilestones} showMilestonePicker={pickerMilestones.length > 0}
            onToggle={() => toggle(task.id)} {...h}
          />
          {hasChildren && isExpanded && children.map((child, idx) => {
            const ch = makeHandlers(child)
            return (
              <Row key={child.id} task={child} isChild
                milestones={pickerMilestones} showMilestonePicker={pickerMilestones.length > 0}
                {...ch}
              />
            )
          })}
        </React.Fragment>
      )
    })

  // Render milestone-grouped sections (shared by single-project and multi-project modes)
  const renderMilestoneGroups = (tasks: Task[], pjMilestones: Milestone[], onAdd: (msId?: string) => void) => {
    const grouped: Record<string, Task[]> = {}
    for (const ms of pjMilestones) grouped[ms.id] = []
    const unassigned: Task[] = []
    for (const task of tasks) {
      if (task.milestoneId && grouped[task.milestoneId] !== undefined) grouped[task.milestoneId].push(task)
      else unassigned.push(task)
    }
    return (
      <>
        {pjMilestones.map(ms => {
          const msTasks = grouped[ms.id] ?? []
          const isCollapsed = collapsedMs.has(ms.id)
          const diff = daysFrom(ms.dueDate, today)
          return (
            <React.Fragment key={ms.id}>
              <MilestoneHeader
                milestone={ms} taskCount={msTasks.length}
                completed={msTasks.filter(t => t.status === '완료').length}
                diff={diff} collapsed={isCollapsed}
                onToggle={() => toggleMs(ms.id)}
                onAddTask={() => onAdd(ms.id)}
                onUpdate={patch => updateMilestone(ms.id, patch)}
              />
              {!isCollapsed && renderRows(msTasks, pjMilestones)}
            </React.Fragment>
          )
        })}
        {unassigned.length > 0 && (
          <>
            <UnassignedHeader count={unassigned.length}
              collapsed={collapsedMs.has('__none__')}
              onToggle={() => toggleMs('__none__')}
              onAddTask={() => onAdd()} />
            {!collapsedMs.has('__none__') && renderRows(unassigned, pjMilestones)}
          </>
        )}
      </>
    )
  }

  const ctx = ctxMenu && (
    <ContextMenu
      x={ctxMenu.x} y={ctxMenu.y} task={ctxMenu.task}
      onClose={() => setCtxMenu(null)}
      onEdit={() => openTaskModal(ctxMenu.task.id)}
      onAddSubtask={() => openTaskModal(undefined, ctxMenu.task.id)}
      onStatusChange={s => updateTask(ctxMenu.task.id, { status: s })}
      onDelete={() => {
        if (!confirm('삭제할까요?')) return
        getChildren(ctxMenu.task.id).forEach(c => deleteTask(c.id))
        deleteTask(ctxMenu.task.id)
      }}
    />
  )

  // ── Multi-project mode (no project filter) ────────────────────────────────
  if (!projectId) {
    const projectsWithTasks = projects.filter(p => rootTasks.some(t => t.projectId === p.id))
    const unassignedTasks = rootTasks.filter(t => !t.projectId || !projects.find(p => p.id === t.projectId))

    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {projectsWithTasks.map(proj => {
          const pjMilestones = milestones.filter(m => m.projectId === proj.id).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
          const pjTasks = rootTasks.filter(t => t.projectId === proj.id)
          const isCollapsed = collapsedPj.has(proj.id)
          const doneCount = pjTasks.filter(t => t.status === '완료').length
          return (
            <div key={proj.id} style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r4)', overflow: 'hidden', minWidth: 860 }}>
              {/* Project header */}
              <div
                onClick={() => togglePj(proj.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg2)', borderBottom: isCollapsed ? 'none' : '1px solid var(--bd)', cursor: 'pointer', borderLeft: `4px solid ${proj.color}` }}
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: proj.color, flexShrink: 0 }} />
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)', flex: 1 }}>{proj.name}</span>
                <span style={{ fontSize: 11, color: 'var(--t3)', background: 'var(--bg3)', borderRadius: 10, padding: '2px 8px' }}>{doneCount}/{pjTasks.length} 완료</span>
                <span style={{ fontSize: 10, color: 'var(--t3)' }}>{isCollapsed ? '▶' : '▼'}</span>
              </div>
              {!isCollapsed && (
                <>
                  {colHeader}
                  {pjMilestones.length > 0
                    ? renderMilestoneGroups(pjTasks, pjMilestones, (msId) => openTaskModal(undefined, undefined, msId))
                    : renderRows(pjTasks, pjMilestones)
                  }
                  {addBtn()}
                </>
              )}
            </div>
          )
        })}

        {unassignedTasks.length > 0 && (
          <div style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r4)', overflow: 'hidden', minWidth: 860 }}>
            <div
              onClick={() => togglePj('__no_project__')}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg2)', borderBottom: collapsedPj.has('__no_project__') ? 'none' : '1px solid var(--bd)', cursor: 'pointer', borderLeft: '4px solid var(--bd)' }}
            >
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--t2)', flex: 1 }}>프로젝트 미배정</span>
              <span style={{ fontSize: 11, color: 'var(--t3)', background: 'var(--bg3)', borderRadius: 10, padding: '2px 8px' }}>{unassignedTasks.length}개</span>
              <span style={{ fontSize: 10, color: 'var(--t3)' }}>{collapsedPj.has('__no_project__') ? '▶' : '▼'}</span>
            </div>
            {!collapsedPj.has('__no_project__') && (
              <>
                {colHeader}
                {renderRows(unassignedTasks, [])}
                {addBtn()}
              </>
            )}
          </div>
        )}
        {ctx}
      </div>
    )
  }

  // ── Single-project mode ───────────────────────────────────────────────────
  const pjMilestones = milestones
    .filter(m => m.projectId === projectId)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
      <div style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r4)', overflow: 'hidden', minWidth: 860 }}>
        {colHeader}
        {pjMilestones.length > 0
          ? renderMilestoneGroups(rootTasks, pjMilestones, (msId) => openTaskModal(undefined, undefined, msId))
          : renderRows(rootTasks, [])
        }
        {addBtn()}
      </div>
      {ctx}
    </div>
  )
}

// ── MilestoneHeader (Jira-style section header) ───────────────────────────────

function MilestoneHeader({ milestone, taskCount, completed, diff, collapsed, onToggle, onAddTask, onUpdate }: {
  milestone: Milestone; taskCount: number; completed: number; diff: number
  collapsed: boolean; onToggle: () => void; onAddTask: () => void
  onUpdate: (patch: Partial<Omit<Milestone, 'id'>>) => void
}) {
  const [hovered, setHovered] = React.useState(false)
  const [editingName, setEditingName] = React.useState(false)
  const [editingDate, setEditingDate] = React.useState(false)
  const [tempName, setTempName] = React.useState(milestone.name)
  const [tempDate, setTempDate] = React.useState(milestone.dueDate)
  const overdue = diff < 0
  const close = diff >= 0 && diff <= 7
  const accent = overdue ? '#ef4444' : close ? '#f59e0b' : '#8b5cf6'
  const progress = taskCount ? Math.round(completed / taskCount * 100) : 0

  const saveName = () => { if (tempName.trim()) onUpdate({ name: tempName.trim() }); setEditingName(false) }
  const saveDate = () => { if (tempDate) onUpdate({ dueDate: tempDate }); setEditingDate(false) }

  const inlineInput: React.CSSProperties = {
    fontSize: 12, padding: '1px 6px', borderRadius: 'var(--r1)',
    border: '1px solid var(--bd)', background: 'var(--bg)', color: 'var(--t1)',
    outline: 'none', fontFamily: 'var(--font)',
  }

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

      {/* Editable name */}
      {editingName ? (
        <input
          autoFocus
          value={tempName}
          onChange={e => setTempName(e.target.value)}
          onBlur={saveName}
          onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setTempName(milestone.name); setEditingName(false) } }}
          onClick={e => e.stopPropagation()}
          style={{ ...inlineInput, fontSize: 13, fontWeight: 600, width: 160 }}
        />
      ) : (
        <span
          onClick={e => { e.stopPropagation(); setTempName(milestone.name); setEditingName(true) }}
          title="클릭해서 이름 수정"
          style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)', cursor: 'text', borderBottom: '1px solid transparent', transition: 'border-color .1s' }}
          onMouseEnter={e => e.currentTarget.style.borderBottomColor = 'var(--bd)'}
          onMouseLeave={e => e.currentTarget.style.borderBottomColor = 'transparent'}
        >
          {milestone.name}
        </span>
      )}

      {/* Editable date */}
      {editingDate ? (
        <input
          autoFocus
          type="date"
          value={tempDate}
          onChange={e => setTempDate(e.target.value)}
          onBlur={saveDate}
          onKeyDown={e => { if (e.key === 'Enter') saveDate(); if (e.key === 'Escape') { setTempDate(milestone.dueDate); setEditingDate(false) } }}
          onClick={e => e.stopPropagation()}
          style={{ ...inlineInput, colorScheme: 'dark' }}
        />
      ) : (
        <span
          onClick={e => { e.stopPropagation(); setTempDate(milestone.dueDate); setEditingDate(true) }}
          title="클릭해서 날짜 수정"
          style={{ fontSize: 11, color: 'var(--t3)', cursor: 'pointer', borderBottom: '1px dashed transparent', transition: 'border-color .1s' }}
          onMouseEnter={e => e.currentTarget.style.borderBottomColor = 'var(--bd)'}
          onMouseLeave={e => e.currentTarget.style.borderBottomColor = 'transparent'}
        >
          {milestone.dueDate}
        </span>
      )}

      {!editingDate && (
        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 'var(--r1)', flexShrink: 0, background: overdue ? 'rgba(239,68,68,.1)' : close ? 'rgba(245,158,11,.1)' : 'rgba(139,92,246,.1)', color: accent }}>
          {overdue ? `D+${Math.abs(diff)}` : `D-${diff}`}
        </span>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4, flexShrink: 0 }}>
        <div style={{ width: 72, height: 4, background: 'var(--bd)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progress}%`, background: accent, borderRadius: 2, transition: 'width .3s' }} />
        </div>
        <span style={{ fontSize: 11, color: 'var(--t3)', whiteSpace: 'nowrap' }}>{completed}/{taskCount} 완료</span>
      </div>

      {!editingName && !editingDate && (
        <button
          onClick={e => { e.stopPropagation(); onAddTask() }}
          style={{ marginLeft: 'auto', padding: '3px 8px', fontSize: 11, borderRadius: 'var(--r1)', border: `1px solid ${accent}`, background: 'transparent', color: accent, cursor: 'pointer', fontFamily: 'var(--font)', flexShrink: 0, opacity: hovered ? 1 : 0, pointerEvents: hovered ? 'auto' : 'none', transition: 'opacity .12s' }}
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
      <button
        onClick={e => { e.stopPropagation(); onAddTask() }}
        style={{ marginLeft: 'auto', padding: '3px 8px', fontSize: 11, borderRadius: 'var(--r1)', border: '1px solid var(--bd)', background: 'transparent', color: 'var(--t2)', cursor: 'pointer', fontFamily: 'var(--font)', flexShrink: 0, opacity: hovered ? 1 : 0, pointerEvents: hovered ? 'auto' : 'none', transition: 'opacity .12s' }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        + 업무
      </button>
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
  task, isChild = false,
  hasChildren = false, isExpanded = true,
  childCount = 0, doneCount = 0,
  milestones = [], showMilestonePicker = false,
  onToggle, onOpen, onUpdate, onMilestoneChange, onContextMenu,
}: {
  task: Task; isChild?: boolean
  hasChildren?: boolean; isExpanded?: boolean; childCount?: number; doneCount?: number
  milestones?: Milestone[]; showMilestonePicker?: boolean
  onToggle?: () => void; onOpen: () => void
  onUpdate: (patch: Partial<Task>) => void
  onMilestoneChange?: (id: string | undefined) => void
  onContextMenu?: (e: React.MouseEvent) => void
}) {
  const [hovered, setHovered] = React.useState(false)
  const [editing, setEditing] = React.useState<string | null>(null)
  const overdue = isOverdue(task.due, task.status)

  const stopEdit = () => setEditing(null)
  // e.detail >= 2 means this click is part of a double-click — let it bubble to onDoubleClick
  const startEdit = (cell: string) => (e: React.MouseEvent) => {
    if (e.detail >= 2) return
    e.stopPropagation()
    setEditing(cell)
  }

  return (
    <div
      onDoubleClick={() => { stopEdit(); onOpen() }}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        background: hovered ? 'var(--bg3)' : (isChild ? 'var(--bg)' : 'transparent'),
        borderBottom: `1px solid var(--bd)`,
        borderLeft: isChild
          ? `3px solid ${hovered ? 'var(--ac)' : 'var(--bd2)'}`
          : `3px solid ${hovered ? 'var(--ac)' : 'transparent'}`,
        transition: 'background .08s',
        opacity: task.status === '완료' ? .55 : 1,
      }}
    >
      {/* 업무명 */}
      <div style={{ flex: 3.5, padding: '8px 12px 8px 40px', display: 'flex', alignItems: 'center', gap: 5, minHeight: 44, overflow: 'hidden', borderRight: '1px solid var(--bd)' }}>
        {isChild ? (
          <div style={{ width: 28, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', paddingLeft: 20 }}>
            <span style={{ fontSize: 11, color: 'var(--t3)', lineHeight: 1 }}>└</span>
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

        {editing === 'name' ? (
          <InlineTextEdit
            value={task.name}
            onCommit={v => { onUpdate({ name: v }); stopEdit() }}
            onCancel={stopEdit}
            fontSize={14}
            bold={!isChild && hasChildren}
          />
        ) : (
          <span
            onClick={startEdit('name')}
            style={{ fontSize: 14, fontWeight: !isChild && hasChildren ? 500 : 400, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--t1)', cursor: 'text' }}
          >
            {task.name}
          </span>
        )}

        {hasChildren && !isExpanded && (
          <span style={{ fontSize: 10, color: 'var(--t3)', background: 'var(--bg4)', borderRadius: 10, padding: '1px 6px', flexShrink: 0 }}>
            {doneCount}/{childCount}
          </span>
        )}

        {task.tags && task.tags.length > 0 && (
          <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
            {task.tags.slice(0, 3).map(tag => <TagBadge key={tag} tag={tag} />)}
            {task.tags.length > 3 && <span style={{ fontSize: 10, color: 'var(--t3)', alignSelf: 'center' }}>+{task.tags.length - 3}</span>}
          </div>
        )}

        {(task.blockedBy?.length || task.blocking?.length) ? (
          <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
            {!!task.blockedBy?.length && <span title={`선행 태스크 ${task.blockedBy.length}개`} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'rgba(239,68,68,.1)', color: '#ef4444', lineHeight: 1.6 }}>⛔ {task.blockedBy.length}</span>}
            {!!task.blocking?.length && <span title={`후행 태스크 ${task.blocking.length}개`} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'rgba(245,158,11,.1)', color: '#f59e0b', lineHeight: 1.6 }}>⚡ {task.blocking.length}</span>}
          </div>
        ) : null}

        {showMilestonePicker && (hovered || task.milestoneId) && onMilestoneChange && (
          <MilestonePicker milestoneId={task.milestoneId} milestones={milestones} onChange={onMilestoneChange} />
        )}
      </div>

      {/* 스페이스 */}
      <Cell flex={1.2}>{task.cat ? <CategoryBadge cat={task.cat} /> : <Dash />}</Cell>
      {/* 담당자 */}
      <Cell flex={1.2}><AssigneeGroup assignee={task.assignee} size={20} /></Cell>
      {/* 상태 — select stays inline always */}
      <Cell flex={1}>
        <select
          value={task.status}
          onClick={e => e.stopPropagation()}
          onChange={e => onUpdate({ status: e.target.value as Status })}
          style={{ border: 'none', background: 'transparent', fontSize: 13, cursor: 'pointer', outline: 'none', color: 'var(--t2)', fontFamily: 'var(--font)', appearance: 'none', width: '100%' }}
        >
          <option>진행중</option><option>대기</option><option>검토중</option><option>완료</option>
        </select>
      </Cell>
      {/* 마감일 */}
      <Cell flex={0.9} onClick={startEdit('due')}>
        {editing === 'due' ? (
          <input autoFocus type="date" value={task.due || ''}
            onChange={e => { onUpdate({ due: e.target.value }); stopEdit() }}
            onBlur={stopEdit}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => { if (e.key === 'Escape') stopEdit() }}
            style={{ border: 'none', outline: '1px solid var(--ac)', borderRadius: 3, background: 'var(--bg)', fontSize: 12, fontFamily: 'var(--font)', color: 'var(--t1)', width: '100%', padding: '2px 4px' }}
          />
        ) : (
          <span style={{ fontSize: 13, color: overdue ? '#ef4444' : task.due ? 'var(--t2)' : 'var(--t3)', fontWeight: overdue ? 500 : 400, cursor: 'pointer' }}>
            {task.due ? (overdue ? '⚠ ' : '') + fmtDate(task.due) : '날짜 추가'}
          </span>
        )}
      </Cell>
      {/* 우선순위 */}
      <Cell flex={0.8} onClick={startEdit('priority')}>
        {editing === 'priority' ? (
          <select autoFocus value={task.priority}
            onChange={e => { onUpdate({ priority: e.target.value as Priority }); stopEdit() }}
            onBlur={stopEdit}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => { if (e.key === 'Escape') stopEdit() }}
            style={{ border: 'none', outline: '1px solid var(--ac)', borderRadius: 3, background: 'var(--bg)', fontSize: 12, fontFamily: 'var(--font)', color: 'var(--t1)', width: '100%', padding: '2px 4px' }}
          >
            <option value="높음">높음</option>
            <option value="중간">중간</option>
            <option value="낮음">낮음</option>
          </select>
        ) : (
          <span style={{ cursor: 'pointer' }}><PriorityBadge priority={task.priority} /></span>
        )}
      </Cell>
      {/* 진행률 */}
      <Cell flex={1.2}><ProgressBar value={task.progress} /></Cell>
      {/* 메모 */}
      <Cell flex={1.8} last onClick={startEdit('memo')}>
        {editing === 'memo' ? (
          <InlineTextEdit
            value={task.memo || ''}
            onCommit={v => { onUpdate({ memo: v }); stopEdit() }}
            onCancel={stopEdit}
            fontSize={13}
          />
        ) : (
          <span style={{ fontSize: 13, color: task.memo ? 'var(--t2)' : 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text', width: '100%' }}>
            {task.memo || '메모 추가...'}
          </span>
        )}
      </Cell>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Cell({ children, flex, last, onClick }: { children?: React.ReactNode; flex: number; last?: boolean; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <div onClick={onClick} style={{ flex, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 4, minHeight: 44, overflow: 'hidden', borderRight: last ? 'none' : '1px solid var(--bd)' }}>
      {children}
    </div>
  )
}

function Dash() {
  return <span style={{ color: 'var(--t3)', fontSize: 12 }}>—</span>
}

function InlineTextEdit({ value, onCommit, onCancel, fontSize = 13, bold = false }: {
  value: string; onCommit: (v: string) => void; onCancel: () => void; fontSize?: number; bold?: boolean
}) {
  const [v, setV] = React.useState(value)
  return (
    <input
      autoFocus
      value={v}
      onChange={e => setV(e.target.value)}
      onBlur={() => onCommit(v)}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); onCommit(v) }
        if (e.key === 'Escape') { e.preventDefault(); onCancel() }
      }}
      onClick={e => e.stopPropagation()}
      style={{ flex: 1, width: '100%', border: 'none', outline: '1.5px solid var(--ac)', borderRadius: 3, background: 'var(--bg)', padding: '2px 6px', fontFamily: 'var(--font)', fontSize, fontWeight: bold ? 500 : 400, color: 'var(--t1)' }}
    />
  )
}
