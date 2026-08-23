import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useFilteredTasks } from '../../../hooks/useFilteredTasks'
import { useMobile } from '../../../hooks/useMobile'
import { haptic } from '../../../lib/haptics'
import { useTaskStore } from '../../../store/taskStore'
import { useUiStore } from '../../../store/uiStore'
import { useMilestoneStore } from '../../../store/milestoneStore'
import { useProjectStore } from '../../../store/projectStore'
import { useAuthStore } from '../../../store/authStore'
import { getCatColor } from '../../../types'
import { CategoryBadge } from '../../shared/Badge'
import { DateField } from '../../shared/DatePicker'
import { askConfirm } from '../../shared/Confirm'
import { addDays, toDate, fmtYMD, dayDiff, getBlockingCascade, isComposing } from '../../../lib/utils'
import type { Task, Milestone, Project } from '../../../types'

/**
 * ── The Gantt ────────────────────────────────────────────────────────────────
 *
 * A Gantt chart is for one question — when does this happen, and what is it
 * waiting on — and this one used to answer it only for work that already had
 * dates. Everything else sat in the left column with an empty lane beside it
 * and no way to fix that without leaving for a modal.
 *
 * So the lane is the input now. Drag across an empty one and the task takes
 * those days; drag across a milestone's own lane and a task is born there,
 * named on the spot. Bars have edges you can pull, dependencies are drawn as
 * the arrows they have always been in every other Gantt, and 일/주/월 decide
 * how much of the year fits on the screen.
 */

type Zoom = 'day' | 'week' | 'month'
const ZOOM_W:        Record<Zoom, number> = { day: 28, week: 11, month: 4.4 }
const ZOOM_W_MOBILE: Record<Zoom, number> = { day: 22, week: 9,  month: 4   }
const ZOOM_LABEL:    Record<Zoom, string> = { day: '일', week: '주', month: '월' }

// Tallest at the top of the hierarchy. The milestone row used to be taller than
// the project band above it, which said the wrong thing about which contains
// which.
const PROJECT_H = 38
const GROUP_H   = 34
const ROW_H     = 32
const CHILD_H   = 28

/**
 * The project band's fill.
 *
 * Composited over the page rather than left as an alpha: --bg3 is translucent,
 * and a pinned column with alpha in it is a window onto the timeline scrolling
 * behind it. That is what put a rollup bar and the today line inside the name
 * column.
 */
const BAND       = 'linear-gradient(var(--bg3), var(--bg3)), var(--bg)'
const BAND_HOVER = 'linear-gradient(var(--bg4), var(--bg4)), var(--bg)'
const LEFT_W  = 248
const MONTH_H = 26
const DAY_H   = 24
const HEADER_H = MONTH_H + DAY_H
const HANDLE  = 7
/** Below this the gesture was a click, not a drag. */
const MIN_DRAG = 4

const MS_COLOR = '#9065B0'

/** Omit that distributes over the union rather than collapsing it. */
type NoY<T> = T extends unknown ? Omit<T, 'y'> : never

type RowSpec =
  | { kind: 'project'; key: string; groupId: string; project: Project | null; tasks: Task[]; y: number; h: number }
  | { kind: 'group'; key: string; groupId: string; milestone: Milestone | null; tasks: Task[]; depth: number; y: number; h: number }
  | { kind: 'task';  key: string; task: Task; child: boolean; depth: number; y: number; h: number }

/** What a pointer drag is currently doing. */
type Drag = {
  mode: 'move' | 'start' | 'end' | 'create' | 'milestone'
  taskId: string
  origStart: string
  origDue: string
  startX: number
  lane: HTMLElement
  anchorCol: number
  cascade: string[]
  /** Set when the drag is drawing a task that does not exist yet. */
}

type Visual =
  | { mode: 'move' | 'start' | 'end' | 'milestone'; taskId: string; offset: number }
  | { mode: 'create'; taskId: string; from: number; to: number }

export function GanttView() {
  const filteredTasks = useFilteredTasks()
  const allTasks = useTaskStore(s => s.tasks)
  const { updateTask, addTask, deleteTask } = useTaskStore()
  const { openTaskModal, openTaskDetail, projectId, hideCompleted, setProject } = useUiStore()
  const allMilestones = useMilestoneStore(s => s.milestones)
  const { deleteMilestone, updateMilestone } = useMilestoneStore()
  const projects = useProjectStore(s => s.projects)
  const email = useAuthStore(s => s.email)
  const isMobile = useMobile()

  const milestones = useMemo(() => {
    const accessibleIds = new Set(projects.map(p => p.id))
    return allMilestones.filter(m => accessibleIds.has(m.projectId))
  }, [allMilestones, projects, email])

  const [zoom, setZoom] = useState<Zoom>('day')
  const dayW = (isMobile ? ZOOM_W_MOBILE : ZOOM_W)[zoom]
  const leftW = isMobile ? 138 : LEFT_W

  const wrapRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null)
  const [hoveredMilestoneId, setHoveredMilestoneId] = useState<string | null>(null)
  const [msCtxMenu, setMsCtxMenu] = useState<{ x: number; y: number; milestone: Milestone } | null>(null)
  /** A task being named in place. `chain` keeps the next one coming on Enter. */
  const [renaming, setRenaming] = useState<{ id: string; chain: boolean } | null>(null)
  const [markUnplaced, setMarkUnplaced] = useState(false)

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])

  const rootTasks = filteredTasks.filter(t => !t.parentId)
  const getChildren = useCallback(
    (id: string) => allTasks.filter(t => t.parentId === id && (!hideCompleted || t.status !== '완료')),
    [allTasks, hideCompleted],
  )

  const toggle = (id: string) =>
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  // ── The span of time on screen ─────────────────────────────────────────────
  // Today and the next two months are always in it, dated or not: an empty lane
  // you cannot drag into is no better than no lane.
  const { rangeStart, rangeEnd } = useMemo(() => {
    const marks: number[] = [today.getTime(), addDays(today, 60).getTime()]
    const consider = (t: Task) => {
      if (t.start) marks.push(toDate(t.start).getTime())
      if (t.due)   marks.push(toDate(t.due).getTime())
    }
    for (const t of filteredTasks) { consider(t); getChildren(t.id).forEach(consider) }
    for (const m of milestones) {
      if (!projectId || m.projectId === projectId) marks.push(toDate(m.dueDate).getTime())
    }
    const PAD = 14
    return {
      rangeStart: addDays(new Date(Math.min(...marks)), -PAD),
      rangeEnd:   addDays(new Date(Math.max(...marks)),  PAD),
    }
  }, [filteredTasks, allTasks, milestones, projectId, today, getChildren])

  const totalDays = dayDiff(rangeStart, rangeEnd) + 1
  const timelineW = totalDays * dayW
  const todayCol  = dayDiff(rangeStart, today)

  const colOf = (ymd: string) => dayDiff(rangeStart, toDate(ymd))
  const dateOf = (col: number) => fmtYMD(addDays(rangeStart, col))

  const milestoneMarkers = useMemo(
    () => milestones
      .filter(m => !projectId || m.projectId === projectId)
      .map(m => ({ id: m.id, name: m.name, col: colOf(m.dueDate), done: !!m.done }))
      .filter(m => m.col >= 0 && m.col < totalDays),
    [milestones, projectId, rangeStart, totalDays],
  )

  // ── Rows, flattened ───────────────────────────────────────────────────────
  // One list with a y for each row, so bars, arrows and the drag ghost can all
  // be placed from the same arithmetic instead of three separate nestings.
  const { rows, contentH } = useMemo(() => {
    const out: RowSpec[] = []
    let y = 0
    const push = (r: NoY<RowSpec>) => { out.push({ ...r, y } as RowSpec); y += r.h }

    /**
     * One project's milestones, and the tasks filed under each.
     *
     * `depth` is how far in the rows sit: with a project band above them they
     * are one step further right than they are inside a single project's view.
     */
    const pushMilestones = (pid: string | undefined, tasks: Task[], depth: number) => {
      const all = milestones.filter(m => m.projectId === pid)
      const active = all.filter(m => !m.done).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      const done   = all.filter(m =>  m.done).sort((a, b) => a.dueDate.localeCompare(b.dueDate))

      const byMilestone = new Map<string, Task[]>()
      for (const m of all) byMilestone.set(m.id, [])
      const unassigned: Task[] = []
      for (const task of tasks) {
        if (task.milestoneId && byMilestone.has(task.milestoneId)) byMilestone.get(task.milestoneId)!.push(task)
        else unassigned.push(task)
      }

      const groups: { milestone: Milestone | null; tasks: Task[] }[] = [
        ...active.map(m => ({ milestone: m, tasks: byMilestone.get(m.id)! })),
        { milestone: null, tasks: unassigned },
        ...done.map(m => ({ milestone: m, tasks: byMilestone.get(m.id)! })),
      ]
      const anyMilestone = groups.some(g => g.milestone !== null)

      for (const g of groups) {
        const groupId = g.milestone?.id ?? `__unassigned__:${pid ?? 'none'}`
        // The catch-all group only earns a header once there is something to
        // catch tasks from.
        const headed = g.milestone !== null || anyMilestone
        if (headed) {
          push({ kind: 'group', key: `g:${groupId}`, groupId, milestone: g.milestone, tasks: g.tasks, depth, h: GROUP_H })
          if (collapsed.has(groupId)) continue
        }
        for (const task of g.tasks) {
          push({ kind: 'task', key: task.id, task, child: false, depth: depth + (headed ? 1 : 0), h: ROW_H })
          if (collapsed.has(task.id)) continue
          for (const c of getChildren(task.id)) {
            push({ kind: 'task', key: c.id, task: c, child: true, depth: depth + (headed ? 1 : 0), h: CHILD_H })
          }
        }
      }
    }

    // Inside one project there is nothing to separate; across all of them the
    // milestones of five projects otherwise read as one list of ten.
    if (projectId) {
      pushMilestones(projectId, rootTasks, 0)
      return { rows: out, contentH: y }
    }

    const byProject = new Map<string, Task[]>()
    for (const task of rootTasks) {
      const key = task.projectId ?? '__none__'
      const at = byProject.get(key)
      if (at) at.push(task); else byProject.set(key, [task])
    }

    for (const project of projects) {
      const tasks = byProject.get(project.id) ?? []
      const hasWork = tasks.length > 0 || milestones.some(m => m.projectId === project.id)
      if (!hasWork) continue
      push({ kind: 'project', key: `p:${project.id}`, groupId: `p:${project.id}`, project, tasks, h: PROJECT_H })
      if (collapsed.has(`p:${project.id}`)) continue
      pushMilestones(project.id, tasks, 1)
    }

    const orphans = byProject.get('__none__') ?? []
    if (orphans.length) {
      push({ kind: 'project', key: 'p:none', groupId: 'p:none', project: null, tasks: orphans, h: PROJECT_H })
      if (!collapsed.has('p:none')) pushMilestones(undefined, orphans, 1)
    }

    return { rows: out, contentH: y }
  }, [rootTasks, milestones, projects, projectId, collapsed, getChildren])

  const unplacedCount = useMemo(
    () => rows.filter(r => r.kind === 'task' && !r.task.start && !r.task.due).length,
    [rows],
  )

  // ── Dragging ──────────────────────────────────────────────────────────────
  const dragRef = useRef<Drag | null>(null)
  const [visual, setVisual] = useState<Visual | null>(null)
  const allTasksRef = useRef(allTasks); allTasksRef.current = allTasks
  const dayWRef = useRef(dayW);         dayWRef.current = dayW

  /** A drag that moved must not also read as a click on the bar underneath. */
  const movedRef = useRef(false)

  const beginDrag = useCallback((d: Drag) => {
    dragRef.current = d
    movedRef.current = false
    // No ghost until the pointer has actually travelled: otherwise every click
    // on a lane flashes a one-day bar that was never going to be created.
    setVisual(d.mode === 'create' ? null : { mode: d.mode, taskId: d.taskId, offset: 0 })
    document.body.style.cursor = d.mode === 'move' || d.mode === 'milestone' ? 'grabbing' : d.mode === 'create' ? 'crosshair' : 'ew-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const colAt = (d: Drag, clientX: number) =>
      Math.floor((clientX - d.lane.getBoundingClientRect().left) / dayWRef.current)

    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      if (Math.abs(e.clientX - d.startX) >= MIN_DRAG) movedRef.current = true
      if (d.mode === 'create') {
        if (!movedRef.current) return
        const col = Math.max(0, Math.min(totalDays - 1, colAt(d, e.clientX)))
        setVisual(prev => {
          const next = { mode: 'create' as const, taskId: d.taskId, from: Math.min(d.anchorCol, col), to: Math.max(d.anchorCol, col) }
          return prev && prev.mode === 'create' && prev.from === next.from && prev.to === next.to ? prev : next
        })
        return
      }
      const mode = d.mode
      const offset = Math.round((e.clientX - d.startX) / dayWRef.current)
      setVisual(prev => (prev && 'offset' in prev && prev.offset === offset ? prev : { mode, taskId: d.taskId, offset }))
    }

    const onUp = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      dragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setVisual(null)

      if (d.mode === 'create') {
        const moved = movedRef.current
        const col = Math.max(0, Math.min(totalDays - 1, colAt(d, e.clientX)))
        const from = Math.min(d.anchorCol, col)
        const to   = Math.max(d.anchorCol, col)
        // A click that never moved is not a schedule; it would drop a one-day
        // task on the calendar every time somebody tapped an empty lane.
        if (!moved) return
        haptic('success')
        // 빈 레인을 그으면 그 줄의 업무에 기간이 생깁니다. 없던 업무를 만드는
        // 길이었던 가지는 마일스톤 줄에서만 쓰였고, 그 줄은 이제 아무 제스처도
        // 광고하지 않습니다.
        updateTask(d.taskId, { start: dateOf(from), due: dateOf(to) })
        return
      }

      const offset = Math.round((e.clientX - d.startX) / dayWRef.current)
      if (offset === 0) return
      haptic('tap')
      const shiftDate = (ymd: string) => fmtYMD(addDays(toDate(ymd), offset))

      if (d.mode === 'milestone') {
        updateMilestone(d.taskId, { dueDate: shiftDate(d.origDue) })
        return
      }

      if (d.mode === 'move') {
        const patch: Partial<Task> = {}
        if (d.origStart) patch.start = shiftDate(d.origStart)
        if (d.origDue)   patch.due   = shiftDate(d.origDue)
        updateTask(d.taskId, patch)
        // Whatever this task blocks moves with it, or the plan silently breaks
        // its own order.
        d.cascade.forEach(id => {
          const t = allTasksRef.current.find(t => t.id === id)
          if (!t) return
          const cp: Partial<Task> = {}
          if (t.start) cp.start = shiftDate(t.start)
          if (t.due)   cp.due   = shiftDate(t.due)
          updateTask(id, cp)
        })
        return
      }

      // An edge pull moves one end only, and never past the other.
      const start = d.origStart || d.origDue
      const due   = d.origDue   || d.origStart
      if (d.mode === 'start') {
        const next = shiftDate(start)
        updateTask(d.taskId, { start: next > due ? due : next, due })
      } else {
        const next = shiftDate(due)
        updateTask(d.taskId, { start, due: next < start ? start : next })
      }
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [updateTask, addTask, updateMilestone, totalDays, rangeStart, email])

  const laneMouseDown = (e: React.MouseEvent, opts: { taskId: string; task?: Task }) => {
    if (e.button !== 0) return
    const lane = e.currentTarget as HTMLElement
    const anchorCol = Math.floor((e.clientX - lane.getBoundingClientRect().left) / dayW)
    e.preventDefault()
    beginDrag({
      mode: 'create', taskId: opts.taskId, lane, startX: e.clientX, anchorCol,
      origStart: opts.task?.start ?? '', origDue: opts.task?.due ?? '', cascade: [],
    })
  }

  const milestoneMouseDown = (e: React.MouseEvent, ms: Milestone) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const lane = (e.currentTarget as HTMLElement).closest('[data-lane]') as HTMLElement
    beginDrag({
      mode: 'milestone', taskId: ms.id, lane, startX: e.clientX, anchorCol: 0,
      origStart: ms.dueDate, origDue: ms.dueDate, cascade: [],
    })
  }

  const barMouseDown = (e: React.MouseEvent, task: Task, mode: 'move' | 'start' | 'end') => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const lane = (e.currentTarget as HTMLElement).closest('[data-lane]') as HTMLElement
    beginDrag({
      mode, taskId: task.id, lane, startX: e.clientX, anchorCol: 0,
      origStart: task.start, origDue: task.due,
      cascade: mode === 'move' ? getBlockingCascade(task.id, allTasksRef.current) : [],
    })
  }

  // ── Where each bar ended up, for the dependency arrows ────────────────────
  const cascadeSet = useMemo(
    () => new Set(visual && visual.mode === 'move' ? getBlockingCascade(visual.taskId, allTasks) : []),
    [visual, allTasks],
  )

  const barBoxes = useMemo(() => {
    const map = new Map<string, { left: number; right: number; cy: number }>()
    for (const r of rows) {
      if (r.kind !== 'task') continue
      const t = r.task
      if (!t.start && !t.due) continue
      const shift = visual && 'offset' in visual && (visual.taskId === t.id || (visual.mode === 'move' && cascadeSet.has(t.id)))
        ? visual.offset : 0
      const s = colOf(t.start || t.due) + (visual?.mode === 'end' && visual.taskId === t.id ? 0 : shift)
      const e = colOf(t.due || t.start) + (visual?.mode === 'start' && visual.taskId === t.id ? 0 : shift)
      map.set(t.id, { left: s * dayW, right: (e + 1) * dayW, cy: r.y + r.h / 2 })
    }
    return map
  }, [rows, dayW, rangeStart, visual, cascadeSet])

  const arrows = useMemo(() => {
    const out: { key: string; from: string; to: string; d: string; head: string }[] = []
    for (const r of rows) {
      if (r.kind !== 'task') continue
      for (const targetId of r.task.blocking ?? []) {
        const a = barBoxes.get(r.task.id)
        const b = barBoxes.get(targetId)
        if (!a || !b) continue
        out.push({ key: `${r.task.id}->${targetId}`, from: r.task.id, to: targetId, ...elbow(a.right, a.cy, b.left, b.cy) })
      }
    }
    return out
  }, [rows, barBoxes])

  // ── Adding ────────────────────────────────────────────────────────────────
  const projectFor = (m: Milestone | null) => m?.projectId ?? projectId ?? ''

  const addInGroup = (m: Milestone | null) => {
    const pid = projectFor(m)
    // With no project in scope there is nothing to file it under, and guessing
    // one is worse than asking.
    if (!pid) { openTaskModal(undefined, undefined, m?.id, undefined); return }
    haptic('tap')
    const created = addTask({
      type: '상위', name: '', cat: '', assignee: '', priority: '중간', status: '대기',
      progress: 0, memo: '', start: '', due: '', projectId: pid,
      ...(m ? { milestoneId: m.id } : null),
      createdBy: email ?? undefined,
    })
    setCollapsed(prev => { const n = new Set(prev); n.delete(m?.id ?? '__unassigned__'); return n })
    setRenaming({ id: created.id, chain: true })
  }

  /** Nothing nameless survives: an empty name means the row was abandoned. */
  const commitName = (task: Task, name: string, thenAnother: boolean) => {
    const trimmed = name.trim()
    if (!trimmed) { deleteTask(task.id); setRenaming(null); return }
    updateTask(task.id, { name: trimmed })
    if (!thenAnother) { setRenaming(null); return }
    const created = addTask({
      type: '상위', name: '', cat: task.cat, assignee: '', priority: '중간', status: '대기',
      progress: 0, memo: '', start: '', due: '', projectId: task.projectId,
      ...(task.milestoneId ? { milestoneId: task.milestoneId } : null),
      createdBy: email ?? undefined,
    })
    setRenaming({ id: created.id, chain: true })
  }

  // ── Scrolling ─────────────────────────────────────────────────────────────
  const scrollToToday = useCallback(() => {
    const el = wrapRef.current
    if (el) el.scrollTo({ left: Math.max(0, todayCol * dayW - (el.clientWidth - leftW) / 2), behavior: 'smooth' })
  }, [todayCol, dayW, leftW])

  const centred = useRef(false)
  useEffect(() => {
    const el = wrapRef.current
    if (!el || centred.current) return
    el.scrollLeft = Math.max(0, todayCol * dayW - (el.clientWidth - leftW) / 2)
    centred.current = true
  }, [todayCol, dayW, leftW])

  const months = useMemo(() => {
    const res: { label: string; short: string; col: number; span: number }[] = []
    let cur = new Date(rangeStart)
    while (cur <= rangeEnd) {
      const col = dayDiff(rangeStart, cur)
      const monthEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0)
      const span = dayDiff(cur, monthEnd < rangeEnd ? monthEnd : rangeEnd) + 1
      res.push({ label: `${cur.getFullYear()}년 ${cur.getMonth() + 1}월`, short: `${cur.getMonth() + 1}월`, col, span })
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
    }
    return res
  }, [rangeStart, rangeEnd])

  const ticks = useMemo(() => {
    const out: { col: number; label: string; weekend: boolean; week: boolean }[] = []
    for (let i = 0; i < totalDays; i++) {
      const d = addDays(rangeStart, i)
      const dow = d.getDay()
      // At a week or a month to the screen there is no room to number every
      // day, so only the Mondays are labelled and the weekends carry the rhythm.
      if (zoom !== 'day' && dow !== 1) {
        out.push({ col: i, label: '', weekend: dow === 0 || dow === 6, week: false })
        continue
      }
      out.push({ col: i, label: String(d.getDate()), weekend: dow === 0 || dow === 6, week: dow === 1 })
    }
    return out
  }, [rangeStart, totalDays, zoom])

  if (rows.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Toolbar
          zoom={zoom} setZoom={setZoom} onToday={scrollToToday}
          unplaced={0} markUnplaced={markUnplaced} setMarkUnplaced={setMarkUnplaced} isMobile={isMobile}
        />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t3)', fontSize: 14 }}>
          업무가 없습니다
        </div>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Toolbar
        zoom={zoom} setZoom={setZoom} onToday={scrollToToday}
        unplaced={unplacedCount} markUnplaced={markUnplaced} setMarkUnplaced={setMarkUnplaced} isMobile={isMobile}
      />

      <div ref={wrapRef} style={{ flex: 1, overflow: 'auto', background: 'var(--bg)' }} onClick={() => setMsCtxMenu(null)}>
        {msCtxMenu && (
          <MilestoneCtxMenu
            x={msCtxMenu.x}
            y={msCtxMenu.y}
            onClose={() => setMsCtxMenu(null)}
            onAddTask={() => { addInGroup(msCtxMenu.milestone); setMsCtxMenu(null) }}
            onDelete={async () => {
              if (await askConfirm({ message: `"${msCtxMenu.milestone.name}" 마일스톤을 삭제할까요?` })) {
                deleteMilestone(msCtxMenu.milestone.id)
                setMsCtxMenu(null)
              }
            }}
          />
        )}

        <div style={{ minWidth: leftW + timelineW, position: 'relative' }}>

          {/*
            머리글은 하나입니다.

            달 띠와 날짜 띠가 각각 sticky이던 시절, 둘은 서로 다른 두 개의
            고정 요소라 스크롤 위치가 반 픽셀에 걸릴 때마다 사이에 머리카락
            같은 틈이 생겼습니다 — 그리로 아래 내용이 지나가는 게 보였고,
            왼쪽 업무 열에서 특히 눈에 띄었습니다.

            이제 하나가 고정되고 두 띠는 그 안에 있습니다. 남는 건 머리글과
            본문 사이 한 줄뿐이고, 그건 요소 바깥에 그려지는 그림자로 덮습니다.
          */}
          <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg2)', boxShadow: '0 1px 0 var(--bd)' }}>

          {/* Month band */}
          <div style={{ display: 'flex', height: MONTH_H, background: 'var(--bg2)', borderBottom: '1px solid var(--bd)' }}>
            <div style={{ width: leftW, flexShrink: 0, position: 'sticky', left: 0, zIndex: 11, background: 'var(--bg2)', borderRight: '1px solid var(--bd)', display: 'flex', alignItems: 'center', paddingLeft: isMobile ? 8 : 14, fontSize: 11, fontWeight: 600, color: 'var(--t3)' }}>
              업무
            </div>
            <div style={{ width: timelineW, flexShrink: 0, position: 'relative' }}>
              {months.map(m => (
                <div key={m.label} style={{ position: 'absolute', left: m.col * dayW, width: m.span * dayW, top: 0, bottom: 0, display: 'flex', alignItems: 'center', paddingLeft: 8, fontSize: 11, fontWeight: 600, color: 'var(--t2)', borderRight: '1px solid var(--bd)', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                  {m.span * dayW > 74 ? m.label : m.short}
                </div>
              ))}
            </div>
          </div>

          {/* Day band */}
          <div style={{ display: 'flex', height: DAY_H, background: 'var(--bg)', borderBottom: '2px solid var(--bd)' }}>
            <div style={{ width: leftW, flexShrink: 0, position: 'sticky', left: 0, zIndex: 11, background: 'var(--bg2)', borderRight: '1px solid var(--bd)' }} />
            <div style={{ position: 'relative', flexShrink: 0, width: timelineW }}>
              {ticks.map(t => (
                <div key={t.col} style={{
                  position: 'absolute', left: t.col * dayW, width: dayW, height: DAY_H,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontVariantNumeric: 'tabular-nums',
                  color: t.col === todayCol ? 'var(--ac)' : 'var(--t3)',
                  fontWeight: t.col === todayCol ? 700 : 400,
                  background: t.col === todayCol ? 'var(--ac-l)' : t.weekend ? 'var(--bg2)' : 'transparent',
                  borderLeft: t.week ? '1px solid var(--bd)' : 'none',
                  overflow: 'hidden',
                }}>
                  {t.label}
                </div>
              ))}
              {milestoneMarkers.map(m => (
                <MilestonePin key={m.id} marker={m} dayW={dayW} forceShow={hoveredMilestoneId === m.id} />
              ))}
            </div>
          </div>

          </div>

          {/* One backdrop for the whole chart: weekends, today, milestone lines.
              Drawn once here rather than once per row, which is what it used to
              cost. */}
          <Backdrop
            left={leftW} width={timelineW} height={contentH}
            dayW={dayW} zoom={zoom} ticks={ticks}
            // Full-height lines belong to one project's plan. Across several
            // they stack into a barcode nobody can read a date off.
            markers={projectId ? milestoneMarkers : []} hoveredMilestoneId={hoveredMilestoneId}
          />

          {todayCol >= 0 && (
            <TodayLine left={leftW} top={HEADER_H} height={contentH} x={todayCol * dayW + Math.floor(dayW / 2)} />
          )}

          {/* Dependencies, tucked behind the bars they connect. */}
          {arrows.length > 0 && (
            <svg
              width={timelineW} height={contentH}
              style={{ position: 'absolute', left: leftW, top: HEADER_H, zIndex: 1, pointerEvents: 'none', overflow: 'visible' }}
            >
              {arrows.map(a => {
                const lit = hoveredTaskId === a.from || hoveredTaskId === a.to
                return (
                  <g key={a.key} opacity={lit ? 1 : .38}>
                    <path d={a.d} fill="none" stroke={lit ? 'var(--ac)' : 'var(--t3)'} strokeWidth={lit ? 1.6 : 1.2} />
                    <path d={a.head} fill={lit ? 'var(--ac)' : 'var(--t3)'} />
                  </g>
                )
              })}
            </svg>
          )}

          {/* Rows.
              The slack at the foot is deliberate: without it the last row ends
              flush against the bottom bar, which looks like the chart has been
              cut rather than finished. */}
          <div style={{ position: 'relative', zIndex: 2, paddingBottom: isMobile ? 20 : 8 }}>
            {rows.map(row => row.kind === 'project' ? (
              <ProjectRow
                key={row.key}
                project={row.project}
                expanded={!collapsed.has(row.groupId)}
                onToggle={() => toggle(row.groupId)}
                rollup={groupRollup(row.tasks, getChildren, rangeStart)}
                count={row.tasks.length}
                timelineW={timelineW}
                leftW={leftW}
                dayW={dayW}
                compact={isMobile}
                onOpen={() => row.project && setProject(row.project.id)}
              />
            ) : row.kind === 'group' ? (
              <MilestoneRow
                key={row.key}
                milestone={row.milestone}
                compact={isMobile}
                depth={row.depth}
                expanded={!collapsed.has(row.groupId)}
                onToggle={() => toggle(row.groupId)}
                rollup={groupRollup(row.tasks, getChildren, rangeStart)}
                timelineW={timelineW}
                leftW={leftW}
                dayW={dayW}
                onHoverChange={setHoveredMilestoneId}
                onAdd={() => addInGroup(row.milestone)}
                onContextMenu={row.milestone ? (x, y) => setMsCtxMenu({ x, y, milestone: row.milestone! }) : undefined}
                rangeStart={rangeStart}
                dragOffset={visual?.mode === 'milestone' && visual.taskId === row.milestone?.id ? visual.offset : null}
                onDateMouseDown={e => { if (row.milestone) milestoneMouseDown(e, row.milestone) }}
                onDateChange={v => { if (row.milestone) updateMilestone(row.milestone.id, { dueDate: v }) }}
              />
            ) : (
              <TaskRow
                key={row.key}
                task={row.task}
                child={row.child}
                height={row.h}
                depth={row.depth}
                compact={isMobile}
                leftW={leftW}
                dayW={dayW}
                timelineW={timelineW}
                today={today}
                rangeStart={rangeStart}
                rollup={row.task.start || row.task.due ? null : childRollup(row.task.id, getChildren, rangeStart)}
                hasChildren={!row.child && getChildren(row.task.id).length > 0}
                expanded={!collapsed.has(row.task.id)}
                visual={visual && visual.taskId === row.task.id ? visual : null}
                cascading={visual?.mode === 'move' && cascadeSet.has(row.task.id)}
                cascadeOffset={visual?.mode === 'move' ? visual.offset : 0}
                markUnplaced={markUnplaced}
                renaming={renaming?.id === row.task.id ? renaming : null}
                onCommitName={(name, another) => commitName(row.task, name, another)}
                onHover={setHoveredTaskId}
                onOpen={() => openTaskDetail(row.task.id)}
                onToggle={() => toggle(row.task.id)}
                onAddSubtask={() => openTaskModal(undefined, row.task.id)}
                onLaneMouseDown={e => laneMouseDown(e, { taskId: row.task.id, task: row.task })}
                onBarMouseDown={(e, mode) => barMouseDown(e, row.task, mode)}
                onOpenGuard={() => { const ok = !movedRef.current; movedRef.current = false; return ok }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Toolbar ──────────────────────────────────────────────────────────────────

function Toolbar({ zoom, setZoom, onToday, unplaced, markUnplaced, setMarkUnplaced, isMobile }: {
  zoom: Zoom; setZoom: (z: Zoom) => void; onToday: () => void
  unplaced: number; markUnplaced: boolean; setMarkUnplaced: (v: boolean) => void; isMobile: boolean
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      minHeight: 40, padding: isMobile ? '0 10px' : '0 16px',
      background: 'var(--bg)', borderBottom: '1px solid var(--bd)',
    }}>
      <button
        onClick={() => { haptic('tap'); onToday() }}
        style={{ padding: '4px 10px', fontSize: 12, borderRadius: 'var(--r1)', border: '1px solid var(--bd)', background: 'transparent', color: 'var(--t2)', cursor: 'pointer', fontFamily: 'var(--font)' }}
      >
        오늘
      </button>

      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: 2, background: 'var(--bg3)', borderRadius: 999 }}>
        {(['day', 'week', 'month'] as Zoom[]).map(z => {
          const on = z === zoom
          return (
            <button
              key={z}
              onClick={() => { haptic('tap'); setZoom(z) }}
              style={{
                padding: '3px 12px', borderRadius: 999, border: 'none', cursor: 'pointer',
                background: on ? 'var(--bg)' : 'transparent', color: on ? 'var(--t1)' : 'var(--t2)',
                fontWeight: on ? 600 : 400, fontSize: 12, fontFamily: 'var(--font)',
                boxShadow: on ? '0 1px 2px rgba(0,0,0,.08)' : 'none',
              }}
            >
              {ZOOM_LABEL[z]}
            </button>
          )
        })}
      </div>

      <div style={{ flex: 1 }} />

      {unplaced > 0 && (
        <button
          onClick={() => { haptic('toggle'); setMarkUnplaced(!markUnplaced) }}
          title="일정이 없는 업무 — 타임라인을 드래그해서 배치하세요"
          style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '3px 9px', fontSize: 12,
            borderRadius: 'var(--r2)', cursor: 'pointer', fontFamily: 'var(--font)',
            border: `1px solid ${markUnplaced ? '#D9730D' : 'var(--bd)'}`,
            background: markUnplaced ? 'rgba(217,115,13,.1)' : 'transparent',
            color: markUnplaced ? '#D9730D' : 'var(--t2)', whiteSpace: 'nowrap',
          }}
        >
          미배치 {unplaced}
        </button>
      )}
      {!isMobile && (
        <span style={{ fontSize: 11, color: 'var(--t3)', whiteSpace: 'nowrap' }}>
          빈 줄을 드래그해 일정을 잡으세요
        </span>
      )}
    </div>
  )
}

// ── Backdrop ─────────────────────────────────────────────────────────────────

function Backdrop({ left, width, height, dayW, zoom, ticks, markers, hoveredMilestoneId }: {
  left: number; width: number; height: number; dayW: number; zoom: Zoom
  ticks: { col: number; weekend: boolean; week: boolean }[]
  markers: { id: string; name: string; col: number; done: boolean }[]
  hoveredMilestoneId: string | null
}) {
  return (
    <div style={{ position: 'absolute', left, top: HEADER_H, width, height, zIndex: 0, pointerEvents: 'none' }}>
      {/* Weekend shading is what makes a week readable at a glance; at a month
          to the screen it would be a barcode, so only the week lines remain. */}
      {zoom !== 'month' && ticks.filter(t => t.weekend).map(t => (
        <div key={t.col} style={{ position: 'absolute', left: t.col * dayW, width: dayW, top: 0, bottom: 0, background: 'var(--bg2)', opacity: .55 }} />
      ))}
      {ticks.filter(t => t.week).map(t => (
        <div key={`w${t.col}`} style={{ position: 'absolute', left: t.col * dayW, top: 0, bottom: 0, width: 1, background: 'var(--bd)', opacity: .6 }} />
      ))}
      {markers.map(m => (
        <div key={m.id} style={{
          position: 'absolute', left: m.col * dayW + Math.floor(dayW / 2), top: 0, bottom: 0,
          width: hoveredMilestoneId === m.id ? 2 : 1,
          background: hoveredMilestoneId === m.id ? MS_COLOR : 'rgba(139,92,246,.4)',
          opacity: m.done ? .4 : 1,
        }} />
      ))}
    </div>
  )
}

/**
 * 오늘.
 *
 * 배경이 아니라 앞면입니다. 뒤에 그리면 막대 하나가 지나갈 때마다 선이
 * 끊기고, 정작 '오늘이 이 막대의 어디쯤인지'가 궁금한 순간에 사라집니다 —
 * 그게 이 선이 있는 이유인데도요.
 *
 * 앞에 오는 대신 얇고 반투명합니다. 막대 위의 글자를 읽는 걸 방해하면
 * 앞으로 나온 값을 못 합니다.
 */
function TodayLine({ left, top, height, x }: { left: number; top: number; height: number; x: number }) {
  return (
    <div style={{
      position: 'absolute', left: left + x, top, height, width: 2,
      background: 'var(--ac)', opacity: .5,
      zIndex: 3, pointerEvents: 'none',
    }} />
  )
}

/** One step in from whatever contains you. */
function INDENT(depth: number, compact: boolean): number {
  return (compact ? 4 : 6) + depth * (compact ? 10 : 16)
}

// ── Project band ─────────────────────────────────────────────────────────────

/**
 * The band above a project's milestones, drawn only when several projects share
 * the chart.
 *
 * Without it the milestones of five projects read as one list of fifteen, in an
 * order nobody chose — the dates interleave and the names do not say whose they
 * are. The band carries the project's colour, its whole span as one bar, and
 * collapses everything under it.
 */
function ProjectRow({ project, expanded, onToggle, rollup, count, timelineW, leftW, dayW, compact, onOpen }: {
  project: Project | null
  expanded: boolean
  onToggle: () => void
  rollup: { col: number; span: number } | null
  count: number
  timelineW: number
  leftW: number
  dayW: number
  compact: boolean
  onOpen: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const color = project?.color ?? 'var(--t3)'

  return (
    <div
      style={{ display: 'flex', height: PROJECT_H, borderBottom: '1px solid var(--bd2)' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        onClick={onToggle}
        style={{
          width: leftW, flexShrink: 0, position: 'sticky', left: 0, zIndex: 4,
          background: hovered ? BAND_HOVER : BAND,
          borderRight: '1px solid var(--bd)', display: 'flex', alignItems: 'center',
          paddingLeft: 4, paddingRight: 8, gap: 6, overflow: 'hidden', cursor: 'pointer',
        }}
      >
        <button
          onClick={e => { e.stopPropagation(); onToggle() }}
          style={{ width: 18, height: 18, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--t3)', fontSize: 9 }}
        >
          {expanded ? '▼' : '▶'}
        </button>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-.01em' }}>
          {project?.name ?? '프로젝트 미지정'}
        </span>
        {hovered && project && !compact ? (
          <button
            onClick={e => { e.stopPropagation(); haptic('tap'); onOpen() }}
            title="이 프로젝트만 보기"
            style={{ flexShrink: 0, fontSize: 10, padding: '2px 7px', borderRadius: 'var(--r1)', border: '1px solid var(--bd2)', background: 'var(--bg)', color: 'var(--t2)', cursor: 'pointer', fontFamily: 'var(--font)' }}
          >
            열기
          </button>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--t3)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
        )}
      </div>

      {/* A tint rather than a fill: the today line and the weekends have to keep
          running down the chart through this band, or the vertical read breaks
          at every project. */}
      <div style={{
        width: timelineW, flexShrink: 0, position: 'relative', height: PROJECT_H,
        background: hovered ? 'var(--bg3)' : 'var(--bg2)',
      }}>
        {rollup && (
          <div style={{
            position: 'absolute', left: rollup.col * dayW + 2, width: Math.max(rollup.span * dayW - 4, 4),
            top: '50%', transform: 'translateY(-50%)', height: 10, borderRadius: 5,
            background: color, opacity: .22, pointerEvents: 'none',
          }} />
        )}
      </div>
    </div>
  )
}

// ── Milestone row ────────────────────────────────────────────────────────────

function MilestoneRow({
  milestone, expanded, onToggle, rollup, timelineW, leftW, dayW,
  onHoverChange, onAdd, onContextMenu, compact, depth,
  rangeStart, dragOffset, onDateMouseDown, onDateChange,
}: {
  compact: boolean
  rangeStart: Date
  /** Days the date is being dragged by, or null when it is not. */
  dragOffset: number | null
  onDateMouseDown: (e: React.MouseEvent) => void
  onDateChange: (ymd: string) => void
  /** 0 inside one project, 1 under a project band. */
  depth: number
  milestone: Milestone | null
  expanded: boolean
  onToggle: () => void
  rollup: { col: number; span: number } | null
  timelineW: number
  leftW: number
  dayW: number
  onHoverChange: (id: string | null) => void
  onAdd: () => void
  onContextMenu?: (x: number, y: number) => void
}) {
  const [hovered, setHovered] = useState(false)
  const isNull = milestone === null
  const isDone = milestone?.done === true
  const dragging = dragOffset !== null
  const shiftedDue = milestone?.dueDate
    ? fmtYMD(addDays(toDate(milestone.dueDate), dragOffset ?? 0))
    : null
  // Off the visible span it would be drawn past the end of its own lane.
  const rawCol = shiftedDue ? dayDiff(rangeStart, toDate(shiftedDue)) : null
  const dueCol = rawCol !== null && rawCol >= 0 && rawCol * dayW < timelineW ? rawCol : null
  const accent = isDone ? '#6b7280' : MS_COLOR
  const tintBg = isDone ? 'rgba(107,114,128,' : 'rgba(139,92,246,'

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
      haptic('longPress')
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
      style={{ display: 'flex', height: GROUP_H, borderBottom: '1px solid var(--bd)', background: hovered && !isNull ? `${tintBg}.05)` : 'transparent' }}
      onMouseEnter={() => { setHovered(true); onHoverChange(milestone?.id ?? null) }}
      onMouseLeave={() => { setHovered(false); onHoverChange(null) }}
      onContextMenu={onContextMenu ? e => { e.preventDefault(); onContextMenu(e.clientX, e.clientY) } : undefined}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* The pinned column has to be opaque, or the timeline scrolls under it. */}
      <div
        onClick={() => { if (!lpActive.current) onToggle() }}
        style={{
          width: leftW, flexShrink: 0, position: 'sticky', left: 0, zIndex: 4,
          // Opaque, always. A tint with alpha in it lets the timeline scroll
          // through the pinned column — which is what the column is for.
          background: hovered
            ? (isNull ? 'var(--bg2)' : `linear-gradient(${tintBg}.14), ${tintBg}.14)), var(--bg)`)
            : 'var(--bg)',
          borderRight: '1px solid var(--bd)', display: 'flex', alignItems: 'center',
          paddingLeft: INDENT(depth, compact), paddingRight: 6, gap: 5, overflow: 'hidden', cursor: 'pointer',
        }}
      >
        <button
          onClick={e => { e.stopPropagation(); onToggle() }}
          style={{ width: 18, height: 18, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', color: isNull ? 'var(--t3)' : accent, fontSize: 9 }}
        >
          {expanded ? '▼' : '▶'}
        </button>
        {!isNull && <span style={{ fontSize: 11, color: accent, flexShrink: 0, lineHeight: 1, opacity: isDone ? .6 : 1 }}>◆</span>}
        <span style={{ fontSize: 12, fontWeight: 600, color: isNull ? 'var(--t3)' : accent, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: isDone ? .6 : 1, textDecoration: isDone ? 'line-through' : 'none' }}>
          {milestone?.name ?? '마일스톤 미지정'}
        </span>
        {/* The date you were already reading is the control that changes it.
            Precise where dragging the diamond is quick — and the only way in on
            a phone, where dragging a 13px handle is not a gesture. */}
        {milestone?.dueDate && (
          <span onClick={e => e.stopPropagation()} style={{ flexShrink: 0 }}>
            <DateField
              value={milestone.dueDate}
              context={{ projectId: milestone.projectId }}
              onChange={v => { if (v) onDateChange(v) }}
              style={{
                fontSize: 10, color: accent, opacity: isDone ? .4 : .8,
                padding: '1px 4px', borderRadius: 'var(--r1)',
                background: hovered ? `${tintBg}.12)` : 'transparent',
              }}
            />
          </span>
        )}
        {/* Adding work is the thing you come to a milestone to do, so it is a
            button on the milestone rather than a menu behind a right-click. */}
        <button
          onClick={e => { e.stopPropagation(); onAdd() }}
          title="이 마일스톤에 업무 추가"
          style={{
            flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3,
            fontSize: 11, padding: '2px 7px', borderRadius: 'var(--r1)', cursor: 'pointer',
            fontFamily: 'var(--font)', border: `1px solid ${hovered ? accent : 'transparent'}`,
            background: hovered ? `${tintBg}.12)` : 'transparent',
            color: hovered || compact ? accent : 'transparent',
            transition: 'color .08s, background .08s, border-color .08s',
          }}
        >
          + 업무
        </button>
      </div>

      {/*
        Lane.

        십자 커서가 없습니다. 마일스톤 줄에서 십자는 '여기 그으면 마일스톤이
        생긴다'로 읽히는데, 마일스톤은 그렇게 만들어지지 않습니다. 그은 결과가
        업무였고, 아무것도 안 생긴 것처럼 보이는 경우도 있었습니다.

        업무를 넣는 길은 두 개 다 남아 있고 둘 다 자기 이름을 말합니다: 왼쪽
        이름 칸의 '+ 업무'와, 우클릭 메뉴. 이 줄에 없는 건 거짓말하는 커서뿐
        입니다.
      */}
      <div
        data-lane
        style={{ width: timelineW, flexShrink: 0, position: 'relative', height: GROUP_H }}
      >
        {rollup && (
          <div style={{
            position: 'absolute', left: rollup.col * dayW + 2, width: Math.max(rollup.span * dayW - 4, 4),
            top: '50%', transform: 'translateY(-50%)', height: 8, borderRadius: 4,
            background: isNull ? 'rgba(100,100,100,.1)' : `${tintBg}.18)`,
            border: `1.5px solid ${isNull ? 'rgba(100,100,100,.3)' : `${tintBg}.45)`}`,
            pointerEvents: 'none', opacity: isDone ? .5 : 1,
          }} />
        )}
        {/* The milestone's own date, where the chart says it is.
            A milestone is a point rather than a span, so it is a handle rather
            than a bar — small enough that dragging anywhere else in the lane
            still means "make a task here", which is what that gesture means on
            every other row. */}
        {dueCol !== null && (
          <div
            onMouseDown={onDateMouseDown}
            title={`${milestone?.dueDate} — 드래그해서 날짜 변경`}
            style={{
              position: 'absolute', left: dueCol * dayW + Math.floor(dayW / 2) - 9,
              top: '50%', transform: 'translateY(-50%)',
              width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'grab', zIndex: 3,
            }}
          >
            <span style={{
              fontSize: 13, lineHeight: 1, color: accent,
              filter: dragging ? `drop-shadow(0 0 5px ${accent})` : 'none',
              opacity: isDone ? .55 : 1,
            }}>◆</span>
          </div>
        )}

        {dragging && dueCol !== null && (
          <div style={{
            position: 'absolute', left: dueCol * dayW + Math.floor(dayW / 2) - 2, top: -2,
            transform: 'translateY(-100%)', background: accent, color: '#fff',
            fontSize: 10, padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap',
            pointerEvents: 'none', zIndex: 5, fontVariantNumeric: 'tabular-nums',
          }}>
            {shiftedDue?.slice(5)}
          </div>
        )}

      </div>
    </div>
  )
}

// ── Task row ─────────────────────────────────────────────────────────────────

function TaskRow({
  task, child, height, depth, compact, leftW, dayW, timelineW, today, rangeStart,
  rollup, hasChildren, expanded, visual, cascading, cascadeOffset, markUnplaced, renaming,
  onCommitName, onHover, onOpen, onToggle, onAddSubtask, onLaneMouseDown, onBarMouseDown, onOpenGuard,
}: {
  task: Task
  child: boolean
  height: number
  /** How many containers this row sits inside: project, milestone, both. */
  depth: number
  compact: boolean
  leftW: number
  dayW: number
  timelineW: number
  today: Date
  rangeStart: Date
  rollup: { col: number; span: number } | null
  hasChildren: boolean
  expanded: boolean
  visual: Visual | null
  cascading: boolean
  cascadeOffset: number
  markUnplaced: boolean
  renaming: { chain: boolean } | null
  onCommitName: (name: string, another: boolean) => void
  onHover: (id: string | null) => void
  onOpen: () => void
  onToggle: () => void
  onAddSubtask: () => void
  onLaneMouseDown: (e: React.MouseEvent) => void
  onBarMouseDown: (e: React.MouseEvent, mode: 'move' | 'start' | 'end') => void
  onOpenGuard: () => boolean
}) {
  const [hovered, setHovered] = useState(false)
  const color = getCatColor(task.cat || '')
  const isDone = task.status === '완료'
  const isOverdue = Boolean(task.due && !isDone && toDate(task.due) < today)
  const placed = Boolean(task.start || task.due)

  // Where the bar is drawn right now, which during a drag is not where it is
  // stored: an edge pull moves one end, a move moves both, a cascade follows.
  const shift = visual && 'offset' in visual ? visual.offset : cascading ? cascadeOffset : 0
  let col = 0, span = 0
  if (placed) {
    const s = dayDiff(rangeStart, toDate(task.start || task.due))
    const e = dayDiff(rangeStart, toDate(task.due || task.start))
    const ds = visual?.mode === 'end' ? 0 : shift
    const de = visual?.mode === 'start' ? 0 : shift
    col = Math.min(s + ds, e + de)
    span = Math.abs((e + de) - (s + ds)) + 1
  }

  const paddingLeft = INDENT(depth, compact) + (child ? (compact ? 14 : 24) : 0)

  const barH = child ? 15 : 20
  const dragging = !!visual && visual.mode !== 'create'

  return (
    <div
      className="lp-row"
      style={{ display: 'flex', height, borderBottom: '1px solid var(--bd)' }}
      onMouseEnter={() => { setHovered(true); onHover(task.id) }}
      onMouseLeave={() => { setHovered(false); onHover(null) }}
    >
      {/* Left */}
      <div
        onClick={() => { if (!renaming) onOpen() }}
        style={{
          width: leftW, flexShrink: 0, position: 'sticky', left: 0, zIndex: 4,
          background: hovered ? 'var(--bg2)' : 'var(--bg)',
          borderRight: '1px solid var(--bd)', display: 'flex', alignItems: 'center',
          paddingLeft, paddingRight: 8, gap: 4, overflow: 'hidden', cursor: 'pointer',
          boxShadow: markUnplaced && !placed ? 'inset 3px 0 0 #D9730D' : 'none',
        }}
      >
        {child ? (
          <span style={{ fontSize: 10, color: 'var(--t3)', flexShrink: 0 }}>└</span>
        ) : (
          <button
            onClick={e => { e.stopPropagation(); onToggle() }}
            style={{ width: compact ? 14 : 18, height: 18, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: hasChildren ? 'pointer' : 'default', color: 'var(--t3)', fontSize: 9, visibility: hasChildren ? 'visible' : 'hidden' }}
          >
            {expanded ? '▼' : '▶'}
          </button>
        )}

        {task.cat && !compact && !renaming && <CategoryBadge cat={task.cat} />}

        {renaming ? (
          <input
            autoFocus
            defaultValue={task.name}
            placeholder="업무 이름"
            onFocus={e => e.currentTarget.select()}
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
            onKeyDown={e => {
              // The Enter that closes a Korean IME's composition is still an
              // Enter to the DOM. Taken at face value it commits a half-typed
              // name and, when chaining, opens the next row underneath it.
              if (isComposing(e)) return
              if (e.key === 'Enter') { e.preventDefault(); onCommitName(e.currentTarget.value, renaming.chain) }
              else if (e.key === 'Escape') { e.preventDefault(); onCommitName(task.name, false) }
            }}
            onBlur={e => onCommitName(e.currentTarget.value, false)}
            style={{
              flex: 1, minWidth: 0, fontSize: 12, fontFamily: 'var(--font)', color: 'var(--t1)',
              border: '1px solid var(--ac)', borderRadius: 'var(--r1)', padding: '2px 6px',
              background: 'var(--bg)', outline: 'none',
            }}
          />
        ) : (
          <span style={{
            fontSize: 12, flex: 1, color: child ? 'var(--t2)' : 'var(--t1)',
            fontWeight: !child && hasChildren ? 500 : 400,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            opacity: isDone ? .55 : 1, textDecoration: isDone ? 'line-through' : 'none',
          }}>
            {task.name || <span style={{ color: 'var(--t3)' }}>이름 없음</span>}
          </span>
        )}

        {hovered && !compact && !child && !renaming && (
          <button
            onClick={e => { e.stopPropagation(); onAddSubtask() }}
            style={{ flexShrink: 0, fontSize: 10, color: 'var(--ac)', background: 'var(--ac-l)', border: '1px solid var(--ac)', borderRadius: 3, padding: '2px 6px', cursor: 'pointer', fontFamily: 'var(--font)' }}
          >
            + 하위
          </button>
        )}
      </div>

      {/* Lane */}
      <div
        data-lane
        onMouseDown={onLaneMouseDown}
        style={{
          width: timelineW, flexShrink: 0, position: 'relative', height,
          background: hovered ? 'var(--bg3)' : 'transparent',
          cursor: 'crosshair',
        }}
      >
        {rollup && (
          <div style={{ position: 'absolute', left: rollup.col * dayW + 2, width: Math.max(rollup.span * dayW - 4, 4), top: '50%', transform: 'translateY(-50%)', height: 6, borderRadius: 3, background: 'var(--bd2)', opacity: .6, pointerEvents: 'none' }} />
        )}

        {/* An empty lane says what to do with it, once, on hover. */}
        {!placed && !rollup && hovered && !visual && (
          <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: 'var(--t3)', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
            드래그해서 일정 배치
          </span>
        )}

        {visual?.mode === 'create' && <DraftBar from={visual.from} to={visual.to} dayW={dayW} accent={color.text} label={task.name || '새 업무'} />}

        {placed && (
          <div
            onMouseDown={e => onBarMouseDown(e, 'move')}
            onClick={e => { e.stopPropagation(); if (onOpenGuard()) onOpen() }}
            style={{
              position: 'absolute', left: col * dayW + 2, width: Math.max(span * dayW - 4, 6),
              top: '50%', transform: 'translateY(-50%)', height: barH,
              borderRadius: child ? 3 : 5,
              background: isOverdue ? 'rgba(212,76,71,.1)' : color.bg,
              border: `${child ? 1 : 1.5}px solid ${isOverdue ? 'var(--danger)' : color.text}`,
              display: 'flex', alignItems: 'center', paddingLeft: 6,
              overflow: 'visible', zIndex: 1,
              cursor: dragging ? 'grabbing' : 'grab',
              opacity: isDone ? .5 : dragging ? .85 : cascading ? .75 : 1,
              boxShadow: dragging ? '0 4px 12px rgba(0,0,0,.18)' : cascading ? '0 2px 8px rgba(0,0,0,.12)' : 'none',
              outline: cascading ? `1.5px dashed ${color.text}` : 'none',
              outlineOffset: 1,
            }}
          >
            {/* Pull an edge to change one end. Only offered on hover, so the bar
                stays a bar until you mean to reshape it. */}
            {(hovered || dragging) && !compact && (['start', 'end'] as const).map(side => (
              <div
                key={side}
                onMouseDown={e => onBarMouseDown(e, side)}
                title={side === 'start' ? '시작일 조정' : '마감일 조정'}
                style={{
                  position: 'absolute', top: -1, bottom: -1, width: HANDLE,
                  [side === 'start' ? 'left' : 'right']: -HANDLE / 2,
                  cursor: 'ew-resize', zIndex: 3,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <span style={{ width: 3, height: barH - 6, borderRadius: 2, background: isOverdue ? 'var(--danger)' : color.text, opacity: .85 }} />
              </div>
            ))}

            {span * dayW > 54 && !compact && (
              <span style={{ fontSize: 10, fontWeight: 500, color: isOverdue ? 'var(--danger)' : color.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none', minWidth: 0, maxWidth: '100%' }}>
                {task.name}
              </span>
            )}
            {task.progress > 0 && (
              <div style={{ position: 'absolute', bottom: 0, left: 0, height: 3, width: `${task.progress}%`, opacity: .5, background: isOverdue ? 'var(--danger)' : color.text, borderRadius: '0 0 0 5px', pointerEvents: 'none' }} />
            )}
          </div>
        )}

        {/* What the dates will read once you let go. */}
        {dragging && placed && (
          <div style={{
            position: 'absolute', left: col * dayW + 2, top: -2,
            transform: 'translateY(-100%)', background: 'var(--t1)', color: 'var(--bg)',
            fontSize: 10, padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap',
            pointerEvents: 'none', zIndex: 3, fontVariantNumeric: 'tabular-nums',
          }}>
            {fmtYMD(addDays(rangeStart, col)).slice(5)} – {fmtYMD(addDays(rangeStart, col + span - 1)).slice(5)}
          </div>
        )}
      </div>
    </div>
  )
}

/** The bar being drawn by a drag, before anything has been written down. */
function DraftBar({ from, to, dayW, accent, label }: { from: number; to: number; dayW: number; accent: string; label: string }) {
  const span = to - from + 1
  return (
    <div style={{
      position: 'absolute', left: from * dayW + 2, width: Math.max(span * dayW - 4, 6),
      top: '50%', transform: 'translateY(-50%)', height: 20, borderRadius: 5,
      border: `1.5px dashed ${accent}`, background: 'var(--ac-l)',
      display: 'flex', alignItems: 'center', paddingLeft: 6, gap: 6,
      pointerEvents: 'none', zIndex: 2, overflow: 'hidden',
    }}>
      <span style={{ fontSize: 10, color: accent, fontWeight: 600, whiteSpace: 'nowrap' }}>
        {span}일{span * dayW > 90 ? ` · ${label}` : ''}
      </span>
    </div>
  )
}

// ── Geometry helpers ─────────────────────────────────────────────────────────

/** The span covering a task's children, for parents that carry no dates. */
function childRollup(parentId: string, getChildren: (id: string) => Task[], rangeStart: Date) {
  const children = getChildren(parentId).filter(c => c.start || c.due)
  if (!children.length) return null
  return spanOf(children, rangeStart)
}

/** The span covering everything filed under a milestone. */
function groupRollup(tasks: Task[], getChildren: (id: string) => Task[], rangeStart: Date) {
  const all: Task[] = []
  tasks.forEach(t => { all.push(t); getChildren(t.id).forEach(c => all.push(c)) })
  const dated = all.filter(t => t.start || t.due)
  if (!dated.length) return null
  return spanOf(dated, rangeStart)
}

function spanOf(tasks: Task[], rangeStart: Date) {
  const cols = tasks.flatMap(t => [
    ...(t.start ? [dayDiff(rangeStart, toDate(t.start))] : []),
    ...(t.due   ? [dayDiff(rangeStart, toDate(t.due))]   : []),
  ])
  const col = Math.min(...cols)
  return { col, span: Math.max(...cols) - col + 1 }
}

/**
 * An orthogonal connector from one bar's end to the next one's start.
 *
 * When the successor starts before its predecessor ends — which is exactly the
 * case worth seeing — the line has to doubles back, so it drops out of the row
 * first and comes at the target from the left.
 */
function elbow(x1: number, y1: number, x2: number, y2: number) {
  const OUT = 8
  const head = (x: number, y: number) => `M ${x} ${y} l -5 -3.5 l 0 7 z`
  if (x2 - x1 > OUT * 2) {
    const mx = x2 - OUT
    return { d: `M ${x1} ${y1} H ${mx} V ${y2} H ${x2 - 1}`, head: head(x2, y2) }
  }
  const drop = (y1 + y2) / 2
  return {
    d: `M ${x1} ${y1} H ${x1 + OUT} V ${drop} H ${x2 - OUT * 2} V ${y2} H ${x2 - 1}`,
    head: head(x2, y2),
  }
}

// ── Milestone UI helpers ─────────────────────────────────────────────────────

function MilestonePin({ marker, dayW, forceShow }: { marker: { id: string; name: string; col: number; done: boolean }; dayW: number; forceShow?: boolean }) {
  const [hovered, setHovered] = useState(false)
  const show = hovered || forceShow
  const left = marker.col * dayW + Math.floor(dayW / 2)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      /* 숫자 위가 아니라 띠의 윗변에 겁니다. ◆는 이 칸 한가운데에 놓이는데
         날짜도 한가운데 있어서, 마일스톤이 있는 날은 며칠인지 읽을 수가
         없었습니다. 아래를 가리키는 작은 삼각형이면 같은 열을 가리키면서
         숫자를 건드리지 않습니다. */
      style={{ position: 'absolute', left: left - 5, top: 0, zIndex: 3, cursor: 'default' }}
    >
      <svg width="10" height="6" viewBox="0 0 10 6" style={{ display: 'block', opacity: marker.done ? .5 : 1, filter: show ? `drop-shadow(0 0 4px ${MS_COLOR}aa)` : 'none', transition: 'filter .15s' }} aria-hidden>
        <path d="M0 0h10L5 6z" fill={MS_COLOR} />
      </svg>
      {show && (
        <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', background: '#1e1b4b', color: '#c4b5fd', fontSize: 11, fontWeight: 600, padding: '4px 8px', borderRadius: 5, whiteSpace: 'nowrap', pointerEvents: 'none', boxShadow: '0 4px 12px rgba(0,0,0,.3)', zIndex: 20 }}>
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
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 13, color: danger ? 'var(--danger)' : 'var(--t1)', background: hovered ? 'var(--bg3)' : 'transparent', transition: 'background .06s' }}>
      <span style={{ fontSize: 12, width: 16, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
      {label}
    </div>
  )
}
