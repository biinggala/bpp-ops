import React, { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
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
import { fmtDate, isOverdue, parseAssignees, assigneeKeyToEmail, stripHtml, isComposing } from '../../../lib/utils'
import { NOTION, STATUS_LIST, PRIORITY_LIST } from '../../../types'
import {
  FileRow, DriveSearch, UrlAdd, AttachTabs,
  useResolvedLinks, useProjectFolderId, driveIdOf, linkFromDriveFile,
} from '../../shared/DriveFiles'
import { fileKind } from '../../../lib/googleDrive'
import { DatePicker, DateField } from '../../shared/DatePicker'
import type { DateContext } from '../../shared/DatePicker'
import type { Task, Milestone, Status, Priority, TaskLink } from '../../../types'
import type { ListGroup } from '../../../store/uiStore'

// ── Column config ─────────────────────────────────────────────────────────────

type ColDef = { key: string; label: string; width: number; hidden?: boolean }

/**
 * Renders into document.body.
 *
 * position: fixed does not escape a stacking context — it only changes what the
 * coordinates are relative to. These menus sit inside the sticky name cell,
 * which has a z-index of its own, so their z-index of 9000 was compared against
 * that cell's siblings and lost to the milestone header above it. Leaving the
 * tree entirely is the only thing that actually puts them on top.
 */
function FloatingMenu({ children }: { children: React.ReactNode }) {
  return createPortal(children, document.body)
}

/**
 * ── Menu primitives ──────────────────────────────────────────────────────────
 *
 * One shell, one row, one way of drawing "this is selected", for every dropdown
 * in the list. These grew as nine hand-rolled menus: five widths, four row
 * paddings, two z-indexes, and four different selection marks — and the two
 * most-clicked cells (상태, 우선순위) were a native <select>, so they rendered
 * as the operating system's menu rather than the app's.
 *
 * The rule the primitives encode: a leading checkbox means you may pick several,
 * a trailing ✓ means exactly one.
 */
const MENU_W = 200
const MENU_GAP = 4

/**
 * Open/close, placement, and outside-click for a dropdown.
 *
 * Two refs, not one: the panel is portalled to document.body, so a click inside
 * it is outside the cell that owns it. Checking only the cell would close a
 * multi-select on the first tick — you could never select two people.
 */
function useMenu() {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0, maxHeight: 320 })
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      const t = e.target as Node
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  /**
   * Places the panel next to `el`, kept inside the window.
   *
   * Horizontally it is clamped; vertically it flips above the trigger when
   * there is more room there. Without the flip a tall panel opened from a row
   * near the bottom of the list would just run off the screen, which is exactly
   * where the long ones — the file picker — tend to be opened from.
   */
  const openAt = (el: HTMLElement | null, width = MENU_W, height = 320) => {
    if (!el) return
    const r = el.getBoundingClientRect()
    const below = window.innerHeight - r.bottom - MENU_GAP - 8
    const above = r.top - MENU_GAP - 8
    const flip = below < Math.min(height, 220) && above > below
    setPos({
      top: flip
        ? Math.max(8, r.top - MENU_GAP - Math.min(height, above))
        : r.bottom + MENU_GAP,
      left: Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8)),
      maxHeight: Math.max(180, flip ? above : below),
    })
    setOpen(true)
  }
  const toggleAt = (el: HTMLElement | null, width = MENU_W, height = 320) =>
    open ? setOpen(false) : openAt(el, width, height)

  return { open, setOpen, pos, rootRef, panelRef, openAt, toggleAt }
}

function Menu({ pos, panelRef, width = MENU_W, maxHeight, children }: {
  pos: { top: number; left: number; maxHeight?: number }
  panelRef: React.RefObject<HTMLDivElement | null>
  width?: number
  /** Ceiling for this menu; the space actually available still wins. */
  maxHeight?: number
  children: React.ReactNode
}) {
  return (
    <FloatingMenu>
      <div
        ref={panelRef}
        data-addrow-popup
        onClick={e => e.stopPropagation()}
        style={{
          position: 'fixed', top: pos.top, left: pos.left, width, zIndex: 9000,
          background: 'var(--bg)', border: '1px solid var(--bd)',
          borderRadius: 'var(--r3)', boxShadow: 'var(--sh-md)',
          padding: 4, boxSizing: 'border-box',
          maxHeight: Math.min(maxHeight ?? 320, pos.maxHeight ?? 320),
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {children}
      </div>
    </FloatingMenu>
  )
}

/** The scrolling middle of a menu, so headers and footers stay put. */
function MenuList({ children }: { children: React.ReactNode }) {
  return <div style={{ overflowY: 'auto', minHeight: 0, margin: '0 -4px', padding: '0 4px' }}>{children}</div>
}

function MenuItem({ selected = false, multi = false, highlighted = false, onSelect, children, trailing }: {
  selected?: boolean
  /** Where the arrow keys currently are — distinct from what is chosen. */
  highlighted?: boolean
  /** Draws the leading checkbox — the signal that more than one may be chosen. */
  multi?: boolean
  onSelect: () => void
  children: React.ReactNode
  trailing?: React.ReactNode
}) {
  return (
    <div
      onMouseDown={e => { e.preventDefault(); onSelect() }}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 8px', borderRadius: 'var(--r1)',
        fontSize: 13, cursor: 'pointer', color: 'var(--t1)',
        fontWeight: selected ? 500 : 400,
        background: highlighted ? 'var(--bg3)' : 'transparent',
        transition: 'background .07s', flexShrink: 0,
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
      onMouseLeave={e => (e.currentTarget.style.background = highlighted ? 'var(--bg3)' : 'transparent')}
    >
      {multi && <MenuCheck on={selected} />}
      <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {children}
      </span>
      {trailing}
      {!multi && selected && <span style={{ fontSize: 10, color: 'var(--ac)', flexShrink: 0 }}>✓</span>}
    </div>
  )
}

function MenuCheck({ on }: { on: boolean }) {
  return (
    <span style={{
      width: 14, height: 14, flexShrink: 0, borderRadius: 3,
      border: `1.5px solid ${on ? 'var(--ac)' : 'var(--bd2)'}`,
      background: on ? 'var(--ac)' : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'all .1s',
    }}>
      {on && <span style={{ color: '#fff', fontSize: 9, lineHeight: 1, fontWeight: 700 }}>✓</span>}
    </span>
  )
}

/** A coloured dot — how status, priority and project identity read everywhere else. */
function Dot({ color, size = 7 }: { color: string; size?: number }) {
  return <span style={{ width: size, height: size, borderRadius: '50%', background: color, flexShrink: 0 }} />
}

function MenuNote({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '8px 8px', fontSize: 12, color: 'var(--t3)' }}>{children}</div>
}

function MenuDivider() {
  return <div style={{ height: 1, background: 'var(--bd)', margin: '4px -4px' }} />
}

/** The one way to say "clear this field", worded the same as the filter bar. */
function MenuFooter({ label, onSelect }: { label: string; onSelect: () => void }) {
  return (
    <>
      <MenuDivider />
      <div
        onMouseDown={e => { e.preventDefault(); onSelect() }}
        style={{ padding: '6px 8px', borderRadius: 'var(--r1)', fontSize: 12, color: 'var(--t3)', cursor: 'pointer', flexShrink: 0, transition: 'background .07s' }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg3)'; e.currentTarget.style.color = 'var(--t2)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t3)' }}
      >
        {label}
      </div>
    </>
  )
}

const MENU_INPUT: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  border: '1px solid var(--bd)', borderRadius: 'var(--r1)',
  padding: '5px 8px', fontSize: 12,
  background: 'var(--bg2)', color: 'var(--t1)',
  outline: 'none', fontFamily: 'var(--font)',
}

/**
 * Value plus a caret that only appears on hover.
 *
 * Nine columns each showing a permanent ▾ made every row read as a form. The
 * value is the affordance; the caret confirms it when the pointer is there.
 */
function CellTrigger({ open, onOpen, children, style, tabbable = false }: {
  open: boolean
  onOpen: (el: HTMLElement) => void
  children: React.ReactNode
  style?: React.CSSProperties
  /**
   * Reachable by Tab. Off in the table proper — nobody wants to tab through
   * nine cells times two hundred rows — and on in the add row, where tabbing
   * from field to field is the whole point.
   */
  tabbable?: boolean
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      tabIndex={tabbable ? 0 : undefined}
      onClick={e => { e.stopPropagation(); onOpen(e.currentTarget) }}
      onKeyDown={tabbable ? e => {
        if (e.key === 'Enter' || e.key === ' ') {
          // Stops here so the enclosing add row does not read it as "save".
          e.preventDefault(); e.stopPropagation()
          onOpen(e.currentTarget)
        }
      } : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', flex: 1, minWidth: 0, ...style }}
    >
      {children}
      <span style={{
        fontSize: 9, color: 'var(--t3)', flexShrink: 0, marginLeft: 'auto',
        opacity: hovered || open ? .6 : 0, transition: 'opacity .1s',
      }}>▾</span>
    </div>
  )
}

const MIN_COL_WIDTH = 60
const COL_STORAGE_KEY = 'cringe_table_cols_v1'
/** Always shown: it is the row's identity and the sticky anchor for the rest. */
const LOCKED_COL = 'name'

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
const PRIORITY_MARK: Partial<Record<Priority, string>> = {
  '높음': NOTION.red.text,
}

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

function daysFrom(dateStr: string, base: Date) {
  return Math.round((new Date(dateStr).setHours(0, 0, 0, 0) - base.getTime()) / 86400000)
}
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
  if (group === 'none') return [{ key: '__all__', label: '', tasks }]

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
    STATUS_LIST.forEach(st => bucket(`st:${st}`, st, STATUS_STYLE[st]?.color))
    for (const t of tasks) bucket(`st:${t.status}`, t.status).tasks.push(t)
  } else if (group === 'assignee') {
    // A task with two assignees appears under both. Picking only the first
    // would hide half of someone's workload, which defeats the point of the
    // grouping; React keys stay unique because each bucket renders its own list.
    for (const t of tasks) {
      const people = parseAssignees(t.assignee)
      if (!people.length) { bucket('as:__none__', '담당자 없음').tasks.push(t); continue }
      // Legacy MemberKey and canonical email are the same person; keying by the
      // resolved email keeps them in one bucket instead of two.
      for (const person of people) {
        const em = assigneeKeyToEmail(person)
        bucket(`as:${em}`, nameOf(em)).tasks.push(t)
      }
    }
    order.sort((a, b) =>
      (a.key === 'as:__none__' ? 1 : 0) - (b.key === 'as:__none__' ? 1 : 0) ||
      a.label.localeCompare(b.label, 'ko'))
  }

  return order.filter(b => b.tasks.length > 0)
}

type CtxState = { x: number; y: number; task: Task } | null

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

  const renderTask = (task: Task, isChild = false, groupAccent?: string): React.ReactNode => {
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
              onClick={e => { e.stopPropagation(); toggle(task.id) }}
              style={{ width: 20, height: 20, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--t3)', fontSize: 10, padding: 0 }}
            >{isExpanded ? '▼' : '▶'}</button>
          )}
          {isChild && <span style={{ fontSize: 11, color: 'var(--t3)', flexShrink: 0 }}>└</span>}
          <span style={{ flex: 1, fontSize: 14, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: isDone ? 'line-through' : 'none' }}>
            {task.name}
          </span>
          {task.due && !isDone && (
            <span style={{ fontSize: 11, color: overdue ? '#D44C47' : 'var(--t3)', flexShrink: 0, marginRight: 6 }}>
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
          const dColor = ms.done ? 'var(--t3)' : overdue ? '#D44C47' : diff <= 7 ? '#D9730D' : 'var(--t3)'
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
                {!ms.done && <span style={{ fontSize: 11, fontWeight: 600, color: dColor, background: overdue ? 'rgba(212,76,71,.08)' : diff <= 7 ? 'rgba(217,115,13,.1)' : 'var(--bg3)', borderRadius: 6, padding: '1px 6px', marginRight: 4 }}>{dLabel}</span>}
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
  const { openTaskDetail, projectId, space, hideCompleted, listGroup } = useUiStore()
  const { milestones, updateMilestone, deleteMilestone } = useMilestoneStore()
  const allProjects = useProjectStore(s => s.projects)
  const getNameByEmail = useUserProfileStore(s => s.getNameByEmail)
  const userEmail = useAuthStore(s => s.email)
  // Only projects the current user is a member of
  const projects = React.useMemo(() =>
    allProjects
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

  // Nine columns is 1350px, so something is always off-screen. Hiding the ones
  // a given person never reads is the only way to get the table to fit; the
  // choice is per-browser and persists with the widths.
  const visibleCols = React.useMemo(() => cols.filter(c => !c.hidden), [cols])
  const totalColWidth = React.useMemo(() => visibleCols.reduce((sum, c) => sum + c.width, 0), [visibleCols])

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
    <div style={{ display: 'flex', minWidth: 'max-content', background: 'var(--bg2)', borderBottom: '2px solid var(--bd)', borderLeft: '3px solid transparent', userSelect: 'none' }}>
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
            milestones={pickerMilestones} showMilestonePicker={pickerMilestones.length > 0}
            assigneeOptions={aOpts} allTags={allTags} groupAccent={groupAccent}
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
                  milestones={pickerMilestones} showMilestonePicker={pickerMilestones.length > 0}
                  assigneeOptions={cOpts} allTags={allTags} groupAccent={groupAccent}
                  {...ch}
                  isDragging={draggingTaskId === child.id}
                  isDragTarget={false}
                  canDrag={true}
                  canBeDropTarget={false}
                  onDragStart={() => setDraggingTaskId(child.id)}
                  onDragEnd={() => { setDraggingTaskId(null); setDropTargetId(null) }}
                />
                {draftSubtaskParentId === child.id && (
                  <AddTaskRow cols={visibleCols} isSubtask parentId={child.id}
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
            <AddTaskRow cols={visibleCols} isSubtask parentId={task.id}
              assigneeOptions={aOpts} projectId={task.projectId} milestoneId={task.milestoneId}
              space={space ?? ''} addTask={addTask} userEmail={userEmail}
              onDone={another => { if (!another) setDraftSubtaskParentId(null) }}
              onCancel={() => setDraftSubtaskParentId(null)}
            />
          )}
        </React.Fragment>
      )
    })

  /**
   * One row per task, no nesting — ClickUp's "subtasks as separate tasks".
   *
   * In a flat mode a subtask due today has to be visible on its own merit; if
   * it only appeared nested under its parent it would be filed under the
   * parent's due date and effectively hidden, which defeats the whole point of
   * asking "what is urgent right now". Each row carries its own breadcrumb,
   * parent task included, so nothing is lost by dropping the indentation.
   */
  const renderFlatRows = (tasks: Task[]) =>
    sortDoneLast(tasks).map(task => {
      const h = makeHandlers(task)
      const ms = milestonesOf(task.projectId)
      return (
        <Row
          key={task.id} cols={visibleCols} task={task}
          milestones={ms} showMilestonePicker={ms.length > 0}
          assigneeOptions={getAssigneeOptions(task.projectId)} allTags={allTags}
          breadcrumb={crumbFor(task)}
          {...h}
        />
      )
    })

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
    const sortedMs = [...pjMilestones].sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0))

    const draftRow = (key: string, msId: string | undefined) => (
      <AddTaskRow
        cols={visibleCols}
        assigneeOptions={getAssigneeOptions(pjId)}
        milestoneId={msId}
        projectId={pjId}
        space={space ?? ''}
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
      onDelete={() => {
        if (!confirm('삭제할까요?')) return
        getChildren(ctxMenu.task.id).forEach(c => deleteTask(c.id))
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
          </div>
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
                        assigneeOptions={getAssigneeOptions(proj.id)}
                        projectId={proj.id}
                        space={space ?? ''}
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
                      assigneeOptions={getAssigneeOptions(undefined)}
                      space={space ?? ''}
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
              assigneeOptions={getAssigneeOptions(projectId)}
              projectId={projectId}
              space={space ?? ''}
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
  milestones = [], showMilestonePicker = false,
  assigneeOptions = [],
  allTags = [],
  groupAccent,
  breadcrumb,
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
  /** Colour of the milestone this row sits under, drawn as a rail on the left. */
  groupAccent?: string
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
  isDragging?: boolean; isDragTarget?: boolean
  canDrag?: boolean; canBeDropTarget?: boolean
  onDragStart?: () => void; onDragEnd?: () => void
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void
  onDragLeave?: () => void; onDrop?: () => void
}) {
  const [hovered, setHovered] = useState(false)
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
              paddingLeft: isChild ? 88 : 64,
              gap: 5,
              position: 'sticky',
              left: 0,
              zIndex: 2,
              background: hovered ? 'var(--bg2)' : 'var(--bg)',
              boxShadow: '2px 0 4px rgba(0,0,0,.06)',
            }}
          >
            {/* The milestone's colour, carried down from its header so the group
                stays visibly one thing past the first row. It lives inside the
                sticky name cell rather than on the row so it survives horizontal
                scrolling — the row's own left border is already spoken for by
                the drag target and child indicators. */}
            {groupAccent && (
              <span aria-hidden style={{
                position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
                background: groupAccent, opacity: isDone ? 0.25 : 0.45,
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
                  opacity: hovered ? 0.8 : 0, transition: 'opacity .1s',
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
              {PRIORITY_MARK[task.priority] && !isDone && (
                <span
                  title={`우선순위 ${task.priority}`}
                  style={{
                    width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                    background: PRIORITY_MARK[task.priority],
                  }}
                />
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
                  {!!task.blockedBy?.length && <span title={`선행 ${task.blockedBy.length}개`} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'rgba(212,76,71,.1)', color: '#D44C47', lineHeight: 1.6 }}>⛔ {task.blockedBy.length}</span>}
                  {!!task.blocking?.length && <span title={`후행 ${task.blocking.length}개`} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'rgba(217,115,13,.1)', color: '#D9730D', lineHeight: 1.6 }}>⚡ {task.blocking.length}</span>}
                </div>
              ) : null}
              {showMilestonePicker && (hovered || task.milestoneId) && onMilestoneChange && (
                <MilestonePicker milestoneId={task.milestoneId} milestones={milestones} onChange={onMilestoneChange} />
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
            <span style={{ fontSize: 13, color: overdue ? '#D44C47' : task.due ? 'var(--t2)' : 'var(--t3)', fontWeight: overdue ? 500 : 400, cursor: 'pointer' }}>
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
        minWidth: 'max-content',
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

// ── ColoredSelect — the 상태 / 우선순위 cell ──────────────────────────────────

/**
 * Was a native <select> hidden under a styled badge, which meant the two most
 * clicked cells in the table opened the operating system's menu while every
 * other cell opened the app's. Same badge, app's menu.
 */
function ColoredSelect<T extends string>({ value, options, styleMap, onChange, tabbable = false }: {
  value: T
  options: T[]
  styleMap: Record<T, { bg: string; color: string }>
  onChange: (v: string) => void
  tabbable?: boolean
}) {
  const m = useMenu()
  const s = styleMap[value] ?? { bg: 'var(--bg3)', color: 'var(--t2)' }
  // Focus stays on the trigger while the menu is open, so the arrows are
  // handled there. Without this the add row could be tabbed to but not filled.
  const [hi, setHi] = useState(0)
  useEffect(() => { if (m.open) setHi(Math.max(0, options.indexOf(value))) }, [m.open])
  const onKey = (e: React.KeyboardEvent) => {
    if (!m.open) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation()
      setHi(i => (i + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length)
    } else if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation()
      onChange(options[hi]); m.setOpen(false)
    }
  }
  const badge = (v: T, st: { bg: string; color: string }) => (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 12,
      background: st.bg, color: st.color,
      fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', lineHeight: 1.6,
    }}>
      <Dot color={st.color} size={6} />
      {v}
    </span>
  )

  return (
    <div ref={m.rootRef} style={{ position: 'relative', display: 'inline-flex', minWidth: 0 }} onClick={e => e.stopPropagation()} onKeyDown={onKey}>
      <CellTrigger open={m.open} onOpen={el => m.toggleAt(el, 150)} style={{ flex: 'none' }} tabbable={tabbable}>
        {badge(value, s)}
      </CellTrigger>
      {m.open && (
        <Menu pos={m.pos} panelRef={m.panelRef} width={150}>
          {options.map((o, i) => (
            <MenuItem key={o} selected={o === value} highlighted={i === hi} onSelect={() => { onChange(o); m.setOpen(false) }}>
              <Dot color={(styleMap[o] ?? s).color} />
              {o}
            </MenuItem>
          ))}
        </Menu>
      )}
    </div>
  )
}

// ── AssigneeMultiSelect ───────────────────────────────────────────────────────

function AssigneeMultiSelect({ assignee, options, onChange }: {
  assignee: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  const m = useMenu()
  const selected = parseAssignees(assignee)

  const toggle = (value: string) => {
    const next = selected.includes(value)
      ? selected.filter(s => s !== value)
      : [...selected, value]
    onChange(next.join(','))
  }

  return (
    <div ref={m.rootRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', width: '100%' }}>
      <CellTrigger open={m.open} onOpen={el => m.toggleAt(el)}>
        {selected.length === 0 ? (
          <Dash />
        ) : (
          <span style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
            {selected.map((k, i) => (
              <span key={k} style={{ marginLeft: i > 0 ? -6 : 0, position: 'relative', zIndex: 1 - i }}>
                <AssigneeAvatar assigneeKey={k} size={22} />
              </span>
            ))}
          </span>
        )}
      </CellTrigger>

      {m.open && (
        <Menu pos={m.pos} panelRef={m.panelRef}>
          {options.length === 0 ? (
            <MenuNote>멤버가 없습니다</MenuNote>
          ) : (
            <>
              <MenuList>
                {options.map(opt => (
                  <MenuItem key={opt.value} multi selected={selected.includes(opt.value)} onSelect={() => toggle(opt.value)}>
                    <AssigneeAvatar assigneeKey={opt.value} size={20} />
                    {opt.label}
                  </MenuItem>
                ))}
              </MenuList>
              {selected.length > 0 && <MenuFooter label="담당자 해제" onSelect={() => onChange('')} />}
            </>
          )}
        </Menu>
      )}
    </div>
  )
}

// ── MilestoneHeader ───────────────────────────────────────────────────────────

function MilestoneHeader({ milestone, taskCount, completed, diff, collapsed, minWidth, onToggle, onToggleDone, onUpdate, onDelete }: {
  milestone: Milestone; taskCount: number; completed: number; diff: number
  collapsed: boolean; minWidth?: number; onToggle: () => void; onToggleDone: () => void
  onUpdate: (patch: Partial<Omit<Milestone, 'id'>>) => void
  onDelete?: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [editingDate, setEditingDate] = useState(false)
  const [tempName, setTempName] = useState(milestone.name)
  const [tempDate, setTempDate] = useState(milestone.dueDate)
  const isDone = !!milestone.done
  const overdue = !isDone && diff < 0
  const close = !isDone && diff >= 0 && diff <= 7
  const accent = milestoneAccent(isDone, diff)
  const progress = taskCount ? Math.round(completed / taskCount * 100) : 0

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
          style={{ ...inlineInput, fontSize: 13, fontWeight: 600, width: 160 }}
        />
      ) : (
        <span
          onClick={e => { e.stopPropagation(); setTempName(milestone.name); setEditingName(true) }}
          title="클릭해서 이름 수정"
          style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t1)', cursor: 'text', borderBottom: '1px solid transparent', transition: 'border-color .1s', textDecoration: isDone ? 'line-through' : 'none' }}
          onMouseEnter={e => e.currentTarget.style.borderBottomColor = 'var(--bd)'}
          onMouseLeave={e => e.currentTarget.style.borderBottomColor = 'transparent'}
        >
          {milestone.name}
        </span>
      )}

      {editingDate ? (
        <span onClick={e => e.stopPropagation()}>
          <DateField
            value={tempDate}
            context={{ projectId: milestone.projectId }}
            onChange={v => { onUpdate({ dueDate: v }); setTempDate(v); setEditingDate(false) }}
            style={{ fontSize: 11, color: 'var(--t2)', outline: '1px solid var(--ac)', borderRadius: 3, padding: '2px 6px' }}
          />
        </span>
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
        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 'var(--r1)', flexShrink: 0, background: overdue ? 'rgba(212,76,71,.1)' : close ? 'rgba(217,115,13,.1)' : 'rgba(139,92,246,.1)', color: accent }}>
          {overdue ? `D+${Math.abs(diff)}` : `D-${diff}`}
        </span>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4, flexShrink: 0 }}>
        <div style={{ width: 72, height: 4, background: 'var(--bd)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progress}%`, background: accent, borderRadius: 2, transition: 'width .3s' }} />
        </div>
        <span style={{ fontSize: 11, color: 'var(--t3)', whiteSpace: 'nowrap' }}>{completed}/{taskCount} 완료</span>
      </div>
      </div>

      {!editingName && !editingDate && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'sticky', right: 12, marginLeft: 'auto', flexShrink: 0, opacity: hovered ? 1 : 0, pointerEvents: hovered ? 'auto' : 'none', transition: 'opacity .12s' }}>
          {onDelete && (
            <button
              onClick={e => { e.stopPropagation(); if (confirm(`"${milestone.name}" 마일스톤을 삭제할까요?`)) onDelete() }}
              style={{ padding: '3px 8px', fontSize: 11, borderRadius: 'var(--r1)', border: '1px solid rgba(212,76,71,.4)', background: 'var(--bg2)', color: '#D44C47', cursor: 'pointer', fontFamily: 'var(--font)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(212,76,71,.07)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg2)' }}
            >삭제</button>
          )}
        </div>
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
  const valid = name.trim() !== '' && date !== ''

  const submit = (another: boolean) => {
    if (!valid) return
    addMilestone(projectId, name.trim(), date)
    setName(''); setDate('')
    if (another) setTimeout(() => nameRef.current?.focus(), 0)
    else onDone()
  }

  return (
    <div
      onKeyDown={e => {
        if (e.key === 'Escape') { e.stopPropagation(); onDone(); return }
        if (e.key === 'Enter' && !isComposing(e)) { e.preventDefault(); submit(!e.shiftKey) }
      }}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: NOTION.purple.bg, borderLeft: `3px solid ${NOTION.purple.text}` }}
    >
      <span style={{ fontSize: 9, color: NOTION.purple.text, flexShrink: 0 }}>◆</span>
      <input
        ref={nameRef} autoFocus placeholder="마일스톤 이름..." value={name}
        onChange={e => setName(e.target.value)}
        style={{ flex: 1, border: 'none', outline: '1px solid var(--ac)', borderRadius: 'var(--r1)', padding: '3px 8px', fontSize: 13, fontWeight: 600, background: 'var(--bg)', color: 'var(--t1)', fontFamily: 'var(--font)' }}
      />
      <div style={{ width: 130, flexShrink: 0 }}>
        <AddRowDatePicker value={date} context={{ projectId }} onChange={setDate} />
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

// ── AddRowAssigneeSelect — single-select for the add row ──────────────────────

function AddRowAssigneeSelect({ value, options, onChange }: {
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  const m = useMenu()
  const current = options.find(o => o.value === value)

  return (
    <div
      ref={m.rootRef}
      style={{ position: 'relative', width: '100%' }}
      onKeyDown={e => { if (e.key === 'Escape' && m.open) { e.stopPropagation(); m.setOpen(false) } }}
    >
      <div
        data-addrow-popup
        tabIndex={0}
        onClick={e => { e.stopPropagation(); m.toggleAt(e.currentTarget) }}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); m.toggleAt(e.currentTarget) }
        }}
        style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', padding: '3px 6px', borderRadius: 'var(--r1)', outline: '1px solid var(--ac)', background: 'var(--bg)', width: '100%', boxSizing: 'border-box' }}
      >
        {current ? <AssigneeAvatar assigneeKey={current.value} size={18} /> : null}
        <span style={{ flex: 1, fontSize: 13, color: current ? 'var(--t1)' : 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {current ? current.label : '미배정'}
        </span>
        <span style={{ fontSize: 9, color: 'var(--t3)', flexShrink: 0, opacity: .6 }}>▾</span>
      </div>

      {m.open && (
        <Menu pos={m.pos} panelRef={m.panelRef}>
          <MenuList>
            <MenuItem selected={!value} onSelect={() => { onChange(''); m.setOpen(false) }}>미배정</MenuItem>
            {options.map(opt => (
              <MenuItem key={opt.value} selected={opt.value === value} onSelect={() => { onChange(opt.value); m.setOpen(false) }}>
                <AssigneeAvatar assigneeKey={opt.value} size={20} />
                {opt.label}
              </MenuItem>
            ))}
          </MenuList>
          {options.length === 0 && <MenuNote>멤버가 없습니다</MenuNote>}
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
      <ColoredSelect
        value={value}
        options={STATUS_LIST}
        styleMap={STATUS_STYLE}
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

  const display = value ? (() => {
    const d = new Date(value + 'T00:00:00')
    return `${d.getMonth() + 1}/${d.getDate()}`
  })() : null

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <div
        data-addrow-popup
        tabIndex={0}
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setOpen(o => !o) }
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
          onClose={() => setOpen(false)}
        />
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
  const [priority, setPriority] = useState<Priority>('중간')
  const containerRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => { nameRef.current?.focus() }, [])

  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      // Ignore clicks inside any fixed popup spawned by our child selects
      if (t.closest('[data-addrow-popup]')) return
      if (containerRef.current && !containerRef.current.contains(t)) onCancel()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onCancel])

  const doSave = (addAnother: boolean) => {
    if (!name.trim()) { nameRef.current?.focus(); return }
    addTask({
      type: parentId ? '세부' : '상위', cat: space, name: name.trim(), assignee,
      start: '', due, priority, status,
      progress: 0, memo: '', parentId, projectId, milestoneId,
      createdBy: userEmail ?? undefined,
    })
    setName(''); setAssignee(''); setDue(''); setStatus('대기'); setPriority('중간')
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
          <div key="name" style={{ ...base, position: 'sticky', left: 0, zIndex: 2, background: 'linear-gradient(rgba(35,131,226,.04), rgba(35,131,226,.04)), var(--bg)', boxShadow: '2px 0 4px rgba(0,0,0,.06)', paddingLeft: isSubtask ? 88 : 14 }}>
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
            <ColoredSelect
              value={priority}
              options={PRIORITY_LIST}
              styleMap={PRIORITY_STYLE}
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
      onKeyDown={handleContainerKey}
      style={{
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

function MilestonePicker({ milestoneId, milestones, onChange }: {
  milestoneId: string | undefined; milestones: Milestone[]; onChange: (id: string | undefined) => void
}) {
  const m = useMenu()
  const current = milestones.find(ms => ms.id === milestoneId)
  const accent = NOTION.purple.text

  return (
    <div ref={m.rootRef} style={{ position: 'relative', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
      <button
        onClick={e => { e.stopPropagation(); m.toggleAt(e.currentTarget, 220) }}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '2px 7px', borderRadius: 12, fontFamily: 'var(--font)',
          fontSize: 11, cursor: 'pointer', border: 'none',
          background: current ? NOTION.purple.bg : 'var(--bg3)',
          color: current ? accent : 'var(--t3)',
          maxWidth: 140, whiteSpace: 'nowrap',
        }}
      >
        <Dot color={current ? accent : 'var(--t3)'} size={5} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{current ? current.name : '마일스톤'}</span>
      </button>

      {m.open && (
        <Menu pos={m.pos} panelRef={m.panelRef} width={220}>
          <MenuList>
            <MenuItem selected={!milestoneId} onSelect={() => { onChange(undefined); m.setOpen(false) }}>미배정</MenuItem>
            {milestones.map(ms => (
              <MenuItem
                key={ms.id}
                selected={ms.id === milestoneId}
                onSelect={() => { onChange(ms.id); m.setOpen(false) }}
                trailing={<span style={{ fontSize: 10, color: 'var(--t3)', flexShrink: 0 }}>{ms.dueDate}</span>}
              >
                <Dot color={accent} size={5} />
                {ms.name}
              </MenuItem>
            ))}
          </MenuList>
          {milestones.length === 0 && <MenuNote>마일스톤이 없습니다</MenuNote>}
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
    ? (driveIdOf(first) ? fileKind(resolved.get(driveIdOf(first)!)?.mimeType ?? first.mimeType).icon : '🔗')
    : null

  return (
    <div ref={m.rootRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', width: '100%' }}>
      <CellTrigger open={m.open} onOpen={el => m.toggleAt(el, 340, 480)}>
        {!first ? <Dash /> : (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, fontSize: 12 }}>
            <span style={{ flexShrink: 0 }}>{firstIcon}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--t1)' }}>{firstName}</span>
            {links.length > 1 && <span style={{ color: 'var(--t3)', flexShrink: 0 }}>+{links.length - 1}</span>}
          </span>
        )}
      </CellTrigger>

      {m.open && (
        <Menu pos={m.pos} panelRef={m.panelRef} width={340} maxHeight={480}>
          {/* Two scroll areas, each with its own floor. Sharing one meant the
              search results grew until what was already attached was a sliver —
              and what is already attached is the thing you check before adding. */}
          {links.length > 0 && (
            <>
              <div style={{ flex: '0 1 auto', minHeight: 40, maxHeight: 150, overflowY: 'auto', margin: '0 -4px', padding: '0 4px' }}>
                {links.map(l => (
                  <FileRow key={l.id} link={l} compact
                    file={resolved.get(driveIdOf(l) ?? '')}
                    onRemove={() => remove(l.id)} />
                ))}
              </div>
              <MenuDivider />
            </>
          )}
          <AttachTabs mode={mode} onChange={setMode} />
          {mode === 'drive'
            ? <DriveSearch folderId={folderId} attachedIds={attachedIds} onPick={f => add(linkFromDriveFile(f))} onClose={() => m.setOpen(false)} />
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
