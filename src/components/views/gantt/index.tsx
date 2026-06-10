import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useFilteredTasks } from '../../../hooks/useFilteredTasks'
import { useMobile } from '../../../hooks/useMobile'
import { useTaskStore } from '../../../store/taskStore'
import { useUiStore } from '../../../store/uiStore'
import { useMilestoneStore } from '../../../store/milestoneStore'
import { useProjectStore } from '../../../store/projectStore'
import { useAuthStore } from '../../../store/authStore'
import { getCatColor } from '../../../types'
import { CategoryBadge } from '../../shared/Badge'
import { addDays, toDate, fmtYMD, dayDiff, getBlockingCascade, canAccessProject } from '../../../lib/utils'
import type { Task, Milestone } from '../../../types'

const DAY_W = 26
const ROW_H = 36
const LEFT_W = 240
const MONTH_H = 28
const DAY_H = 24

interface DragData {
  taskId: string
  origStart: string
  origDue: string
  startX: number
}

type MilestoneGroup = { milestone: Milestone | null; tasks: Task[] }

export function GanttView() {
  const filteredTasks = useFilteredTasks()
  const allTasks = useTaskStore(s => s.tasks)
  const { updateTask } = useTaskStore()
  const { openTaskModal, openTaskDetail, projectId } = useUiStore()
  const allMilestones = useMilestoneStore(s => s.milestones)
  const { deleteMilestone } = useMilestoneStore()
  const projects = useProjectStore(s => s.projects)
  const email = useAuthStore(s => s.email)
  const milestones = useMemo(() => {
    const accessibleIds = new Set(projects.filter(p => canAccessProject(p, email)).map(p => p.id))
    return allMilestones.filter(m => accessibleIds.has(m.projectId))
  }, [allMilestones, projects, email])
  const isMobile = useMobile()
  // Narrow left column + tighter day cells on phones so the timeline gets room
  const leftW = isMobile ? 132 : LEFT_W
  const dayW = isMobile ? 22 : DAY_W
  const wrapRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [hoveredMilestoneId, setHoveredMilestoneId] = useState<string | null>(null)
  const [msCtxMenu, setMsCtxMenu] = useState<{ x: number; y: number; milestone: Milestone } | null>(null)

  const allTasksRef = useRef(allTasks)
  useEffect(() => { allTasksRef.current = allTasks }, [allTasks])

  const dragRef = useRef<DragData | null>(null)
  const cascadeIdsRef = useRef<Set<string>>(new Set())
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

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const dayOffset = Math.round((e.clientX - d.startX) / dayW)
      setDragVisual(prev =>
        prev?.dayOffset === dayOffset ? prev : { taskId: d.taskId, dayOffset }
      )
    }
    const onUp = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const dayOffset = Math.round((e.clientX - d.startX) / dayW)
      if (dayOffset !== 0) {
        const patch: Partial<Task> = {}
        if (d.origStart) patch.start = fmtYMD(addDays(toDate(d.origStart), dayOffset))
        if (d.origDue)   patch.due   = fmtYMD(addDays(toDate(d.origDue),   dayOffset))
        updateTask(d.taskId, patch)
        cascadeIdsRef.current.forEach(id => {
          const t = allTasksRef.current.find(t => t.id === id)
          if (!t) return
          const cp: Partial<Task> = {}
          if (t.start) cp.start = fmtYMD(addDays(toDate(t.start), dayOffset))
          if (t.due)   cp.due   = fmtYMD(addDays(toDate(t.due),   dayOffset))
          updateTask(id, cp)
        })
      }
      dragRef.current = null
      cascadeIdsRef.current = new Set()
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
  }, [updateTask, dayW])

  const startDrag = useCallback((data: DragData) => {
    dragRef.current = data
    cascadeIdsRef.current = new Set(getBlockingCascade(data.taskId, allTasksRef.current))
    setDragVisual({ taskId: data.taskId, dayOffset: 0 })
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
  }, [])

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
  const timelineW = totalDays * dayW
  const todayCol = dayDiff(rangeStart, today)

  const milestoneMarkers = useMemo(() => {
    return milestones
      .filter(m => !projectId || m.projectId === projectId)
      .map(m => ({ id: m.id, name: m.name, col: dayDiff(rangeStart, toDate(m.dueDate)) }))
      .filter(m => m.col >= 0 && m.col < totalDays)
  }, [milestones, projectId, rangeStart, totalDays])

  // Group root tasks by milestone — active milestones by due date, then unassigned, then done milestones
  const milestoneGroups = useMemo((): MilestoneGroup[] => {
    const all = milestones.filter(m => !projectId || m.projectId === projectId)
    const active = all.filter(m => !m.done).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    const done   = all.filter(m =>  m.done).sort((a, b) => a.dueDate.localeCompare(b.dueDate))

    const msMap = new Map<string, Task[]>()
    for (const m of all) msMap.set(m.id, [])

    const unassigned: Task[] = []
    for (const task of rootTasks) {
      if (task.milestoneId && msMap.has(task.milestoneId)) {
        msMap.get(task.milestoneId)!.push(task)
      } else {
        unassigned.push(task)
      }
    }

    const groups: MilestoneGroup[] = []
    for (const m of active) groups.push({ milestone: m, tasks: msMap.get(m.id)! })
    groups.push({ milestone: null, tasks: unassigned })
    for (const m of done)   groups.push({ milestone: m, tasks: msMap.get(m.id)! })
    return groups
  }, [rootTasks, milestones, projectId])

  const hasMilestones = milestoneGroups.some(g => g.milestone !== null)

  useEffect(() => {
    const el = wrapRef.current
    if (el) el.scrollLeft = Math.max(0, todayCol * dayW - (el.clientWidth - leftW) / 2)
  }, [todayCol, dayW, leftW])

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

  const getGroupRollup = (tasks: Task[]): { col: number; span: number } | null => {
    const all: Task[] = []
    tasks.forEach(t => { all.push(t); getChildren(t.id).forEach(c => all.push(c)) })
    const starts = all.filter(t => t.start).map(t => dayDiff(rangeStart, toDate(t.start!)))
    const ends   = all.filter(t => t.due).map(t => dayDiff(rangeStart, toDate(t.due!)))
    if (!starts.length && !ends.length) return null
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
    <div ref={wrapRef} style={{ flex: 1, overflow: 'auto', background: 'var(--bg)' }} onClick={() => setMsCtxMenu(null)}>
      {msCtxMenu && (
        <MilestoneCtxMenu
          x={msCtxMenu.x}
          y={msCtxMenu.y}
          onClose={() => setMsCtxMenu(null)}
          onAddTask={() => { openTaskModal(undefined, undefined, msCtxMenu.milestone.id, msCtxMenu.milestone.projectId); setMsCtxMenu(null) }}
          onDelete={() => { if (confirm(`"${msCtxMenu.milestone.name}" 마일스톤을 삭제할까요?`)) { deleteMilestone(msCtxMenu.milestone.id); setMsCtxMenu(null) } }}
        />
      )}
      <div style={{ minWidth: leftW + timelineW }}>

        {/* Month header */}
        <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 10, height: MONTH_H, background: 'var(--bg2)', borderBottom: '1px solid var(--bd)' }}>
          <div style={{ width: leftW, flexShrink: 0, position: 'sticky', left: 0, zIndex: 11, background: 'var(--bg2)', borderRight: '1px solid var(--bd)', display: 'flex', alignItems: 'center', paddingLeft: isMobile ? 8 : 16 }}>
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
              <div key={m.label} style={{ position: 'absolute', left: m.col * dayW, width: m.span * dayW, top: 0, bottom: 0, display: 'flex', alignItems: 'center', paddingLeft: 10, fontSize: 11, fontWeight: 600, color: 'var(--t2)', borderRight: '1px solid var(--bd)', overflow: 'hidden' }}>
                {m.label}
              </div>
            ))}
          </div>
        </div>

        {/* Day header */}
        <div style={{ display: 'flex', position: 'sticky', top: MONTH_H, zIndex: 10, height: DAY_H, background: 'var(--bg)', borderBottom: '2px solid var(--bd)' }}>
          <div style={{ width: leftW, flexShrink: 0, position: 'sticky', left: 0, zIndex: 11, background: 'var(--bg2)', borderRight: '1px solid var(--bd)' }} />
          <div style={{ position: 'relative', flexShrink: 0, width: timelineW }}>
            {days.map((d, i) => {
              const isToday = i === todayCol
              const isWeekend = d.getDay() === 0 || d.getDay() === 6
              const isMonthEnd = d.getDate() === new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
              return (
                <div key={i} style={{ position: 'absolute', left: i * dayW, width: dayW, height: DAY_H, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: isToday ? 'var(--ac)' : 'var(--t3)', fontWeight: isToday ? 700 : 400, background: isToday ? 'var(--ac-l)' : isWeekend ? 'var(--bg2)' : 'transparent', borderRight: isMonthEnd ? '1px solid var(--bd)' : 'none' }}>
                  {d.getDate()}
                </div>
              )
            })}
            {milestoneMarkers.map(m => (
              <MilestonePin key={m.id} marker={m} dayW={dayW} forceShow={hoveredMilestoneId === m.id} />
            ))}
          </div>
        </div>

        {/* Task rows — grouped by milestone */}
        {milestoneGroups.map(({ milestone, tasks }) => {
          const groupId = milestone?.id ?? '__unassigned__'
          const isGroupExpanded = !collapsed.has(groupId)
          const groupRollup = getGroupRollup(tasks)

          // Skip the unassigned group header when there are no milestones at all
          const showHeader = milestone !== null || hasMilestones

          return (
            <div key={groupId}>
              {showHeader && (
                <MilestoneHeaderRow
                  milestone={milestone}
                  isExpanded={isGroupExpanded}
                  onToggle={() => toggle(groupId)}
                  rollup={groupRollup}
                  rangeStart={rangeStart}
                  timelineW={timelineW}
                  totalDays={totalDays}
                  todayCol={todayCol}
                  milestoneMarkers={milestoneMarkers}
                  leftW={leftW}
                  dayW={dayW}
                  onHoverChange={id => setHoveredMilestoneId(id)}
                  onContextMenu={milestone ? (x, y) => setMsCtxMenu({ x, y, milestone }) : undefined}
                />
              )}

              {isGroupExpanded && tasks.map(task => {
                const children = getChildren(task.id)
                const hasChildren = children.length > 0
                const isExpanded = !collapsed.has(task.id)
                const hasOwnBar = !!(task.start || task.due)
                const rollup = !hasOwnBar ? getRollupBar(task.id) : null
                const isInCascade = dragVisual ? cascadeIdsRef.current.has(task.id) : false
                const dragOffset = dragVisual
                  ? (dragVisual.taskId === task.id || isInCascade ? dragVisual.dayOffset : 0)
                  : 0

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
                      isCascading={isInCascade}
                      milestoneMarkers={milestoneMarkers}
                      inGroup={hasMilestones}
                      leftW={leftW}
                      dayW={dayW}
                      compact={isMobile}
                      onOpen={() => openTaskDetail(task.id)}
                      onToggle={() => toggle(task.id)}
                      onAddSubtask={() => openTaskModal(undefined, task.id)}
                      onBarMouseDown={(startX) => startDrag({ taskId: task.id, origStart: task.start, origDue: task.due, startX })}
                    />
                    {hasChildren && isExpanded && children.map(child => {
                      const childInCascade = dragVisual ? cascadeIdsRef.current.has(child.id) : false
                      const childDragOffset = dragVisual
                        ? (dragVisual.taskId === child.id || childInCascade ? dragVisual.dayOffset : 0)
                        : 0
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
                          isCascading={childInCascade}
                          milestoneMarkers={milestoneMarkers}
                          inGroup={hasMilestones}
                          leftW={leftW}
                          dayW={dayW}
                          compact={isMobile}
                          onOpen={() => openTaskDetail(child.id)}
                          onBarMouseDown={(startX) => startDrag({ taskId: child.id, origStart: child.start, origDue: child.due, startX })}
                        />
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── MilestoneHeaderRow ────────────────────────────────────────────────────────

function MilestoneHeaderRow({ milestone, isExpanded, onToggle, rollup, rangeStart, timelineW, totalDays, todayCol, milestoneMarkers, leftW, dayW, onHoverChange, onContextMenu }: {
  milestone: Milestone | null
  isExpanded: boolean
  onToggle: () => void
  rollup: { col: number; span: number } | null
  rangeStart: Date
  timelineW: number
  totalDays: number
  todayCol: number
  milestoneMarkers: { id: string; col: number; name: string }[]
  leftW: number
  dayW: number
  onHoverChange?: (id: string | null) => void
  onContextMenu?: (x: number, y: number) => void
}) {
  const [hovered, setHovered] = useState(false)
  const isNull = milestone === null
  const isDone = milestone?.done === true
  const accent = isDone ? '#6b7280' : '#8b5cf6'
  const accentBg = isDone ? 'rgba(107,114,128,' : 'rgba(139,92,246,'

  const handleMouseEnter = () => { setHovered(true);  onHoverChange?.(milestone?.id ?? null) }
  const handleMouseLeave = () => { setHovered(false); onHoverChange?.(null) }

  // Long press for mobile
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lpActive = useRef(false)
  const lpStart = useRef({ x: 0, y: 0 })

  const onTouchStart = (e: React.TouchEvent) => {
    if (!onContextMenu) return
    const t = e.touches[0]
    lpStart.current = { x: t.clientX, y: t.clientY }
    lpActive.current = false
    lpTimer.current = setTimeout(() => {
      lpActive.current = true
      navigator.vibrate?.(40)
      onContextMenu(lpStart.current.x, lpStart.current.y)
    }, 500)
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (!lpTimer.current) return
    const t = e.touches[0]
    if (Math.abs(t.clientX - lpStart.current.x) > 6 || Math.abs(t.clientY - lpStart.current.y) > 6) {
      clearTimeout(lpTimer.current); lpTimer.current = null
    }
  }
  const onTouchEnd = () => { if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null } }

  return (
    <div
      className="lp-row"
      style={{ display: 'flex', height: ROW_H + 2, borderBottom: '1px solid var(--bd)', background: hovered ? (isNull ? 'var(--bg2)' : `${accentBg}.07)`) : (isNull ? 'transparent' : `${accentBg}.03)`) }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onContextMenu={onContextMenu ? e => { e.preventDefault(); onContextMenu(e.clientX, e.clientY) } : undefined}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Left */}
      <div
        onClick={() => { if (!lpActive.current) onToggle() }}
        style={{ width: leftW, flexShrink: 0, position: 'sticky', left: 0, zIndex: 2, background: hovered ? (isNull ? 'var(--bg2)' : `${accentBg}.07)`) : (isNull ? 'transparent' : `${accentBg}.03)`), borderRight: '1px solid var(--bd)', display: 'flex', alignItems: 'center', paddingLeft: 4, paddingRight: 8, gap: 5, overflow: 'hidden', cursor: 'pointer', transition: 'background .08s' }}
      >
        <button
          onClick={e => { e.stopPropagation(); onToggle() }}
          style={{ width: 18, height: 18, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', color: isNull ? 'var(--t3)' : accent, fontSize: 9, borderRadius: 3 }}
        >
          {isExpanded ? '▼' : '▶'}
        </button>
        {!isNull && <span style={{ fontSize: 11, color: accent, flexShrink: 0, lineHeight: 1, opacity: isDone ? .6 : 1 }}>◆</span>}
        <span style={{ fontSize: 12, fontWeight: 600, color: isNull ? 'var(--t3)' : accent, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: isDone ? .6 : 1, textDecoration: isDone ? 'line-through' : 'none' }}>
          {milestone?.name ?? '마일스톤 미지정'}
        </span>
        {milestone?.dueDate && (
          <span style={{ fontSize: 10, color: accent, opacity: isDone ? .4 : .65, flexShrink: 0 }}>
            ~{milestone.dueDate.slice(5)}
          </span>
        )}
      </div>

      {/* Timeline */}
      <div style={{ width: timelineW, flexShrink: 0, position: 'relative', height: ROW_H + 2 }}>
        {todayCol >= 0 && todayCol < totalDays && (
          <div style={{ position: 'absolute', left: todayCol * dayW + Math.floor(dayW / 2), top: 0, bottom: 0, width: 1, background: 'var(--ac)', opacity: .35, pointerEvents: 'none' }} />
        )}
        {milestoneMarkers.map(m => (
          <MilestoneLine key={m.id} marker={m} dayW={dayW} />
        ))}
        {rollup && (
          <div style={{ position: 'absolute', left: rollup.col * dayW + 2, width: rollup.span * dayW - 4, top: '50%', transform: 'translateY(-50%)', height: 8, borderRadius: 4, background: isNull ? 'rgba(100,100,100,.1)' : `${accentBg}.18)`, border: `1.5px solid ${isNull ? 'rgba(100,100,100,.3)' : `${accentBg}.45)`}`, pointerEvents: 'none', opacity: isDone ? .5 : 1 }} />
        )}
      </div>
    </div>
  )
}

// ── GanttRow ─────────────────────────────────────────────────────────────────

function GanttRow({
  task, rangeStart, todayCol, totalDays, timelineW, today,
  isChild = false, hasChildren = false, isExpanded = true,
  rollup = null, dragOffset = 0, isDragging = false, isCascading = false,
  milestoneMarkers = [], inGroup = false,
  leftW, dayW, compact = false,
  onOpen, onToggle, onAddSubtask, onBarMouseDown,
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
  isCascading?: boolean
  milestoneMarkers?: { id: string; col: number; name: string }[]
  inGroup?: boolean
  leftW: number
  dayW: number
  compact?: boolean
  onOpen: () => void
  onToggle?: () => void
  onAddSubtask?: () => void
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
    barWidth = Math.max((barRight - barLeft + 1) * dayW - 4, dayW - 4)
  }

  // indent: milestone header (0) → root task → subtask; tighter steps on compact
  const paddingLeft = isChild
    ? (compact ? (inGroup ? 26 : 18) : (inGroup ? 42 : 28))
    : (compact ? (inGroup ? 8 : 4) : (inGroup ? 18 : 4))

  const rowH = isChild ? ROW_H - 2 : ROW_H
  const rowBg = hovered ? 'var(--bg2)' : isChild ? 'rgba(55,53,47,.015)' : 'var(--bg)'

  return (
    <div
      className="lp-row"
      style={{ display: 'flex', height: rowH, borderBottom: '1px solid var(--bd)' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Left */}
      <div
        onClick={onOpen}
        style={{ width: leftW, flexShrink: 0, position: 'sticky', left: 0, zIndex: 2, background: rowBg, borderRight: '1px solid var(--bd)', display: 'flex', alignItems: 'center', paddingLeft, paddingRight: 8, gap: 4, overflow: 'hidden', cursor: 'pointer', transition: 'background .08s' }}
      >
        {isChild ? (
          <span style={{ fontSize: 10, color: 'var(--t3)', flexShrink: 0 }}>└</span>
        ) : (
          <button
            onClick={e => { e.stopPropagation(); onToggle?.() }}
            style={{ width: compact ? 14 : 18, height: 18, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: hasChildren ? 'pointer' : 'default', color: 'var(--t3)', fontSize: 9, borderRadius: 3, visibility: hasChildren ? 'visible' : 'hidden' }}
          >
            {isExpanded ? '▼' : '▶'}
          </button>
        )}

        {task.cat && !compact && <CategoryBadge cat={task.cat} />}

        <span style={{ fontSize: 12, flex: 1, color: isChild ? 'var(--t2)' : 'var(--t1)', fontWeight: !isChild && hasChildren ? 500 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {task.name}
        </span>

        {hovered && !compact && !isChild && onAddSubtask && (
          <button onClick={e => { e.stopPropagation(); onAddSubtask() }} style={{ flexShrink: 0, fontSize: 10, color: 'var(--ac)', background: 'var(--ac-l)', border: '1px solid var(--ac)', borderRadius: 3, padding: '2px 6px', cursor: 'pointer', fontFamily: 'var(--font)' }}>
            + 하위
          </button>
        )}
      </div>

      {/* Timeline */}
      <div style={{ width: timelineW, flexShrink: 0, position: 'relative', height: rowH, background: hovered ? 'rgba(55,53,47,.013)' : 'transparent' }}>
        {todayCol >= 0 && todayCol < totalDays && (
          <div style={{ position: 'absolute', left: todayCol * dayW + Math.floor(dayW / 2), top: 0, bottom: 0, width: 1, background: 'var(--ac)', opacity: .35, pointerEvents: 'none' }} />
        )}
        {milestoneMarkers.map(m => (
          <MilestoneLine key={m.id} marker={m} dayW={dayW} />
        ))}
        {!hasOwnBar && rollup && (
          <div style={{ position: 'absolute', left: rollup.col * dayW + 2, width: rollup.span * dayW - 4, top: '50%', transform: 'translateY(-50%)', height: 6, borderRadius: 3, background: 'var(--bd2)', opacity: .6, pointerEvents: 'none' }} />
        )}
        {hasOwnBar && (
          <div
            onMouseDown={e => { e.preventDefault(); onBarMouseDown?.(e.clientX) }}
            onClick={onOpen}
            style={{
              position: 'absolute',
              left: barLeft * dayW + dragOffset * dayW + 2,
              width: barWidth,
              top: '50%', transform: 'translateY(-50%)',
              height: isChild ? 18 : 22,
              borderRadius: isChild ? 3 : 5,
              background: isOverdue ? 'rgba(239,68,68,.1)' : color.bg,
              border: `${isChild ? 1 : 1.5}px solid ${isOverdue ? '#ef4444' : color.text}`,
              display: 'flex', alignItems: 'center', paddingLeft: 6,
              overflow: 'hidden', zIndex: 1,
              cursor: isDragging ? 'grabbing' : 'grab',
              opacity: isDragging ? .85 : isCascading ? .7 : 1,
              boxShadow: isDragging ? '0 4px 12px rgba(0,0,0,.18)' : isCascading ? '0 2px 8px rgba(0,0,0,.12)' : 'none',
              outline: isCascading ? '1.5px dashed ' + color.text : 'none',
              outlineOffset: 1,
              transition: isDragging || isCascading ? 'none' : 'box-shadow .1s',
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

// ── Milestone UI helpers ──────────────────────────────────────────────────────

function MilestonePin({ marker, dayW, forceShow }: { marker: { id: string; name: string; col: number }; dayW: number; forceShow?: boolean }) {
  const [hovered, setHovered] = useState(false)
  const show = hovered || forceShow
  const left = marker.col * dayW + Math.floor(dayW / 2)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: 'absolute', left: left - 7, top: 2, zIndex: 3, cursor: 'default' }}
    >
      <span style={{ fontSize: 12, color: '#8b5cf6', lineHeight: 1, display: 'block', filter: show ? 'drop-shadow(0 0 4px #8b5cf6aa)' : 'none', transition: 'filter .15s' }}>◆</span>
      {show && (
        <div style={{ position: 'absolute', top: 18, left: '50%', transform: 'translateX(-50%)', background: '#1e1b4b', color: '#c4b5fd', fontSize: 11, fontWeight: 600, padding: '4px 8px', borderRadius: 5, whiteSpace: 'nowrap', pointerEvents: 'none', boxShadow: '0 4px 12px rgba(0,0,0,.3)', zIndex: 20 }}>
          ◆ {marker.name}
        </div>
      )}
    </div>
  )
}

function MilestoneCtxMenu({ x, y, onClose, onAddTask, onDelete }: {
  x: number; y: number
  onClose: () => void
  onAddTask: () => void
  onDelete: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) { if (e.key === 'Escape') onClose(); return }
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [onClose])

  const menuW = 180
  const cx = Math.min(x, window.innerWidth - menuW - 8)
  const cy = Math.min(y, window.innerHeight - 100)

  return (
    <div ref={ref} onClick={e => e.stopPropagation()} style={{ position: 'fixed', left: cx, top: cy, width: menuW, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r3)', boxShadow: '0 8px 28px rgba(0,0,0,.18)', zIndex: 500, padding: '4px 0', userSelect: 'none' }}>
      <CtxItem icon="+" label="새 업무 추가" onClick={onAddTask} />
      <div style={{ height: 1, background: 'var(--bd)', margin: '3px 0' }} />
      <CtxItem icon="✕" label="마일스톤 삭제" onClick={onDelete} danger />
    </div>
  )
}

function CtxItem({ icon, label, onClick, danger }: { icon: string; label: string; onClick: () => void; danger?: boolean }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 13, color: danger ? '#ef4444' : 'var(--t1)', background: hovered ? 'var(--bg3)' : 'transparent', transition: 'background .06s' }}>
      <span style={{ fontSize: 12, width: 16, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
      {label}
    </div>
  )
}

function MilestoneLine({ marker, dayW }: { marker: { id: string; name: string; col: number }; dayW: number }) {
  const [hovered, setHovered] = useState(false)
  const left = marker.col * dayW + Math.floor(dayW / 2)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: 'absolute', left: left - 6, top: 0, bottom: 0, width: 12, zIndex: 1, cursor: 'default' }}
    >
      <div style={{ position: 'absolute', left: 5, top: 0, bottom: 0, width: hovered ? 2 : 1, background: hovered ? '#8b5cf6' : 'rgba(139,92,246,.4)', transition: 'width .1s, background .1s', borderRadius: 1 }} />
      {hovered && (
        <div style={{ position: 'absolute', top: '30%', left: 14, background: '#1e1b4b', color: '#c4b5fd', fontSize: 11, fontWeight: 600, padding: '3px 7px', borderRadius: 5, whiteSpace: 'nowrap', pointerEvents: 'none', boxShadow: '0 4px 12px rgba(0,0,0,.25)', zIndex: 20 }}>
          ◆ {marker.name}
        </div>
      )}
    </div>
  )
}
