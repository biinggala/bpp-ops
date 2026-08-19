import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAccessibleTasks } from '../../hooks/useAccessibleTasks'
import { useMobile } from '../../hooks/useMobile'
import { haptic } from '../../lib/haptics'
import { useMilestoneStore } from '../../store/milestoneStore'
import { useUserProfileStore } from '../../store/userProfileStore'
import { useTaskStore } from '../../store/taskStore'
import { parseAssignees } from '../../lib/utils'
import { NOTION, STATUS_COLORS } from '../../types'
import type { Task } from '../../types'

/**
 * ── Picking a deadline with the calendar in front of you ─────────────────────
 *
 * The browser's own date input asks "what date" and shows nothing else, so a
 * deadline was being chosen blind: no sense of whether that Thursday already
 * has six things landing on it, no sight of the milestone the task belongs to,
 * no idea when the task it is waiting on is supposed to finish. The date got
 * picked, and the collision was discovered a fortnight later.
 *
 * The pattern is borrowed from the tools that solved it:
 *
 * - **Load per day**, as a bar under each date — Asana's calendar and Todoist's
 *   Upcoming. When the task has an assignee the bar is *their* load, because
 *   the real question is "does this land on top of everything else Minsu owes
 *   me on the 14th", not "is the company busy".
 * - **The dates this one is tied to**, as chips that jump the calendar there:
 *   the milestone, the parent task, whatever this is blocked by. Height and
 *   Linear surface dependencies at scheduling time for the same reason.
 * - **The day's actual deadlines, named**, under the grid. A count tells you
 *   the 14th is heavy; the names tell you whether it is heavy with things that
 *   matter to this decision, which is the question actually being asked.
 */

export interface DateContext {
  /** Excluded from its own day's count — it is the thing being scheduled. */
  taskId?: string
  projectId?: string
  milestoneId?: string
  parentId?: string
  /** Comma-separated, as tasks store it. Narrows the load bars to these people. */
  assignee?: string
  blockedBy?: string[]
}

const DAYS = ['일', '월', '화', '수', '목', '금', '토']
const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']

export function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Load is a ladder, not a gradient — four steps people can tell apart at 4px tall. */
function loadStyle(n: number): { color: string; height: number } | null {
  if (n <= 0) return null
  if (n <= 2) return { color: NOTION.blue.text, height: 2 }
  if (n <= 4) return { color: NOTION.orange.text, height: 3 }
  return { color: NOTION.red.text, height: 4 }
}

export function DatePicker({ value, anchor, context, onChange, onClose }: {
  value: string
  anchor: HTMLElement | null
  context?: DateContext
  onChange: (v: string) => void
  onClose: () => void
}) {
  const accessible = useAccessibleTasks()
  const nameOf = useUserProfileStore(s => s.getNameByEmail)
  const isMobile = useMobile()
  const allTasks = useTaskStore(s => s.tasks)
  const milestones = useMilestoneStore(s => s.milestones)
  const panelRef = useRef<HTMLDivElement>(null)

  const initial = value ? new Date(value + 'T00:00:00') : new Date()
  const [viewYear, setViewYear] = useState(initial.getFullYear())
  const [viewMonth, setViewMonth] = useState(initial.getMonth())
  const [hover, setHover] = useState<string | null>(null)

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])
  const todayStr = ymd(today)

  // ── Placement ───────────────────────────────────────────────────────────────
  // Only the desktop panel is anchored. On a phone it rises from the bottom
  // instead: a 296px card pinned near whatever was tapped lands under the
  // thumb, half off-screen as often as not, and there is no room to put it
  // anywhere better.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  useEffect(() => {
    if (isMobile) { setPos({ top: 0, left: 0 }); return }
    if (!anchor) return
    const r = anchor.getBoundingClientRect()
    const W = 296, H = 440
    const below = window.innerHeight - r.bottom - 6
    setPos({
      top: below < H && r.top > below ? Math.max(8, r.top - 6 - H) : r.bottom + 6,
      left: Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - W - 8)),
    })
  }, [anchor, isMobile])

  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || anchor?.contains(t)) return
      onClose()
    }
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('mousedown', h)
    document.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k) }
  }, [anchor, onClose])

  // ── Load per day ────────────────────────────────────────────────────────────
  // Whose load: the people this task is assigned to, or everyone when it has
  // nobody yet. "Is the 14th busy" is only ever asked about somebody.
  const owners = useMemo(() => parseAssignees(context?.assignee ?? ''), [context?.assignee])
  const mine = (assignee: string) =>
    owners.length === 0 || owners.some(o => assignee.includes(o))

  const loadByDay = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const t of accessible) {
      if (!t.due || t.status === '완료') continue
      if (t.id === context?.taskId) continue
      if (!mine(t.assignee)) continue
      m.set(t.due, [...(m.get(t.due) ?? []), t])
    }
    // Highest priority first: if only four names fit, they should be the four
    // worth knowing about.
    const rank: Record<string, number> = { '높음': 0, '중간': 1, '낮음': 2 }
    for (const list of m.values()) {
      list.sort((a, b) => (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3) || a.name.localeCompare(b.name, 'ko'))
    }
    return m
  }, [accessible, context?.taskId, owners])

  const milestonesByDay = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const ms of milestones) {
      if (context?.projectId && ms.projectId !== context.projectId) continue
      if (!ms.dueDate) continue
      m.set(ms.dueDate, [...(m.get(ms.dueDate) ?? []), ms.name])
    }
    return m
  }, [milestones, context?.projectId])

  // ── The dates this task is tied to ──────────────────────────────────────────
  const anchors = useMemo(() => {
    const out: { label: string; date: string; color: string }[] = []
    const ms = context?.milestoneId ? milestones.find(x => x.id === context.milestoneId) : undefined
    if (ms?.dueDate) out.push({ label: `◆ ${ms.name}`, date: ms.dueDate, color: NOTION.purple.text })
    const parent = context?.parentId ? allTasks.find(t => t.id === context.parentId) : undefined
    if (parent?.due) out.push({ label: `상위 · ${parent.name}`, date: parent.due, color: NOTION.blue.text })
    for (const id of context?.blockedBy ?? []) {
      const b = allTasks.find(t => t.id === id)
      if (b?.due) out.push({ label: `선행 · ${b.name}`, date: b.due, color: NOTION.orange.text })
    }
    return out.slice(0, 4)
  }, [context?.milestoneId, context?.parentId, context?.blockedBy, milestones, allTasks])

  // ── Grid ────────────────────────────────────────────────────────────────────
  const cells = useMemo(() => {
    const firstDow = new Date(viewYear, viewMonth, 1).getDay()
    const count = new Date(viewYear, viewMonth + 1, 0).getDate()
    const out: (number | null)[] = Array(firstDow).fill(null)
    for (let d = 1; d <= count; d++) out.push(d)
    while (out.length % 7 !== 0) out.push(null)
    return out
  }, [viewYear, viewMonth])

  const step = (n: number) => {
    const d = new Date(viewYear, viewMonth + n, 1)
    setViewYear(d.getFullYear()); setViewMonth(d.getMonth())
  }
  const jumpTo = (date: string) => {
    const d = new Date(date + 'T00:00:00')
    setViewYear(d.getFullYear()); setViewMonth(d.getMonth())
  }
  const pick = (date: string) => { haptic('toggle'); onChange(date); onClose() }

  const focus = hover ?? value
  const focusTasks = (focus ? loadByDay.get(focus) : undefined) ?? []
  const focusMs = focus ? milestonesByDay.get(focus) : undefined

  if (!pos) return null

  const shell: React.CSSProperties = isMobile
    ? {
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9100,
        background: 'var(--bg)', borderTop: '1px solid var(--bd)',
        borderRadius: '16px 16px 0 0', boxShadow: '0 -8px 32px rgba(0,0,0,.18)',
        padding: 14, paddingBottom: 'calc(14px + env(safe-area-inset-bottom, 0px))',
        boxSizing: 'border-box', userSelect: 'none',
        maxHeight: '85vh', overflowY: 'auto',
      }
    : {
        position: 'fixed', top: pos.top, left: pos.left, width: 296, zIndex: 9100,
        background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r3)',
        boxShadow: 'var(--sh-md)', padding: 10, boxSizing: 'border-box', userSelect: 'none',
      }

  return createPortal(
    <>
    {/* A sheet needs something behind it to catch the tap that dismisses it —
        on a phone there is no "outside the panel" left to click. */}
    {isMobile && (
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 9099, background: 'rgba(15,15,15,.32)' }}
      />
    )}
    <div
      ref={panelRef}
      data-addrow-popup
      data-datepicker-popup
      onClick={e => e.stopPropagation()}
      style={shell}
    >
      {isMobile && (
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--bd2)', margin: '-4px auto 10px' }} />
      )}
      {/* What this task is already tied to. Clicking lands the calendar there. */}
      {anchors.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--bd)' }}>
          {anchors.map((a, i) => (
            <div
              key={i}
              onMouseDown={e => { e.preventDefault(); jumpTo(a.date) }}
              onMouseEnter={() => setHover(a.date)}
              onMouseLeave={() => setHover(null)}
              title="이 날짜로 이동"
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, cursor: 'pointer', padding: '2px 4px', borderRadius: 'var(--r1)' }}
              onMouseOver={e => (e.currentTarget.style.background = 'var(--bg3)')}
              onMouseOut={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ color: a.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{a.label}</span>
              <span style={{ color: 'var(--t3)', flexShrink: 0 }}>{a.date.slice(5).replace('-', '/')}</span>
            </div>
          ))}
        </div>
      )}

      {/* Month nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <NavBtn onClick={() => step(-1)}>‹</NavBtn>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{viewYear}년 {MONTHS[viewMonth]}</span>
        <NavBtn onClick={() => step(1)}>›</NavBtn>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 3 }}>
        {DAYS.map((d, i) => (
          <div key={d} style={{ textAlign: 'center', fontSize: 10, color: i === 0 ? NOTION.red.text : i === 6 ? NOTION.blue.text : 'var(--t3)', paddingBottom: 2 }}>{d}</div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
        {cells.map((day, i) => {
          if (day === null) return <div key={i} />
          const date = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const isSel = date === value
          const isToday = date === todayStr
          const dow = i % 7
          const load = loadByDay.get(date)?.length ?? 0
          const bar = loadStyle(load)
          const hasMs = milestonesByDay.has(date)
          return (
            <div
              key={i}
              onMouseDown={e => { e.preventDefault(); pick(date) }}
              onMouseEnter={() => setHover(date)}
              onMouseLeave={() => setHover(null)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                minHeight: isMobile ? 42 : undefined,
                padding: '3px 0 4px', borderRadius: 4, cursor: 'pointer',
                background: isSel ? 'var(--ac)' : hover === date ? 'var(--bg3)' : isToday ? 'var(--ac-l)' : 'transparent',
                outline: isToday && !isSel ? '1px solid var(--ac)' : 'none',
                position: 'relative',
              }}
            >
              <span style={{
                fontSize: isMobile ? 15 : 12, lineHeight: 1.2,
                fontWeight: isSel || isToday ? 600 : 400,
                color: isSel ? '#fff' : dow === 0 ? NOTION.red.text : dow === 6 ? NOTION.blue.text : 'var(--t1)',
              }}>{day}</span>
              {/* Milestone marker sits above the load bar — it is a landmark,
                  not a quantity. */}
              {hasMs && (
                <span style={{ position: 'absolute', top: 1, right: 2, fontSize: 6, color: isSel ? '#fff' : NOTION.purple.text }}>◆</span>
              )}
              <span style={{
                width: bar ? `${Math.min(100, 30 + load * 14)}%` : 0,
                height: bar?.height ?? 2,
                borderRadius: 2,
                background: bar ? (isSel ? 'rgba(255,255,255,.85)' : bar.color) : 'transparent',
              }} />
            </div>
          )
        })}
      </div>

      {/*
        What the bar under the focused day is made of, by name.

        Fixed height on purpose: this changes on every hover, and a panel that
        grew and shrank as the pointer crossed the grid would move the calendar
        out from under it.
      */}
      <div style={{ marginTop: 8, paddingTop: 7, borderTop: '1px solid var(--bd)', height: 96, overflow: 'hidden' }}>
        {focus ? (
          <>
            <div style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap', overflow: 'hidden' }}>
              <span style={{ fontWeight: 600, color: 'var(--t1)', flexShrink: 0 }}>{focus.slice(5).replace('-', '월 ')}일</span>
              <span style={{ flexShrink: 0, color: focusTasks.length ? (loadStyle(focusTasks.length)?.color ?? 'var(--t3)') : 'var(--t3)' }}>
                {focusTasks.length
                  ? `마감 ${focusTasks.length}건${owners.length ? ' (담당자 기준)' : ''}`
                  : '마감 없음'}
              </span>
              {focusMs?.map(n => (
                <span key={n} style={{ color: NOTION.purple.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>◆ {n}</span>
              ))}
            </div>
            <div style={{ marginTop: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {focusTasks.slice(0, 3).map(t => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, minWidth: 0 }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0, background: STATUS_COLORS[t.status]?.text ?? 'var(--t3)' }} />
                  <span style={{ flex: 1, minWidth: 0, color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.name}>
                    {t.name}
                  </span>
                  {owners.length === 0 && t.assignee && (
                    <span style={{ flexShrink: 0, color: 'var(--t3)', fontSize: 10, maxWidth: 70, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {parseAssignees(t.assignee).map(a => nameOf(a)).join(', ')}
                    </span>
                  )}
                </div>
              ))}
              {focusTasks.length > 3 && (
                <div style={{ fontSize: 10, color: 'var(--t3)' }}>+{focusTasks.length - 3}건 더</div>
              )}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--t3)' }}>날짜 위에 올리면 그날 마감이 보입니다</div>
        )}
      </div>

      {value && (
        <div style={{ marginTop: 6, textAlign: 'center' }}>
          <span
            onMouseDown={e => { e.preventDefault(); onChange(''); onClose() }}
            style={{ fontSize: 11, color: 'var(--t3)', cursor: 'pointer' }}
            onMouseEnter={e => (e.currentTarget.style.color = NOTION.red.text)}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--t3)')}
          >날짜 지우기</span>
        </div>
      )}
    </div>
    </>,
    document.body,
  )
}

function NavBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onMouseDown={e => { e.preventDefault(); onClick() }}
      style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--t2)', padding: '2px 8px', borderRadius: 3, lineHeight: 1, fontFamily: 'var(--font)' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >{children}</button>
  )
}

/**
 * A date, clicked to open the picker.
 *
 * The drop-in for every `<input type="date">` that used to hand the job to the
 * operating system — and with it, to a calendar that knows nothing about the
 * work.
 */
export function DateField({ value, context, onChange, placeholder = '—', format = 'short', style }: {
  value: string
  context?: DateContext
  onChange: (v: string) => void
  placeholder?: string
  format?: 'short' | 'full'
  style?: React.CSSProperties
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  const label = value
    ? (() => {
        const d = new Date(value + 'T00:00:00')
        return format === 'full'
          ? `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`
          : `${d.getMonth() + 1}/${d.getDate()}`
      })()
    : placeholder

  return (
    <>
      <span
        ref={ref}
        tabIndex={0}
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setOpen(o => !o) }
        }}
        style={{ cursor: 'pointer', color: value ? 'var(--t1)' : 'var(--t3)', ...style }}
      >
        {label}
      </span>
      {open && (
        <DatePicker
          value={value}
          anchor={ref.current}
          context={context}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
