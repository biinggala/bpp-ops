import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { beginLongPress } from '../../../lib/press'
import { useTouch } from '../../../hooks/useTouch'
import {
  useMenu, Menu, MenuList, MenuItem, MenuCheck, MenuNote,
  MenuDivider, MenuFooter, MENU_INPUT, CellTrigger, Dot, useMenuKeys,
} from '../../shared/Menu'
import { AssigneePicker } from '../../shared/AssigneePicker'
import { Icon } from '../../shared/Icon'
import { useToast } from '../../shared/Toast'
import { BadgeSelect } from '../../shared/BadgeSelect'
import { StatusPill, PriorityLabel } from '../../shared/StatusPill'
import { useGCalStore, type GCalEvent } from '../../../store/gcalStore'
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
import { ActionMenu, ContextMenu } from '../../shared/ContextMenu'
import { fmtDate, isOverdue, parseAssignees, assigneeKeyToEmail, stripHtml, isComposing, daysFrom, assigneeOptions } from '../../../lib/utils'
import { NOTION, STATUS_LIST, PRIORITY_LIST, getTagColor, statusAccent } from '../../../types'
import {
  FileRow, DriveSearch, UrlAdd, AttachTabs,
  useResolvedLinks, useProjectFolderId, driveIdOf, linkFromDriveFile,
} from '../../shared/DriveFiles'
import { fileKind } from '../../../lib/googleDrive'
import { DatePicker, DateField } from '../../shared/DatePicker'
import { askConfirm } from '../../shared/Confirm'
import { haptic } from '../../../lib/haptics'
import type { DateContext } from '../../shared/DatePicker'
import type { Task, Milestone, Status, Priority, TaskLink } from '../../../types'
import type { ListGroup } from '../../../store/uiStore'
import { useShallow } from 'zustand/react/shallow'

// ── Column config ─────────────────────────────────────────────────────────────

type ColDef = { key: string; label: string; width: number; hidden?: boolean }


/** The flat list's own add row, which belongs to no project card. */
const FLAT_DRAFT = '__flat__'

const MIN_COL_WIDTH = 60
// v2: the default order changed and 진행률 left. A saved v1 layout would have
// kept the old arrangement forever, since what is stored is the arrangement
// itself rather than a diff from the default.
const COL_STORAGE_KEY = 'cringe_table_cols_v2'
/** Always shown: it is the row's identity and the sticky anchor for the rest. */
const LOCKED_COL = 'name'

// Left to right in the order somebody reads a row: what it is, where it stands,
// whose it is, when it is due — then the things you go looking for rather than
// scan past.
const DEFAULT_COLS: ColDef[] = [
  { key: 'name',     label: '업무',    width: 300 },
  { key: 'status',   label: '상태',    width: 110 },
  { key: 'assignee', label: '담당자',  width: 140 },
  { key: 'due',      label: '마감일',  width: 100 },
  { key: 'links',    label: '링크',    width: 140 },
  { key: 'tags',     label: '태그',    width: 160 },
  { key: 'priority', label: '우선순위', width: 100 },
  { key: 'memo',     label: '메모',    width: 180 },
]

function loadCols(): ColDef[] {
  try {
    const raw = localStorage.getItem(COL_STORAGE_KEY)
    if (raw) {
      const saved: ColDef[] = JSON.parse(raw)
      const defMap = new Map(DEFAULT_COLS.map(d => [d.key, d]))
      const merged: ColDef[] = saved
        .filter(s => defMap.has(s.key))
        .map(s => ({ ...defMap.get(s.key)!, width: Math.max(MIN_COL_WIDTH, s.width), hidden: !!s.hidden }))
      DEFAULT_COLS.forEach(d => { if (!merged.find(m => m.key === d.key)) merged.push(d) })
      return merged
    }
  } catch { /* ignore */ }
  return [...DEFAULT_COLS]
}

// ── Status / Priority styling ─────────────────────────────────────────────────

// One source for these — see NOTION in types.
const STATUS_STYLE: Record<Status, { bg: string; color: string }> = {
  '진행중': { bg: NOTION.blue.bg,   color: NOTION.blue.text },
  '대기':   { bg: NOTION.gray.bg,   color: NOTION.gray.text },
  '검토중': { bg: NOTION.yellow.bg, color: NOTION.yellow.text },
  '완료':   { bg: NOTION.green.bg,  color: NOTION.green.text },
}
// Priority has to read as a ranking, not three equally loud labels. 높음 carries
// weight, 중간 is quiet, 낮음 has no fill at all — the previous blue on 낮음 drew
// more attention than the muted amber on 중간, which inverted the order.
const PRIORITY_STYLE: Record<Priority, { bg: string; color: string }> = {
  '높음': { bg: NOTION.red.bg,    color: NOTION.red.text },
  '중간': { bg: NOTION.orange.bg, color: NOTION.orange.text },
  '낮음': { bg: 'transparent',    color: 'var(--t3)' },
}

// Only 높음 gets a mark next to the name. Marking every level would make the
// column louder without making anything stand out.
/**
 * The colour a milestone and everything under it share.
 *
 * Overdue and near-due milestones take warning colours so the group reads at a
 * glance; done ones recede.
 */
function milestoneAccent(done: boolean, diff: number): string {
  if (done) return 'var(--t3)'
  if (diff < 0) return NOTION.red.text
  if (diff <= 7) return NOTION.orange.text
  return NOTION.purple.text
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type Bucket = { key: string; label: string; accent?: string; tasks: Task[] }

/**
 * Splits tasks into the buckets a flat list mode shows.
 *
 * Buckets are emitted in a fixed, meaningful order (overdue before today, 높음
 * before 낮음) rather than alphabetically, so the top of the list is always the
 * part that needs attention. Empty buckets are dropped — an always-present but
 * always-empty "검토중" header is just a line to scroll past.
 */
function bucketTasks(
  tasks: Task[],
  group: ListGroup,
  today: Date,
  nameOf: (email: string) => string,
): Bucket[] {
  // '없음' used to return here before the done-last pass at the bottom of this
  // function ever ran, so finished work stayed wherever the chosen sort had put
  // it — most visibly on the phone, which has no second sort of its own and
  // draws these buckets exactly as they arrive.
  if (group === 'none') return [{ key: '__all__', label: '', tasks: doneLast(tasks) }]

  const order: Bucket[] = []
  const byKey = new Map<string, Bucket>()
  const bucket = (key: string, label: string, accent?: string) => {
    let b = byKey.get(key)
    if (!b) { b = { key, label, accent, tasks: [] }; byKey.set(key, b); order.push(b) }
    return b
  }

  if (group === 'due') {
    // Seeded up front so the buckets keep this order regardless of which one
    // the first task happens to land in.
    bucket('due:overdue', '지남', NOTION.red.text)
    bucket('due:today', '오늘', NOTION.orange.text)
    bucket('due:week', '이번 주', NOTION.blue.text)
    bucket('due:later', '이후', NOTION.gray.text)
    bucket('due:none', '마감일 없음', NOTION.gray.text)
    bucket('due:done', '완료', NOTION.green.text)
    for (const t of tasks) {
      // A finished task is not overdue no matter what its due date says, so it
      // gets its own bucket rather than reddening the top of the list.
      if (t.status === '완료') { bucket('due:done', '').tasks.push(t); continue }
      if (!t.due) { bucket('due:none', '').tasks.push(t); continue }
      const d = daysFrom(t.due, today)
      const key = d < 0 ? 'due:overdue'
        : d === 0 ? 'due:today'
        : d <= 7 ? 'due:week'
        : 'due:later'
      bucket(key, '').tasks.push(t)
    }
  } else if (group === 'priority') {
    PRIORITY_LIST.forEach(pr => bucket(`pr:${pr}`, pr, PRIORITY_STYLE[pr].color))
    for (const t of tasks) bucket(`pr:${t.priority}`, t.priority).tasks.push(t)
  } else if (group === 'status') {
    STATUS_LIST.forEach(st => bucket(`st:${st}`, st, statusAccent(st)))
    for (const t of tasks) bucket(`st:${t.status}`, t.status).tasks.push(t)
  } else if (group === 'assignee') {
    // A task with two assignees appears under both. Picking only the first
    // would hide half of someone's workload, which defeats the point of the
    // grouping; React keys stay unique because each bucket renders its own list.
    for (const t of tasks) {
      const people = parseAssignees(t.assignee)
      if (!people.length) { bucket('as:__none__', '담당자 없음').tasks.push(t); continue }
      // 대소문자만 다른 같은 주소가 두 칸으로 갈라지지 않게, 정규화한 값으로
      // 묶습니다.
      for (const person of people) {
        const em = assigneeKeyToEmail(person)
        bucket(`as:${em}`, nameOf(em)).tasks.push(t)
      }
    }
    order.sort((a, b) =>
      (a.key === 'as:__none__' ? 1 : 0) - (b.key === 'as:__none__' ? 1 : 0) ||
      a.label.localeCompare(b.label, 'ko'))
  } else if (group === 'tag') {
    // Same rule as 담당자: a task with three tags shows up under all three.
    // Tags are a label, not a bucket the task belongs to exclusively, so
    // picking one would hide the task from the other two lists.
    //
    // The buckets are ordered by how many tasks carry the tag, because the tag
    // list is open — anyone can type a new one — and an alphabetical list of
    // fifty tags buries the three people actually use.
    for (const t of tasks) {
      const tags = t.tags ?? []
      if (!tags.length) { bucket('tag:__none__', '태그 없음', NOTION.gray.text).tasks.push(t); continue }
      for (const tag of tags) bucket(`tag:${tag}`, `#${tag}`, getTagColor(tag).text).tasks.push(t)
    }
    order.sort((a, b) =>
      (a.key === 'tag:__none__' ? 1 : 0) - (b.key === 'tag:__none__' ? 1 : 0) ||
      b.tasks.length - a.tasks.length ||
      a.label.localeCompare(b.label, 'ko'))
  }

  // Done last, inside every bucket.
  for (const b of order) b.tasks = doneLast(b.tasks)
  return order.filter(b => b.tasks.length > 0)
}

/**
 * Finished work goes to the bottom.
 *
 * The sort the list is under is about when work is due, and a finished task
 * still has its deadline — so "마감 가까운 순" was floating things that were
 * already done to the top of the list, which is the one place they have no
 * business being. Stable, so the chosen order survives underneath.
 */
function doneLast(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => (a.status === '완료' ? 1 : 0) - (b.status === '완료' ? 1 : 0))
}

/**
 * "이 업무에 일정 2개" — read out of the calendar already in memory.
 *
 * The link lives on the Google event, so the honest question "does this task
 * have events" costs one API call per task, which a two-hundred-row list cannot
 * pay. What it can do is look at the window the calendar views already loaded:
 * every event in it carries its task id, so the answer is free for anything
 * within a few months of today. The list asks for that window once when it
 * opens, and the calendar reuses the same cache.
 *
 * Older or far-future events are therefore not counted. That is the price of
 * not making the list wait on the network, and the task's own 일정 섹션 —
 * which does ask Google — remains the complete answer.
 */
function EventCountChip({ events }: { events: GCalEvent[] }) {
  const next = events.find(e => (e.startIso ?? `${e.start}T23:59:59`) >= new Date().toISOString().slice(0, 19))
  const when = next ? (() => {
    const d = new Date((next.startIso ?? `${next.start}T00:00:00`).slice(0, 19))
    return `${d.getMonth() + 1}/${d.getDate()}${next.allDay ? '' : ` ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`}`
  })() : null
  return (
    <span
      title={`연결된 일정 ${events.length}개${when ? ` · 다음 ${when} ${next!.summary}` : ''}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0,
        fontSize: 10, lineHeight: 1.6, padding: '1px 5px', borderRadius: 3,
        background: 'rgba(35,131,226,.09)', color: '#2E6E90',
      }}
    >
      <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" style={{ display: 'block' }} aria-hidden>
        <rect x="1.4" y="2.4" width="9.2" height="8.2" rx="1.4" />
        <path d="M1.4 5.1h9.2M4 1.4v2M8 1.4v2" />
      </svg>
      {events.length}
    </span>
  )
}

/** The linked events for every task, keyed by task id. */
function useTaskEvents(): Map<string, GCalEvent[]> {
  const events = useGCalStore(s => s.events)
  const wasConnected = useGCalStore(s => s.wasConnected)
  const ensureEvents = useGCalStore(s => s.ensureEvents)

  // Asked for once, and generously: ensureEvents pads either side and skips the
  // request when the calendar has already loaded a window that covers it, so
  // walking between the list and the calendar costs nothing extra.
  useEffect(() => {
    if (!wasConnected) return
    const at = (days: number) => {
      const d = new Date()
      d.setDate(d.getDate() + days)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    void ensureEvents(at(-14), at(60))
  }, [wasConnected, ensureEvents])

  return useMemo(() => {
    const m = new Map<string, GCalEvent[]>()
    for (const ev of events) {
      if (!ev.taskId) continue
      const list = m.get(ev.taskId)
      if (list) list.push(ev)
      else m.set(ev.taskId, [ev])
    }
    for (const list of m.values()) {
      list.sort((a, b) => (a.startIso ?? a.start).localeCompare(b.startIso ?? b.start))
    }
    return m
  }, [events])
}

type CtxState = { x: number; y: number; task: Task } | null

// ── MobileTableView ───────────────────────────────────────────────────────────

function MobileTableView() {
  const taskEvents = useTaskEvents()
  const filteredTasks = useFilteredTasks()
  const allTasks = useTaskStore(s => s.tasks)
  const { addTask, updateTask, deleteTask } = useTaskStore(useShallow(s => ({ addTask: s.addTask, updateTask: s.updateTask, deleteTask: s.deleteTask })))
  const { openTaskModal: _openTaskModal, openTaskDetail, projectId, hideCompleted, listGroup, myTasksOnly } = useUiStore(useShallow(s => ({ openTaskModal: s.openTaskModal, openTaskDetail: s.openTaskDetail, projectId: s.projectId, hideCompleted: s.hideCompleted, listGroup: s.listGroup, myTasksOnly: s.myTasksOnly })))
  const { milestones, updateMilestone } = useMilestoneStore()
  const projects = useProjectStore(s => s.projects)
  const userEmail = useAuthStore(s => s.email)
  const getNameByEmail = useUserProfileStore(s => s.getNameByEmail)
  const todayDate = React.useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])

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

  const crumbFor = (task: Task) => {
    const proj = projectId ? undefined : projects.find(p => p.id === task.projectId)
    const ms = task.milestoneId ? milestones.find(m => m.id === task.milestoneId) : undefined
    if (!proj && !ms) return undefined
    return <TaskBreadcrumb project={proj} milestone={ms} />
  }

  const renderTask = (task: Task, isChild = false, groupAccent?: string, crumb?: React.ReactNode): React.ReactNode => {
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
        haptic('longPress')
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
          onClick={() => { if (longPressActive.current) { longPressActive.current = false; return }; haptic('tap'); openTaskDetail(task.id) }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchMove}
          onDragStart={e => e.preventDefault()}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            paddingTop: 12, paddingBottom: 12,
            paddingLeft: isChild ? 44 : hasChildren ? 12 : 16, paddingRight: 16,
            borderBottom: '1px solid var(--bd)',
            // The milestone's colour continues down its rows; a child row keeps
            // its own indent marker instead.
            borderLeft: isChild
              ? '2px solid var(--bd2)'
              : groupAccent ? `2px solid ${groupAccent}` : '2px solid transparent',
            cursor: 'pointer', userSelect: 'none',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            WebkitTouchCallout: 'none' as any,
            opacity: isDone ? 0.55 : 1,
          }}
        >
          {!isChild && hasChildren && (
            <button
              onClick={e => { e.stopPropagation(); haptic('tap'); toggle(task.id) }}
              style={{ width: 20, height: 20, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--t3)', fontSize: 10, padding: 0 }}
            >{isExpanded ? '▼' : '▶'}</button>
          )}
          {isChild && <span style={{ fontSize: 11, color: 'var(--t3)', flexShrink: 0 }}>└</span>}
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 14, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: isDone ? 'line-through' : 'none' }}>
              {task.name}
            </span>
            {crumb}
          </span>
          {task.due && !isDone && (
            <span style={{ fontSize: 11, color: overdue ? 'var(--danger)' : 'var(--t3)', flexShrink: 0, marginRight: 6 }}>
              {overdue ? '⚠ ' : ''}{fmtDate(task.due)}
            </span>
          )}
          {!!taskEvents.get(task.id)?.length && (
            <span style={{ flexShrink: 0, marginRight: 4 }}><EventCountChip events={taskEvents.get(task.id)!} /></span>
          )}
          <span style={{ flexShrink: 0 }}><StatusPill status={task.status} compact /></span>
          {!isDone && (
            <button
              onClick={e => { e.stopPropagation(); haptic('toggle'); const child = addTask({ type: '세부', cat: task.cat, name: '새 하위 업무', assignee: '', start: '', due: '', priority: '중간', status: '대기', progress: 0, memo: '', parentId: task.id, projectId: task.projectId, milestoneId: task.milestoneId, createdBy: userEmail ?? undefined }); openTaskDetail(child.id) }}
              style={{ width: 26, height: 26, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--t3)', fontSize: 18, padding: 0, lineHeight: 1 }}
            >⊕</button>
          )}
          <span style={{ fontSize: 16, color: 'var(--t3)', marginLeft: isDone ? 4 : 0, flexShrink: 0 }}>›</span>
        </div>
        {hasChildren && isExpanded && sortDoneLast(children).map(c => renderTask(c, true, groupAccent))}
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
    /**
     * 내 할 일에서는 빈 마일스톤을 접지 않고 아예 내립니다.
     *
     * 프로젝트를 펼쳐 보고 있을 때 비어 있는 마일스톤은 정보입니다 — 아직
     * 아무도 손대지 않은 구간이고, 그 헤더의 추가 행이 거기에 일을 넣는
     * 방법입니다. 하지만 내 할 일은 정의상 '나에게 배정된 것'만 남긴 화면이고,
     * 거기 남은 빈 마일스톤은 '내 일이 없는 구간'이라는 뜻뿐입니다. 프로젝트가
     * 수십 개인 사람에게 그건 스크롤 몇 화면입니다.
     */
    const shown = myTasksOnly ? pjMilestones.filter(ms => grouped[ms.id]?.length) : pjMilestones
    const sortedMs = [...shown].sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0))
    return (
      <>
        {sortedMs.map(ms => {
          const msTasks = grouped[ms.id] ?? []
          const isCollapsed = collapsedMs.has(ms.id)
          const doneTasks = msTasks.filter(t => t.status === '완료').length
          const diff = daysFrom(ms.dueDate, today)
          const overdue = !ms.done && diff < 0
          const dLabel = overdue ? `D+${Math.abs(diff)}` : diff === 0 ? 'D-Day' : `D-${diff}`
          const dColor = ms.done ? 'var(--t3)' : overdue ? 'var(--danger)' : diff <= 7 ? '#D9730D' : 'var(--t3)'
          const accent = milestoneAccent(!!ms.done, diff)
          const d = new Date(ms.dueDate + 'T00:00:00')
          const dateLabel = `${d.getMonth() + 1}/${d.getDate()}`
          return (
            <React.Fragment key={ms.id}>
              <div
                onClick={() => toggleMs(ms.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'var(--bg2)', borderBottom: '1px solid var(--bd)', borderLeft: `2px solid ${accent}`, cursor: 'pointer', opacity: ms.done ? 0.6 : 1 }}
              >
                <button
                  onClick={e => { e.stopPropagation(); updateMilestone(ms.id, { done: !ms.done }) }}
                  style={{ width: 18, height: 18, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', border: ms.done ? '2px solid #448361' : '2px solid var(--bd2)', background: ms.done ? '#448361' : 'transparent', color: '#fff', fontSize: 10, cursor: 'pointer', padding: 0, transition: 'all .15s' }}
                >
                  {ms.done ? '✓' : ''}
                </button>
                <span style={{ fontSize: 10, color: accent }}>◆</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--t1)', textDecoration: ms.done ? 'line-through' : 'none' }}>{ms.name}</span>
                {!ms.done && <span style={{ fontSize: 11, color: 'var(--t3)', marginRight: 2 }}>{dateLabel}</span>}
                {!ms.done && (overdue || diff <= 30) && <span style={{ fontSize: 11, fontWeight: 600, color: dColor, background: overdue ? 'rgba(212,76,71,.08)' : diff <= 7 ? 'rgba(217,115,13,.1)' : 'var(--bg3)', borderRadius: 6, padding: '1px 6px', marginRight: 4 }}>{dLabel}</span>}
                <span style={{ fontSize: 11, color: 'var(--t3)', marginRight: 6 }}>{doneTasks}/{msTasks.length}</span>
                <span style={{ fontSize: 9, color: 'var(--t3)' }}>{isCollapsed ? '▶' : '▼'}</span>
              </div>
              {!isCollapsed && sortDoneLast(msTasks).map(t => renderTask(t, false, accent))}
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
      onClick={() => _openTaskModal({ milestoneId })}
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

  // ── Flat modes ──────────────────────────────────────────────────────────────
  // Same buckets as the desktop list, drawn as sections. Grouping is a stored
  // preference, so a phone that ignored it would quietly disagree with the
  // laptop the same person set it on.
  if (listGroup !== 'project') {
    const buckets = bucketTasks(filteredTasks, listGroup, todayDate, getNameByEmail)
    // A subtask whose parent is in the same section is drawn under it, so it
    // must not also be drawn as a row of its own — it was appearing twice.
    // When the parent is in another section the child stands alone, which is
    // the point of the flat modes.
    const tops = (list: Task[]) => {
      const here = new Set(list.map(t => t.id))
      return list.filter(t => !t.parentId || !here.has(t.parentId))
    }
    return (
      <>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {buckets.length === 0 && (
            <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: 13, color: 'var(--t3)' }}>
              조건에 맞는 업무가 없습니다
            </div>
          )}
          {buckets.map(b => {
            if (b.key === '__all__') {
              return <React.Fragment key={b.key}>{tops(b.tasks).map(t => renderTask(t, false, undefined, crumbFor(t)))}</React.Fragment>
            }
            const isCollapsed = collapsedMs.has(b.key)
            return (
              <React.Fragment key={b.key}>
                <div
                  onClick={() => { haptic('tap'); toggleMs(b.key) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'var(--bg2)', borderBottom: '1px solid var(--bd)', borderLeft: `3px solid ${b.accent ?? 'var(--bd)'}`, cursor: 'pointer' }}
                >
                  <span style={{ fontSize: 9, color: 'var(--t3)', width: 10 }}>{isCollapsed ? '▶' : '▼'}</span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: b.accent ?? 'var(--t1)' }}>{b.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--t3)' }}>{b.tasks.length}</span>
                </div>
                {!isCollapsed && tops(b.tasks).map(t => renderTask(t, false, undefined, crumbFor(t)))}
              </React.Fragment>
            )
          })}
          {addTaskBtn()}
        </div>
        {mobCtxMenuEl}
      </>
    )
  }

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
  const { addTask, deleteTask, updateTask } = useTaskStore(useShallow(s => ({ addTask: s.addTask, deleteTask: s.deleteTask, updateTask: s.updateTask })))
  const { openTaskDetail, projectId, hideCompleted, listGroup, myTasksOnly } = useUiStore(useShallow(s => ({ openTaskDetail: s.openTaskDetail, projectId: s.projectId, hideCompleted: s.hideCompleted, listGroup: s.listGroup, myTasksOnly: s.myTasksOnly })))
  const { milestones, updateMilestone, deleteMilestone, addMilestone } = useMilestoneStore()
  const allProjects = useProjectStore(s => s.projects)
  const getNameByEmail = useUserProfileStore(s => s.getNameByEmail)
  const userEmail = useAuthStore(s => s.email)
  // Only projects the current user is a member of
  const projects = React.useMemo(() =>
    allProjects
  , [allProjects, userEmail])
  const taskEvents = useTaskEvents()
  const isMobile = useMobile()

  // A task added to a list of one's own work is one's own work. Elsewhere the
  // row still asks, because elsewhere the screen does not know the answer.
  const myAssignee = myTasksOnly ? (userEmail ?? '') : ''

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [collapsedMs, setCollapsedMs] = useState<Set<string>>(new Set())
  const [collapsedPj, setCollapsedPj] = useState<Set<string>>(new Set())
  const [ctxMenu, setCtxMenu] = useState<CtxState>(null)
  const [addingMs, setAddingMs] = useState<string | null>(null)
  const [draftMsId, setDraftMsId] = useState<string | null>(null)
  /** "add at the end of this project", the inline answer to the old modal. */
  const [draftEndPjId, setDraftEndPjId] = useState<string | null>(null)
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
  // 고를 수 있는 사람은 그 업무를 읽을 수 있는 사람뿐입니다 — lib/utils.
  const getAssigneeOptions = useCallback(
    (pjId: string | undefined) => assigneeOptions(pjId, projects, userEmail, getNameByEmail),
    [projects, userEmail, getNameByEmail],
  )

  const allTags = React.useMemo(() => {
    const s = new Set<string>()
    accessibleTasks.forEach(t => t.tags?.forEach(tag => s.add(tag)))
    return Array.from(s).sort()
  }, [accessibleTasks])

  // Nine columns is 1350px, so something is always off-screen. Hiding the ones
  // a given person never reads is the only way to get the table to fit; the
  // choice is per-browser and persists with the widths.
  const visibleCols = React.useMemo(() => cols.filter(c => !c.hidden), [cols])
  const totalColWidth = React.useMemo(() => visibleCols.reduce((sum, c) => sum + c.width, 0), [visibleCols])
  const projectPickerOptions = React.useMemo(
    () => projects.filter(p => !p.archived).map(p => ({ id: p.id, name: p.name, color: p.color })),
    [projects],
  )

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
    /**
     * 손가락에는 우클릭이 없습니다. 길게 누르면 같은 메뉴가 뜹니다 — 간트의
     * 마일스톤 줄이 이미 그렇게 하고 있고, 아이패드에서 이 메뉴에 닿는 길은
     * 이것뿐입니다. 마우스에는 아무 일도 안 합니다(lib/press).
     */
    onPointerDown: (e: React.PointerEvent) => beginLongPress(e, p => setCtxMenu({ x: p.x, y: p.y, task })),
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
    <div style={{ display: 'flex', minWidth: 'max-content', background: 'var(--bg2)', borderBottom: '2px solid var(--bd)', userSelect: 'none' }}>
      {visibleCols.map((col, idx) => {
        const isLast = idx === visibleCols.length - 1
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
      <ColumnPicker cols={cols} onChange={setCols} />
    </div>
  )

  // ── Row helpers ─────────────────────────────────────────────────────────────
  const milestonesOf = useCallback((pjId?: string) =>
    pjId ? milestones.filter(m => m.projectId === pjId) : []
  , [milestones])

  // The project half is dropped when a single project is already selected —
  // repeating it on every row would say nothing the sidebar has not.
  const crumbFor = useCallback((task: Task) => {
    const proj = projectId ? undefined : projects.find(p => p.id === task.projectId)
    const ms = task.milestoneId ? milestones.find(m => m.id === task.milestoneId) : undefined
    const parent = task.parentId ? allTasks.find(t => t.id === task.parentId) : undefined
    if (!proj && !ms && !parent) return undefined
    return <TaskBreadcrumb project={proj} milestone={ms} parentName={parent?.name} />
  }, [projectId, projects, milestones, allTasks])

  const sortDoneLast = (arr: Task[]) =>
    [...arr].sort((a, b) => (a.status === '완료' ? 1 : 0) - (b.status === '완료' ? 1 : 0))

  const renderRows = (tasks: Task[], pickerMilestones: Milestone[], groupAccent?: string) =>
    sortDoneLast(tasks).map(task => {
      const children = sortDoneLast(getChildren(task.id))
      const hasChildren = children.length > 0
      const isExpanded = !collapsed.has(task.id)
      const h = makeHandlers(task)
      const aOpts = getAssigneeOptions(task.projectId)
      return (
        <React.Fragment key={task.id}>
          <Row cols={visibleCols} task={task} hasChildren={hasChildren} isExpanded={isExpanded}
            childCount={children.length} doneCount={children.filter(c => c.status === '완료').length}
            milestones={pickerMilestones} showMilestonePicker={!!task.projectId}
            onMilestoneCreate={task.projectId ? (n, d) => addMilestone(task.projectId!, n, d).id : undefined}
            assigneeOptions={aOpts} allTags={allTags} groupAccent={groupAccent}
            events={taskEvents.get(task.id)}
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
                <Row cols={visibleCols} task={child} isChild
                  milestones={pickerMilestones} showMilestonePicker={!!child.projectId}
                  onMilestoneCreate={child.projectId ? (n, d) => addMilestone(child.projectId!, n, d).id : undefined}
                  assigneeOptions={cOpts} allTags={allTags} groupAccent={groupAccent}
                  events={taskEvents.get(child.id)}
                  {...ch}
                  isDragging={draggingTaskId === child.id}
                  isDragTarget={false}
                  canDrag={true}
                  canBeDropTarget={false}
                  onDragStart={() => setDraggingTaskId(child.id)}
                  onDragEnd={() => { setDraggingTaskId(null); setDropTargetId(null) }}
                />
                {draftSubtaskParentId === child.id && (
                  <AddTaskRow cols={visibleCols} defaultAssignee={myAssignee} isSubtask parentId={child.id}
                    assigneeOptions={cOpts} projectId={child.projectId} milestoneId={child.milestoneId}
                    addTask={addTask} userEmail={userEmail}
                    onDone={another => { if (!another) setDraftSubtaskParentId(null) }}
                    onCancel={() => setDraftSubtaskParentId(null)}
                  />
                )}
              </React.Fragment>
            )
          })}
          {draftSubtaskParentId === task.id && (
            <AddTaskRow cols={visibleCols} defaultAssignee={myAssignee} isSubtask parentId={task.id}
              assigneeOptions={aOpts} projectId={task.projectId} milestoneId={task.milestoneId}
              addTask={addTask} userEmail={userEmail}
              onDone={another => { if (!another) setDraftSubtaskParentId(null) }}
              onCancel={() => setDraftSubtaskParentId(null)}
            />
          )}
        </React.Fragment>
      )
    })

  /**
   * Flat rows, with the hierarchy still readable inside each group.
   *
   * A subtask due today has to be visible on its own merit — that is the whole
   * point of the flat modes — so nothing is hidden behind a parent. But it was
   * *only* ever a loose row, and two things followed: the parent never showed
   * that it had subtasks at all, and 하위 업무 추가 quietly did nothing here,
   * because the add row it opens was only ever drawn in the project layout.
   *
   * So: a child sits under its parent when the parent is in the same group, and
   * stands on its own — breadcrumb and all — when it is not. Nothing appears
   * twice, and nothing appears that the filters excluded: the children drawn
   * under a parent are only the ones this group already contains.
   */
  const renderFlatRows = (tasks: Task[]) => {
    const here = new Map(tasks.map(t => [t.id, t]))
    const childrenHere = new Map<string, Task[]>()
    for (const t of tasks) {
      if (!t.parentId || !here.has(t.parentId)) continue
      const list = childrenHere.get(t.parentId) ?? []
      list.push(t)
      childrenHere.set(t.parentId, list)
    }

    const flatRow = (task: Task, isChild: boolean) => {
      const h = makeHandlers(task)
      const kids = sortDoneLast(childrenHere.get(task.id) ?? [])
      const isExpanded = !collapsed.has(task.id)
      const opts = getAssigneeOptions(task.projectId)
      return (
        <React.Fragment key={task.id}>
          <Row
            cols={visibleCols} task={task} isChild={isChild}
            hasChildren={kids.length > 0} isExpanded={isExpanded}
            childCount={kids.length} doneCount={kids.filter(c => c.status === '완료').length}
            milestones={milestonesOf(task.projectId)} showMilestonePicker={!!task.projectId}
            onMilestoneCreate={task.projectId ? (n, d) => addMilestone(task.projectId!, n, d).id : undefined}
            assigneeOptions={opts} allTags={allTags} flat
            events={taskEvents.get(task.id)}
            // A child drawn under its parent does not need to be told who its
            // parent is; the indentation already said so.
            breadcrumb={isChild ? crumbFor({ ...task, parentId: undefined }) : crumbFor(task)}
            onToggle={() => toggle(task.id)}
            {...h}
          />
          {kids.length > 0 && isExpanded && kids.map(child => flatRow(child, true))}
          {draftSubtaskParentId === task.id && (
            <AddTaskRow cols={visibleCols} defaultAssignee={myAssignee} isSubtask parentId={task.id}
              assigneeOptions={opts} projectId={task.projectId} milestoneId={task.milestoneId}
              addTask={addTask} userEmail={userEmail}
              onDone={another => { if (!another) setDraftSubtaskParentId(null) }}
              onCancel={() => setDraftSubtaskParentId(null)}
            />
          )}
        </React.Fragment>
      )
    }

    const roots = sortDoneLast(tasks.filter(t => !t.parentId || !here.has(t.parentId)))
    return roots.map(task => flatRow(task, false))
  }

  /**
   * The quiet "one more" at the end of a group's rows.
   *
   * Adding a task belongs immediately after the rows it extends, in the group
   * that will own it — the same rule the project card's button follows one level
   * up. This replaces a button that only appeared when you hovered the group's
   * header, and a right-click menu whose only item did the same thing.
   */
  const groupAddRow = (key: string, msId: string | undefined, pjId: string | undefined, accent?: string) => (
    <div
      onClick={() => setDraftMsId(key)}
      style={{
        display: 'flex', alignItems: 'center', gap: 7,
        padding: '6px 12px 6px 26px', minWidth: totalColWidth,
        borderBottom: '1px solid var(--bd)', cursor: 'pointer',
        color: 'var(--t3)', fontSize: 12, transition: 'background .1s, color .1s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg3)'; e.currentTarget.style.color = accent ?? 'var(--t2)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t3)' }}
    >
      <span style={{ position: 'sticky', left: 26, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 14, lineHeight: 1, marginTop: -1 }}>+</span> 업무
      </span>
      {/* Referenced so the signature reads as "add into this milestone". */}
      <span hidden>{msId}{pjId}</span>
    </div>
  )

  const renderMilestoneGroups = (tasks: Task[], pjMilestones: Milestone[]) => {
    const pjId = pjMilestones[0]?.projectId
    const grouped: Record<string, Task[]> = {}
    for (const ms of pjMilestones) grouped[ms.id] = []
    const unassigned: Task[] = []
    for (const task of tasks) {
      if (task.milestoneId && grouped[task.milestoneId] !== undefined) grouped[task.milestoneId].push(task)
      else unassigned.push(task)
    }
    /**
     * 내 할 일에서는 빈 마일스톤을 접지 않고 아예 내립니다.
     *
     * 프로젝트를 펼쳐 보고 있을 때 비어 있는 마일스톤은 정보입니다 — 아직
     * 아무도 손대지 않은 구간이고, 그 헤더의 추가 행이 거기에 일을 넣는
     * 방법입니다. 하지만 내 할 일은 정의상 '나에게 배정된 것'만 남긴 화면이고,
     * 거기 남은 빈 마일스톤은 '내 일이 없는 구간'이라는 뜻뿐입니다. 프로젝트가
     * 수십 개인 사람에게 그건 스크롤 몇 화면입니다.
     */
    const shown = myTasksOnly ? pjMilestones.filter(ms => grouped[ms.id]?.length) : pjMilestones
    const sortedMs = [...shown].sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0))

    const draftRow = (key: string, msId: string | undefined) => (
      <AddTaskRow
        cols={visibleCols}
        defaultAssignee={myAssignee}
        assigneeOptions={getAssigneeOptions(pjId)}
        milestoneId={msId}
        projectId={pjId}
        addTask={addTask}
        userEmail={userEmail}
        onDone={(another) => { if (!another) setDraftMsId(null) }}
        onCancel={() => setDraftMsId(null)}
        key={`draft-${key}`}
      />
    )

    return (
      <>
        {sortedMs.map(ms => {
          const msTasks = grouped[ms.id] ?? []
          const isCollapsed = collapsedMs.has(ms.id)
          const diff = daysFrom(ms.dueDate, today)
          const accent = milestoneAccent(!!ms.done, diff)
          return (
            <React.Fragment key={ms.id}>
              <MilestoneHeader
                milestone={ms} taskCount={msTasks.length}
                completed={msTasks.filter(t => t.status === '완료').length}
                diff={diff} collapsed={isCollapsed}
                minWidth={totalColWidth}
                onToggle={() => toggleMs(ms.id)}
                onToggleDone={() => updateMilestone(ms.id, { done: !ms.done })}
                onUpdate={patch => updateMilestone(ms.id, patch)}
                onDelete={() => deleteMilestone(ms.id)}
              />
              {!isCollapsed && renderRows(msTasks, pjMilestones, accent)}
              {!isCollapsed && (draftMsId === ms.id
                ? draftRow(ms.id, ms.id)
                : groupAddRow(ms.id, ms.id, pjId, accent))}
            </React.Fragment>
          )
        })}
        {/*
          Always drawn, even at zero. It is the container for "no milestone
          yet", and a container that only appears once something is already in
          it gives you no way to put the first thing there — which is what the
          card's own add button was quietly compensating for.
        */}
        {(
          <>
            <UnassignedHeader count={unassigned.length}
              collapsed={collapsedMs.has('__none__')}
              minWidth={totalColWidth}
              onToggle={() => toggleMs('__none__')} />
            {!collapsedMs.has('__none__') && renderRows(unassigned, pjMilestones)}
            {!collapsedMs.has('__none__') && (draftMsId === '__none__'
              ? draftRow('__none__', undefined)
              : groupAddRow('__none__', undefined, pjId))}
          </>
        )}
      </>
    )
  }

  /**
   * Adding a milestone sits below the card, not inside it.
   *
   * The card is the project's tasks; 업무 추가 continues the list directly above
   * it and belongs against it. A milestone is not another row — it is a new
   * container for rows — so it reads as an action on the card rather than an
   * entry in it, and is drawn one step quieter and one step further out.
   */
  const addMsBtn = (pjId: string) => (
    <button
      onClick={() => setAddingMs(pjId)}
      style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 6, padding: '5px 12px', fontSize: 12, color: 'var(--t3)', background: 'transparent', border: '1px dashed var(--bd2)', borderRadius: 'var(--r2)', cursor: 'pointer', fontFamily: 'var(--font)', alignSelf: 'flex-start', transition: 'color .1s, border-color .1s, background .1s' }}
      onMouseEnter={e => { e.currentTarget.style.color = NOTION.purple.text; e.currentTarget.style.borderColor = NOTION.purple.text; e.currentTarget.style.background = NOTION.purple.bg }}
      onMouseLeave={e => { e.currentTarget.style.color = 'var(--t3)'; e.currentTarget.style.borderColor = 'var(--bd2)'; e.currentTarget.style.background = 'transparent' }}
    >
      <span style={{ fontSize: 9, lineHeight: 1 }}>◆</span> 마일스톤 추가
    </button>
  )

  /** The inline milestone form, standing on its own below the card. */
  const msForm = (pjId: string) => (
    <div style={{ marginTop: 6, border: '1px solid var(--bd)', borderRadius: 'var(--r4)', overflow: 'clip' }}>
      <AddMilestoneInline projectId={pjId} onDone={() => setAddingMs(null)} />
    </div>
  )

  /**
   * Adds a row to the table instead of opening a dialog.
   *
   * The dialog asked for one field at a time behind a modal; the row is the
   * same shape as the thing being created, fills in with Tab, and commits with
   * Enter — so adding five tasks is five lines of typing rather than five
   * round trips through a popup.
   */
  const addBtn = (pjId?: string) => (
    <button
      onClick={() => setDraftEndPjId(pjId ?? '__none__')}
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
      onDelete={async () => {
        const children = getChildren(ctxMenu.task.id)
        const ok = await askConfirm({
          message: `"${ctxMenu.task.name || '이름 없음'}" 업무를 삭제할까요?`,
          detail: children.length ? `하위 업무 ${children.length}개도 함께 삭제됩니다.` : undefined,
        })
        if (!ok) return
        children.forEach(c => deleteTask(c.id))
        deleteTask(ctxMenu.task.id)
      }}
    />
  )

  if (isMobile) return <MobileTableView />

  // ── Flat modes ──────────────────────────────────────────────────────────────
  // Any grouping other than 'project' collapses to a single table: one column
  // header, one horizontal scroll container, every row comparable with every
  // other row. That is what makes "what is urgent right now" answerable across
  // project boundaries — the per-project cards can only ever rank within a card.
  if (listGroup !== 'project') {
    // filteredTasks, not rootTasks — see renderFlatRows.
    const buckets = bucketTasks(filteredTasks, listGroup, today, getNameByEmail)
    const flatRows = renderFlatRows
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        <div style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r4)', overflow: 'clip' }}>
          <div style={{ overflowX: 'auto' }}>
            {colHeader}
            {buckets.length === 0 && (
              <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: 13, color: 'var(--t3)' }}>
                조건에 맞는 업무가 없습니다
              </div>
            )}
            {buckets.map(b => {
              if (b.key === '__all__') return <React.Fragment key={b.key}>{flatRows(b.tasks)}</React.Fragment>
              const isCollapsed = collapsedMs.has(b.key)
              return (
                <React.Fragment key={b.key}>
                  <GroupHeader
                    label={b.label} accent={b.accent}
                    count={b.tasks.length}
                    done={b.tasks.filter(t => t.status === '완료').length}
                    collapsed={isCollapsed}
                    minWidth={totalColWidth}
                    onToggle={() => toggleMs(b.key)}
                  />
                  {!isCollapsed && flatRows(b.tasks)}
                </React.Fragment>
              )
            })}
            {/*
              One add row for the whole flat list, not one per group.

              The groups here are properties — a due window, a priority, a
              person — not containers. Hanging "add into 높음" off one would
              claim a priority owns tasks the way a milestone does, which is
              exactly the confusion the flat modes exist to avoid. So the row
              belongs to the list, and asks for the project it cannot inherit.
            */}
            {draftEndPjId === FLAT_DRAFT && (
              <AddTaskRow
                cols={visibleCols}
                defaultAssignee={myAssignee}
                assigneeOptions={getAssigneeOptions(projectId ?? undefined)}
                projectId={projectId ?? undefined}
                projectOptions={projectId ? undefined : projectPickerOptions}
                milestoneOptions={milestones}
                onMilestoneCreate={(pid, n, d) => addMilestone(pid, n, d).id}
                addTask={addTask}
                userEmail={userEmail}
                onDone={another => { if (!another) setDraftEndPjId(null) }}
                onCancel={() => setDraftEndPjId(null)}
              />
            )}
          </div>
          {draftEndPjId !== FLAT_DRAFT && addBtn(FLAT_DRAFT)}
        </div>
        {ctx}
      </div>
    )
  }

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
            <div key={proj.id} style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r4)', overflow: 'clip' }}>
              {/* Project header – fixed, not scrollable */}
              {/*
                The project is the outer container and has to read as one.

                It was a 3px rail on a grey bar, and the milestone headers
                inside it were a 3px rail on the same grey bar — at a glance
                they were the same kind of thing. The project now takes the
                heavier end of every axis: bigger type, a wider rail in its own
                colour, its colour washed across the bar, and the chevron on
                the left where the top of a tree belongs. The milestone headers
                below give the corresponding ground back.
              */}
              <div
                onClick={() => togglePj(proj.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9,
                  padding: '11px 14px',
                  background: `linear-gradient(${proj.color}0F, ${proj.color}0F), var(--bg2)`,
                  borderBottom: isCollapsed ? 'none' : `1px solid ${proj.color}33`,
                  cursor: 'pointer', borderLeft: `4px solid ${proj.color}`,
                }}
              >
                <span style={{ fontSize: 9, color: 'var(--t3)', width: 10, flexShrink: 0 }}>{isCollapsed ? '▶' : '▼'}</span>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: proj.color, flexShrink: 0 }} />
                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--t1)', flex: 1, letterSpacing: '-.01em' }}>{proj.name}</span>
                <span style={{ fontSize: 11, color: 'var(--t3)' }}>{doneCount}/{pjTasks.length} 완료</span>
              </div>
              {!isCollapsed && (
                <>
                  {/* Scrollable area: column header + task rows only */}
                  <div style={{ overflowX: 'auto' }}>
                    {colHeader}
                    {pjMilestones.length > 0
                      ? renderMilestoneGroups(pjTasks, pjMilestones)
                      : renderRows(pjTasks, pjMilestones)}
                    {draftEndPjId === proj.id && (
                      <AddTaskRow
                        cols={visibleCols}
                        defaultAssignee={myAssignee}
                        assigneeOptions={getAssigneeOptions(proj.id)}
                        projectId={proj.id}
                                addTask={addTask}
                        userEmail={userEmail}
                        onDone={another => { if (!another) setDraftEndPjId(null) }}
                        onCancel={() => setDraftEndPjId(null)}
                      />
                    )}
                  </div>
                  {/* Only where there are no milestone groups to own it — with
                      groups, each owns its own add row and this would be a
                      second door into the same room. */}
                  {pjMilestones.length === 0 && addBtn(proj.id)}
                </>
              )}
            </div>
            {!isCollapsed && (addingMs === proj.id ? msForm(proj.id) : addMsBtn(proj.id))}
            </div>
          )
        })}
        {unassignedTasks.length > 0 && (
          <div style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r4)', overflow: 'clip' }}>
            {/* Unassigned header – fixed */}
            <div
              onClick={() => togglePj('__no_project__')}
              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 14px', background: 'var(--bg2)', borderBottom: collapsedPj.has('__no_project__') ? 'none' : '1px solid var(--bd)', cursor: 'pointer', borderLeft: '4px solid var(--bd2)' }}
            >
              <span style={{ fontSize: 9, color: 'var(--t3)', width: 10, flexShrink: 0 }}>{collapsedPj.has('__no_project__') ? '▶' : '▼'}</span>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--bd2)', flexShrink: 0 }} />
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--t2)', flex: 1, letterSpacing: '-.01em' }}>프로젝트 미배정</span>
              <span style={{ fontSize: 11, color: 'var(--t3)' }}>{unassignedTasks.length}개</span>
            </div>
            {!collapsedPj.has('__no_project__') && (
              <>
                <div style={{ overflowX: 'auto' }}>
                  {colHeader}
                  {renderRows(unassignedTasks, [])}
                  {draftEndPjId === '__none__' && (
                    <AddTaskRow
                      cols={visibleCols}
                      defaultAssignee={myAssignee}
                      assigneeOptions={getAssigneeOptions(undefined)}
                            addTask={addTask}
                      userEmail={userEmail}
                      onDone={another => { if (!another) setDraftEndPjId(null) }}
                      onCancel={() => setDraftEndPjId(null)}
                    />
                  )}
                </div>
                {addBtn()}
              </>
            )}
          </div>
        )}
        {ctx}
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
            ? renderMilestoneGroups(rootTasks, pjMilestones)
            : renderRows(rootTasks, [])}
          {draftEndPjId === projectId && (
            <AddTaskRow
              cols={visibleCols}
              defaultAssignee={myAssignee}
              assigneeOptions={getAssigneeOptions(projectId)}
              projectId={projectId}
                    addTask={addTask}
              userEmail={userEmail}
              onDone={another => { if (!another) setDraftEndPjId(null) }}
              onCancel={() => setDraftEndPjId(null)}
            />
          )}
        </div>
        {pjMilestones.length === 0 && addBtn(projectId!)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {addingMs === projectId ? msForm(projectId!) : addMsBtn(projectId!)}
      </div>
      {ctx}
    </div>
  )
}

// ── Row ───────────────────────────────────────────────────────────────────────

function Row({
  cols, task, isChild = false,
  hasChildren = false, isExpanded = true,
  childCount = 0, doneCount = 0,
  milestones = [], showMilestonePicker = false, onMilestoneCreate,
  assigneeOptions = [],
  allTags = [],
  groupAccent,
  flat = false,
  breadcrumb,
  events,
  onToggle, onOpen, onUpdate, onMilestoneChange, onContextMenu, onPointerDown,
  isDragging = false, isDragTarget = false,
  canDrag = false, canBeDropTarget = false,
  onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop,
}: {
  cols: ColDef[]
  task: Task; isChild?: boolean
  hasChildren?: boolean; isExpanded?: boolean; childCount?: number; doneCount?: number
  milestones?: Milestone[]; showMilestonePicker?: boolean
  onMilestoneCreate?: (name: string, dueDate: string) => string | undefined
  assigneeOptions?: { value: string; label: string }[]
  allTags?: string[]
  /** Colour of the milestone this row sits under, drawn as a rail on the left. */
  groupAccent?: string
  /**
   * 위에 마일스톤 머리글이 없는 평면 목록의 줄인가.
   *
   * 들여쓰기 64는 머리글 밑에 줄을 세우려고 잡은 값입니다. 세울 머리글이
   * 없는 평면 목록에서는 그냥 왼쪽에 빈 손바닥만 한 여백이 생깁니다 —
   * 화면에서 제일 좁은 이름 칸을 그만큼 깎아 먹으면서요. 손잡이와 펼침
   * 화살표가 들어갈 만큼만 둡니다.
   */
  flat?: boolean
  /** Linked calendar events, if any are in the loaded window. */
  events?: GCalEvent[]
  /**
   * Where the task lives, for flat modes where no header above the row says so.
   * Rendered as a second line under the name rather than inline, so it never
   * competes with the name for the truncation budget.
   */
  breadcrumb?: React.ReactNode
  onToggle?: () => void; onOpen: () => void
  onUpdate: (patch: Partial<Task>) => void
  onMilestoneChange?: (id: string | undefined) => void
  onContextMenu?: (e: React.MouseEvent) => void
  onPointerDown?: (e: React.PointerEvent) => void
  isDragging?: boolean; isDragTarget?: boolean
  canDrag?: boolean; canBeDropTarget?: boolean
  onDragStart?: () => void; onDragEnd?: () => void
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void
  onDragLeave?: () => void; onDrop?: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const touch = useTouch()
  const [editing, setEditing] = useState<string | null>(null)
  const dueCellRef = useRef<HTMLDivElement>(null)
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
              paddingLeft: flat ? (isChild ? 72 : 48) : (isChild ? 88 : 64),
              gap: 5,
              position: 'sticky',
              left: 0,
              zIndex: 2,
              background: hovered ? 'var(--bg2)' : 'var(--bg)',
              boxShadow: '2px 0 4px rgba(0,0,0,.06)',
            }}
          >
            {/*
              ── 이 줄이 어디에 속하는가 ───────────────────────────────────
              머리줄에서 내려온 마일스톤 색. 목록이 길면 머리줄은 위로
              사라지는데, 그때 이 줄이 어느 묶음의 것인지 말해 주는 건 이
              색뿐입니다. 그래서 색이 필요합니다 — 예쁘라고 있는 게 아니라
              스크롤이 지운 맥락을 되돌려 놓습니다.

              **한 줄에 하나만.** 끌어 놓는 자리 · 손이 얹힌 줄 · 소속,
              셋을 각각 다른 띠로 그리면 줄마다 두세 겹이 섭니다. 지금은
              같은 3px 한 자리를 셋이 나눠 쓰고, 급한 것이 이깁니다 —
              끌어 놓는 자리가 맨 위, 그다음이 손이 얹힌 줄, 평소엔 소속.

              하위 업무의 회색 띠는 없앴습니다. 들여쓰기가 이미 하위라고
              말하고 있고, 부모와 다른 색 띠가 붙으면 오히려 다른 묶음처럼
              보였습니다. 하위 업무는 부모와 같은 색을 씁니다.
            */}
            {(isDragTarget || hovered || groupAccent) && (
              <span aria-hidden style={{
                position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
                background: isDragTarget || hovered ? 'var(--ac)' : groupAccent,
                opacity: isDragTarget || hovered ? 1 : (isDone ? 0.25 : 0.45),
                transition: 'background .08s, opacity .08s',
              }} />
            )}
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
                  opacity: hovered || touch ? 0.8 : 0, transition: 'opacity .1s',
                  userSelect: 'none', lineHeight: 1,
                }}
              >⠿</span>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0, opacity: isDone ? 0.55 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
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
              {/*
                우선순위 '높음'에 붙던 빨간 점이 여기 있었습니다.

                두 가지 이유로 뺐습니다. 하나, 우선순위는 이미 자기 열에
                badge로 있습니다 — 한 줄에서 같은 사실을 두 번 말하고 있었던
                겁니다. 둘, 이 앱에서 이름 앞의 색점은 이미 '프로젝트'라는 뜻을
                갖고 있습니다. 같은 자리의 같은 모양이 다른 뜻을 가지면 둘 다
                안 읽힙니다.
              */}
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
              {!!events?.length && <EventCountChip events={events} />}
              {task.tags && task.tags.length > 0 && (
                <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                  {task.tags.slice(0, 2).map(tag => <TagBadge key={tag} tag={tag} />)}
                  {task.tags.length > 2 && <span style={{ fontSize: 10, color: 'var(--t3)', alignSelf: 'center' }}>+{task.tags.length - 2}</span>}
                </div>
              )}
              {(task.blockedBy?.length || task.blocking?.length) ? (
                <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                  {!!task.blockedBy?.length && <span title={`선행 ${task.blockedBy.length}개`} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'rgba(212,76,71,.1)', color: 'var(--danger)', lineHeight: 1.6 }}>⛔ {task.blockedBy.length}</span>}
                  {!!task.blocking?.length && <span title={`후행 ${task.blocking.length}개`} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'rgba(217,115,13,.1)', color: '#D9730D', lineHeight: 1.6 }}>⚡ {task.blocking.length}</span>}
                </div>
              ) : null}
              {showMilestonePicker && (hovered || task.milestoneId) && onMilestoneChange && (
                <MilestonePicker
                  milestoneId={task.milestoneId} milestones={milestones}
                  onChange={onMilestoneChange} onCreate={onMilestoneCreate}
                />
              )}
            </div>
            {breadcrumb}
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
            <AssigneePicker
              assignee={task.assignee}
              options={assigneeOptions}
              onChange={v => onUpdate({ assignee: v })}
            />
          </div>
        )

      case 'status':
        return (
          <div key="status" style={{ ...cellBase(col, isLast, true), padding: '6px 10px' }}>
            <BadgeSelect
              value={task.status}
              options={(['진행중','대기','검토중','완료'] as Status[])}
              styleMap={STATUS_STYLE}
              renderValue={v => <StatusPill status={v} />}
              onChange={v => onUpdate({ status: v as Status })}
            />
          </div>
        )

      case 'due':
        return (
          <div
            key="due"
            ref={dueCellRef}
            style={cellBase(col, isLast, true)}
            onClick={e => {
              // The second click of a double-click would toggle the picker shut
              // again; ignoring it leaves it open, which is what was meant.
              if (e.detail >= 2) return
              e.stopPropagation()
              setEditing(editing === 'due' ? null : 'due')
            }}
          >
            <span style={{ fontSize: 13, color: overdue ? 'var(--danger)' : task.due ? 'var(--t2)' : 'var(--t3)', fontWeight: overdue ? 500 : 400, cursor: 'pointer' }}>
              {task.due ? (overdue ? '⚠ ' : '') + fmtDate(task.due) : '—'}
            </span>
            {editing === 'due' && (
              <DatePicker
                value={task.due || ''}
                anchor={dueCellRef.current}
                context={{
                  taskId: task.id, projectId: task.projectId, milestoneId: task.milestoneId,
                  parentId: task.parentId, assignee: task.assignee, blockedBy: task.blockedBy,
                }}
                onChange={v => onUpdate({ due: v })}
                onClose={stopEdit}
              />
            )}
          </div>
        )

      case 'priority':
        return (
          <div key="priority" style={{ ...cellBase(col, isLast, true), padding: '6px 10px' }}>
            <BadgeSelect
              value={task.priority}
              options={(['높음','중간','낮음'] as Priority[])}
              styleMap={PRIORITY_STYLE}
              renderValue={v => <PriorityLabel priority={v} />}
              onChange={v => onUpdate({ priority: v as Priority })}
            />
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
              projectId={task.projectId}
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
      className="hold"
      onDoubleClick={() => { stopEdit(); onOpen() }}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
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
        minWidth: 'max-content',
        opacity: isDragging ? 0.4 : 1,
        background: isDragTarget
          ? 'var(--ac-l)'
          : hovered ? 'var(--bg3)' : (isChild ? 'var(--bg)' : 'transparent'),
        borderBottom: '1px solid var(--bd)',
        /**
         * ── 왼쪽 띠는 하나입니다 ──────────────────────────────────────────
         *
         * 여기 3px 테두리가 하나 있고, 아래 이름 칸 안에 마일스톤 색 띠가 또
         * 하나 있었습니다. 둘이 나란히 서니 **줄마다 두 겹**이었고, 안쪽
         * 띠는 바깥 테두리 두께만큼 밀려서 머리줄의 띠와 3px 어긋났습니다 —
         * 그 미세한 들여쓰기가 신고된 그것입니다.
         *
         * 이제 테두리는 자리를 차지하지 않고, 띠는 이름 칸 안의 하나뿐입니다.
         * 그 칸은 가로 스크롤에도 붙어 있으므로(sticky) 오른쪽으로 밀어도
         * 어느 마일스톤의 줄인지가 남습니다 — 바깥 테두리로는 못 하던 것입니다.
         */
        transition: 'background .08s, opacity .08s',
      }}
    >
      {cols.map((col, idx) => renderCell(col, idx === cols.length - 1))}
      <div style={{ flex: 1 }} />
    </div>
  )
}

// ── MilestoneHeader ───────────────────────────────────────────────────────────

/**
 * ── 마일스톤 줄의 칸 ─────────────────────────────────────────────────────────
 *
 * 이름 뒤에 오는 값들 — 날짜, D-n, 막대, 완료 수 — 은 그 줄에서 유일하게
 * **마일스톤끼리 비교하는** 값입니다. '뭐가 제일 급하지', '어디가 밀렸지'는
 * 세로로 훑어서 답하는 질문이고, 세로로 훑는 값은 칸이어야 합니다. 이름은
 * 반대로 하나씩 읽는 값이라 비교 대상이 아닙니다.
 *
 * 그래서 이름에 고정 폭을 줍니다. 그러면 뒤의 값들이 모든 줄에서 같은 자리에
 * 놓입니다. 예전에는 이름 길이만큼 밀려서, 값들이 줄마다 다른 x에 있었습니다.
 *
 * 오른쪽 끝에 붙이는 방법은 쓸 수 없습니다. 이 줄의 내용은 `sticky left: 17`
 * 로 뷰포트에 붙어 표를 가로로 스크롤해도 따라오는데, 오른쪽 정렬은 그 순간
 * 어긋납니다.
 */
const MS_NAME_W = 200   // 한글 15~16자
const MS_DATE_W = 58    // 26.12.18
const MS_DDAY_W = 46

function MilestoneHeader({ milestone, taskCount, completed, diff, collapsed, minWidth, onToggle, onToggleDone, onUpdate, onDelete }: {
  milestone: Milestone; taskCount: number; completed: number; diff: number
  collapsed: boolean; minWidth?: number; onToggle: () => void; onToggleDone: () => void
  onUpdate: (patch: Partial<Omit<Milestone, 'id'>>) => void
  onDelete?: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [tempName, setTempName] = useState(milestone.name)
  // Delete used to be a button that appeared on hover at the right edge, which
  // is both undiscoverable and one stray click from gone. It is a right-click
  // and then a confirmation now — the same two deliberate steps a task's own
  // delete already asks for.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const isDone = !!milestone.done
  const overdue = !isDone && diff < 0
  const close = !isDone && diff >= 0 && diff <= 7
  const accent = milestoneAccent(isDone, diff)
  const progress = taskCount ? Math.round(completed / taskCount * 100) : 0
  /**
   * D-n은 가까울 때만.
   *
   * 날짜와 D-n은 같은 사실을 두 번 말합니다. 278일 남은 마일스톤에서 의미
   * 있는 쪽은 날짜고(무슨 달인지, 무슨 요일인지), 사흘 남은 쪽에서 의미 있는
   * 건 D-n입니다. 모든 줄에 배지를 달면 배지가 경고가 아니라 장식이 됩니다.
   *
   * 칸 자체는 비워둘지언정 남겨둡니다 — 없다고 뒤엣것이 당겨 오면 정렬이
   * 깨지고, 그게 이 칸을 만든 이유였습니다.
   */
  const showDday = !isDone && (overdue || diff <= 30)

  const saveName = () => { if (tempName.trim()) onUpdate({ name: tempName.trim() }); setEditingName(false) }

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
      onContextMenu={onDelete ? e => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY }) } : undefined}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px 6px 14px', background: 'var(--bg)', borderBottom: '1px solid var(--bd)', borderTop: '1px solid var(--bd)', borderLeft: `3px solid ${accent}`, position: 'sticky', left: 0, zIndex: 4, minWidth: minWidth ?? undefined, opacity: isDone ? 0.65 : 1, transition: 'opacity .2s' }}
    >
      {/* Pinned to the viewport's left edge, like the name column on task rows.
          Sticky on the row itself does nothing — the row already spans the full
          table width, so there is no overflow for it to stick within. The offset
          matches where these sit at rest (3px border + 14px padding), so nothing
          shifts when the scroll starts. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'sticky', left: 17, zIndex: 1, flexShrink: 0 }}>
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
        style={{ width: 16, height: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', border: isDone ? '2px solid #448361' : '2px solid var(--bd2)', background: isDone ? '#448361' : 'transparent', color: '#fff', fontSize: 9, cursor: 'pointer', padding: 0, transition: 'all .15s' }}
        onMouseEnter={e => { if (!isDone) { e.currentTarget.style.borderColor = '#448361'; e.currentTarget.style.background = 'rgba(68,131,97,.15)' } }}
        onMouseLeave={e => { if (!isDone) { e.currentTarget.style.borderColor = 'var(--bd2)'; e.currentTarget.style.background = 'transparent' } }}
      >
        {isDone ? '✓' : ''}
      </button>
      <span style={{ fontSize: 11, color: accent, flexShrink: 0 }}>◆</span>

      {editingName ? (
        <input
          autoFocus value={tempName} onChange={e => setTempName(e.target.value)}
          onBlur={saveName}
          onKeyDown={e => { if (e.key === 'Enter' && !isComposing(e)) saveName(); if (e.key === 'Escape') { setTempName(milestone.name); setEditingName(false) } }}
          onClick={e => e.stopPropagation()}
          style={{ ...inlineInput, fontSize: 13, fontWeight: 600, width: MS_NAME_W }}
        />
      ) : (
        // The slot is fixed; the text inside it is not, so the hover underline
        // hugs the name rather than running to the end of an empty column.
        // A name too long for the slot is cut with an ellipsis — and clicking it
        // opens the rename field above, which holds the whole thing. (A title=
        // tooltip would not do: it is silent in the desktop webview.)
        <div style={{ width: MS_NAME_W, flexShrink: 0, minWidth: 0, display: 'flex' }}>
          <span
            onClick={e => { e.stopPropagation(); setTempName(milestone.name); setEditingName(true) }}
            title="클릭해서 이름 수정"
            style={{
              fontSize: 12.5, fontWeight: 600, color: 'var(--t1)', cursor: 'text',
              borderBottom: '1px solid transparent', transition: 'border-color .1s',
              textDecoration: isDone ? 'line-through' : 'none',
              maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => e.currentTarget.style.borderBottomColor = 'var(--bd)'}
            onMouseLeave={e => e.currentTarget.style.borderBottomColor = 'transparent'}
          >
            {milestone.name}
          </span>
        </div>
      )}

      {/*
        D-n이 날짜 앞에 옵니다.

        비는 건 D-n 쪽입니다(가까울 때만 뜨니까). 그게 날짜와 진행률 사이에
        있으면 한가운데가 뻥 뚫린 줄이 되는데, 이름 바로 뒤로 옮기면 같은
        빈칸이 그냥 들여쓰기처럼 읽힙니다. 구멍은 가장자리에 두는 편이
        낫습니다.
      */}
      <span style={{ width: MS_DDAY_W, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        {showDday && (
          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 'var(--r1)', background: overdue ? 'rgba(212,76,71,.1)' : close ? 'rgba(217,115,13,.1)' : 'rgba(139,92,246,.1)', color: accent }}>
            {overdue ? `D+${Math.abs(diff)}` : diff === 0 ? 'D-Day' : `D-${diff}`}
          </span>
        )}
      </span>

      {/* The date opens its picker on the first click. There used to be an
          in-between state — click once to turn the text into a field, click
          again to open the calendar — which bought nothing and cost a click. */}
      <span
        onClick={e => e.stopPropagation()}
        title="클릭해서 날짜 수정"
        style={{ display: 'inline-flex', width: MS_DATE_W, flexShrink: 0 }}
      >
        <DateField
          value={milestone.dueDate}
          format="compact"
          context={{ projectId: milestone.projectId }}
          onChange={v => onUpdate({ dueDate: v })}
          style={{ fontSize: 11, color: 'var(--t3)', padding: '1px 4px', borderRadius: 3, borderBottom: '1px dashed transparent', transition: 'background .1s, border-color .1s' }}
        />
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4, flexShrink: 0 }}>
        <div style={{ width: 72, height: 4, background: 'var(--bd)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progress}%`, background: accent, borderRadius: 2, transition: 'width .3s' }} />
        </div>
        <span style={{ fontSize: 11, color: 'var(--t3)', whiteSpace: 'nowrap' }}>{completed}/{taskCount} 완료</span>
      </div>
      </div>

      {menu && onDelete && (
        <ActionMenu
          x={menu.x} y={menu.y}
          onClose={() => setMenu(null)}
          actions={[
            {
              label: '마일스톤 삭제', icon: 'trash' as const, danger: true,
              onSelect: async () => {
                if (await askConfirm({ message: `"${milestone.name}" 마일스톤을 삭제할까요?` })) onDelete()
              },
            },
          ]}
        />
      )}
    </div>
  )
}

// ── UnassignedHeader ──────────────────────────────────────────────────────────

function UnassignedHeader({ count, collapsed, minWidth, onToggle }: {
  count: number; collapsed: boolean; minWidth?: number; onToggle: () => void
}) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'var(--bg)', borderBottom: '1px solid var(--bd)', borderLeft: '3px solid var(--bd2)', position: 'sticky', left: 0, zIndex: 4, minWidth: minWidth ?? undefined }}
    >
      {/* Pinned left, same reasoning as MilestoneHeader. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'sticky', left: 15, zIndex: 1, flexShrink: 0 }}>
        <button
          onClick={onToggle}
          style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--t3)', fontSize: 9, borderRadius: 3, flexShrink: 0, fontFamily: 'var(--font)' }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg4)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          {collapsed ? '▶' : '▼'}
        </button>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--t2)' }}>마일스톤 미배정</span>
        <span style={{ fontSize: 11, color: 'var(--t3)' }}>{count}</span>
      </div>
    </div>
  )
}

// ── ColumnPicker ──────────────────────────────────────────────────────────────

/**
 * Pinned to the right edge of the column header so it stays reachable while the
 * columns scroll under it. Resizing already existed but could not remove a
 * column, so a nine-column table was permanently wider than the window.
 */
function ColumnPicker({ cols, onChange }: { cols: ColDef[]; onChange: (c: ColDef[]) => void }) {
  const m = useMenu()
  const hiddenCount = cols.filter(c => c.hidden).length

  const toggle = (key: string) =>
    onChange(cols.map(c => c.key === key ? { ...c, hidden: !c.hidden } : c))

  return (
    <div ref={m.rootRef} style={{ position: 'sticky', right: 0, display: 'flex', alignItems: 'center', paddingRight: 8, background: 'var(--bg2)', flexShrink: 0 }}>
      <button
        title="표시할 열"
        onClick={e => { e.stopPropagation(); m.toggleAt(e.currentTarget, 180) }}
        style={{
          padding: '2px 7px', fontSize: 11, borderRadius: 'var(--r1)',
          border: '1px solid var(--bd)', background: 'var(--bg)',
          color: hiddenCount ? 'var(--ac)' : 'var(--t3)', cursor: 'pointer',
          fontFamily: 'var(--font)', whiteSpace: 'nowrap',
        }}
      >
        열{hiddenCount ? ` −${hiddenCount}` : ''}
      </button>
      {m.open && (
        <Menu pos={m.pos} panelRef={m.panelRef} width={180}>
          <MenuList>
            {cols.map(col => col.key === LOCKED_COL ? (
              // Always shown: it is the row's identity and the sticky anchor.
              <div key={col.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', fontSize: 13, color: 'var(--t3)' }}>
                <MenuCheck on />
                {col.label}
              </div>
            ) : (
              <MenuItem key={col.key} multi selected={!col.hidden} onSelect={() => toggle(col.key)}>
                {col.label}
              </MenuItem>
            ))}
          </MenuList>
        </Menu>
      )}
    </div>
  )
}

// ── Flat-list pieces ──────────────────────────────────────────────────────────

/**
 * The header above one bucket in a flat list mode.
 *
 * Kept deliberately lighter than MilestoneHeader: a flat list can show a dozen
 * of these at once, and they are a sort key made visible, not an entity you can
 * rename or complete.
 */
function GroupHeader({ label, accent, count, done, collapsed, minWidth, onToggle }: {
  label: string; accent?: string; count: number; done: number
  collapsed: boolean; minWidth?: number; onToggle: () => void
}) {
  return (
    <div
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
        background: 'var(--bg2)', borderBottom: '1px solid var(--bd)',
        borderLeft: `3px solid ${accent ?? 'var(--bd)'}`,
        position: 'sticky', left: 0, zIndex: 4, cursor: 'pointer',
        minWidth: minWidth ?? undefined,
      }}
    >
      {/* Pinned so the label stays readable while the columns scroll under it. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'sticky', left: 15, zIndex: 1, flexShrink: 0 }}>
        <span style={{ fontSize: 9, color: 'var(--t3)', width: 10 }}>{collapsed ? '▶' : '▼'}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: accent ?? 'var(--t1)' }}>{label}</span>
        <span style={{ fontSize: 11, color: 'var(--t3)', background: 'var(--bg3)', borderRadius: 10, padding: '1px 7px' }}>
          {done > 0 ? `${done}/${count}` : count}
        </span>
      </div>
    </div>
  )
}

/**
 * Where a task lives, shown under its name.
 *
 * In flat modes no header above the row says which project or milestone it
 * belongs to, so the row has to carry it. A second line rather than an inline
 * suffix, so it never eats into the name's truncation budget.
 */
function TaskBreadcrumb({ project, milestone, parentName }: {
  project?: { name: string; color: string }
  milestone?: Milestone
  parentName?: string
}) {
  if (!project && !milestone && !parentName) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--t3)', minWidth: 0, lineHeight: 1.4 }}>
      {project && (
        <>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: project.color, flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.name}</span>
        </>
      )}
      {project && milestone && <span style={{ opacity: .45, flexShrink: 0 }}>›</span>}
      {milestone && (
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 1 }}>
          ◆ {milestone.name}
        </span>
      )}
      {parentName && (project || milestone) && <span style={{ opacity: .45, flexShrink: 0 }}>›</span>}
      {parentName && (
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 1 }}>
          └ {parentName}
        </span>
      )}
    </div>
  )
}

// ── AddMilestoneInline ────────────────────────────────────────────────────────

/**
 * Adding a milestone, in the same shape as the milestone header it becomes.
 *
 * Name, Tab, date, Enter. Shift+Enter adds it and stops; Enter alone leaves the
 * row open for the next one, because milestones are laid out in a sitting.
 */
function AddMilestoneInline({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const addMilestone = useMilestoneStore(s => s.addMilestone)
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const valid = name.trim() !== '' && date !== ''

  // Clicking away keeps a finished row and drops an unfinished one, the same as
  // the task add row. A milestone needs both halves to exist, so "finished"
  // here means a name and a date. The calendar it opens is portalled to the
  // body, so it has to be exempted by name or picking a date would count as
  // clicking outside.
  const outsideRef = useRef<() => void>(() => {})
  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('[data-addrow-popup]')) return
      if (containerRef.current && !containerRef.current.contains(t)) outsideRef.current()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const submit = (another: boolean) => {
    if (!valid) return
    addMilestone(projectId, name.trim(), date)
    setName(''); setDate('')
    if (another) setTimeout(() => nameRef.current?.focus(), 0)
    else onDone()
  }
  outsideRef.current = () => { if (valid) submit(false); else onDone() }

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={e => {
        if (e.key === 'Escape') { e.stopPropagation(); onDone(); return }
        if (e.key === 'Enter' && !isComposing(e)) { e.preventDefault(); submit(!e.shiftKey) }
      }}
      style={{ outline: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: NOTION.purple.bg, borderLeft: `3px solid ${NOTION.purple.text}` }}
    >
      <span style={{ fontSize: 9, color: NOTION.purple.text, flexShrink: 0 }}>◆</span>
      <input
        ref={nameRef} autoFocus placeholder="마일스톤 이름..." value={name}
        onChange={e => setName(e.target.value)}
        style={{ flex: 1, border: 'none', outline: '1px solid var(--ac)', borderRadius: 'var(--r1)', padding: '3px 8px', fontSize: 13, fontWeight: 600, background: 'var(--bg)', color: 'var(--t1)', fontFamily: 'var(--font)' }}
      />
      <div style={{ width: 130, flexShrink: 0 }}>
        <AddRowDatePicker
          value={date}
          context={{ projectId }}
          onChange={setDate}
        />
      </div>
      <span style={{ fontSize: 11, color: 'var(--t3)', flexShrink: 0, whiteSpace: 'nowrap' }}>
        {valid ? 'Enter로 추가' : '이름과 날짜'}
      </span>
      <button
        onClick={onDone}
        style={{ padding: '3px 8px', fontSize: 11, borderRadius: 'var(--r1)', border: '1px solid var(--bd)', background: 'var(--bg)', color: 'var(--t3)', cursor: 'pointer', fontFamily: 'var(--font)', flexShrink: 0 }}
      >취소</button>
    </div>
  )
}

// ── AddRowProjectSelect ───────────────────────────────────────────────────────

/**
 * Which project(s) the new task goes into.
 *
 * More than one is allowed, and it means **one task per project** rather than
 * one task in two places. A task lives at its project's path and access is
 * project membership, so a record spanning two projects would need a new answer
 * to 'who can see this' — which is exactly the kind of thing this app declines
 * to invent. What people actually want here is not to type the same row twice
 * (스텝 취합, for 승원 and 릴서 both), and copies deliver that: each one then
 * lives its own life, which is also correct — finishing 승원's does not finish
 * 릴서's.
 */
function AddRowProjectSelect({ value, options, onChange }: {
  value: string[]
  options: { id: string; name: string; color: string }[]
  onChange: (v: string[]) => void
}) {
  const m = useMenu()
  const picked = options.filter(p => value.includes(p.id))
  // undefined leads, as 미배정 does in the panel.
  const items: (string | undefined)[] = [undefined, ...options.map(p => p.id)]
  // Picking does not close the menu — the whole point is to pick more than one.
  // 미배정 is the exception: it clears, and clearing is a finished thought.
  const toggle = (id: string | undefined) => {
    if (!id) { onChange([]); m.setOpen(false); return }
    onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id])
  }
  const { hi, onKeyDown } = useMenuKeys(m, items, toggle, Math.max(0, items.indexOf(picked[0]?.id)))

  return (
    <div ref={m.rootRef} style={{ position: 'relative', flexShrink: 0, minWidth: 0 }} onKeyDown={onKeyDown}>
      <div
        data-addrow-popup
        tabIndex={0}
        title={picked.length ? picked.map(p => p.name).join(', ') : '프로젝트 미배정'}
        onClick={e => { e.stopPropagation(); m.toggleAt(e.currentTarget, 200) }}
        onKeyDown={e => {
          if (e.key === ' ' || e.key === 'ArrowDown') {
            if (!m.open) { e.preventDefault(); e.stopPropagation(); m.openAt(e.currentTarget, 200) }
          }
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
          padding: '3px 6px', borderRadius: 'var(--r1)', outline: '1px solid var(--ac)',
          background: 'var(--bg)', maxWidth: 92, minWidth: 0,
        }}
      >
        <Dot color={picked[0]?.color ?? 'var(--bd2)'} size={8} />
        <span style={{ fontSize: 11, color: picked.length ? 'var(--t1)' : 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {picked.length === 0 ? '프로젝트'
            : picked.length === 1 ? picked[0].name
            : `${picked[0].name} +${picked.length - 1}`}
        </span>
        <span style={{ fontSize: 8, color: 'var(--t3)', flexShrink: 0 }}>▾</span>
      </div>
      {m.open && (
        <Menu pos={m.pos} panelRef={m.panelRef} width={200}>
          <MenuList>
            <MenuItem selected={!value.length} highlighted={hi === 0} onSelect={() => toggle(undefined)}>
              프로젝트 미배정
            </MenuItem>
            {options.map((p, i) => (
              <MenuItem key={p.id} multi selected={value.includes(p.id)} highlighted={hi === i + 1} onSelect={() => toggle(p.id)}>
                <Dot color={p.color} />
                {p.name}
              </MenuItem>
            ))}
          </MenuList>
        </Menu>
      )}
    </div>
  )
}

// ── AddRowStatusSelect ────────────────────────────────────────────────────────

// The add row's status cell is the row's status cell — the only difference used
// to be that this one drew its own menu.
function AddRowStatusSelect({ value, onChange }: { value: Status; onChange: (v: Status) => void }) {
  return (
    <div>
      <BadgeSelect
        value={value}
        options={STATUS_LIST}
        styleMap={STATUS_STYLE}
        renderValue={v => <StatusPill status={v} />}
        onChange={v => onChange(v as Status)}
        tabbable
      />
    </div>
  )
}

// ── AddRowDatePicker ──────────────────────────────────────────────────────────

function AddRowDatePicker({ value, context, onChange }: {
  value: string
  context?: DateContext
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)

  const display = value ? (() => {
    const d = new Date(value + 'T00:00:00')
    return `${d.getMonth() + 1}/${d.getDate()}`
  })() : null

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <div
        ref={triggerRef}
        data-addrow-popup
        tabIndex={0}
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        onKeyDown={e => {
          // Same rule as CellTrigger: Space opens, Enter is the row's.
          if (e.key === ' ' || e.key === 'ArrowDown') {
            if (!open) { e.preventDefault(); e.stopPropagation(); setOpen(true) }
          } else if (e.key === 'Enter' && open) {
            e.preventDefault(); e.stopPropagation(); setOpen(false)
          }
        }}
        style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', padding: '3px 6px', borderRadius: 'var(--r1)', outline: '1px solid var(--ac)', background: 'var(--bg)', width: '100%', boxSizing: 'border-box' }}
      >
        <span style={{ flex: 1, fontSize: 13, color: display ? 'var(--t1)' : 'var(--t3)' }}>
          {display || '마감일'}
        </span>
        <span style={{ fontSize: 9, color: 'var(--t3)', flexShrink: 0, opacity: .6 }}>▾</span>
      </div>
      {open && (
        <DatePicker
          value={value}
          anchor={ref.current}
          context={context}
          onChange={onChange}
          onClose={() => {
            setOpen(false)
            // Focus goes with the panel that just closed; putting it back on the
            // trigger keeps Tab where the person left it and lets the next Enter
            // reach the row.
            triggerRef.current?.focus()
          }}
        />
      )}
    </div>
  )
}

// ── AddTaskRow ────────────────────────────────────────────────────────────────

function AddTaskRow({ cols, assigneeOptions, defaultAssignee = '', milestoneId, milestoneOptions, onMilestoneCreate, parentId, projectId, projectOptions, addTask, userEmail, isSubtask = false, onDone, onCancel }: {
  cols: ColDef[]
  assigneeOptions: { value: string; label: string }[]
  /**
   * Who the row starts out assigned to.
   *
   * In 내 할 일 that is the person reading it: a task added to a list of one's
   * own work is one's own work, and having to say so on every row is a question
   * whose answer the screen already knows.
   */
  defaultAssignee?: string
  /** Fixed when the row sits inside a milestone's own group. */
  milestoneId?: string
  /**
   * Offered when it does not. Outside the project grouping a new task has no
   * milestone to inherit, and filing it afterwards meant finding the row again
   * in a different grouping.
   */
  milestoneOptions?: Milestone[]
  onMilestoneCreate?: (projectId: string, name: string, dueDate: string) => string | undefined
  parentId?: string
  projectId?: string
  /**
   * Offered when the row does not already sit inside a project.
   *
   * The flat list modes span every project, so a row added there has no
   * container to inherit — the row has to ask rather than quietly filing the
   * task under nothing.
   */
  projectOptions?: { id: string; name: string; color: string }[]
  addTask: (t: Omit<Task, 'id'>) => Task
  userEmail: string | null
  isSubtask?: boolean
  onDone: (addAnother: boolean) => void
  onCancel: () => void
}) {
  // Plural: more than one project means one copy of the task in each.
  const [pickedProjects, setPickedProjects] = useState<string[]>(projectId ? [projectId] : [])
  const [pickedMs, setPickedMs] = useState<string | undefined>(milestoneId)
  const [name, setName] = useState('')
  const [assignee, setAssignee] = useState(defaultAssignee)
  const [due, setDue] = useState('')
  const [status, setStatus] = useState<Status>('대기')
  const [priority, setPriority] = useState<Priority>('중간')
  const containerRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => { nameRef.current?.focus() }, [])

  /**
   * Clicking away keeps a row that is ready, and drops one that is not.
   *
   * Filling the row is a run of clicks — project, milestone, date — and the
   * click that ends it is usually just somewhere else on the page. Throwing the
   * row away then meant retyping everything, so the last step became "remember
   * to press Enter". A named task is a task; an empty row is nothing lost.
   *
   * The listener is registered once, so it reads the fields through a ref
   * rather than through the closure the effect captured — otherwise it would
   * decide with the values the row had when it opened, which are always empty.
   */
  const outsideRef = useRef<() => void>(() => {})
  outsideRef.current = () => { if (name.trim()) doSave(false); else onCancel() }

  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      // Ignore clicks inside any fixed popup spawned by our child selects
      if (t.closest('[data-addrow-popup]')) return
      if (containerRef.current && !containerRef.current.contains(t)) outsideRef.current()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // A milestone belongs to exactly one project, so it is only offered — and
  // only applied — when exactly one project is picked.
  const soleProject = pickedProjects.length === 1 ? pickedProjects[0] : undefined

  const doSave = (addAnother: boolean) => {
    if (!name.trim()) { nameRef.current?.focus(); return }
    // No project picked is still one task, filed under nothing.
    const targets: (string | undefined)[] = pickedProjects.length ? pickedProjects : [undefined]
    for (const pid of targets) {
      addTask({
        type: parentId ? '세부' : '상위', cat: '', name: name.trim(), assignee,
        start: '', due, priority, status,
        progress: 0, memo: '', parentId, projectId: pid,
        milestoneId: milestoneId ?? (pid && pid === soleProject ? pickedMs : undefined),
        createdBy: userEmail ?? undefined,
      })
    }
    if (targets.length > 1) useToast.getState().show(`${targets.length}개 프로젝트에 추가했습니다`)
    // The milestone is deliberately kept for the next row: a run of tasks
    // typed one after another almost always belongs to the same one.
    setName(''); setAssignee(defaultAssignee); setDue(''); setStatus('대기'); setPriority('중간')
    onDone(addAnother)
    if (addAnother) setTimeout(() => nameRef.current?.focus(), 0)
  }

  const handleContainerKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onCancel(); return }
    if (e.key === 'Enter' && !isComposing(e)) { e.preventDefault(); doSave(!e.shiftKey) }
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
        // The tint is layered over an opaque base rather than used alone: a
        // translucent background on a pinned cell lets the columns scrolling
        // underneath show through it.
        return (
          <div key="name" style={{ ...base, gap: 6, position: 'sticky', left: 0, zIndex: 2, background: 'linear-gradient(rgba(35,131,226,.04), rgba(35,131,226,.04)), var(--bg)', boxShadow: '2px 0 4px rgba(0,0,0,.06)', paddingLeft: isSubtask ? 88 : 14 }}>
            {/* Name, then project, then milestone — the order they are filled
                in, and therefore the order Tab has to visit them in. They used
                to sit ahead of the name, where tabbing out of the field skipped
                straight past both. */}
            <input
              ref={nameRef}
              value={name} onChange={e => setName(e.target.value)}
              placeholder="업무 이름 (Enter로 추가)"
              style={{ ...inp, minWidth: 70 }}
            />
            {projectOptions && (
              <AddRowProjectSelect
                value={pickedProjects}
                options={projectOptions}
                onChange={v => { setPickedProjects(v); setPickedMs(undefined) }}
              />
            )}
            {!milestoneId && milestoneOptions && soleProject && (
              <MilestonePicker
                milestoneId={pickedMs}
                milestones={milestoneOptions.filter(m => m.projectId === soleProject)}
                onChange={setPickedMs}
                onCreate={onMilestoneCreate ? (n, d) => onMilestoneCreate(soleProject, n, d) : undefined}
              />
            )}
          </div>
        )
      case 'assignee':
        // The same picker the rows use. A single-value control here could not
        // express two people, and it is where a default assignee has to be
        // added to rather than replaced.
        return (
          <div key="assignee" style={base}>
            <AssigneePicker assignee={assignee} options={assigneeOptions} onChange={setAssignee} tabbable />
          </div>
        )
      case 'due':
        return (
          <div key="due" style={base}>
            <AddRowDatePicker
              value={due}
              context={{ projectId, milestoneId, parentId, assignee }}
              onChange={setDue}
            />
          </div>
        )
      case 'status':
        return (
          <div key="status" style={{ ...base, padding: '6px 10px' }}>
            <AddRowStatusSelect value={status} onChange={setStatus} />
          </div>
        )
      case 'priority':
        return (
          <div key="priority" style={{ ...base, padding: '6px 10px' }}>
            <BadgeSelect
              value={priority}
              options={PRIORITY_LIST}
              styleMap={PRIORITY_STYLE}
              renderValue={v => <PriorityLabel priority={v} />}
              onChange={v => setPriority(v as Priority)}
              tabbable
            />
          </div>
        )
      default:
        return <div key={col.key} style={base} />
    }
  }

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleContainerKey}
      style={{
        outline: 'none',
        display: 'flex', minWidth: 'max-content',
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

const MS_DRAFT_BTN: React.CSSProperties = {
  padding: '3px 10px', fontSize: 12, borderRadius: 'var(--r1)',
  border: '1px solid var(--bd)', background: 'transparent',
  color: 'var(--t2)', cursor: 'pointer', fontFamily: 'var(--font)',
}

/**
 * Picks a milestone, and makes one.
 *
 * Outside the project grouping there is no milestone card to hang a "마일스톤
 * 추가" row off — and a project with none yet had a picker that did not appear
 * at all, so the only way in was to go and group by project first. Creating one
 * belongs in the same control that chooses one: a milestone is a name and a
 * date, which fits in the menu that was already open.
 */
function MilestonePicker({ milestoneId, milestones, onChange, onCreate }: {
  milestoneId: string | undefined
  milestones: Milestone[]
  onChange: (id: string | undefined) => void
  /** Absent when there is no project to put a new milestone in. */
  onCreate?: (name: string, dueDate: string) => string | undefined
}) {
  const m = useMenu()
  const current = milestones.find(ms => ms.id === milestoneId)
  const accent = NOTION.purple.text
  const [drafting, setDrafting] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftDue, setDraftDue] = useState('')

  const closeMenu = () => { m.setOpen(false); setDrafting(false); setDraftName(''); setDraftDue('') }
  // undefined leads, as 미배정 does in the panel.
  const items: (string | undefined)[] = [undefined, ...milestones.map(ms => ms.id)]
  const { hi, onKeyDown } = useMenuKeys(
    { open: m.open && !drafting, setOpen: m.setOpen }, items,
    id => { onChange(id); closeMenu() },
    items.indexOf(milestoneId),
  )
  const create = () => {
    const name = draftName.trim()
    if (!name || !draftDue || !onCreate) return
    const id = onCreate(name, draftDue)
    if (id) onChange(id)
    closeMenu()
  }

  return (
    <div ref={m.rootRef} style={{ position: 'relative', flexShrink: 0, minWidth: 0 }} onClick={e => e.stopPropagation()} onKeyDown={onKeyDown}>
      {/* Space opens; Enter belongs to the row it sits in, so a name typed and a
          milestone chosen can still be committed without reaching for a mouse. */}
      <button
        onClick={e => { e.stopPropagation(); m.toggleAt(e.currentTarget, 220) }}
        onKeyDown={e => {
          if ((e.key === ' ' || e.key === 'ArrowDown') && !m.open) {
            e.preventDefault(); e.stopPropagation(); m.openAt(e.currentTarget, 220)
          } else if (e.key === 'Enter' && !m.open) {
            // A focused <button> turns Enter into a click, which would open the
            // menu instead of committing the row. Stop the click, let the key
            // carry on up.
            e.preventDefault()
          }
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '2px 7px', borderRadius: 12, fontFamily: 'var(--font)',
          fontSize: 11, cursor: 'pointer', border: 'none',
          background: current ? NOTION.purple.bg : 'var(--bg3)',
          color: current ? accent : 'var(--t3)',
          maxWidth: 110, minWidth: 0, whiteSpace: 'nowrap',
        }}
      >
        <Dot color={current ? accent : 'var(--t3)'} size={5} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{current ? current.name : '마일스톤'}</span>
      </button>

      {m.open && (
        <Menu pos={m.pos} panelRef={m.panelRef} width={240}>
          {drafting ? (
            <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input
                autoFocus
                value={draftName}
                onChange={e => setDraftName(e.target.value)}
                onKeyDown={e => {
                  if (isComposing(e)) return
                  if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); create() }
                  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDrafting(false) }
                }}
                placeholder="마일스톤 이름"
                style={MENU_INPUT}
              />
              <DateField value={draftDue} onChange={setDraftDue} context={{}} placeholder="마감일" />
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button onClick={() => setDrafting(false)} style={MS_DRAFT_BTN}>취소</button>
                <button
                  onClick={create}
                  disabled={!draftName.trim() || !draftDue}
                  style={{
                    ...MS_DRAFT_BTN,
                    borderColor: accent,
                    color: draftName.trim() && draftDue ? accent : 'var(--t3)',
                    cursor: draftName.trim() && draftDue ? 'pointer' : 'default',
                  }}
                >추가</button>
              </div>
            </div>
          ) : (
            <>
              <MenuList>
                <MenuItem selected={!milestoneId} highlighted={hi === 0} onSelect={() => { onChange(undefined); closeMenu() }}>미배정</MenuItem>
                {milestones.map((ms, i) => (
                  <MenuItem
                    key={ms.id}
                    selected={ms.id === milestoneId}
                    highlighted={hi === i + 1}
                    onSelect={() => { onChange(ms.id); closeMenu() }}
                    trailing={<span style={{ fontSize: 10, color: 'var(--t3)', flexShrink: 0 }}>{ms.dueDate}</span>}
                  >
                    <Dot color={accent} size={5} />
                    {ms.name}
                  </MenuItem>
                ))}
              </MenuList>
              {milestones.length === 0 && <MenuNote>아직 마일스톤이 없습니다</MenuNote>}
              {onCreate && (
                <MenuFooter label="+ 새 마일스톤" onSelect={() => setDrafting(true)} />
              )}
            </>
          )}
        </Menu>
      )}
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
        if (e.key === 'Enter' && !isComposing(e)) { e.preventDefault(); onCommit(v) }
        if (e.key === 'Escape') { e.preventDefault(); onCancel() }
      }}
      onClick={e => e.stopPropagation()}
      style={{ flex: 1, width: '100%', border: 'none', outline: '1.5px solid var(--ac)', borderRadius: 3, background: 'var(--bg)', padding: '2px 6px', fontFamily: 'var(--font)', fontSize, fontWeight: bold ? 500 : 400, color: 'var(--t1)' }}
    />
  )
}

// ── LinksCell — a task's materials ────────────────────────────────────────────

/** One compact FileRow: 5px padding twice, a name line and a subtitle line. */
const ATTACHED_ROW = 46

function LinksCell({ links, projectId, onChange }: {
  links: TaskLink[]
  projectId?: string
  onChange: (links: TaskLink[]) => void
}) {
  const m = useMenu()
  const [mode, setMode] = useState<'drive' | 'url'>('drive')
  const folderId = useProjectFolderId(projectId)
  const resolved = useResolvedLinks(links)
  const attachedIds = React.useMemo(
    () => new Set(links.map(driveIdOf).filter((v): v is string => !!v)),
    [links],
  )

  const add = (link: TaskLink) => onChange([...links, link])
  const remove = (id: string) => onChange(links.filter(l => l.id !== id))

  // The cell itself shows the first file by name rather than a count: "대본" is
  // what someone is looking for, "2개" only says there is looking to be done.
  const first = links[0]
  const firstName = first ? (resolved.get(driveIdOf(first) ?? '')?.name ?? first.title) : null
  const firstIcon = first
    ? (driveIdOf(first) ? fileKind(resolved.get(driveIdOf(first)!)?.mimeType ?? first.mimeType).icon : 'link')
    : null

  return (
    <div ref={m.rootRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', width: '100%' }}>
      <CellTrigger open={m.open} onOpen={el => m.toggleAt(el, 340, 480)}>
        {!first ? <Dash /> : (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, fontSize: 12 }}>
            <span style={{ flexShrink: 0, display: 'flex', color: 'var(--t2)' }}>
              {firstIcon && <Icon name={firstIcon} size={13} />}
            </span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--t1)' }}>{firstName}</span>
            {links.length > 1 && <span style={{ color: 'var(--t3)', flexShrink: 0 }}>+{links.length - 1}</span>}
          </span>
        )}
      </CellTrigger>

      {m.open && (
        <Menu pos={m.pos} panelRef={m.panelRef} width={340} maxHeight={480}>
          {/* What is already attached does not give up space.
              It was `flex: 0 1 auto` with a 40px floor — one row — so the search
              results below squeezed it down and two attached files looked like
              one. Wrong way round: the list you check before adding is the one
              that keeps its height, and the results are what shrink. Three rows,
              then it scrolls. */}
          {links.length > 0 && (
            <>
              <div style={{ flex: '0 0 auto', maxHeight: 3 * ATTACHED_ROW, overflowY: 'auto', margin: '0 -4px', padding: '0 4px' }}>
                {links.map(l => (
                  <FileRow key={l.id} link={l} compact
                    file={resolved.get(driveIdOf(l) ?? '')}
                    onRemove={() => remove(l.id)}
                    onNote={note => onChange(links.map(x => {
              if (x.id !== l.id) return x
              // Firebase rejects undefined, so an emptied note is dropped.
              const { note: _old, ...rest } = x
              return note ? { ...rest, note } : rest
            }))} />
                ))}
              </div>
              <MenuDivider />
            </>
          )}
          <AttachTabs mode={mode} onChange={setMode} />
          {mode === 'drive'
            ? <DriveSearch folderId={folderId} attachedIds={attachedIds} onPick={(f, tab) => add(linkFromDriveFile(f, tab))} onClose={() => m.setOpen(false)} />
            : <UrlAdd onAdd={add} />}
        </Menu>
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
  const m = useMenu()
  const [input, setInput] = useState('')

  const toggle = (tag: string) =>
    onChange(tags.includes(tag) ? tags.filter(t => t !== tag) : [...tags, tag])

  const addNew = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed || tags.includes(trimmed)) return
    onChange([...tags, trimmed])
    setInput('')
  }

  const inputTrimmed = input.trim()
  const filtered = inputTrimmed
    ? allTags.filter(t => t.toLowerCase().includes(input.toLowerCase()))
    : allTags
  const canAddNew = !!inputTrimmed && !allTags.includes(inputTrimmed)

  return (
    <div ref={m.rootRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', width: '100%' }}>
      <CellTrigger open={m.open} onOpen={el => m.toggleAt(el)}>
        {tags.length === 0
          ? <Dash />
          : <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 3, minWidth: 0 }}>
              {tags.map(tag => <TagBadge key={tag} tag={tag} />)}
            </span>}
      </CellTrigger>

      {m.open && (
        <Menu pos={m.pos} panelRef={m.panelRef}>
          <div style={{ paddingBottom: 4, flexShrink: 0 }}>
            <input
              autoFocus
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !isComposing(e)) {
                  e.preventDefault()
                  if (filtered.length === 1) toggle(filtered[0])
                  else if (canAddNew) addNew(input)
                  else if (inputTrimmed && tags.includes(inputTrimmed)) toggle(inputTrimmed)
                }
                if (e.key === 'Escape') { m.setOpen(false); setInput('') }
              }}
              placeholder="태그 검색 또는 추가..."
              style={MENU_INPUT}
            />
          </div>
          <MenuList>
            {canAddNew && (
              <MenuItem onSelect={() => addNew(input)}>
                <span style={{ color: 'var(--ac)' }}>+ "{inputTrimmed}" 추가</span>
              </MenuItem>
            )}
            {filtered.map(tag => (
              <MenuItem key={tag} multi selected={tags.includes(tag)} onSelect={() => toggle(tag)}>
                <TagBadge tag={tag} />
              </MenuItem>
            ))}
            {filtered.length === 0 && !canAddNew && <MenuNote>태그가 없습니다</MenuNote>}
          </MenuList>
          {tags.length > 0 && (
            <MenuFooter label="태그 해제" onSelect={() => { onChange([]); m.setOpen(false) }} />
          )}
        </Menu>
      )}
    </div>
  )
}
