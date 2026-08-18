import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useGCalStore } from '../../../store/gcalStore'
import { useUiStore } from '../../../store/uiStore'
import { useFilteredTasks } from '../../../hooks/useFilteredTasks'
import { addDays, toDate, fmtYMD, isComposing } from '../../../lib/utils'
import { writableCalendars } from '../../../lib/googleCalendar'
import type { GCalEvent } from '../../../store/gcalStore'

/**
 * Day and week timeline.
 *
 * Dragging across empty grid creates a Google Calendar event, following the
 * gesture people already know from Google Calendar: drag from the start time to
 * the end time, then name it. Meetings booked here are for the team to see at a
 * glance — nobody outside is invited, so there are no attendees involved.
 */

const SLOT_H = 48          // px per hour
const PX_PER_MIN = SLOT_H / 60
const SNAP = 15            // minutes
const MIN_DURATION = 15
const GUTTER = 52          // width of the hour labels
const HOURS = Array.from({ length: 24 }, (_, i) => i)

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

export function TimelineView() {
  const { timelineDays, timelineAnchor, setTimelineAnchor } = useUiStore()
  const { token, events, calendars, targetCalendarId, canWrite, createEvent, fetchEvents, setTargetCalendar } = useGCalStore()
  const tasks = useFilteredTasks()

  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const days = useMemo(() => {
    const start = toDate(timelineAnchor)
    return Array.from({ length: timelineDays }, (_, i) => fmtYMD(addDays(start, i)))
  }, [timelineAnchor, timelineDays])

  useEffect(() => {
    if (!token) return
    fetchEvents(days[0], days[days.length - 1])
  }, [token, days[0], days[days.length - 1]])

  // ── Drag to create ────────────────────────────────────────────────────────
  const [draft, setDraft] = useState<Draft | null>(null)
  const [naming, setNaming] = useState<Draft | null>(null)
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const dragging = useRef<{ date: string; anchorMinutes: number } | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  const minutesAt = (clientY: number, column: HTMLElement): number => {
    const rect = column.getBoundingClientRect()
    return clampDay(snap((clientY - rect.top) / PX_PER_MIN))
  }

  const beginDrag = (e: React.MouseEvent<HTMLDivElement>, date: string) => {
    if (e.button !== 0 || naming) return
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
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      dragging.current = null
      setDraft(current => { if (current) { setNaming(current); setTitle('') } return null })
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
    })
    setSaving(false)
    if (ok) { setNaming(null); setTitle('') }
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
    const map = new Map<string, number>()
    for (const t of tasks) { if (t.due) map.set(t.due, (map.get(t.due) ?? 0) + 1) }
    return map
  }, [tasks])

  const todayStr = fmtYMD(now)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()

  // Scroll to the working day rather than midnight.
  useEffect(() => {
    if (gridRef.current) gridRef.current.scrollTop = Math.max(0, (8 * 60) * PX_PER_MIN - 40)
  }, [])

  const writable = writableCalendars(calendars)
  const target = targetCalendarId ?? calendars.find(c => c.primary)?.id ?? writable[0]?.id ?? ''

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
      <TimelineBar
        days={days}
        count={timelineDays}
        onShift={n => setTimelineAnchor(fmtYMD(addDays(toDate(timelineAnchor), n)))}
        onToday={() => setTimelineAnchor(todayStr)}
        calendars={writable}
        target={target}
        onTarget={setTargetCalendar}
        canWrite={canWrite}
      />

      {/* Day headers stay put while the hours scroll. */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--bd)', paddingLeft: GUTTER, flexShrink: 0 }}>
        {days.map(d => {
          const dt = toDate(d)
          const isToday = d === todayStr
          const count = tasksByDate.get(d) ?? 0
          return (
            <div key={d} style={{ flex: 1, padding: '6px 8px', textAlign: 'center', borderLeft: '1px solid var(--bd)' }}>
              <div style={{ fontSize: 11, color: isToday ? 'var(--ac)' : 'var(--t3)' }}>
                {['일','월','화','수','목','금','토'][dt.getDay()]}
              </div>
              <div style={{ fontSize: 15, fontWeight: isToday ? 700 : 500, color: isToday ? 'var(--ac)' : 'var(--t1)' }}>
                {dt.getDate()}
              </div>
              {count > 0 && (
                <div style={{ fontSize: 10, color: 'var(--t3)' }}>마감 {count}</div>
              )}
            </div>
          )
        })}
      </div>

      <div ref={gridRef} style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
        <div style={{ display: 'flex', position: 'relative', height: 24 * SLOT_H }}>
          {/* Hour labels */}
          <div style={{ width: GUTTER, flexShrink: 0, position: 'relative' }}>
            {HOURS.map(h => (
              <div key={h} style={{ position: 'absolute', top: h * SLOT_H - 6, right: 8, fontSize: 10, color: 'var(--t3)' }}>
                {h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}
              </div>
            ))}
          </div>

          {days.map(date => (
            <div
              key={date}
              onMouseDown={e => beginDrag(e, date)}
              style={{ flex: 1, position: 'relative', borderLeft: '1px solid var(--bd)', cursor: 'crosshair' }}
            >
              {HOURS.map(h => (
                <div key={h} style={{ position: 'absolute', top: h * SLOT_H, left: 0, right: 0, height: 1, background: 'var(--bd)', opacity: .6 }} />
              ))}

              {place(eventsByDate.get(date) ?? []).map(p => <EventBlock key={p.event.id} placed={p} />)}

              {draft?.date === date && <DraftBlock draft={draft} />}
              {naming?.date === date && (
                <NamingBlock
                  draft={naming}
                  title={title}
                  saving={saving}
                  onTitle={setTitle}
                  onSave={save}
                  onCancel={() => { setNaming(null); setTitle('') }}
                />
              )}

              {date === todayStr && (
                <div style={{ position: 'absolute', top: nowMinutes * PX_PER_MIN, left: 0, right: 0, height: 2, background: '#ef4444', zIndex: 3 }}>
                  <div style={{ position: 'absolute', left: -4, top: -3, width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }} />
                </div>
              )}
            </div>
          ))}
        </div>
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

function EventBlock({ placed }: { placed: Placed }) {
  const { event, from, to, lane, lanes } = placed
  const width = 100 / lanes
  const colour = event.calendarColor || '#4285f4'
  return (
    <a
      href={event.htmlLink || undefined}
      target="_blank"
      rel="noopener noreferrer"
      onMouseDown={e => e.stopPropagation()}
      title={`${hhmm(from)}–${hhmm(to)}  ${event.summary}`}
      style={{
        position: 'absolute',
        top: from * PX_PER_MIN,
        height: Math.max(16, (to - from) * PX_PER_MIN - 2),
        left: `calc(${lane * width}% + 3px)`,
        width: `calc(${width}% - 6px)`,
        background: colour, opacity: .92, color: '#fff',
        borderRadius: 4, padding: '2px 5px', fontSize: 11, lineHeight: 1.25,
        overflow: 'hidden', textDecoration: 'none', zIndex: 2,
      }}
    >
      <span style={{ opacity: .85, marginRight: 4 }}>{hhmm(from)}</span>
      {event.summary}
    </a>
  )
}

function DraftBlock({ draft }: { draft: Draft }) {
  return (
    <div style={{
      position: 'absolute',
      top: draft.fromMinutes * PX_PER_MIN,
      height: (draft.toMinutes - draft.fromMinutes) * PX_PER_MIN,
      left: 3, right: 3, borderRadius: 4, zIndex: 4,
      background: 'var(--ac)', opacity: .35,
      border: '1px solid var(--ac)',
      display: 'flex', alignItems: 'flex-start', padding: '2px 5px',
      fontSize: 11, color: '#fff', pointerEvents: 'none',
    }}>
      {hhmm(draft.fromMinutes)} – {hhmm(draft.toMinutes)}
    </div>
  )
}

function NamingBlock({ draft, title, saving, onTitle, onSave, onCancel }: {
  draft: Draft
  title: string
  saving: boolean
  onTitle: (v: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: draft.fromMinutes * PX_PER_MIN,
        minHeight: (draft.toMinutes - draft.fromMinutes) * PX_PER_MIN,
        left: 3, right: 3, zIndex: 6,
        background: 'var(--bg)', border: '2px solid var(--ac)', borderRadius: 4,
        boxShadow: 'var(--sh-md)', padding: 4,
      }}
    >
      <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 2 }}>
        {hhmm(draft.fromMinutes)} – {hhmm(draft.toMinutes)}
      </div>
      <input
        autoFocus
        value={title}
        disabled={saving}
        onChange={e => onTitle(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !isComposing(e)) onSave()
          if (e.key === 'Escape') onCancel()
        }}
        onBlur={onCancel}
        placeholder="일정 이름"
        style={{
          width: '100%', border: 'none', outline: 'none', background: 'transparent',
          fontSize: 12, color: 'var(--t1)', fontFamily: 'var(--font)',
        }}
      />
    </div>
  )
}

function TimelineBar({ days, count, onShift, onToday, calendars, target, onTarget, canWrite }: {
  days: string[]
  count: number
  onShift: (n: number) => void
  onToday: () => void
  calendars: { id: string; summary: string }[]
  target: string
  onTarget: (id: string) => void
  canWrite: boolean
}) {
  const setDays = useUiStore(s => s.setTimelineDays)
  const first = toDate(days[0])
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderBottom: '1px solid var(--bd)', flexShrink: 0, flexWrap: 'wrap' }}>
      <button onClick={() => onShift(-count)} style={navStyle}>‹</button>
      <button onClick={onToday} style={navStyle}>오늘</button>
      <button onClick={() => onShift(count)} style={navStyle}>›</button>
      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)', marginLeft: 4 }}>
        {first.getFullYear()}. {first.getMonth() + 1}
      </span>

      <div style={{ display: 'flex', gap: 2, marginLeft: 8 }}>
        {[1, 3, 7].map(n => (
          <button key={n} onClick={() => setDays(n)} style={{ ...navStyle, borderColor: n === count ? 'var(--ac)' : 'var(--bd)', color: n === count ? 'var(--ac)' : 'var(--t2)' }}>
            {n === 1 ? '일간' : n === 3 ? '3일' : '주간'}
          </button>
        ))}
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--t3)' }}>새 일정을 넣을 캘린더</span>
        <select
          value={target}
          onChange={e => onTarget(e.target.value)}
          style={{ padding: '3px 6px', borderRadius: 'var(--r1)', border: '1px solid var(--bd)', background: 'transparent', fontSize: 12, color: 'var(--t2)', fontFamily: 'var(--font)', maxWidth: 200 }}
        >
          {calendars.length === 0 && <option value="">쓸 수 있는 캘린더 없음</option>}
          {calendars.map(c => <option key={c.id} value={c.id}>{c.summary}</option>)}
        </select>
        {!canWrite && (
          <span style={{ fontSize: 11, color: 'var(--t3)' }} title="처음 일정을 만들 때 구글 권한을 한 번 더 요청합니다">
            첫 생성 시 권한 요청
          </span>
        )}
      </div>
    </div>
  )
}

const navStyle: React.CSSProperties = {
  padding: '3px 10px', borderRadius: 'var(--r1)', border: '1px solid var(--bd)',
  background: 'transparent', color: 'var(--t2)', fontSize: 12, cursor: 'pointer',
  fontFamily: 'var(--font)',
}
