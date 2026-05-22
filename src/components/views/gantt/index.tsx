import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useFilteredTasks } from '../../../hooks/useFilteredTasks'
import { useTaskStore } from '../../../store/taskStore'
import { useUiStore } from '../../../store/uiStore'
import { useMilestoneStore } from '../../../store/milestoneStore'
import { getCatColor } from '../../../types'
import { CategoryBadge } from '../../shared/Badge'
import type { Task } from '../../../types'

const DAY_W = 26
const ROW_H = 36
const LEFT_W = 240
const MONTH_H = 28
const DAY_H = 24

function toDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r
}
function dayDiff(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}
function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface DragData {
  taskId: string
  origStart: string
  origDue: string
  startX: number
}

export function GanttView() {
  const filteredTasks = useFilteredTasks()
  const allTasks = useTaskStore(s => s.tasks)
  const { updateTask } = useTaskStore()
  const { setDetailTaskId, openTaskModal, projectId } = useUiStore()
  const milestones = useMilestoneStore(s => s.milestones)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  // Drag state — ref for raw data (no re-render), state for visual offset
  const dragRef = useRef<DragData | null>(null)
  const [dragVisual, setDragVisual] = useState<{ taskId: string; dayOffset: number } | null>(null)

  const today = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d
  }, [])

  const rootTasks = filteredTasks.filter(t => !t.parentId)
  const getChildren = (id: string) => allTasks.filter(t => t.parentId === id)

  const toggle = (id: string) =>
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  // Global mouse handlers — registered once
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const dayOffset = Math.round((e.clientX - d.startX) / DAY_W)
      setDragVisual(prev =>
        prev?.dayOffset === dayOffset ? prev : { taskId: d.taskId, dayOffset }
      )
    }

    const onUp = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const dayOffset = Math.round((e.clientX - d.startX) / DAY_W)
      if (dayOffset !== 0) {
        const patch: Partial<Task> = {}
        if (d.origStart) patch.start = fmtDate(addDays(toDate(d.origStart), dayOffset))
        if (d.origDue)   patch.due   = fmtDate(addDays(toDate(d.origDue),   dayOffset))
        updateTask(d.taskId, patch)
      }
      dragRef.current = null
      setDragVisual(null)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [updateTask])

  const startDrag = useCallback((data: DragData) => {
    dragRef.current = data
    setDragVisual({ taskId: data.taskId, dayOffset: 0 })
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
  }, [])

  // Compute date range
  const { rangeStart, rangeEnd } = useMemo(() => {
    const allVisible: Task[] = []
    for (const t of filteredTasks) {
      allVisible.push(t)
      getChildren(t.id).forEach(c => allVisible.push(c))
    }
    const all: Date[] = []
    for (const t of allVisible) {
      if (t.start) all.push(toDate(t.start))
      if (t.due)   all.push(toDate(t.due))
    }
    const PAD = 14
    const s = all.length
      ? addDays(new Date(Math.min(...all.map(d => d.getTime()))), -PAD)
      : new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const e = all.length
      ? addDays(new Date(Math.max(...all.map(d => d.getTime()))), PAD)
      : new Date(today.getFullYear(), today.getMonth() + 2, 0)
    return { rangeStart: s, rangeEnd: e }
  }, [filteredTasks, allTasks, today])

  const totalDays = dayDiff(rangeStart, rangeEnd) + 1
  const timelineW = totalDays * DAY_W
  const todayCol = dayDiff(rangeStart, today)

  const milestoneMarkers = useMemo(() => {
    if (!projectId) return []
    return milestones
      .filter(m => m.projectId === projectId)
      .map(m => ({ id: m.id, name: m.name, col: dayDiff(rangeStart, toDate(m.dueDate)) }))
      .filter(m => m.col >= 0 && m.col < totalDays)
  }, [milestones, projectId, rangeStart, totalDays])

  useEffect(() => {
    const el = wrapRef.current
    if (el) el.scrollLeft = Math.max(0, todayCol * DAY_W - (el.clientWidth - LEFT_W) / 2)
  }, [todayCol])

  const months = useMemo(() => {
    const res: { label: string; col: number; span: number }[] = []
    let cur = new Date(rangeStart)
    while (cur <= rangeEnd) {
      const col = dayDiff(rangeStart, cur)
      const monthEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0)
      const span = dayDiff(cur, monthEnd < rangeEnd ? monthEnd : rangeEnd) + 1
      res.push({ label: `${cur.getFullYear()}년 ${cur.getMonth() + 1}월`, col, span })
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
    }
    return res
  }, [rangeStart, rangeEnd])

  const days = useMemo(
    () => Array.from({ length: totalDays }, (_, i) => addDays(rangeStart, i)),
    [rangeStart, totalDays]
  )

  const getRollupBar = (parentId: string): { col: number; span: number } | null => {
    const children = getChildren(parentId).filter(c => c.start || c.due)
    if (!children.length) return null
    const starts = children.filter(c => c.start).map(c => dayDiff(rangeStart, toDate(c.start!)))
    const ends   = children.filter(c => c.due).map(c => dayDiff(rangeStart, toDate(c.due!)))
    const col    = Math.min(...(starts.length ? starts : ends))
    const endCol = Math.max(...(ends.length ? ends : starts))
    return { col, span: endCol - col + 1 }
  }

  if (filteredTasks.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t3)', fontSize: 14 }}>
        업무가 없습니다
      </div>
    )
  }

  return (
    <div ref={wrapRef} style={{ flex: 1, overflow: 'auto', background: 'var(--bg)' }}>
      <div style={{ minWidth: LEFT_W + timelineW }}>

        {/* Month header */}
        <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 10, height: MONTH_H, background: 'var(--bg2)', borderBottom: '1px solid var(--bd)' }}>
          <div style={{ width: LEFT_W, flexShrink: 0, position: 'sticky', left: 0, zIndex: 11, background: 'var(--bg2)', borderRight: '1px solid var(--bd)', display: 'flex', alignItems: 'center', paddingLeft: 16 }}>
            <button
              onClick={() => openTaskModal()}
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--t3)', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'var(--font)', padding: '2px 6px', borderRadius: 'var(--r1)', transition: 'background .08s, color .08s' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg4)'; e.currentTarget.style.color = 'var(--ac)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t3)' }}
            >
              <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> 새 업무
            </button>
          </div>
          <div style={{ width: timelineW, flexShrink: 0, position: 'relative' }}>
            {months.map(m => (
              <div key={m.label} style={{ position: 'absolute', left: m.col * DAY_W, width: m.span * DAY_W, top: 0, bottom: 0, display: 'flex', alignItems: 'center', paddingLeft: 10, fontSize: 11, fontWeight: 600, color: 'var(--t2)', borderRight: '1px solid var(--bd)', overflow: 'hidden' }}>
                {m.label}
              </div>
            ))}
          </div>
        </div>

        {/* Day header */}
        <div style={{ display: 'flex', position: 'sticky', top: MONTH_H, zIndex: 10, height: DAY_H, background: 'var(--bg)', borderBottom: '2px solid var(--bd)' }}>
          <div style={{ width: LEFT_W, flexShrink: 0, position: 'sticky', left: 0, zIndex: 11, background: 'var(--bg2)', borderRight: '1px solid var(--bd)' }} />
          <div style={{ position: 'relative', flexShrink: 0, width: timelineW }}>
            {days.map((d, i) => {
              const isToday = i === todayCol
              const isWeekend = d.getDay() === 0 || d.getDay() === 6
              const isMonthEnd = d.getDate() === new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
              return (
                <div key={i} style={{ position: 'absolute', left: i * DAY_W, width: DAY_W, height: DAY_H, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: isToday ? 'var(--ac)' : 'var(--t3)', fontWeight: isToday ? 700 : 400, background: isToday ? 'var(--ac-l)' : isWeekend ? 'var(--bg2)' : 'transparent', borderRight: isMonthEnd ? '1px solid var(--bd)' : 'none' }}>
                  {d.getDate()}
                </div>
              )
            })}
            {milestoneMarkers.map(m => (
              <div
                key={m.id}
                title={m.name}
                style={{ position: 'absolute', left: m.col * DAY_W + Math.floor(DAY_W / 2) - 5, top: 2, fontSize: 10, color: '#8b5cf6', pointerEvents: 'none', zIndex: 2, lineHeight: 1 }}
              >◆</div>
            ))}
          </div>
        </div>

        {/* Task rows */}
        {rootTasks.map(task => {
          const children = getChildren(task.id)
          const hasChildren = children.length > 0
          const isExpanded = !collapsed.has(task.id)
          const hasOwnBar = !!(task.start || task.due)
          const rollup = !hasOwnBar ? getRollupBar(task.id) : null
          const dragOffset = dragVisual?.taskId === task.id ? dragVisual.dayOffset : 0

          return (
            <div key={task.id}>
              <GanttRow
                task={task}
                rangeStart={rangeStart}
                todayCol={todayCol}
                totalDays={totalDays}
                timelineW={timelineW}
                today={today}
                hasChildren={hasChildren}
                isExpanded={isExpanded}
                rollup={rollup}
                dragOffset={dragOffset}
                isDragging={dragVisual?.taskId === task.id}
                milestoneMarkers={milestoneMarkers}
                onOpen={() => openTaskModal(task.id)}
                onToggle={() => toggle(task.id)}
                onAddSubtask={() => openTaskModal(undefined, task.id)}
                onBarMouseDown={(startX) => startDrag({ taskId: task.id, origStart: task.start, origDue: task.due, startX })}
              />
              {hasChildren && isExpanded && children.map(child => {
                const childDragOffset = dragVisual?.taskId === child.id ? dragVisual.dayOffset : 0
                return (
                  <GanttRow
                    key={child.id}
                    task={child}
                    rangeStart={rangeStart}
                    todayCol={todayCol}
                    totalDays={totalDays}
                    timelineW={timelineW}
                    today={today}
                    isChild
                    dragOffset={childDragOffset}
                    isDragging={dragVisual?.taskId === child.id}
                    milestoneMarkers={milestoneMarkers}
                    onOpen={() => setDetailTaskId(child.id)}
                    onEdit={() => openTaskModal(child.id)}
                    onBarMouseDown={(startX) => startDrag({ taskId: child.id, origStart: child.start, origDue: child.due, startX })}
                  />
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── GanttRow ─────────────────────────────────────────────────────────────────

function GanttRow({
  task, rangeStart, todayCol, totalDays, timelineW, today,
  isChild = false, hasChildren = false, isExpanded = true,
  rollup = null, dragOffset = 0, isDragging = false,
  milestoneMarkers = [],
  onOpen, onToggle, onAddSubtask, onEdit, onBarMouseDown,
}: {
  task: Task
  rangeStart: Date
  todayCol: number
  totalDays: number
  timelineW: number
  today: Date
  isChild?: boolean
  hasChildren?: boolean
  isExpanded?: boolean
  rollup?: { col: number; span: number } | null
  dragOffset?: number
  isDragging?: boolean
  milestoneMarkers?: { id: string; col: number; name: string }[]
  onOpen: () => void
  onToggle?: () => void
  onAddSubtask?: () => void
  onEdit?: () => void
  onBarMouseDown?: (startX: number) => void
}) {
  const [hovered, setHovered] = useState(false)
  const color = getCatColor(task.cat || '')
  const isOverdue = Boolean(task.due && task.status !== '완료' && toDate(task.due) < today)

  const startCol = task.start ? dayDiff(rangeStart, toDate(task.start)) : null
  const endCol   = task.due   ? dayDiff(rangeStart, toDate(task.due))   : null
  const hasOwnBar = startCol !== null || endCol !== null

  let barLeft = 0, barWidth = 0
  if (hasOwnBar) {
    barLeft = startCol ?? endCol ?? 0
    const barRight = endCol ?? startCol ?? 0
    barWidth = Math.max((barRight - barLeft + 1) * DAY_W - 4, DAY_W - 4)
  }

  const rowH = isChild ? ROW_H - 2 : ROW_H
  const rowBg = hovered ? 'var(--bg2)' : isChild ? 'rgba(55,53,47,.015)' : 'var(--bg)'

  return (
    <div
      style={{ display: 'flex', height: rowH, borderBottom: '1px solid var(--bd)' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Left */}
      <div
        onClick={onOpen}
        style={{ width: LEFT_W, flexShrink: 0, position: 'sticky', left: 0, zIndex: 2, background: rowBg, borderRight: '1px solid var(--bd)', display: 'flex', alignItems: 'center', paddingLeft: isChild ? 28 : 4, paddingRight: 8, gap: 4, overflow: 'hidden', cursor: 'pointer', transition: 'background .08s' }}
      >
        {isChild ? (
          <span style={{ fontSize: 10, color: 'var(--t3)', flexShrink: 0 }}>└</span>
        ) : (
          <button
            onClick={e => { e.stopPropagation(); onToggle?.() }}
            style={{ width: 18, height: 18, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: hasChildren ? 'pointer' : 'default', color: 'var(--t3)', fontSize: 9, borderRadius: 3, visibility: hasChildren ? 'visible' : 'hidden' }}
          >
            {isExpanded ? '▼' : '▶'}
          </button>
        )}

        {task.cat && <CategoryBadge cat={task.cat} />}

        <span style={{ fontSize: 12, flex: 1, color: isChild ? 'var(--t2)' : 'var(--t1)', fontWeight: !isChild && hasChildren ? 500 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {task.name}
        </span>

        {hovered && !isChild && onAddSubtask && (
          <button onClick={e => { e.stopPropagation(); onAddSubtask() }} style={{ flexShrink: 0, fontSize: 10, color: 'var(--ac)', background: 'var(--ac-l)', border: '1px solid var(--ac)', borderRadius: 3, padding: '2px 6px', cursor: 'pointer', fontFamily: 'var(--font)' }}>
            + 하위
          </button>
        )}
        {hovered && isChild && onEdit && (
          <button onClick={e => { e.stopPropagation(); onEdit() }} style={{ flexShrink: 0, fontSize: 11, color: 'var(--t2)', background: 'var(--bg4)', border: 'none', borderRadius: 3, padding: '2px 5px', cursor: 'pointer', fontFamily: 'var(--font)' }}>
            ✎
          </button>
        )}
      </div>

      {/* Timeline */}
      <div style={{ width: timelineW, flexShrink: 0, position: 'relative', height: rowH, background: hovered ? 'rgba(55,53,47,.013)' : 'transparent' }}>
        {/* Today line */}
        {todayCol >= 0 && todayCol < totalDays && (
          <div style={{ position: 'absolute', left: todayCol * DAY_W + Math.floor(DAY_W / 2), top: 0, bottom: 0, width: 1, background: 'var(--ac)', opacity: .35, pointerEvents: 'none' }} />
        )}

        {/* Milestone lines */}
        {milestoneMarkers.map(m => (
          <div
            key={m.id}
            title={m.name}
            style={{ position: 'absolute', left: m.col * DAY_W + Math.floor(DAY_W / 2), top: 0, bottom: 0, width: 1, borderLeft: '1px dashed rgba(139,92,246,.45)', pointerEvents: 'none', zIndex: 1 }}
          />
        ))}

        {/* Rollup bar */}
        {!hasOwnBar && rollup && (
          <div style={{ position: 'absolute', left: rollup.col * DAY_W + 2, width: rollup.span * DAY_W - 4, top: '50%', transform: 'translateY(-50%)', height: 6, borderRadius: 3, background: 'var(--bd2)', opacity: .6, pointerEvents: 'none' }} />
        )}

        {/* Task bar */}
        {hasOwnBar && (
          <div
            onMouseDown={e => {
              e.preventDefault()
              onBarMouseDown?.(e.clientX)
            }}
            onClick={onOpen}
            style={{
              position: 'absolute',
              left: barLeft * DAY_W + dragOffset * DAY_W + 2,
              width: barWidth,
              top: '50%', transform: 'translateY(-50%)',
              height: isChild ? 18 : 22,
              borderRadius: isChild ? 3 : 5,
              background: isOverdue ? 'rgba(239,68,68,.1)' : color.bg,
              border: `${isChild ? 1 : 1.5}px solid ${isOverdue ? '#ef4444' : isDragging ? color.text : color.text}`,
              display: 'flex', alignItems: 'center', paddingLeft: 6,
              overflow: 'hidden', zIndex: 1,
              cursor: isDragging ? 'grabbing' : 'grab',
              opacity: isDragging ? .85 : 1,
              boxShadow: isDragging ? '0 4px 12px rgba(0,0,0,.18)' : 'none',
              transition: isDragging ? 'none' : 'box-shadow .1s',
            }}
          >
            {barWidth > 54 && (
              <span style={{ fontSize: 10, fontWeight: 500, color: isOverdue ? '#ef4444' : color.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none' }}>
                {task.name}
              </span>
            )}
            {task.progress > 0 && (
              <div style={{ position: 'absolute', bottom: 0, left: 0, height: 3, width: `${task.progress}%`, opacity: .5, background: isOverdue ? '#ef4444' : color.text, borderRadius: '0 0 0 5px', pointerEvents: 'none' }} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
