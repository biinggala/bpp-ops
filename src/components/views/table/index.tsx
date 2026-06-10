import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useFilteredTasks } from '../../../hooks/useFilteredTasks'
import { useAccessibleTasks } from '../../../hooks/useAccessibleTasks'
import { useTaskStore } from '../../../store/taskStore'
import { useUiStore } from '../../../store/uiStore'
import { useMilestoneStore } from '../../../store/milestoneStore'
import { useProjectStore } from '../../../store/projectStore'
import { useUserProfileStore } from '../../../store/userProfileStore'
import { useAuthStore } from '../../../store/authStore'
import { useMobile } from '../../../hooks/useMobile'
import { TagBadge } from '../../shared/Badge'
import { AssigneeAvatar } from '../../shared/Avatar'
import { ProgressBar } from '../../shared/ProgressBar'
import { ContextMenu } from '../../shared/ContextMenu'
import { fmtDate, isOverdue, parseAssignees, stripHtml, gid, canAccessProject } from '../../../lib/utils'
import type { Task, Milestone, Status, Priority, TaskLink } from '../../../types'

// ── Column config ─────────────────────────────────────────────────────────────

type ColDef = { key: string; label: string; width: number }

const MIN_COL_WIDTH = 60
const COL_STORAGE_KEY = 'cringe_table_cols_v1'

const DEFAULT_COLS: ColDef[] = [
  { key: 'name',     label: '업무',    width: 300 },
  { key: 'tags',     label: '태그',    width: 160 },
  { key: 'links',    label: '링크',    width: 140 },
  { key: 'assignee', label: '담당자',  width: 140 },
  { key: 'status',   label: '상태',    width: 110 },
  { key: 'due',      label: '마감일',  width: 100 },
  { key: 'priority', label: '우선순위', width: 100 },
  { key: 'progress', label: '진행률',  width: 120 },
  { key: 'memo',     label: '메모',    width: 180 },
]

function loadCols(): ColDef[] {
  try {
    const raw = localStorage.getItem(COL_STORAGE_KEY)
    if (raw) {
      const saved: ColDef[] = JSON.parse(raw)
      const defMap = new Map(DEFAULT_COLS.map(d => [d.key, d]))
      const merged = saved
        .filter(s => defMap.has(s.key))
        .map(s => ({ ...defMap.get(s.key)!, width: Math.max(MIN_COL_WIDTH, s.width) }))
      DEFAULT_COLS.forEach(d => { if (!merged.find(m => m.key === d.key)) merged.push(d) })
      return merged
    }
  } catch { /* ignore */ }
  return [...DEFAULT_COLS]
}

// ── Status / Priority styling ─────────────────────────────────────────────────

const STATUS_STYLE: Record<Status, { bg: string; color: string }> = {
  '진행중': { bg: 'rgba(35,131,226,.15)', color: '#1869c9' },
  '대기':   { bg: 'rgba(120,117,114,.14)', color: '#5a5857' },
  '검토중': { bg: '#fef3c7',              color: '#b45309' },
  '완료':   { bg: '#d1fae5',              color: '#047857' },
}
const PRIORITY_STYLE: Record<Priority, { bg: string; color: string }> = {
  '높음': { bg: 'rgba(239,68,68,.13)',  color: '#dc2626' },
  '중간': { bg: 'rgba(245,158,11,.14)', color: '#b45309' },
  '낮음': { bg: 'rgba(59,130,246,.13)', color: '#1d4ed8' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysFrom(dateStr: string, base: Date) {
  return Math.round((new Date(dateStr).setHours(0, 0, 0, 0) - base.getTime()) / 86400000)
}
type CtxState = { x: number; y: number; task: Task } | null
type MsCtxState = { x: number; y: number; onAdd: () => void } | null

// ── MobileTableView ───────────────────────────────────────────────────────────

function MobileTableView() {
  const filteredTasks = useFilteredTasks()
  const allTasks = useTaskStore(s => s.tasks)
  const { addTask, updateTask, deleteTask } = useTaskStore()
  const { openTaskModal: _openTaskModal, openTaskDetail, projectId, hideCompleted } = useUiStore()
  const { milestones, updateMilestone } = useMilestoneStore()
  const projects = useProjectStore(s => s.projects)
  const userEmail = useAuthStore(s => s.email)

  const rootTasks = filteredTasks.filter(t => !t.parentId)
  const getChildren = (id: string) => allTasks.filter(t => t.parentId === id && (!hideCompleted || t.status !== '완료'))
  const sortDoneLast = (arr: Task[]) =>
    [...arr].sort((a, b) => (a.status === '완료' ? 1 : 0) - (b.status === '완료' ? 1 : 0))

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [collapsedMs, setCollapsedMs] = useState<Set<string>>(new Set())
  const [collapsedPj, setCollapsedPj] = useState<Set<string>>(new Set())

  const [mobCtxMenu, setMobCtxMenu] = useState<{ x: number; y: number; task: Task } | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressActive = useRef(false)

  const toggle = (id: string) =>
    setCollapsed(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleMs = (id: string) =>
    setCollapsedMs(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const togglePj = (id: string) =>
    setCollapsedPj(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  const renderTask = (task: Task, isChild = false): React.ReactNode => {
    const isDone = task.status === '완료'
    const overdue = isOverdue(task.due, task.status)
    const children = getChildren(task.id)
    const hasChildren = children.length > 0
    const isExpanded = !collapsed.has(task.id)
    const st = STATUS_STYLE[task.status]
    const handleTouchStart = (e: React.TouchEvent) => {
      const touch = e.touches[0]
      const startX = touch.clientX
      const startY = touch.clientY
      longPressActive.current = false
      longPressTimer.current = setTimeout(() => {
        longPressActive.current = true
        // Vibrate feedback if available
        if (navigator.vibrate) navigator.vibrate(30)
        setMobCtxMenu({ x: startX, y: startY, task })
      }, 500)
    }
    const handleTouchMove = (e: React.TouchEvent) => {
      if (!longPressTimer.current) return
      const touch = e.touches[0]
      const dx = touch.clientX - (e.currentTarget.getBoundingClientRect().left)
      const dy = touch.clientY - (e.currentTarget.getBoundingClientRect().top)
      // Cancel long press if finger moved significantly (allow scroll)
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        clearTimeout(longPressTimer.current)
        longPressTimer.current = null
      }
    }
    const handleTouchEnd = () => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null } }
    return (
      <React.Fragment key={task.id}>
        <div
          className="lp-row"
          draggable={false}
          onClick={() => { if (longPressActive.current) { longPressActive.current = false; return }; openTaskDetail(task.id) }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchMove}
          onDragStart={e => e.preventDefault()}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            paddingTop: 12, paddingBottom: 12,
            paddingLeft: isChild ? 44 : hasChildren ? 12 : 16, paddingRight: 16,
            borderBottom: '1px solid var(--bd)',
            borderLeft: isChild ? '2px solid var(--bd2)' : '2px solid transparent',
            cursor: 'pointer', userSelect: 'none',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            WebkitTouchCallout: 'none' as any,
            opacity: isDone ? 0.55 : 1,
          }}
        >
          {!isChild && hasChildren && (
            <button
              onClick={e => { e.stopPropagation(); toggle(task.id) }}
              style={{ width: 20, height: 20, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--t3)', fontSize: 10, padding: 0 }}
            >{isExpanded ? '▼' : '▶'}</button>
          )}
          {isChild && <span style={{ fontSize: 11, color: 'var(--t3)', flexShrink: 0 }}>└</span>}
          <span style={{ flex: 1, fontSize: 14, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: isDone ? 'line-through' : 'none' }}>
            {task.name}
          </span>
          {task.due && !isDone && (
            <span style={{ fontSize: 11, color: overdue ? '#ef4444' : 'var(--t3)', flexShrink: 0, marginRight: 6 }}>
              {overdue ? '⚠ ' : ''}{fmtDate(task.due)}
            </span>
          )}
          <span style={{ fontSize: 11, fontWeight: 500, flexShrink: 0, padding: '2px 8px', borderRadius: 10, background: st.bg, color: st.color, whiteSpace: 'nowrap' }}>
            {task.status}
          </span>
          {!isDone && (
            <button
              onClick={e => { e.stopPropagation(); const child = addTask({ type: '세부', cat: task.cat, name: '새 하위 업무', assignee: '', start: '', due: '', priority: '중간', status: '대기', progress: 0, memo: '', parentId: task.id, projectId: task.projectId, milestoneId: task.milestoneId, createdBy: userEmail ?? undefined }); openTaskDetail(child.id) }}
              style={{ width: 26, height: 26, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--t3)', fontSize: 18, padding: 0, lineHeight: 1 }}
            >⊕</button>
          )}
          <span style={{ fontSize: 16, color: 'var(--t3)', marginLeft: isDone ? 4 : 0, flexShrink: 0 }}>›</span>
        </div>
        {hasChildren && isExpanded && sortDoneLast(children).map(c => renderTask(c, true))}
      </React.Fragment>
    )
  }

  const renderMsGroups = (tasks: Task[], pjMilestones: Milestone[]) => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const grouped: Record<string, Task[]> = {}
    for (const ms of pjMilestones) grouped[ms.id] = []
    const unassigned: Task[] = []
    for (const task of tasks) {
      if (task.milestoneId && grouped[task.milestoneId] !== undefined) grouped[task.milestoneId].push(task)
      else unassigned.push(task)
    }
    const sortedMs = [...pjMilestones].sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0))
    return (
      <>
        {sortedMs.map(ms => {
          const msTasks = grouped[ms.id] ?? []
          const isCollapsed = collapsedMs.has(ms.id)
          const doneTasks = msTasks.filter(t => t.status === '완료').length
          const diff = daysFrom(ms.dueDate, today)
          const overdue = !ms.done && diff < 0
          const dLabel = overdue ? `D+${Math.abs(diff)}` : diff === 0 ? 'D-Day' : `D-${diff}`
          const dColor = ms.done ? 'var(--t3)' : overdue ? '#ef4444' : diff <= 7 ? '#f59e0b' : 'var(--t3)'
          const borderColor = ms.done ? 'var(--bd)' : '#8b5cf6'
          const d = new Date(ms.dueDate + 'T00:00:00')
          const dateLabel = `${d.getMonth() + 1}/${d.getDate()}`
          return (
            <React.Fragment key={ms.id}>
              <div
                onClick={() => toggleMs(ms.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'var(--bg2)', borderBottom: '1px solid var(--bd)', borderLeft: `2px solid ${borderColor}`, cursor: 'pointer', opacity: ms.done ? 0.6 : 1 }}
              >
                <button
                  onClick={e => { e.stopPropagation(); updateMilestone(ms.id, { done: !ms.done }) }}
                  style={{ width: 18, height: 18, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', border: ms.done ? '2px solid #22c55e' : '2px solid var(--bd2)', background: ms.done ? '#22c55e' : 'transparent', color: '#fff', fontSize: 10, cursor: 'pointer', padding: 0, transition: 'all .15s' }}
                >
                  {ms.done ? '✓' : ''}
                </button>
                <span style={{ fontSize: 10, color: ms.done ? 'var(--t3)' : '#8b5cf6' }}>◆</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--t1)', textDecoration: ms.done ? 'line-through' : 'none' }}>{ms.name}</span>
                {!ms.done && <span style={{ fontSize: 11, color: 'var(--t3)', marginRight: 2 }}>{dateLabel}</span>}
                {!ms.done && <span style={{ fontSize: 11, fontWeight: 600, color: dColor, background: overdue ? 'rgba(239,68,68,.08)' : diff <= 7 ? 'rgba(245,158,11,.1)' : 'var(--bg3)', borderRadius: 6, padding: '1px 6px', marginRight: 4 }}>{dLabel}</span>}
                <span style={{ fontSize: 11, color: 'var(--t3)', marginRight: 6 }}>{doneTasks}/{msTasks.length}</span>
                <span style={{ fontSize: 9, color: 'var(--t3)' }}>{isCollapsed ? '▶' : '▼'}</span>
              </div>
              {!isCollapsed && sortDoneLast(msTasks).map(t => renderTask(t))}
            </React.Fragment>
          )
        })}
        {unassigned.length > 0 && (
          <>
            {pjMilestones.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: 'var(--bg2)', borderBottom: '1px solid var(--bd)', borderLeft: '2px solid var(--bd)' }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--t2)' }}>마일스톤 미배정</span>
                <span style={{ fontSize: 11, color: 'var(--t3)', background: 'var(--bg3)', borderRadius: 8, padding: '1px 6px' }}>{unassigned.length}</span>
              </div>
            )}
            {sortDoneLast(unassigned).map(t => renderTask(t))}
          </>
        )}
      </>
    )
  }

  const addTaskBtn = (milestoneId?: string) => (
    <button
      onClick={() => _openTaskModal(undefined, undefined, milestoneId)}
      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', fontSize: 14, color: 'var(--ac)', background: 'transparent', border: 'none', borderTop: '1px solid var(--bd)', cursor: 'pointer', fontFamily: 'var(--font)' }}
    >
      <span style={{ fontSize: 20, lineHeight: 1 }}>+</span> 업무 추가
    </button>
  )

  const mobCtxMenuEl = mobCtxMenu && (
    <ContextMenu
      x={mobCtxMenu.x} y={mobCtxMenu.y} task={mobCtxMenu.task}
      onClose={() => setMobCtxMenu(null)}
      onEdit={() => { openTaskDetail(mobCtxMenu.task.id); setMobCtxMenu(null) }}
      onAddSubtask={() => {
        const parent = mobCtxMenu.task
        const child = addTask({ type: '세부', cat: parent.cat, name: '새 하위 업무', assignee: '', start: '', due: '', priority: '중간', status: '대기', progress: 0, memo: '', parentId: parent.id, projectId: parent.projectId, milestoneId: parent.milestoneId, createdBy: userEmail ?? undefined })
        openTaskDetail(child.id)
        setMobCtxMenu(null)
      }}
      onStatusChange={s => updateTask(mobCtxMenu.task.id, { status: s })}
      onDelete={() => deleteTask(mobCtxMenu.task.id)}
    />
  )

  // Multi-project mode
  if (!projectId) {
    const projectsWithTasks = projects.filter(p => rootTasks.some(t => t.projectId === p.id))
    const unassignedTasks = rootTasks.filter(t => !t.projectId || !projects.find(p => p.id === t.projectId))
    return (
      <>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {projectsWithTasks.map(proj => {
            const pjMilestones = milestones.filter(m => m.projectId === proj.id).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
            const pjTasks = rootTasks.filter(t => t.projectId === proj.id)
            const isCollapsed = collapsedPj.has(proj.id)
            const doneCount = pjTasks.filter(t => t.status === '완료').length
            return (
              <div key={proj.id} style={{ borderBottom: '8px solid var(--bg2)' }}>
                <div
                  onClick={() => togglePj(proj.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'var(--bg)', borderBottom: '1px solid var(--bd)', cursor: 'pointer', borderLeft: `3px solid ${proj.color}` }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: proj.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--t1)' }}>{proj.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--t3)', background: 'var(--bg3)', borderRadius: 10, padding: '2px 8px' }}>{doneCount}/{pjTasks.length}</span>
                  <span style={{ fontSize: 10, color: 'var(--t3)', marginLeft: 4 }}>{isCollapsed ? '▶' : '▼'}</span>
                </div>
                {!isCollapsed && (
                  <>
                    {pjMilestones.length > 0
                      ? renderMsGroups(pjTasks, pjMilestones)
                      : sortDoneLast(pjTasks).map(t => renderTask(t))}
                    {addTaskBtn()}
                  </>
                )}
              </div>
            )
          })}
          {unassignedTasks.length > 0 && (
            <>
              {sortDoneLast(unassignedTasks).map(t => renderTask(t))}
              {addTaskBtn()}
            </>
          )}
        </div>
        {mobCtxMenuEl}
      </>
    )
  }

  // Single-project mode
  const pjMilestones = milestones.filter(m => m.projectId === projectId).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  return (
    <>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {pjMilestones.length > 0
          ? renderMsGroups(rootTasks, pjMilestones)
          : sortDoneLast(rootTasks).map(t => renderTask(t))}
        {addTaskBtn()}
      </div>
      {mobCtxMenuEl}
    </>
  )
}

// ── TableView ─────────────────────────────────────────────────────────────────

export function TableView() {
  const filteredTasks = useFilteredTasks()
  const allTasks = useTaskStore(s => s.tasks)          // raw — only for task-tree traversal
  const accessibleTasks = useAccessibleTasks()          // for option lists (tags etc.)
  const { addTask, deleteTask, updateTask } = useTaskStore()
  const { openTaskModal, openTaskDetail, projectId, space, hideCompleted } = useUiStore()
  const { milestones, updateMilestone, deleteMilestone } = useMilestoneStore()
  const allProjects = useProjectStore(s => s.projects)
  const getNameByEmail = useUserProfileStore(s => s.getNameByEmail)
  const userEmail = useAuthStore(s => s.email)
  // Only projects the current user is a member of
  const projects = React.useMemo(() =>
    allProjects.filter(p => canAccessProject(p, userEmail))
  , [allProjects, userEmail])
  // Union of all accessible project members — used as fallback for assignee dropdowns
  const accessibleMemberEmails = React.useMemo(() => {
    const s = new Set<string>()
    projects.forEach(p => p.memberEmails?.forEach(e => s.add(e)))
    return Array.from(s)
  }, [projects])
  const isMobile = useMobile()

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [collapsedMs, setCollapsedMs] = useState<Set<string>>(new Set())
  const [collapsedPj, setCollapsedPj] = useState<Set<string>>(new Set())
  const [ctxMenu, setCtxMenu] = useState<CtxState>(null)
  const [msCtxMenu, setMsCtxMenu] = useState<MsCtxState>(null)
  const [addingMs, setAddingMs] = useState<string | null>(null)
  const [draftMsId, setDraftMsId] = useState<string | null>(null)
  const [draftSubtaskParentId, setDraftSubtaskParentId] = useState<string | null>(null)
  const today = React.useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])

  // ── Column state ────────────────────────────────────────────────────────────
  const [cols, setCols] = useState<ColDef[]>(loadCols)
  const [draggingCol, setDraggingCol] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null)
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)

  useEffect(() => {
    try { localStorage.setItem(COL_STORAGE_KEY, JSON.stringify(cols)) } catch { /* ignore */ }
  }, [cols])

  const handleResizeStart = useCallback((key: string, startX: number, startWidth: number, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    resizingRef.current = { key, startX, startWidth }
    const onMove = (ev: MouseEvent) => {
      const r = resizingRef.current
      if (!r) return
      const newW = Math.max(MIN_COL_WIDTH, r.startWidth + ev.clientX - r.startX)
      setCols(prev => prev.map(c => c.key === r.key ? { ...c, width: newW } : c))
    }
    const onUp = () => {
      resizingRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  const handleColDrop = useCallback((targetKey: string) => {
    if (!draggingCol || draggingCol === targetKey) { setDraggingCol(null); setDropTarget(null); return }
    setCols(prev => {
      const from = prev.findIndex(c => c.key === draggingCol)
      const to = prev.findIndex(c => c.key === targetKey)
      const next = [...prev]
      const [removed] = next.splice(from, 1)
      next.splice(to, 0, removed)
      return next
    })
    setDraggingCol(null)
    setDropTarget(null)
  }, [draggingCol])

  // ── Assignee options ────────────────────────────────────────────────────────
  const getAssigneeOptions = useCallback((pjId: string | undefined) => {
    const project = projects.find(p => p.id === pjId)
    const emails = project?.memberEmails ?? []
    if (emails.length > 0) return emails.map(e => ({ value: e, label: getNameByEmail(e) }))
    return accessibleMemberEmails.map(e => ({ value: e, label: getNameByEmail(e) }))
  }, [projects, accessibleMemberEmails, getNameByEmail])

  const allTags = React.useMemo(() => {
    const s = new Set<string>()
    accessibleTasks.forEach(t => t.tags?.forEach(tag => s.add(tag)))
    return Array.from(s).sort()
  }, [accessibleTasks])

  const totalColWidth = React.useMemo(() => cols.reduce((sum, c) => sum + c.width, 0), [cols])

  // ── Navigation helpers ──────────────────────────────────────────────────────
  const rootTasks = filteredTasks.filter(t => !t.parentId)
  const getChildren = (id: string) => allTasks.filter(t => t.parentId === id && (!hideCompleted || t.status !== '완료'))
  const toggle = (id: string) => setCollapsed(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleMs = (id: string) => setCollapsedMs(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const togglePj = (id: string) => setCollapsedPj(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const makeHandlers = (task: Task) => ({
    onOpen: () => openTaskDetail(task.id),
    onUpdate: (patch: Partial<Task>) => updateTask(task.id, patch),
    onMilestoneChange: (msId: string | undefined) => updateTask(task.id, { milestoneId: msId }),
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, task }) },
  })

  const canDropOnTask = useCallback((dragId: string, targetId: string) => {
    if (dragId === targetId) return false
    const target = allTasks.find(t => t.id === targetId)
    if (!target || target.parentId) return false
    const dragged = allTasks.find(t => t.id === dragId)
    if (dragged?.parentId === targetId) return false
    return true
  }, [allTasks])

  const handleTaskDrop = useCallback((targetId: string) => {
    if (!draggingTaskId || !canDropOnTask(draggingTaskId, targetId)) return
    updateTask(draggingTaskId, { parentId: targetId, type: '세부' })
    setDraggingTaskId(null)
    setDropTargetId(null)
  }, [draggingTaskId, canDropOnTask, updateTask])

  // ── Column header row ───────────────────────────────────────────────────────
  const colHeader = (
    <div style={{ display: 'flex', minWidth: '100%', background: 'var(--bg2)', borderBottom: '2px solid var(--bd)', borderLeft: '3px solid transparent', userSelect: 'none' }}>
      {cols.map((col, idx) => {
        const isLast = idx === cols.length - 1
        const isDragTarget = dropTarget === col.key && draggingCol !== col.key
        const isNameCol = col.key === 'name'
        return (
          <div
            key={col.key}
            draggable={!isNameCol}
            onDragStart={isNameCol ? undefined : e => { e.dataTransfer.effectAllowed = 'move'; setDraggingCol(col.key) }}
            onDragOver={isNameCol ? undefined : e => { e.preventDefault(); setDropTarget(col.key) }}
            onDragLeave={isNameCol ? undefined : () => setDropTarget(null)}
            onDrop={isNameCol ? undefined : () => handleColDrop(col.key)}
            onDragEnd={isNameCol ? undefined : () => { setDraggingCol(null); setDropTarget(null) }}
            style={{
              width: col.width, minWidth: col.width, maxWidth: col.width, flexShrink: 0,
              padding: '8px 12px', fontSize: 12, fontWeight: 600, color: 'var(--t3)',
              textTransform: 'uppercase' as const, letterSpacing: '.04em',
              borderRight: isLast ? 'none' : '1px solid var(--bd)',
              position: isNameCol ? 'sticky' : 'relative',
              left: isNameCol ? 0 : undefined,
              zIndex: isNameCol ? 3 : undefined,
              background: isNameCol ? 'var(--bg2)' : isDragTarget ? 'var(--ac-l)' : draggingCol === col.key ? 'var(--bg3)' : 'transparent',
              boxShadow: isNameCol ? '2px 0 4px rgba(0,0,0,.06)' : undefined,
              cursor: isNameCol ? 'default' : 'grab',
              transition: 'background .1s',
              display: 'flex', alignItems: 'center',
            }}
          >
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.label}</span>
            {/* Resize handle */}
            {!isLast && (
              <div
                onMouseDown={e => handleResizeStart(col.key, e.clientX, col.width, e)}
                draggable={false}
                style={{
                  position: 'absolute', right: 0, top: 0, bottom: 0, width: 6,
                  cursor: 'col-resize', zIndex: 1,
                  background: 'transparent',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--ac)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              />
            )}
          </div>
        )
      })}
      <div style={{ flex: 1 }} />
    </div>
  )

  // ── Row helpers ─────────────────────────────────────────────────────────────
  const sortDoneLast = (arr: Task[]) =>
    [...arr].sort((a, b) => (a.status === '완료' ? 1 : 0) - (b.status === '완료' ? 1 : 0))

  const renderRows = (tasks: Task[], pickerMilestones: Milestone[]) =>
    sortDoneLast(tasks).map(task => {
      const children = sortDoneLast(getChildren(task.id))
      const hasChildren = children.length > 0
      const isExpanded = !collapsed.has(task.id)
      const h = makeHandlers(task)
      const aOpts = getAssigneeOptions(task.projectId)
      return (
        <React.Fragment key={task.id}>
          <Row cols={cols} task={task} hasChildren={hasChildren} isExpanded={isExpanded}
            childCount={children.length} doneCount={children.filter(c => c.status === '완료').length}
            milestones={pickerMilestones} showMilestonePicker={pickerMilestones.length > 0}
            assigneeOptions={aOpts} allTags={allTags}
            onToggle={() => toggle(task.id)} {...h}
            isDragging={draggingTaskId === task.id}
            isDragTarget={dropTargetId === task.id && !!draggingTaskId && canDropOnTask(draggingTaskId, task.id)}
            canDrag={!hasChildren}
            canBeDropTarget={!task.parentId}
            onDragStart={() => setDraggingTaskId(task.id)}
            onDragEnd={() => { setDraggingTaskId(null); setDropTargetId(null) }}
            onDragOver={e => {
              if (!task.parentId && draggingTaskId && canDropOnTask(draggingTaskId, task.id)) {
                e.preventDefault(); setDropTargetId(task.id)
              }
            }}
            onDragLeave={() => setDropTargetId(prev => prev === task.id ? null : prev)}
            onDrop={() => handleTaskDrop(task.id)}
          />
          {hasChildren && isExpanded && children.map(child => {
            const ch = makeHandlers(child)
            const cOpts = getAssigneeOptions(child.projectId)
            return (
              <React.Fragment key={child.id}>
                <Row cols={cols} task={child} isChild
                  milestones={pickerMilestones} showMilestonePicker={pickerMilestones.length > 0}
                  assigneeOptions={cOpts} allTags={allTags}
                  {...ch}
                  isDragging={draggingTaskId === child.id}
                  isDragTarget={false}
                  canDrag={true}
                  canBeDropTarget={false}
                  onDragStart={() => setDraggingTaskId(child.id)}
                  onDragEnd={() => { setDraggingTaskId(null); setDropTargetId(null) }}
                />
                {draftSubtaskParentId === child.id && (
                  <AddTaskRow cols={cols} isSubtask parentId={child.id}
                    assigneeOptions={cOpts} projectId={child.projectId} milestoneId={child.milestoneId}
                    space={space ?? ''} addTask={addTask} userEmail={userEmail}
                    onDone={another => { if (!another) setDraftSubtaskParentId(null) }}
                    onCancel={() => setDraftSubtaskParentId(null)}
                  />
                )}
              </React.Fragment>
            )
          })}
          {draftSubtaskParentId === task.id && (
            <AddTaskRow cols={cols} isSubtask parentId={task.id}
              assigneeOptions={aOpts} projectId={task.projectId} milestoneId={task.milestoneId}
              space={space ?? ''} addTask={addTask} userEmail={userEmail}
              onDone={another => { if (!another) setDraftSubtaskParentId(null) }}
              onCancel={() => setDraftSubtaskParentId(null)}
            />
          )}
        </React.Fragment>
      )
    })

  const renderMilestoneGroups = (tasks: Task[], pjMilestones: Milestone[], onAdd: (msId?: string) => void) => {
    const pjId = pjMilestones[0]?.projectId
    const grouped: Record<string, Task[]> = {}
    for (const ms of pjMilestones) grouped[ms.id] = []
    const unassigned: Task[] = []
    for (const task of tasks) {
      if (task.milestoneId && grouped[task.milestoneId] !== undefined) grouped[task.milestoneId].push(task)
      else unassigned.push(task)
    }
    const sortedMs = [...pjMilestones].sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0))
    return (
      <>
        {sortedMs.map(ms => {
          const msTasks = grouped[ms.id] ?? []
          const isCollapsed = collapsedMs.has(ms.id)
          const diff = daysFrom(ms.dueDate, today)
          return (
            <React.Fragment key={ms.id}>
              <MilestoneHeader
                milestone={ms} taskCount={msTasks.length}
                completed={msTasks.filter(t => t.status === '완료').length}
                diff={diff} collapsed={isCollapsed}
                minWidth={totalColWidth}
                onToggle={() => toggleMs(ms.id)}
                onToggleDone={() => updateMilestone(ms.id, { done: !ms.done })}
                onAddTask={() => { setDraftMsId(ms.id) }}
                onUpdate={patch => updateMilestone(ms.id, patch)}
                onDelete={() => deleteMilestone(ms.id)}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMsCtxMenu({ x: e.clientX, y: e.clientY, onAdd: () => { if (collapsedMs.has(ms.id)) toggleMs(ms.id); setDraftMsId(ms.id) } }) }}
              />
              {!isCollapsed && renderRows(msTasks, pjMilestones)}
              {!isCollapsed && draftMsId === ms.id && (
                <AddTaskRow
                  cols={cols}
                  assigneeOptions={getAssigneeOptions(pjId)}
                  milestoneId={ms.id}
                  projectId={pjId}
                  space={space ?? ''}
                  addTask={addTask}
                  userEmail={userEmail}
                  onDone={(another) => { if (!another) setDraftMsId(null) }}
                  onCancel={() => setDraftMsId(null)}
                />
              )}
            </React.Fragment>
          )
        })}
        {unassigned.length > 0 && (
          <>
            <UnassignedHeader count={unassigned.length}
              collapsed={collapsedMs.has('__none__')}
              minWidth={totalColWidth}
              onToggle={() => toggleMs('__none__')}
              onAddTask={() => { setDraftMsId('__none__') }}
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMsCtxMenu({ x: e.clientX, y: e.clientY, onAdd: () => { if (collapsedMs.has('__none__')) toggleMs('__none__'); setDraftMsId('__none__') } }) }} />
            {!collapsedMs.has('__none__') && renderRows(unassigned, pjMilestones)}
            {!collapsedMs.has('__none__') && draftMsId === '__none__' && (
              <AddTaskRow
                cols={cols}
                assigneeOptions={getAssigneeOptions(pjId)}
                milestoneId={undefined}
                projectId={pjId}
                space={space ?? ''}
                addTask={addTask}
                userEmail={userEmail}
                onDone={(another) => { if (!another) setDraftMsId(null) }}
                onCancel={() => setDraftMsId(null)}
              />
            )}
          </>
        )}
      </>
    )
  }

  const addMsBtn = (pjId: string) => (
    <button
      onClick={() => setAddingMs(pjId)}
      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', fontSize: 12, color: '#8b5cf6', background: 'transparent', border: 'none', borderTop: '1px solid var(--bd)', cursor: 'pointer', fontFamily: 'var(--font)', textAlign: 'left', transition: 'background .1s' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(139,92,246,.05)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      <span style={{ fontSize: 9, lineHeight: 1 }}>◆</span> 마일스톤 추가
    </button>
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

  const ctx = ctxMenu && (
    <ContextMenu
      x={ctxMenu.x} y={ctxMenu.y} task={ctxMenu.task}
      onClose={() => setCtxMenu(null)}
      onEdit={() => { openTaskDetail(ctxMenu.task.id); setCtxMenu(null) }}
      onAddSubtask={() => {
        const parent = ctxMenu.task
        if (collapsed.has(parent.id)) toggle(parent.id)
        setDraftSubtaskParentId(parent.id)
        setCtxMenu(null)
      }}
      onStatusChange={s => updateTask(ctxMenu.task.id, { status: s })}
      onDelete={() => {
        if (!confirm('삭제할까요?')) return
        getChildren(ctxMenu.task.id).forEach(c => deleteTask(c.id))
        deleteTask(ctxMenu.task.id)
      }}
    />
  )
  const msCtx = msCtxMenu && (
    <MsContextMenu
      x={msCtxMenu.x} y={msCtxMenu.y}
      onAdd={msCtxMenu.onAdd}
      onClose={() => setMsCtxMenu(null)}
    />
  )

  if (isMobile) return <MobileTableView />

  // ── Multi-project mode ──────────────────────────────────────────────────────
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
            <div key={proj.id} style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r4)', overflow: 'clip' }}>
              {/* Project header – fixed, not scrollable */}
              <div
                onClick={() => togglePj(proj.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg2)', borderBottom: isCollapsed ? 'none' : '1px solid var(--bd)', cursor: 'pointer', borderLeft: `3px solid ${proj.color}` }}
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: proj.color, flexShrink: 0 }} />
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)', flex: 1 }}>{proj.name}</span>
                <span style={{ fontSize: 11, color: 'var(--t3)', background: 'var(--bg3)', borderRadius: 10, padding: '2px 8px' }}>{doneCount}/{pjTasks.length} 완료</span>
                <span style={{ fontSize: 10, color: 'var(--t3)' }}>{isCollapsed ? '▶' : '▼'}</span>
              </div>
              {!isCollapsed && (
                <>
                  {/* Scrollable area: column header + task rows only */}
                  <div style={{ overflowX: 'auto' }}>
                    {colHeader}
                    {pjMilestones.length > 0
                      ? renderMilestoneGroups(pjTasks, pjMilestones, (msId) => openTaskModal(undefined, undefined, msId))
                      : renderRows(pjTasks, pjMilestones)}
                  </div>
                  {/* Add buttons – fixed, not scrollable */}
                  {addingMs === proj.id
                    ? <AddMilestoneInline projectId={proj.id} onDone={() => setAddingMs(null)} />
                    : addMsBtn(proj.id)}
                  {addBtn()}
                </>
              )}
            </div>
          )
        })}
        {unassignedTasks.length > 0 && (
          <div style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r4)', overflow: 'clip' }}>
            {/* Unassigned header – fixed */}
            <div
              onClick={() => togglePj('__no_project__')}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg2)', borderBottom: collapsedPj.has('__no_project__') ? 'none' : '1px solid var(--bd)', cursor: 'pointer', borderLeft: '3px solid var(--bd)' }}
            >
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--t2)', flex: 1 }}>프로젝트 미배정</span>
              <span style={{ fontSize: 11, color: 'var(--t3)', background: 'var(--bg3)', borderRadius: 10, padding: '2px 8px' }}>{unassignedTasks.length}개</span>
              <span style={{ fontSize: 10, color: 'var(--t3)' }}>{collapsedPj.has('__no_project__') ? '▶' : '▼'}</span>
            </div>
            {!collapsedPj.has('__no_project__') && (
              <>
                <div style={{ overflowX: 'auto' }}>
                  {colHeader}
                  {renderRows(unassignedTasks, [])}
                </div>
                {addBtn()}
              </>
            )}
          </div>
        )}
        {ctx}
        {msCtx}
      </div>
    )
  }

  // ── Single-project mode ─────────────────────────────────────────────────────
  const pjMilestones = milestones.filter(m => m.projectId === projectId).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
      <div style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r4)', overflow: 'clip' }}>
        {/* Scrollable area: column header + task rows only */}
        <div style={{ overflowX: 'auto' }}>
          {colHeader}
          {pjMilestones.length > 0
            ? renderMilestoneGroups(rootTasks, pjMilestones, (msId) => openTaskModal(undefined, undefined, msId))
            : renderRows(rootTasks, [])}
        </div>
        {/* Add buttons – fixed, not scrollable */}
        {addingMs === projectId
          ? <AddMilestoneInline projectId={projectId!} onDone={() => setAddingMs(null)} />
          : addMsBtn(projectId!)}
        {addBtn()}
      </div>
      {ctx}
      {msCtx}
    </div>
  )
}

// ── Row ───────────────────────────────────────────────────────────────────────

function Row({
  cols, task, isChild = false,
  hasChildren = false, isExpanded = true,
  childCount = 0, doneCount = 0,
  milestones = [], showMilestonePicker = false,
  assigneeOptions = [],
  allTags = [],
  onToggle, onOpen, onUpdate, onMilestoneChange, onContextMenu,
  isDragging = false, isDragTarget = false,
  canDrag = false, canBeDropTarget = false,
  onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop,
}: {
  cols: ColDef[]
  task: Task; isChild?: boolean
  hasChildren?: boolean; isExpanded?: boolean; childCount?: number; doneCount?: number
  milestones?: Milestone[]; showMilestonePicker?: boolean
  assigneeOptions?: { value: string; label: string }[]
  allTags?: string[]
  onToggle?: () => void; onOpen: () => void
  onUpdate: (patch: Partial<Task>) => void
  onMilestoneChange?: (id: string | undefined) => void
  onContextMenu?: (e: React.MouseEvent) => void
  isDragging?: boolean; isDragTarget?: boolean
  canDrag?: boolean; canBeDropTarget?: boolean
  onDragStart?: () => void; onDragEnd?: () => void
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void
  onDragLeave?: () => void; onDrop?: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const overdue = isOverdue(task.due, task.status)

  const stopEdit = () => setEditing(null)
  const startEdit = (cell: string) => (e: React.MouseEvent) => {
    if (e.detail >= 2) return
    e.stopPropagation()
    setEditing(cell)
  }

  const isDone = task.status === '완료'

  const cellBase = (col: ColDef, isLast: boolean, applyDone = false): React.CSSProperties => ({
    width: col.width, minWidth: col.width, maxWidth: col.width, flexShrink: 0,
    padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 4,
    minHeight: 44, overflow: 'hidden',
    borderRight: isLast ? 'none' : '1px solid var(--bd)',
    ...(applyDone && isDone ? { opacity: 0.55 } : {}),
  })

  const renderCell = (col: ColDef, isLast: boolean) => {
    switch (col.key) {

      case 'name':
        // background stays fully opaque (covers scrolled content behind sticky cell);
        // content wrapper gets opacity for done tasks instead
        return (
          <div
            key="name"
            onDoubleClick={e => { e.stopPropagation(); stopEdit(); onOpen() }}
            style={{
              ...cellBase(col, isLast),
              paddingLeft: isChild ? 88 : 64,
              gap: 5,
              position: 'sticky',
              left: 0,
              zIndex: 2,
              background: hovered ? 'var(--bg2)' : 'var(--bg)',
              boxShadow: '2px 0 4px rgba(0,0,0,.06)',
            }}
          >
            {canDrag && (
              <span
                draggable
                onDragStart={e => {
                  e.stopPropagation()
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', task.id)
                  onDragStart?.()
                }}
                onDragEnd={e => { e.stopPropagation(); onDragEnd?.() }}
                style={{
                  position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                  cursor: 'grab', color: 'var(--t3)', fontSize: 12,
                  opacity: hovered ? 0.8 : 0, transition: 'opacity .1s',
                  userSelect: 'none', lineHeight: 1,
                }}
              >⠿</span>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1, minWidth: 0, opacity: isDone ? 0.55 : 1 }}>
              {isChild ? (
                <span style={{ fontSize: 11, color: 'var(--t3)', lineHeight: 1, flexShrink: 0 }}>└</span>
              ) : (
                <button
                  onClick={e => { e.stopPropagation(); onToggle?.() }}
                  style={{ width: 18, height: 18, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: hasChildren ? 'pointer' : 'default', borderRadius: 3, padding: 0, color: 'var(--t3)', fontSize: 9, visibility: hasChildren ? 'visible' : 'hidden', marginLeft: -22 }}
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
                <span style={{ fontSize: 10, color: 'var(--t3)', background: 'var(--bg4)', borderRadius: 10, padding: '1px 6px', flexShrink: 0 }}>{doneCount}/{childCount}</span>
              )}
              {task.tags && task.tags.length > 0 && (
                <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                  {task.tags.slice(0, 2).map(tag => <TagBadge key={tag} tag={tag} />)}
                  {task.tags.length > 2 && <span style={{ fontSize: 10, color: 'var(--t3)', alignSelf: 'center' }}>+{task.tags.length - 2}</span>}
                </div>
              )}
              {(task.blockedBy?.length || task.blocking?.length) ? (
                <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                  {!!task.blockedBy?.length && <span title={`선행 ${task.blockedBy.length}개`} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'rgba(239,68,68,.1)', color: '#ef4444', lineHeight: 1.6 }}>⛔ {task.blockedBy.length}</span>}
                  {!!task.blocking?.length && <span title={`후행 ${task.blocking.length}개`} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'rgba(245,158,11,.1)', color: '#f59e0b', lineHeight: 1.6 }}>⚡ {task.blocking.length}</span>}
                </div>
              ) : null}
              {showMilestonePicker && (hovered || task.milestoneId) && onMilestoneChange && (
                <MilestonePicker milestoneId={task.milestoneId} milestones={milestones} onChange={onMilestoneChange} />
              )}
            </div>
          </div>
        )

      case 'tags':
        return (
          <div key="tags" style={{ ...cellBase(col, isLast, true), padding: '4px 8px' }}>
            <TagMultiSelect
              tags={task.tags ?? []}
              allTags={allTags}
              onChange={v => onUpdate({ tags: v })}
            />
          </div>
        )

      case 'assignee':
        return (
          <div key="assignee" style={{ ...cellBase(col, isLast, true), padding: '4px 8px' }}>
            <AssigneeMultiSelect
              assignee={task.assignee}
              options={assigneeOptions}
              onChange={v => onUpdate({ assignee: v })}
            />
          </div>
        )

      case 'status':
        return (
          <div key="status" style={{ ...cellBase(col, isLast, true), padding: '6px 10px' }}>
            <ColoredSelect
              value={task.status}
              options={(['진행중','대기','검토중','완료'] as Status[])}
              styleMap={STATUS_STYLE}
              onChange={v => onUpdate({ status: v as Status })}
            />
          </div>
        )

      case 'due':
        return (
          <div key="due" style={cellBase(col, isLast, true)} onClick={startEdit('due')}>
            {editing === 'due' ? (
              <AutoDateInput
                value={task.due || ''}
                onChange={v => { onUpdate({ due: v }); stopEdit() }}
                onBlur={stopEdit}
                onEscape={stopEdit}
              />
            ) : (
              <span style={{ fontSize: 13, color: overdue ? '#ef4444' : task.due ? 'var(--t2)' : 'var(--t3)', fontWeight: overdue ? 500 : 400, cursor: 'pointer' }}>
                {task.due ? (overdue ? '⚠ ' : '') + fmtDate(task.due) : '—'}
              </span>
            )}
          </div>
        )

      case 'priority':
        return (
          <div key="priority" style={{ ...cellBase(col, isLast, true), padding: '6px 10px' }}>
            <ColoredSelect
              value={task.priority}
              options={(['높음','중간','낮음'] as Priority[])}
              styleMap={PRIORITY_STYLE}
              onChange={v => onUpdate({ priority: v as Priority })}
            />
          </div>
        )

      case 'progress':
        return (
          <div key="progress" style={cellBase(col, isLast, true)}>
            <ProgressBar value={task.progress} />
          </div>
        )

      case 'memo':
        return (
          <div key="memo" style={cellBase(col, isLast, true)} onClick={startEdit('memo')}>
            {editing === 'memo' ? (
              <InlineTextEdit
                value={task.memo || ''}
                onCommit={v => { onUpdate({ memo: v }); stopEdit() }}
                onCancel={stopEdit}
                fontSize={13}
              />
            ) : (
              <span style={{ fontSize: 13, color: task.memo ? 'var(--t2)' : 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text', width: '100%' }}>
                {task.memo ? stripHtml(task.memo) : '—'}
              </span>
            )}
          </div>
        )

      case 'links':
        return (
          <div key="links" style={{ ...cellBase(col, isLast, true), padding: '4px 8px' }}>
            <LinksCell
              links={task.links ?? []}
              onChange={v => onUpdate({ links: v })}
            />
          </div>
        )

      default:
        return <div key={col.key} style={cellBase(col, isLast, true)} />
    }
  }

  return (
    <div
      onDoubleClick={() => { stopEdit(); onOpen() }}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDragOver={onDragOver}
      onDragLeave={e => {
        const row = e.currentTarget
        if (e.relatedTarget && row.contains(e.relatedTarget as Node)) return
        onDragLeave?.()
      }}
      onDrop={e => { e.preventDefault(); onDrop?.() }}
      style={{
        display: 'flex',
        minWidth: '100%',
        opacity: isDragging ? 0.4 : 1,
        background: isDragTarget
          ? 'var(--ac-l)'
          : hovered ? 'var(--bg3)' : (isChild ? 'var(--bg)' : 'transparent'),
        borderBottom: '1px solid var(--bd)',
        borderLeft: isDragTarget
          ? '3px solid var(--ac)'
          : isChild
            ? `3px solid ${hovered ? 'var(--ac)' : 'var(--bd2)'}`
            : `3px solid ${hovered ? 'var(--ac)' : 'transparent'}`,
        transition: 'background .08s, opacity .08s',
      }}
    >
      {cols.map((col, idx) => renderCell(col, idx === cols.length - 1))}
      <div style={{ flex: 1 }} />
    </div>
  )
}

// ── ColoredSelect — colored badge with overlaid native select ─────────────────

function ColoredSelect<T extends string>({ value, options, styleMap, onChange }: {
  value: T
  options: T[]
  styleMap: Record<T, { bg: string; color: string }>
  onChange: (v: string) => void
}) {
  const s = styleMap[value] ?? { bg: 'var(--bg3)', color: 'var(--t2)' }
  return (
    <div style={{ position: 'relative', display: 'inline-flex' }} onClick={e => e.stopPropagation()}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '3px 10px', borderRadius: 12,
        background: s.bg, color: s.color,
        fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', lineHeight: 1.6,
        pointerEvents: 'none',
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
        {value}
        <span style={{ fontSize: 9, opacity: .6 }}>▾</span>
      </span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%',
          fontFamily: 'var(--font)',
        }}
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

// ── AssigneeMultiSelect ───────────────────────────────────────────────────────

function AssigneeMultiSelect({ assignee, options, onChange }: {
  assignee: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLDivElement>(null)
  const selected = parseAssignees(assignee)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (open) { setOpen(false); return }
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left })
    }
    setOpen(true)
  }

  const toggle = (value: string) => {
    const next = selected.includes(value)
      ? selected.filter(s => s !== value)
      : [...selected, value]
    onChange(next.join(','))
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', alignItems: 'center', width: '100%' }}>
      <div
        ref={btnRef}
        onClick={handleOpen}
        style={{ display: 'flex', alignItems: 'center', gap: 2, cursor: 'pointer', minWidth: 0 }}
      >
        {selected.length === 0 ? (
          <span style={{ fontSize: 12, color: 'var(--t3)' }}>—</span>
        ) : (
          selected.map((k, i) => (
            <span key={k} style={{ marginLeft: i > 0 ? -6 : 0, position: 'relative', zIndex: 1 - i }}>
              <AssigneeAvatar assigneeKey={k} size={22} />
            </span>
          ))
        )}
        {options.length > 0 && (
          <span style={{ fontSize: 9, color: 'var(--t3)', marginLeft: 4, opacity: .7 }}>▾</span>
        )}
      </div>

      {open && (
        <div style={{
          position: 'fixed', top: pos.top, left: pos.left, zIndex: 9000,
          background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r3)',
          boxShadow: 'var(--sh-md)', padding: '4px 0', minWidth: 180, maxHeight: 280, overflowY: 'auto',
        }}>
          {options.length === 0 ? (
            <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--t3)' }}>멤버가 없습니다</div>
          ) : (
            <>
              {selected.length > 0 && (
                <div
                  onMouseDown={e => { e.preventDefault(); onChange('') }}
                  style={{ padding: '6px 12px', fontSize: 12, color: 'var(--t3)', cursor: 'pointer', borderBottom: '1px solid var(--bd)', transition: 'background .07s' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  미배정으로 초기화
                </div>
              )}
              {options.map(opt => {
                const isOn = selected.includes(opt.value)
                return (
                  <div
                    key={opt.value}
                    onMouseDown={e => { e.preventDefault(); toggle(opt.value) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '7px 12px', cursor: 'pointer', fontSize: 13,
                      background: isOn ? 'rgba(35,131,226,.07)' : 'transparent',
                      transition: 'background .07s',
                    }}
                    onMouseEnter={e => { if (!isOn) e.currentTarget.style.background = 'var(--bg3)' }}
                    onMouseLeave={e => { if (!isOn) e.currentTarget.style.background = 'transparent' }}
                  >
                    <span style={{ width: 14, height: 14, border: `2px solid ${isOn ? 'var(--ac)' : 'var(--bd2)'}`, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: isOn ? 'var(--ac)' : 'transparent', transition: 'all .1s' }}>
                      {isOn && <span style={{ color: '#fff', fontSize: 9, lineHeight: 1, fontWeight: 700 }}>✓</span>}
                    </span>
                    <AssigneeAvatar assigneeKey={opt.value} size={20} />
                    <span style={{ color: isOn ? 'var(--t1)' : 'var(--t2)', fontWeight: isOn ? 500 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {opt.label}
                    </span>
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── MilestoneHeader ───────────────────────────────────────────────────────────

function MilestoneHeader({ milestone, taskCount, completed, diff, collapsed, minWidth, onToggle, onToggleDone, onAddTask, onUpdate, onDelete, onContextMenu }: {
  milestone: Milestone; taskCount: number; completed: number; diff: number
  collapsed: boolean; minWidth?: number; onToggle: () => void; onToggleDone: () => void; onAddTask: () => void
  onUpdate: (patch: Partial<Omit<Milestone, 'id'>>) => void
  onDelete?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [editingDate, setEditingDate] = useState(false)
  const [tempName, setTempName] = useState(milestone.name)
  const [tempDate, setTempDate] = useState(milestone.dueDate)
  const isDone = !!milestone.done
  const overdue = !isDone && diff < 0
  const close = !isDone && diff >= 0 && diff <= 7
  const accent = isDone ? 'var(--t3)' : overdue ? '#ef4444' : close ? '#f59e0b' : '#8b5cf6'
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
      className="lp-row"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={onContextMenu}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--bg2)', borderBottom: '1px solid var(--bd)', borderLeft: `3px solid ${accent}`, position: 'sticky', left: 0, zIndex: 4, minWidth: minWidth ?? undefined, opacity: isDone ? 0.65 : 1, transition: 'opacity .2s' }}
    >
      <button
        onClick={onToggle}
        style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--t3)', fontSize: 9, borderRadius: 3, flexShrink: 0, fontFamily: 'var(--font)' }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg4)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        {collapsed ? '▶' : '▼'}
      </button>
      {/* Done toggle checkbox */}
      <button
        onClick={e => { e.stopPropagation(); onToggleDone() }}
        title={isDone ? '완료 취소' : '마일스톤 완료'}
        style={{ width: 16, height: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', border: isDone ? '2px solid #22c55e' : '2px solid var(--bd2)', background: isDone ? '#22c55e' : 'transparent', color: '#fff', fontSize: 9, cursor: 'pointer', padding: 0, transition: 'all .15s' }}
        onMouseEnter={e => { if (!isDone) { e.currentTarget.style.borderColor = '#22c55e'; e.currentTarget.style.background = 'rgba(34,197,94,.15)' } }}
        onMouseLeave={e => { if (!isDone) { e.currentTarget.style.borderColor = 'var(--bd2)'; e.currentTarget.style.background = 'transparent' } }}
      >
        {isDone ? '✓' : ''}
      </button>
      <span style={{ fontSize: 11, color: accent, flexShrink: 0 }}>◆</span>

      {editingName ? (
        <input
          autoFocus value={tempName} onChange={e => setTempName(e.target.value)}
          onBlur={saveName}
          onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setTempName(milestone.name); setEditingName(false) } }}
          onClick={e => e.stopPropagation()}
          style={{ ...inlineInput, fontSize: 13, fontWeight: 600, width: 160 }}
        />
      ) : (
        <span
          onClick={e => { e.stopPropagation(); setTempName(milestone.name); setEditingName(true) }}
          title="클릭해서 이름 수정"
          style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)', cursor: 'text', borderBottom: '1px solid transparent', transition: 'border-color .1s', textDecoration: isDone ? 'line-through' : 'none' }}
          onMouseEnter={e => e.currentTarget.style.borderBottomColor = 'var(--bd)'}
          onMouseLeave={e => e.currentTarget.style.borderBottomColor = 'transparent'}
        >
          {milestone.name}
        </span>
      )}

      {editingDate ? (
        <input
          autoFocus type="date" value={tempDate} onChange={e => setTempDate(e.target.value)}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'sticky', right: 12, marginLeft: 'auto', flexShrink: 0, opacity: hovered ? 1 : 0, pointerEvents: hovered ? 'auto' : 'none', transition: 'opacity .12s' }}>
          <button
            onClick={e => { e.stopPropagation(); onAddTask() }}
            style={{ padding: '3px 8px', fontSize: 11, borderRadius: 'var(--r1)', border: `1px solid ${accent}`, background: 'var(--bg2)', color: accent, cursor: 'pointer', fontFamily: 'var(--font)' }}
            onMouseEnter={e => { e.currentTarget.style.background = overdue ? 'rgba(239,68,68,.07)' : close ? 'rgba(245,158,11,.07)' : 'rgba(139,92,246,.07)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg2)' }}
          >+ 업무</button>
          {onDelete && (
            <button
              onClick={e => { e.stopPropagation(); if (confirm(`"${milestone.name}" 마일스톤을 삭제할까요?`)) onDelete() }}
              style={{ padding: '3px 8px', fontSize: 11, borderRadius: 'var(--r1)', border: '1px solid rgba(239,68,68,.4)', background: 'var(--bg2)', color: '#ef4444', cursor: 'pointer', fontFamily: 'var(--font)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,.07)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg2)' }}
            >삭제</button>
          )}
        </div>
      )}
    </div>
  )
}

// ── UnassignedHeader ──────────────────────────────────────────────────────────

function UnassignedHeader({ count, collapsed, minWidth, onToggle, onAddTask, onContextMenu }: {
  count: number; collapsed: boolean; minWidth?: number; onToggle: () => void; onAddTask: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={onContextMenu}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--bg2)', borderBottom: '1px solid var(--bd)', borderLeft: '3px solid var(--bd)', position: 'sticky', left: 0, zIndex: 4, minWidth: minWidth ?? undefined }}
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
        style={{ position: 'sticky', right: 12, marginLeft: 'auto', padding: '3px 8px', fontSize: 11, borderRadius: 'var(--r1)', border: '1px solid var(--bd)', background: 'var(--bg2)', color: 'var(--t2)', cursor: 'pointer', fontFamily: 'var(--font)', flexShrink: 0, opacity: hovered ? 1 : 0, pointerEvents: hovered ? 'auto' : 'none', transition: 'opacity .12s' }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
        onMouseLeave={e => e.currentTarget.style.background = 'var(--bg2)'}
      >
        + 업무
      </button>
    </div>
  )
}

// ── AddMilestoneInline ────────────────────────────────────────────────────────

function AddMilestoneInline({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const addMilestone = useMilestoneStore(s => s.addMilestone)
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const submit = () => {
    if (!name.trim() || !date) return
    addMilestone(projectId, name.trim(), date)
    onDone()
  }
  const valid = name.trim() !== '' && date !== ''
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--bg2)', borderBottom: '1px solid var(--bd)', borderLeft: '3px solid #8b5cf6', borderTop: '1px solid var(--bd)' }}>
      <span style={{ fontSize: 9, color: '#8b5cf6', flexShrink: 0 }}>◆</span>
      <input
        autoFocus placeholder="마일스톤 이름..." value={name} onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onDone() }}
        style={{ flex: 1, border: '1px solid var(--ac)', borderRadius: 'var(--r1)', padding: '3px 8px', fontSize: 13, fontWeight: 600, background: 'var(--bg)', color: 'var(--t1)', outline: 'none', fontFamily: 'var(--font)' }}
      />
      <input
        type="date" value={date} onChange={e => setDate(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onDone() }}
        style={{ border: '1px solid var(--bd)', borderRadius: 'var(--r1)', padding: '3px 8px', fontSize: 11, background: 'var(--bg)', color: 'var(--t2)', outline: 'none', fontFamily: 'var(--font)' }}
      />
      <button
        onClick={submit} disabled={!valid}
        style={{ padding: '3px 10px', fontSize: 11, borderRadius: 'var(--r1)', border: `1px solid ${valid ? '#8b5cf6' : 'var(--bd)'}`, background: valid ? 'rgba(139,92,246,.1)' : 'transparent', color: valid ? '#8b5cf6' : 'var(--t3)', cursor: valid ? 'pointer' : 'default', fontFamily: 'var(--font)', transition: 'background .1s' }}
      >추가</button>
      <button
        onClick={onDone}
        style={{ padding: '3px 8px', fontSize: 11, borderRadius: 'var(--r1)', border: '1px solid var(--bd)', background: 'transparent', color: 'var(--t3)', cursor: 'pointer', fontFamily: 'var(--font)' }}
      >취소</button>
    </div>
  )
}

// ── AddRowAssigneeSelect — simple single-select for the add row ───────────────

function AddRowAssigneeSelect({ value, options, onChange }: {
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const current = options.find(o => o.value === value)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const toggle = () => {
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 2, left: r.left })
    }
    setOpen(o => !o)
  }

  const pick = (v: string) => { onChange(v); setOpen(false) }

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}
      onKeyDown={e => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false) } }}
    >
      <div
        ref={triggerRef}
        onClick={toggle}
        style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', padding: '3px 6px', borderRadius: 3, outline: '1px solid var(--ac)', background: 'var(--bg)', width: '100%', boxSizing: 'border-box' }}
      >
        <span style={{ flex: 1, fontSize: 13, color: current ? 'var(--t1)' : 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {current ? current.label : '— 미배정'}
        </span>
        <span style={{ fontSize: 9, color: 'var(--t3)', flexShrink: 0 }}>▾</span>
      </div>

      {open && (
        <div style={{
          position: 'fixed', top: pos.top, left: pos.left, zIndex: 9001,
          background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r3)',
          boxShadow: 'var(--sh-md)', minWidth: 160, maxHeight: 240, overflowY: 'auto', padding: '4px 0',
        }}>
          <div
            onMouseDown={e => { e.preventDefault(); pick('') }}
            style={{ padding: '6px 12px', fontSize: 13, cursor: 'pointer', color: !value ? 'var(--ac)' : 'var(--t2)', fontWeight: !value ? 500 : 400 }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >— 미배정</div>
          {options.map(opt => (
            <div
              key={opt.value}
              onMouseDown={e => { e.preventDefault(); pick(opt.value) }}
              style={{ padding: '6px 12px', fontSize: 13, cursor: 'pointer', color: opt.value === value ? 'var(--ac)' : 'var(--t2)', fontWeight: opt.value === value ? 500 : 400 }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >{opt.label}</div>
          ))}
          {options.length === 0 && (
            <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--t3)' }}>멤버가 없습니다</div>
          )}
        </div>
      )}
    </div>
  )
}

// ── AddRowStatusSelect ────────────────────────────────────────────────────────

function AddRowStatusSelect({ value, onChange }: {
  value: Status
  onChange: (v: Status) => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const s = STATUS_STYLE[value]

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const toggle = () => {
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 2, left: r.left })
    }
    setOpen(o => !o)
  }

  const pick = (v: Status) => { onChange(v); setOpen(false) }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}
      onKeyDown={e => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false) } }}
    >
      <div
        ref={triggerRef}
        onClick={toggle}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 12, background: s.bg, color: s.color, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', cursor: 'pointer' }}
      >
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
        {value}
        <span style={{ fontSize: 9, opacity: .6 }}>▾</span>
      </div>
      {open && (
        <div style={{
          position: 'fixed', top: pos.top, left: pos.left, zIndex: 9001,
          background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r3)',
          boxShadow: 'var(--sh-md)', minWidth: 120, padding: '4px 0',
        }}>
          {(['진행중','대기','검토중','완료'] as Status[]).map(st => {
            const ss = STATUS_STYLE[st]
            return (
              <div
                key={st}
                onMouseDown={e => { e.preventDefault(); pick(st) }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', cursor: 'pointer', background: 'transparent' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: ss.color, flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: st === value ? ss.color : 'var(--t2)', fontWeight: st === value ? 600 : 400 }}>{st}</span>
                {st === value && <span style={{ marginLeft: 'auto', fontSize: 10, color: ss.color }}>✓</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── AddRowDatePicker ──────────────────────────────────────────────────────────

function AddRowDatePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const [viewYear, setViewYear] = useState(new Date().getFullYear())
  const [viewMonth, setViewMonth] = useState(new Date().getMonth())
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const d = value ? new Date(value + 'T00:00:00') : new Date()
    setViewYear(d.getFullYear()); setViewMonth(d.getMonth())
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open, value])

  const toggle = () => {
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 2, left: r.left })
    }
    setOpen(o => !o)
  }

  const prevMonth = () => setViewMonth(m => { if (m === 0) { setViewYear(y => y - 1); return 11 } return m - 1 })
  const nextMonth = () => setViewMonth(m => { if (m === 11) { setViewYear(y => y + 1); return 0 } return m + 1 })

  const firstDow = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const cells: (number | null)[] = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const today = new Date()
  const todayD = today.getFullYear() === viewYear && today.getMonth() === viewMonth ? today.getDate() : null
  const selD = (() => {
    if (!value) return null
    const d = new Date(value + 'T00:00:00')
    return d.getFullYear() === viewYear && d.getMonth() === viewMonth ? d.getDate() : null
  })()

  const pick = (day: number) => {
    const m = String(viewMonth + 1).padStart(2, '0'), dd = String(day).padStart(2, '0')
    onChange(`${viewYear}-${m}-${dd}`)
    setOpen(false)
  }

  const displayStr = value ? (() => {
    const d = new Date(value + 'T00:00:00')
    return `${d.getMonth() + 1}/${d.getDate()}`
  })() : null

  const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']
  const DAYS = ['일','월','화','수','목','금','토']

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}
      onKeyDown={e => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false) } }}
    >
      <div
        ref={triggerRef} onClick={toggle}
        style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', padding: '3px 6px', borderRadius: 3, outline: '1px solid var(--ac)', background: 'var(--bg)', width: '100%', boxSizing: 'border-box' as const }}
      >
        <span style={{ flex: 1, fontSize: 13, color: displayStr ? 'var(--t1)' : 'var(--t3)' }}>
          {displayStr || '— 마감일'}
        </span>
        <span style={{ fontSize: 12, color: 'var(--t3)', flexShrink: 0 }}>▾</span>
      </div>

      {open && (
        <div style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9001, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r3)', boxShadow: 'var(--sh-md)', width: 234, padding: '10px', userSelect: 'none' as const }}>
          {/* Month nav */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <button onMouseDown={e => { e.preventDefault(); prevMonth() }} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--t2)', padding: '2px 6px', borderRadius: 3, lineHeight: 1 }}>‹</button>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{viewYear}년 {MONTHS[viewMonth]}</span>
            <button onMouseDown={e => { e.preventDefault(); nextMonth() }} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--t2)', padding: '2px 6px', borderRadius: 3, lineHeight: 1 }}>›</button>
          </div>
          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
            {DAYS.map((d, i) => (
              <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, padding: '2px 0', color: i === 0 ? '#ef4444' : i === 6 ? '#3b82f6' : 'var(--t3)' }}>{d}</div>
            ))}
          </div>
          {/* Day grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {cells.map((day, idx) => {
              if (!day) return <div key={idx} />
              const dow = (firstDow + day - 1) % 7
              const isSel = day === selD
              const isToday = day === todayD
              return (
                <div key={idx} onMouseDown={e => { e.preventDefault(); pick(day) }}
                  style={{ textAlign: 'center', padding: '4px 0', borderRadius: 4, fontSize: 12, cursor: 'pointer', fontWeight: isSel || isToday ? 600 : 400, background: isSel ? 'var(--ac)' : isToday ? 'var(--ac-l)' : 'transparent', color: isSel ? '#fff' : dow === 0 ? '#ef4444' : dow === 6 ? '#3b82f6' : 'var(--t1)', outline: isToday && !isSel ? '1px solid var(--ac)' : 'none' }}
                  onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'var(--bg3)' }}
                  onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = isToday ? 'var(--ac-l)' : 'transparent' }}
                >{day}</div>
              )
            })}
          </div>
          {value && (
            <div style={{ borderTop: '1px solid var(--bd)', marginTop: 8, paddingTop: 6, textAlign: 'center' }}>
              <span onMouseDown={e => { e.preventDefault(); onChange(''); setOpen(false) }}
                style={{ fontSize: 11, color: 'var(--t3)', cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--t3)')}
              >날짜 지우기</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── AddTaskRow ────────────────────────────────────────────────────────────────

function AddTaskRow({ cols, assigneeOptions, milestoneId, parentId, projectId, space, addTask, userEmail, isSubtask = false, onDone, onCancel }: {
  cols: ColDef[]
  assigneeOptions: { value: string; label: string }[]
  milestoneId?: string
  parentId?: string
  projectId?: string
  space: string
  addTask: (t: Omit<Task, 'id'>) => Task
  userEmail: string | null
  isSubtask?: boolean
  onDone: (addAnother: boolean) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [assignee, setAssignee] = useState('')
  const [due, setDue] = useState('')
  const [status, setStatus] = useState<Status>('대기')
  const containerRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => { nameRef.current?.focus() }, [])

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) onCancel()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onCancel])

  const doSave = (addAnother: boolean) => {
    if (!name.trim()) { nameRef.current?.focus(); return }
    addTask({
      type: parentId ? '세부' : '상위', cat: space, name: name.trim(), assignee,
      start: '', due, priority: '중간', status,
      progress: 0, memo: '', parentId, projectId, milestoneId,
      createdBy: userEmail ?? undefined,
    })
    setName(''); setAssignee(''); setDue(''); setStatus('대기')
    onDone(addAnother)
    if (addAnother) setTimeout(() => nameRef.current?.focus(), 0)
  }

  const handleContainerKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onCancel(); return }
    if (e.key === 'Enter') { e.preventDefault(); doSave(!e.shiftKey) }
  }

  const inp: React.CSSProperties = {
    width: '100%', border: 'none', outline: '1px solid var(--ac)',
    borderRadius: 3, background: 'var(--bg)', padding: '3px 6px',
    fontFamily: 'var(--font)', fontSize: 13, color: 'var(--t1)',
  }

  const renderCell = (col: ColDef, isLast: boolean) => {
    const base: React.CSSProperties = {
      width: col.width, minWidth: col.width, maxWidth: col.width, flexShrink: 0,
      padding: '6px 10px', display: 'flex', alignItems: 'center',
      minHeight: 44,
      borderRight: isLast ? 'none' : '1px solid var(--bd)',
    }
    switch (col.key) {
      case 'name':
        return (
          <div key="name" style={{ ...base, position: 'sticky', left: 0, zIndex: 2, background: 'rgba(35,131,226,.04)', boxShadow: '2px 0 4px rgba(0,0,0,.06)', paddingLeft: isSubtask ? 88 : 14 }}>
            <input
              ref={nameRef}
              value={name} onChange={e => setName(e.target.value)}
              placeholder="업무 이름 입력... (Enter로 추가)"
              style={inp}
            />
          </div>
        )
      case 'assignee':
        return (
          <div key="assignee" style={base}>
            <AddRowAssigneeSelect value={assignee} options={assigneeOptions} onChange={setAssignee} />
          </div>
        )
      case 'due':
        return (
          <div key="due" style={base}>
            <AddRowDatePicker value={due} onChange={setDue} />
          </div>
        )
      case 'status':
        return (
          <div key="status" style={{ ...base, padding: '6px 10px' }}>
            <AddRowStatusSelect value={status} onChange={setStatus} />
          </div>
        )
      default:
        return <div key={col.key} style={base} />
    }
  }

  return (
    <div
      ref={containerRef}
      onKeyDown={handleContainerKey}
      style={{
        display: 'flex', minWidth: '100%',
        background: 'rgba(35,131,226,.04)',
        borderBottom: '2px solid var(--ac)',
        borderLeft: '3px solid var(--ac)',
      }}
    >
      {cols.map((col, idx) => renderCell(col, idx === cols.length - 1))}
      <div style={{ flex: 1 }} />
    </div>
  )
}

// ── MilestonePicker ───────────────────────────────────────────────────────────

function MilestonePicker({ milestoneId, milestones, onChange }: {
  milestoneId: string | undefined; milestones: Milestone[]; onChange: (id: string | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const current = milestones.find(m => m.id === milestoneId)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const handleOpen = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 3, left: r.left })
    }
    setOpen(o => !o)
  }

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
      <button
        ref={btnRef} onClick={handleOpen}
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
        <div style={{ position: 'fixed', top: pos.top, left: pos.left, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r3)', boxShadow: 'var(--sh-md)', zIndex: 9000, minWidth: 200, padding: '4px 0' }}>
          <PickerRow onClick={() => { onChange(undefined); setOpen(false) }} active={!milestoneId} label="— 없음 (미배정)" accent={false} />
          {milestones.map(m => (
            <PickerRow key={m.id} onClick={() => { onChange(m.id); setOpen(false) }} active={m.id === milestoneId} label={`◆ ${m.name}`} sub={m.dueDate} accent />
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

// ── Misc helpers ──────────────────────────────────────────────────────────────

function Dash() {
  return <span style={{ color: 'var(--t3)', fontSize: 12 }}>—</span>
}

function InlineTextEdit({ value, onCommit, onCancel, fontSize = 13, bold = false }: {
  value: string; onCommit: (v: string) => void; onCancel: () => void; fontSize?: number; bold?: boolean
}) {
  const [v, setV] = useState(value)
  return (
    <input
      autoFocus value={v} onChange={e => setV(e.target.value)}
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

// ── LinksCell ─────────────────────────────────────────────────────────────────

function LinksCell({ links, onChange }: {
  links: TaskLink[]
  onChange: (links: TaskLink[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const [addTitle, setAddTitle] = useState('')
  const [addUrl, setAddUrl] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setAddTitle(''); setAddUrl('')
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (open) { setOpen(false); return }
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left })
    }
    setOpen(true)
  }

  const addLink = () => {
    const url = addUrl.trim()
    if (!url) return
    onChange([...links, { id: gid(), title: addTitle.trim() || url, url }])
    setAddTitle(''); setAddUrl('')
  }

  const removeLink = (id: string) => onChange(links.filter(l => l.id !== id))

  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', alignItems: 'center', width: '100%' }}>
      <div ref={btnRef} onClick={handleOpen}
        style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', flex: 1, minWidth: 0 }}>
        {links.length === 0
          ? <span style={{ fontSize: 12, color: 'var(--t3)' }}>—</span>
          : <span style={{ fontSize: 12, color: 'var(--ac)', fontWeight: 500 }}>↗ {links.length}개</span>
        }
        <span style={{ fontSize: 9, color: 'var(--t3)', opacity: .6, marginLeft: 2 }}>▾</span>
      </div>

      {open && (
        <div style={{
          position: 'fixed', top: pos.top, left: pos.left, zIndex: 9000,
          background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r3)',
          boxShadow: 'var(--sh-md)', minWidth: 260, maxHeight: 320, display: 'flex', flexDirection: 'column',
        }}>
          {links.length > 0 && (
            <div style={{ overflowY: 'auto', maxHeight: 200, padding: '4px 0' }}>
              {links.map(l => (
                <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <a href={l.url} target="_blank" rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{ flex: 1, fontSize: 12, color: 'var(--ac)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={l.url}
                  >↗ {l.title}</a>
                  <span
                    onMouseDown={e => { e.preventDefault(); removeLink(l.id) }}
                    style={{ fontSize: 14, color: 'var(--t3)', cursor: 'pointer', flexShrink: 0, lineHeight: 1 }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--t3)')}
                  >×</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ borderTop: links.length > 0 ? '1px solid var(--bd)' : 'none', padding: '8px' }}>
            <input
              autoFocus={links.length === 0}
              value={addTitle}
              onChange={e => setAddTitle(e.target.value)}
              placeholder="링크 제목 (선택)"
              onKeyDown={e => { if (e.key === 'Enter') { const next = e.currentTarget.nextElementSibling as HTMLInputElement; next?.focus() } }}
              style={{ width: '100%', boxSizing: 'border-box', marginBottom: 5, border: '1px solid var(--bd)', borderRadius: 'var(--r1)', padding: '4px 8px', fontSize: 12, background: 'var(--bg2)', color: 'var(--t1)', outline: 'none', fontFamily: 'var(--font)' }}
            />
            <div style={{ display: 'flex', gap: 5 }}>
              <input
                value={addUrl}
                onChange={e => setAddUrl(e.target.value)}
                placeholder="https://..."
                onKeyDown={e => { if (e.key === 'Enter') addLink() }}
                style={{ flex: 1, border: '1px solid var(--bd)', borderRadius: 'var(--r1)', padding: '4px 8px', fontSize: 12, background: 'var(--bg2)', color: 'var(--t1)', outline: 'none', fontFamily: 'var(--font)' }}
              />
              <button
                onMouseDown={e => { e.preventDefault(); addLink() }}
                disabled={!addUrl.trim()}
                style={{ padding: '4px 10px', borderRadius: 'var(--r1)', border: 'none', background: addUrl.trim() ? 'var(--ac)' : 'var(--bg3)', color: addUrl.trim() ? '#fff' : 'var(--t3)', fontSize: 12, cursor: addUrl.trim() ? 'pointer' : 'default', fontFamily: 'var(--font)', flexShrink: 0 }}
              >추가</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── TagMultiSelect ────────────────────────────────────────────────────────────

function TagMultiSelect({ tags, allTags, onChange }: {
  tags: string[]
  allTags: string[]
  onChange: (tags: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setInput('') }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (open) { setOpen(false); setInput(''); return }
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left })
    }
    setOpen(true)
  }

  const toggle = (tag: string) => {
    const next = tags.includes(tag) ? tags.filter(t => t !== tag) : [...tags, tag]
    onChange(next)
  }

  const addNew = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed || tags.includes(trimmed)) return
    onChange([...tags, trimmed])
    setInput('')
  }

  const filtered = input.trim()
    ? allTags.filter(t => t.toLowerCase().includes(input.toLowerCase()))
    : allTags
  const inputTrimmed = input.trim()
  const canAddNew = inputTrimmed && !allTags.includes(inputTrimmed)

  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', alignItems: 'center', width: '100%' }}>
      <div ref={btnRef} onClick={handleOpen}
        style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 3, cursor: 'pointer', flex: 1, minWidth: 0 }}>
        {tags.length === 0
          ? <span style={{ fontSize: 12, color: 'var(--t3)' }}>—</span>
          : tags.map(tag => <TagBadge key={tag} tag={tag} />)
        }
        <span style={{ fontSize: 9, color: 'var(--t3)', opacity: .6, marginLeft: 2 }}>▾</span>
      </div>

      {open && (
        <div style={{
          position: 'fixed', top: pos.top, left: pos.left, zIndex: 9000,
          background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r3)',
          boxShadow: 'var(--sh-md)', minWidth: 190, maxHeight: 280, display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
            <input
              autoFocus
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (filtered.length === 1) toggle(filtered[0])
                  else if (canAddNew) addNew(input)
                  else if (inputTrimmed && tags.includes(inputTrimmed)) toggle(inputTrimmed)
                }
                if (e.key === 'Escape') { setOpen(false); setInput('') }
              }}
              placeholder="태그 검색 또는 추가..."
              style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--bd)', borderRadius: 'var(--r1)', padding: '4px 8px', fontSize: 12, background: 'var(--bg2)', color: 'var(--t1)', outline: 'none', fontFamily: 'var(--font)' }}
            />
          </div>
          <div style={{ overflowY: 'auto', padding: '4px 0' }}>
            {canAddNew && (
              <div
                onMouseDown={e => { e.preventDefault(); addNew(input) }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 12, color: 'var(--ac)', cursor: 'pointer', transition: 'background .07s' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ fontWeight: 700 }}>+</span> "{inputTrimmed}" 추가
              </div>
            )}
            {filtered.map(tag => {
              const isOn = tags.includes(tag)
              return (
                <div key={tag}
                  onMouseDown={e => { e.preventDefault(); toggle(tag) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', cursor: 'pointer', background: isOn ? 'rgba(35,131,226,.07)' : 'transparent', transition: 'background .07s' }}
                  onMouseEnter={e => { if (!isOn) e.currentTarget.style.background = 'var(--bg3)' }}
                  onMouseLeave={e => { if (!isOn) e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{ width: 14, height: 14, border: `2px solid ${isOn ? 'var(--ac)' : 'var(--bd2)'}`, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: isOn ? 'var(--ac)' : 'transparent', transition: 'all .1s' }}>
                    {isOn && <span style={{ color: '#fff', fontSize: 9, fontWeight: 700 }}>✓</span>}
                  </span>
                  <TagBadge tag={tag} />
                </div>
              )
            })}
            {filtered.length === 0 && !canAddNew && (
              <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--t3)' }}>태그가 없습니다</div>
            )}
          </div>
          {tags.length > 0 && (
            <div style={{ borderTop: '1px solid var(--bd)', flexShrink: 0 }}>
              <div
                onMouseDown={e => { e.preventDefault(); onChange([]); setOpen(false) }}
                style={{ padding: '6px 12px', fontSize: 12, color: 'var(--t3)', cursor: 'pointer', transition: 'background .07s' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                전체 해제
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── MsContextMenu ─────────────────────────────────────────────────────────────

function MsContextMenu({ x, y, onAdd, onClose }: {
  x: number; y: number; onAdd: () => void; onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const h = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) { if (e.key === 'Escape') onCloseRef.current(); return }
      if (ref.current && !ref.current.contains(e.target as Node)) onCloseRef.current()
    }
    // small delay so the right-click mousedown doesn't immediately close the menu
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', h)
      document.addEventListener('keydown', h)
    }, 10)
    return () => {
      clearTimeout(id)
      document.removeEventListener('mousedown', h)
      document.removeEventListener('keydown', h)
    }
  }, [])

  const cx = Math.min(x, window.innerWidth - 190)
  const cy = Math.min(y, window.innerHeight - 60)
  return (
    <div ref={ref} style={{ position: 'fixed', left: cx, top: cy, width: 180, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r3)', boxShadow: '0 8px 28px rgba(0,0,0,.18)', zIndex: 9000, padding: '4px 0', userSelect: 'none' }}>
      <MsCtxItem icon="+" label="새 업무 추가" onClick={() => { onAdd(); onClose() }} />
    </div>
  )
}

function MsCtxItem({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  const [hov, setHov] = useState(false)
  return (
    <div onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 13, color: 'var(--t1)', background: hov ? 'var(--bg3)' : 'transparent', transition: 'background .06s' }}>
      <span style={{ fontSize: 14, width: 16, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
      {label}
    </div>
  )
}

function AutoDateInput({ value, onChange, onBlur, onEscape }: {
  value: string; onChange: (v: string) => void; onBlur: () => void; onEscape: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    try { el.showPicker?.() } catch { /* ignore */ }
  }, [])
  return (
    <input
      ref={ref} type="date" value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={onBlur}
      onClick={e => e.stopPropagation()}
      onKeyDown={e => { if (e.key === 'Escape') onEscape() }}
      style={{ border: 'none', outline: '1px solid var(--ac)', borderRadius: 3, background: 'var(--bg)', fontSize: 12, fontFamily: 'var(--font)', color: 'var(--t1)', width: '100%', padding: '2px 4px' }}
    />
  )
}
