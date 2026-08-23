import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useGCalStore } from '../../../store/gcalStore'
import { useUiStore } from '../../../store/uiStore'
import { useFilteredTasks } from '../../../hooks/useFilteredTasks'
import { DayPlanner } from '../calendar/DayPlanner'
import { useTaskStore } from '../../../store/taskStore'
import { useProjectStore } from '../../../store/projectStore'
import { useAuthStore } from '../../../store/authStore'
import { useUserProfileStore } from '../../../store/userProfileStore'
import { authorizedEmails } from '../../../lib/utils'
import type { Task } from '../../../types'
import { addDays, toDate, fmtYMD, isComposing } from '../../../lib/utils'
import type { GCalEvent } from '../../../store/gcalStore'

/**
 * Day and week timeline.
 *
 * Dragging across empty grid creates a Google Calendar event, following the
 * gesture people already know from Google Calendar: drag from the start time to
 * the end time, then name it. Meetings booked here are for the team to see at a
 * glance — nobody outside is invited, so there are no attendees involved.
 */

// Notion's palette works by pairing a very pale tint with mid-tone text rather
// than filling a shape with saturated colour and putting white on top. The
// timeline follows that: a calendar's colour shows as a bar and a wash, and the
// text stays dark enough to read at 11px.
// (Reference values confirmed from Notion light mode: blue text #487CA5,
// blue background #E7F3F8, green #DBEDDB, brown #EEE0DA.)
function tint(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  if (clean.length !== 6) return `rgba(55,53,47,${alpha})`
  const [r, g, b] = [0, 2, 4].map(i => parseInt(clean.slice(i, i + 2), 16))
  return `rgba(${r},${g},${b},${alpha})`
}

/**
 * A calendar's colour, darkened enough to read as text.
 *
 * Google hands out saturated colours meant for filled shapes. Notion's text
 * colours are the same hue pulled toward its default ink (#37352F), which is
 * what keeps a coloured label legible at 10px.
 */
function readable(hex: string): string {
  const clean = hex.replace('#', '')
  if (clean.length !== 6) return '#37352F'
  const mixed = [0, 2, 4].map(i => {
    const channel = parseInt(clean.slice(i, i + 2), 16)
    const ink = [0x37, 0x35, 0x2f][i / 2]
    return Math.round(channel * 0.62 + ink * 0.38)
  })
  return `#${mixed.map(c => c.toString(16).padStart(2, '0')).join('')}`
}

const SLOT_H = 64          // px per hour — a 30-minute block has to fit its own name
const PX_PER_MIN = SLOT_H / 60
const SNAP = 15            // minutes
const MIN_DURATION = 15
export const GUTTER = 52   // width of the hour labels
const HOURS = Array.from({ length: 24 }, (_, i) => i)
/** The hour the grid is scrolled to on open — sits flush with the top edge. */
const DAY_START_HOUR = 9

const snap = (minutes: number) => Math.round(minutes / SNAP) * SNAP
const clampDay = (minutes: number) => Math.max(0, Math.min(24 * 60, minutes))

function hhmm(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24
  const m = totalMinutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Google wants local wall-clock time plus a zone, not UTC. */
function localIso(date: string, minutes: number): string {
  return `${date}T${hhmm(minutes)}:00`
}

interface Draft {
  date: string
  fromMinutes: number
  toMinutes: number
}

/**
 * The hour grid, without a toolbar of its own.
 *
 * Navigation and the day/week choice live in the calendar view's header now:
 * this and the month grid are two ranges of one screen, not two screens, so a
 * second set of controls next to the first would only invite the confusion the
 * merge was meant to remove.
 */
/**
 * `lead` days of each end are drawn outside the frame, so that a scroll can
 * park the grid between two days instead of only on one. See useWheelSlide in
 * the calendar view: it writes the sub-day remainder into --slide, which every
 * strip below reads, so the three of them travel as one without React having to
 * redraw a single column.
 */
export function TimelineGrid({ days, lead = 0 }: { days: string[]; lead?: number }) {
  const { token, events, calendars, createEvent, updateEvent, removeEvent, ensureEvents } = useGCalStore()
  const tasks = useFilteredTasks()
  const updateTask = useTaskStore(s => s.updateTask)
  const openTaskDetail = useUiStore(s => s.openTaskDetail)
  const projects = useProjectStore(s => s.projects)
  const myEmail = useAuthStore(s => s.email)
  const getNameByEmail = useUserProfileStore(s => s.getNameByEmail)

  // Who can be invited: the people this account already shares a project with.
  // Not everyone who has ever signed in — that is a list of accounts, not a team.
  const teammates = useMemo(
    () => [...authorizedEmails(projects, myEmail)].filter(e => e !== myEmail?.toLowerCase()).sort(),
    [projects, myEmail],
  )

  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!token) return
    ensureEvents(days[0], days[days.length - 1])
  }, [token, days[0], days[days.length - 1]])

  // ── Drag to create ────────────────────────────────────────────────────────
  const [draft, setDraft] = useState<Draft | null>(null)
  const [naming, setNaming] = useState<Draft | null>(null)
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const ghostRef = useRef<{ id: string; from: number; to: number } | null>(null)
  const dragging = useRef<{ date: string; anchorMinutes: number } | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<string | null>(null)
  /** Placing a task on a whole day, opened from that day's header. */
  const [planning, setPlanning] = useState<{ date: string; anchor: HTMLElement } | null>(null)
  // A floating card, like Google Calendar's quick-create. Day columns are far
  // too narrow to hold a guest list, and the grid clips anything wider.
  const [cardAt, setCardAt] = useState<{ x: number; y: number } | null>(null)
  const [guests, setGuests] = useState<string[]>([])

  // Moving or stretching an existing event. Held here so the block can be drawn
  // at the new position before Google has confirmed it.
  const [ghost, setGhost] = useState<{ id: string; from: number; to: number } | null>(null)
  const moving = useRef<{ id: string; date: string; grabAt: number; from: number; to: number; mode: 'move' | 'resize' } | null>(null)

  // mouseup fires outside React's render, so the latest ghost is read from a ref.
  useEffect(() => { ghostRef.current = ghost }, [ghost])

  const beginMove = (
    e: React.MouseEvent, event: GCalEvent, date: string, from: number, to: number, mode: 'move' | 'resize',
  ) => {
    e.stopPropagation()
    e.preventDefault()
    const column = (e.currentTarget as HTMLElement).closest('[data-day-column]') as HTMLElement | null
    if (!column) return
    const grabAt = minutesAt(e.clientY, column)
    moving.current = { id: event.id, date, grabAt, from, to, mode }

    const move = (ev: MouseEvent) => {
      const held = moving.current
      if (!held) return
      const at = minutesAt(ev.clientY, column)
      const delta = at - held.grabAt
      if (held.mode === 'move') {
        const length = held.to - held.from
        const start = clampDay(Math.min(24 * 60 - length, Math.max(0, held.from + delta)))
        setGhost({ id: held.id, from: start, to: start + length })
      } else {
        setGhost({ id: held.id, from: held.from, to: clampDay(Math.max(held.from + MIN_DURATION, held.to + delta)) })
      }
    }
    const up = async () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      const held = moving.current
      moving.current = null
      const settled = ghostRef.current
      setGhost(null)
      if (!held || !settled) return
      if (settled.from === held.from && settled.to === held.to) return
      await updateEvent(held.id, {
        startDateTime: localIso(held.date, settled.from),
        endDateTime: localIso(held.date, settled.to),
      })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const minutesAt = (clientY: number, column: HTMLElement): number => {
    const rect = column.getBoundingClientRect()
    return clampDay(snap((clientY - rect.top) / PX_PER_MIN))
  }

  const beginDrag = (e: React.MouseEvent<HTMLDivElement>, date: string) => {
    if (e.button !== 0 || naming || selected) return   // a popover is open; a stray drag would hide it
    const column = e.currentTarget
    const at = minutesAt(e.clientY, column)
    dragging.current = { date, anchorMinutes: at }
    setDraft({ date, fromMinutes: at, toMinutes: at + MIN_DURATION })

    const move = (ev: MouseEvent) => {
      const held = dragging.current
      if (!held) return
      const to = minutesAt(ev.clientY, column)
      const from = Math.min(held.anchorMinutes, to)
      const until = Math.max(held.anchorMinutes, to)
      setDraft({ date, fromMinutes: from, toMinutes: Math.max(from + MIN_DURATION, until) })
    }
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      dragging.current = null
      setCardAt({ x: ev.clientX, y: ev.clientY })
      setDraft(current => { if (current) { setNaming(current); setTitle(''); setGuests([]) } return null })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const save = async () => {
    if (!naming || saving) return
    const name = title.trim()
    if (!name) { setNaming(null); return }
    setSaving(true)
    const ok = await createEvent({
      summary: name,
      startDateTime: localIso(naming.date, naming.fromMinutes),
      endDateTime: localIso(naming.date, naming.toMinutes),
      attendees: guests,
    })
    setSaving(false)
    if (ok) { setNaming(null); setTitle(''); setGuests([]) }
  }

  // ── Layout ────────────────────────────────────────────────────────────────
  const eventsByDate = useMemo(() => {
    const map = new Map<string, GCalEvent[]>()
    for (const ev of events) {
      if (ev.allDay) continue
      if (!map.has(ev.start)) map.set(ev.start, [])
      map.get(ev.start)!.push(ev)
    }
    return map
  }, [events])

  const tasksByDate = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const t of tasks) {
      if (!t.due) continue
      if (!map.has(t.due)) map.set(t.due, [])
      map.get(t.due)!.push(t)
    }
    return map
  }, [tasks])

  // All-day entries sit above the hours rather than in them, which is where
  // Google Calendar puts both its all-day events and anything merely due today.
  const allDayByDate = useMemo(() => {
    const map = new Map<string, GCalEvent[]>()
    for (const ev of events) {
      if (!ev.allDay) continue
      for (let d = ev.start; d <= ev.end; d = fmtYMD(addDays(toDate(d), 1))) {
        if (!map.has(d)) map.set(d, [])
        map.get(d)!.push(ev)
      }
    }
    return map
  }, [events])

  const [selectedTitle, setSelectedTitle] = useState('')
  const selectedInfo = useMemo(() => {
    if (!selected) return null
    for (const list of eventsByDate.values()) {
      const found = place(list).find(p => p.event.id === selected)
      if (found) return found
    }
    return null
  }, [selected, eventsByDate])
  useEffect(() => { if (selectedInfo) setSelectedTitle(selectedInfo.event.summary) }, [selectedInfo?.event.id])

  const todayStr = fmtYMD(now)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()

  // Open at the start of the working day rather than midnight. The team starts
  // at 10, so the small hours are dead space that only costs a scroll.
  useEffect(() => {
    if (gridRef.current) gridRef.current.scrollTop = DAY_START_HOUR * 60 * PX_PER_MIN
  }, [])

  if (!token) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--t3)' }}>
        <div style={{ fontSize: 26, opacity: .4 }}>◷</div>
        <div style={{ fontSize: 14 }}>구글 캘린더를 연동하면 타임라인이 열립니다</div>
        <div style={{ fontSize: 12 }}>캘린더 뷰 상단에서 연동해 주세요</div>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Day headers stay put while the hours scroll. */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
        <div style={{ width: GUTTER, flexShrink: 0 }} />
        <Track lead={lead} count={days.length}>
        {days.map(d => {
          const dt = toDate(d)
          const isToday = d === todayStr
          return (
            // The header is the one place in this view that means "the day
            // itself" rather than an hour in it, so it is where placing a task
            // on the day belongs. Dragging the grid below still makes a
            // calendar event, which is a different thing.
            <div
              key={d}
              onClick={e => setPlanning({ date: d, anchor: e.currentTarget })}
              title="이 날에 업무 배치"
              style={{ flex: 1, minWidth: 0, padding: '7px 8px 8px', textAlign: 'center', borderLeft: '1px solid var(--bd)', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{ fontSize: 11, color: isToday ? 'var(--ac)' : 'var(--t3)' }}>
                {['일','월','화','수','목','금','토'][dt.getDay()]}
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 1 }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  minWidth: 24, height: 24, borderRadius: '50%',
                  fontSize: 14, fontWeight: isToday ? 700 : 500,
                  background: isToday ? 'var(--ac)' : 'transparent',
                  color: isToday ? '#fff' : 'var(--t1)',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {dt.getDate()}
                </span>
              </div>

            </div>
          )
        })}
        </Track>
      </div>

      {/* All-day strip: things pinned to the day rather than to a time. */}
      <div style={{
        display: 'flex', flexShrink: 0,
        borderBottom: '1px solid var(--bd2)', background: 'var(--bg2)',
        maxHeight: 112, overflowY: 'auto',
      }}>
        <div style={{ width: GUTTER, flexShrink: 0 }} />
        <Track lead={lead} count={days.length}>
        {days.map(date => (
          <div key={date} style={{ flex: 1, borderLeft: '1px solid var(--bd)', padding: '3px 4px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            {(allDayByDate.get(date) ?? []).map(ev => (
              <a key={ev.id} href={ev.htmlLink || undefined} target="_blank" rel="noopener noreferrer"
                title={ev.summary}
                style={{
                  fontSize: 10, lineHeight: 1.4, padding: '2px 6px', borderRadius: 4,
                  background: tint(ev.calendarColor || '#337EA9', .13),
                  borderLeft: `3px solid ${ev.calendarColor || '#337EA9'}`,
                  color: 'var(--t1)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none',
                }}>
                {ev.summary}
              </a>
            ))}
            {(tasksByDate.get(date) ?? []).map(task => (
              <DueTask
                key={task.id}
                task={task}
                overdue={date < todayStr}
                onToggle={() => updateTask(task.id, { status: task.status === '완료' ? '진행중' : '완료' })}
                onOpen={() => openTaskDetail(task.id)}
              />
            ))}
            {!(allDayByDate.get(date)?.length || tasksByDate.get(date)?.length) && (
              <div style={{ height: 16 }} />
            )}
          </div>
        ))}
        </Track>
      </div>

      {naming && cardAt && (
        <EventCard
          at={cardAt}
          heading={`${hhmm(naming.fromMinutes)} – ${hhmm(naming.toMinutes)}`}
          title={title}
          onTitle={setTitle}
          saving={saving}
          teammates={teammates}
          guests={guests}
          nameOf={getNameByEmail}
          onToggleGuest={email => setGuests(g => g.includes(email) ? g.filter(x => x !== email) : [...g, email])}
          onSave={save}
          onClose={() => { setNaming(null); setTitle(''); setGuests([]) }}
        />
      )}

      {selectedInfo && cardAt && (
        <EventCard
          at={cardAt}
          heading={`${hhmm(selectedInfo.from)} – ${hhmm(selectedInfo.to)}`}
          title={selectedTitle}
          onTitle={setSelectedTitle}
          saving={saving}
          teammates={teammates}
          guests={guests}
          nameOf={getNameByEmail}
          onToggleGuest={email => setGuests(g => g.includes(email) ? g.filter(x => x !== email) : [...g, email])}
          onSave={async () => {
            setSaving(true)
            await updateEvent(selectedInfo.event.id, { summary: selectedTitle.trim() || selectedInfo.event.summary, attendees: guests })
            setSaving(false)
            setSelected(null)
          }}
          onDelete={async () => { await removeEvent(selectedInfo.event.id); setSelected(null) }}
          openLink={selectedInfo.event.htmlLink}
          responses={selectedInfo.event.attendees}
          onClose={() => setSelected(null)}
        />
      )}

      <div ref={gridRef} style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
        <div style={{ display: 'flex', position: 'relative', height: 24 * SLOT_H }}>
          {/* Hour labels */}
          <div style={{ width: GUTTER, flexShrink: 0, position: 'relative' }}>
            {HOURS.map(h => (
              <div key={h} style={{
                position: 'absolute', top: h * SLOT_H - 7, right: 10,
                fontSize: 10, lineHeight: '14px', color: 'var(--t3)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}
              </div>
            ))}
          </div>

          <Track lead={lead} count={days.length} fill>
          {days.map(date => (
            <div
              key={date}
              data-day-column
              onMouseDown={e => beginDrag(e, date)}
              style={{
                flex: 1, minWidth: 0, position: 'relative', cursor: 'crosshair',
                borderLeft: '1px solid var(--bd)',
                background: date === todayStr ? 'rgba(35,131,226,.025)' : 'transparent',
              }}
            >
              {HOURS.map(h => (
                <React.Fragment key={h}>
                  <div style={{ position: 'absolute', top: h * SLOT_H, left: 0, right: 0, height: 1, background: 'var(--bd)' }} />
                  {/* Half-hour guide, faint — it helps aim without ruling the grid. */}
                  <div style={{ position: 'absolute', top: h * SLOT_H + SLOT_H / 2, left: 0, right: 0, height: 1, background: 'var(--bd)', opacity: .4 }} />
                </React.Fragment>
              ))}

              {draft?.date === date && <DraftBlock draft={draft} />}
              {naming?.date === date && <DraftBlock draft={naming} />}

              {place(eventsByDate.get(date) ?? []).map(p => (
                <EventBlock
                  key={p.event.id}
                  placed={p}
                  ghost={ghost?.id === p.event.id ? ghost : null}
                  selected={selected === p.event.id}
                  onSelect={e => {
                    setCardAt({ x: e.clientX, y: e.clientY })
                    setGuests((p.event.attendees ?? []).map(a => a.email).filter(email => email !== myEmail?.toLowerCase()))
                    setSelected(p.event.id)
                  }}
                  onMove={(e, mode) => beginMove(e, p.event, date, p.from, p.to, mode)}
                />
              ))}
              {date === todayStr && (
                <div style={{ position: 'absolute', top: nowMinutes * PX_PER_MIN, left: 0, right: 0, height: 2, background: 'var(--danger)', zIndex: 3 }}>
                  <div style={{ position: 'absolute', left: -4, top: -3, width: 8, height: 8, borderRadius: '50%', background: 'var(--danger)' }} />
                </div>
              )}
            </div>
          ))}
          </Track>
        </div>
      </div>
      {planning && (
        <DayPlanner
          date={planning.date}
          anchor={planning.anchor}
          onClose={() => setPlanning(null)}
        />
      )}
    </div>
  )
}

/**
 * One horizontal strip of day columns, clipped to the frame.
 *
 * The track is wider than the frame by the two buffer days, and sits pulled
 * left by exactly one of them; --slide, written by the scroll gesture, is the
 * remainder of the day currently being crossed. Percentages do the arithmetic,
 * so nothing here has to know how wide a column actually is.
 */
function Track({ lead, count, fill, children }: {
  lead: number; count: number; fill?: boolean; children: React.ReactNode
}) {
  const visible = Math.max(1, count - lead * 2)
  return (
    <div style={{ flex: 1, minWidth: 0, overflowX: 'clip', ...(fill ? { alignSelf: 'stretch' } : null) }}>
      <div style={{
        display: 'flex',
        width: `${(count / visible) * 100}%`,
        height: fill ? '100%' : undefined,
        transform: lead
          ? `translateX(calc(${(-lead / count) * 100}% + var(--slide, 0px)))`
          : undefined,
      }}>
        {children}
      </div>
    </div>
  )
}

/** Where an event sits and how tall it is, from its own start and end. */
function geometry(event: GCalEvent): { from: number; to: number } | null {
  if (!event.startIso) return null
  const start = new Date(event.startIso)
  const end = event.endIso ? new Date(event.endIso) : new Date(start.getTime() + 30 * 60000)
  const from = start.getHours() * 60 + start.getMinutes()
  const rawTo = end.getHours() * 60 + end.getMinutes()
  // An event running past midnight reports an earlier clock time for its end.
  const to = rawTo <= from ? 24 * 60 : rawTo
  return { from, to: Math.max(from + MIN_DURATION, to) }
}

interface Placed {
  event: GCalEvent
  from: number
  to: number
  lane: number
  lanes: number
}

/**
 * Puts overlapping events side by side instead of on top of each other.
 *
 * Two meetings at the same hour is exactly the case this view exists for, so
 * one hiding the other would defeat the point.
 */
function place(events: GCalEvent[]): Placed[] {
  const spans = events
    .map(event => ({ event, ...(geometry(event) ?? { from: -1, to: -1 }) }))
    .filter(s => s.from >= 0)
    .sort((a, b) => a.from - b.from || a.to - b.to)

  const out: Placed[] = []
  let cluster: typeof spans = []
  let clusterEnd = -1

  const flush = () => {
    if (!cluster.length) return
    const laneEnds: number[] = []
    const assigned = cluster.map(span => {
      let lane = laneEnds.findIndex(end => end <= span.from)
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(span.to) }
      else laneEnds[lane] = span.to
      return { ...span, lane }
    })
    assigned.forEach(a => out.push({ ...a, lanes: laneEnds.length }))
    cluster = []
    clusterEnd = -1
  }

  for (const span of spans) {
    if (cluster.length && span.from >= clusterEnd) flush()
    cluster.push(span)
    clusterEnd = Math.max(clusterEnd, span.to)
  }
  flush()
  return out
}

function EventBlock({ placed, ghost, selected, onSelect, onMove }: {
  placed: Placed
  ghost: { from: number; to: number } | null
  selected: boolean
  onSelect: (e: React.MouseEvent) => void
  onMove: (e: React.MouseEvent, mode: 'move' | 'resize') => void
}) {
  const { event, lane, lanes } = placed
  const from = ghost?.from ?? placed.from
  const to = ghost?.to ?? placed.to
  const width = 100 / lanes
  const colour = event.calendarColor || '#337EA9'
  const height = Math.max(18, (to - from) * PX_PER_MIN - 2)
  // Below roughly two lines there is no room to stack the time above the name,
  // so they share one line and the name takes what is left.
  const roomy = height >= 40

  return (
    <div
      onMouseDown={e => onMove(e, 'move')}
      onClick={e => { e.stopPropagation(); onSelect(e) }}
      title={`${hhmm(from)}–${hhmm(to)}  ${event.summary}`}
      style={{
        position: 'absolute',
        top: from * PX_PER_MIN,
        height,
        left: `calc(${lane * width}% + 3px)`,
        width: `calc(${width}% - 6px)`,
        background: tint(colour, ghost ? .28 : .13),
        borderLeft: `3px solid ${colour}`,
        borderRadius: 5,
        boxShadow: selected ? `0 0 0 2px ${colour}` : 'none',
        color: 'var(--t1)',
        padding: roomy ? '3px 6px' : '2px 6px',
        fontSize: 11, lineHeight: 1.35,
        overflow: 'hidden', zIndex: selected ? 5 : 2, cursor: 'grab',
        display: 'flex', flexDirection: roomy ? 'column' : 'row',
        gap: roomy ? 0 : 5, alignItems: roomy ? 'stretch' : 'baseline',
      }}
    >
      <span style={{
        fontSize: 10, color: readable(colour), fontWeight: 600,
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', flexShrink: 0,
      }}>
        {hhmm(from)}
      </span>
      <span style={{
        overflow: 'hidden', textOverflow: 'ellipsis',
        whiteSpace: roomy ? 'normal' : 'nowrap',
        display: roomy ? '-webkit-box' : 'block',
        WebkitLineClamp: roomy ? 2 : undefined,
        WebkitBoxOrient: roomy ? 'vertical' : undefined,
        minWidth: 0,
      }}>
        {event.summary}
      </span>
      <div
        onMouseDown={e => onMove(e, 'resize')}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 8, cursor: 'ns-resize' }}
      />
    </div>
  )
}

/**
 * A task whose deadline lands on this day.
 *
 * Deadlines are not appointments — they belong to the day, not to an hour — so
 * they sit in the all-day strip with a checkbox, the way Google Calendar shows
 * anything due. Ticking it here marks the task complete in the app; there is no
 * calendar entry behind it.
 */
function DueTask({ task, overdue, onToggle, onOpen }: {
  task: Task
  overdue: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  const done = task.status === '완료'
  const late = overdue && !done
  return (
    <div
      onClick={onOpen}
      title={`${task.name}${late ? ' · 기한 지남' : ''}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        fontSize: 10, lineHeight: 1.3, padding: '2px 4px', borderRadius: 3,
        border: '1px solid var(--bd)',
        borderLeft: `3px solid ${late ? 'var(--danger)' : done ? 'var(--bd2)' : 'var(--ac)'}`,
        background: 'var(--bg)', cursor: 'pointer', minWidth: 0,
        opacity: done ? .55 : 1,
      }}
    >
      <button
        onClick={e => { e.stopPropagation(); onToggle() }}
        title={done ? '완료 취소' : '완료로 표시'}
        style={{
          width: 12, height: 12, flexShrink: 0, padding: 0, cursor: 'pointer',
          borderRadius: '50%', border: `1.5px solid ${done ? '#448361' : 'var(--bd2)'}`,
          background: done ? '#448361' : 'transparent', color: '#fff', fontSize: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
        }}
      >{done ? '✓' : ''}</button>
      {task.priority === '높음' && !done && (
        <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--danger)', flexShrink: 0 }} />
      )}
      <span style={{
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        textDecoration: done ? 'line-through' : 'none',
        color: late ? 'var(--danger)' : 'var(--t1)',
      }}>{task.name}</span>
    </div>
  )
}

/** The chip's own height and the gap between rows — so four rows is a number. */
const CHIP_H = 24
const CHIP_GAP = 6

/**
 * Picks who to invite from the people this account shares a project with.
 *
 * Google mails everyone listed the moment the event is saved, so the panel says
 * so rather than letting an invitation go out unannounced.
 */
function AttendeePicker({ teammates, chosen, nameOf, onToggle }: {
  teammates: string[]
  chosen: string[]
  nameOf: (email: string) => string
  onToggle: (email: string) => void
}) {
  if (!teammates.length) {
    return <div style={{ fontSize: 11, color: 'var(--t3)' }}>초대할 팀원이 없습니다</div>
  }
  return (
    <div>
      {/* Whole rows only.
          The box scrolled at a height that was not a multiple of the row pitch,
          so it always ended on a chip sliced through the middle — which reads as
          a broken panel rather than as a list that continues. Fixing the chip's
          height makes the pitch knowable, and the cap is an exact four rows.
          The scrollbar is what says there is more; a half-eaten name is not. */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: CHIP_GAP,
        maxHeight: CHIP_H * 4 + CHIP_GAP * 3, overflowY: 'auto',
      }}>
        {teammates.map(email => {
          const on = chosen.includes(email)
          return (
            <button
              key={email}
              onClick={() => onToggle(email)}
              title={email}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                height: CHIP_H, boxSizing: 'border-box',
                padding: '0 8px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${on ? 'var(--ac)' : 'var(--bd)'}`,
                background: on ? 'var(--ac-l)' : 'transparent',
                color: on ? 'var(--ac)' : 'var(--t2)',
                fontSize: 11, lineHeight: 1, fontFamily: 'var(--font)', whiteSpace: 'nowrap',
              }}
            >
              {on && <span style={{ fontSize: 9 }}>✓</span>}
              {nameOf(email)}
            </button>
          )
        })}
      </div>
      {chosen.length > 0 && (
        <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 6 }}>
          저장하면 {chosen.length}명에게 구글 캘린더 초대장이 발송됩니다.
        </div>
      )}
    </div>
  )
}

/**
 * The floating panel for naming a new block or editing an existing one.
 *
 * It follows the pointer rather than sitting inside the day column: a week's
 * columns are only tens of pixels wide, and the scrolling grid clips anything
 * that overflows one.
 */
function EventCard({
  at, heading, title, onTitle, saving, teammates, guests, nameOf, onToggleGuest,
  onSave, onDelete, onClose, openLink, responses,
}: {
  at: { x: number; y: number }
  heading: string
  title: string
  onTitle: (v: string) => void
  saving: boolean
  teammates: string[]
  guests: string[]
  nameOf: (email: string) => string
  onToggleGuest: (email: string) => void
  onSave: () => void
  onDelete?: () => void
  onClose: () => void
  openLink?: string
  responses?: { email: string; responseStatus?: string }[]
}) {
  const WIDTH = 280
  const MARGIN = 8

  /**
   * The card's height, measured rather than assumed.
   *
   * This used to clamp against a hard-coded 280 — the height of an empty card.
   * With four rows of attendees, a list of replies and the buttons, the real
   * card is closer to 500, so the bottom of it ran past the window and was cut
   * off. It looks like the webview clipping something, and it is not: the same
   * arithmetic cuts it in a browser.
   *
   * Observed rather than measured once, because the content grows after the
   * first paint — chips wrap, replies arrive.
   */
  const cardRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const measure = () => setHeight(el.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const left = Math.min(Math.max(MARGIN, at.x - WIDTH / 2), window.innerWidth - WIDTH - MARGIN)
  // Below the pointer when it fits, pushed up when it does not, and never above
  // the top edge — the last clamp matters on a card taller than the window.
  const top = Math.max(
    MARGIN,
    Math.min(at.y + 8, window.innerHeight - (height || 280) - MARGIN),
  )

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 9600 }} onMouseDown={onClose} />
      <div
        ref={cardRef}
        onMouseDown={e => e.stopPropagation()}
        style={{
          position: 'fixed', left, top, width: WIDTH, zIndex: 9601,
          background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r3)',
          boxShadow: 'var(--sh-lg)', padding: 12,
          // A card with more attendees than the window is tall scrolls itself
          // rather than running off the bottom.
          maxHeight: `calc(100vh - ${MARGIN * 2}px)`,
          overflowY: 'auto', boxSizing: 'border-box',
        }}
      >
        <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 4 }}>{heading}</div>
        <input
          autoFocus
          value={title}
          disabled={saving}
          onChange={e => onTitle(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !isComposing(e)) onSave()
            if (e.key === 'Escape') onClose()
          }}
          placeholder="일정 이름"
          style={{
            width: '100%', padding: '6px 8px', borderRadius: 'var(--r1)',
            border: '1px solid var(--bd)', background: 'var(--bg)',
            fontSize: 13, color: 'var(--t1)', outline: 'none', fontFamily: 'var(--font)',
          }}
        />

        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--t2)', margin: '10px 0 6px' }}>참석자</div>
        <AttendeePicker teammates={teammates} chosen={guests} nameOf={nameOf} onToggle={onToggleGuest} />

        {responses && responses.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 10, color: 'var(--t3)', lineHeight: 1.6 }}>
            {responses.map(a => (
              <div key={a.email}>
                {nameOf(a.email)} · {RESPONSE_LABEL[a.responseStatus ?? 'needsAction'] ?? a.responseStatus}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 12 }}>
          <button onClick={onSave} disabled={saving} style={{ ...navStyle, borderColor: 'var(--ac)', color: '#fff', background: 'var(--ac)' }}>
            {saving ? '저장 중…' : '저장'}
          </button>
          {onDelete && (
            <button onClick={onDelete} style={{ ...navStyle, borderColor: 'rgba(212,76,71,.4)', color: 'var(--danger)' }}>삭제</button>
          )}
          {openLink && (
            <a href={openLink} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--t3)' }}>
              구글에서 열기 ↗
            </a>
          )}
        </div>
      </div>
    </>
  )
}

const RESPONSE_LABEL: Record<string, string> = {
  accepted: '수락',
  declined: '거절',
  tentative: '미정',
  needsAction: '응답 대기',
}

function DraftBlock({ draft }: { draft: Draft }) {
  const height = (draft.toMinutes - draft.fromMinutes) * PX_PER_MIN
  return (
    <div style={{
      position: 'absolute',
      top: draft.fromMinutes * PX_PER_MIN,
      height,
      left: 3, right: 3, borderRadius: 6, zIndex: 7,
      // Opacity on the whole box faded the label along with it; the wash carries
      // the transparency instead so the outline and text stay solid.
      background: 'rgba(35,131,226,.14)',
      border: '1.5px solid var(--ac)',
      boxShadow: '0 1px 4px rgba(35,131,226,.25)',
      padding: '3px 6px', pointerEvents: 'none',
      display: 'flex', flexDirection: 'column', justifyContent: 'flex-start',
      overflow: 'hidden',
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--ac)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {hhmm(draft.fromMinutes)} – {hhmm(draft.toMinutes)}
      </span>
      {height >= 34 && (
        <span style={{ fontSize: 10, color: 'var(--ac)', opacity: .75 }}>
          {draft.toMinutes - draft.fromMinutes}분
        </span>
      )}
    </div>
  )
}

const navStyle: React.CSSProperties = {
  padding: '3px 10px', borderRadius: 'var(--r1)', border: '1px solid var(--bd)',
  background: 'transparent', color: 'var(--t2)', fontSize: 12, cursor: 'pointer',
  fontFamily: 'var(--font)',
}
