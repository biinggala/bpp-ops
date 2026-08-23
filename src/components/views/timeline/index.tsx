import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useGCalStore, awaitingMe, myAttendance } from '../../../store/gcalStore'
import { useUiStore } from '../../../store/uiStore'
import { useFilteredTasks } from '../../../hooks/useFilteredTasks'
import { DayPlanner } from '../calendar/DayPlanner'
import { useTaskStore } from '../../../store/taskStore'
import { useProjectStore } from '../../../store/projectStore'
import { useAuthStore } from '../../../store/authStore'
import { useUserProfileStore } from '../../../store/userProfileStore'
import { authorizedEmails } from '../../../lib/utils'
import type { Task } from '../../../types'
import type { Rsvp } from '../../../lib/googleCalendar'
import { Icon } from '../../shared/Icon'
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
  const { token, events, calendars, createEvent, updateEvent, removeEvent, ensureEvents, respond } = useGCalStore()
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

  /**
   * ── 줄이 안 맞던 이유 ──────────────────────────────────────────────────────
   *
   * The day headers and the hour grid draw the same columns with the same
   * flex rules, and they still did not line up.
   *
   * The grid scrolls; the headers do not. Our scrollbar is a *classic* one
   * (index.css gives it a width), so it takes 6px out of the grid's width and
   * nothing out of the header's — and every column line below sat a few pixels
   * left of the one above it, drifting further across the week.
   *
   * So both scrolling rows always reserve the rail (`scrollbar-gutter: stable`,
   * below), and the header reserves exactly as much by measuring it. Measured
   * rather than hard-coded at 6: the number is a stylesheet's opinion today and
   * the platform's tomorrow.
   */
  const [rail, setRail] = useState(0)
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const measure = () => setRail(el.offsetWidth - el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
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

  /**
   * 고른 일정에서 실제로 고친 게 있는가 — 이름이나 참석자.
   *
   * 참석자는 순서가 다를 수 있으니 정렬해서 비교합니다. 사람을 넣었다 빼면
   * 목록의 순서가 바뀌는데, 그걸 '고쳤다'로 읽으면 저장 버튼이 안 사라집니다.
   */
  const selectedDirty = useMemo(() => {
    if (!selectedInfo) return false
    if (selectedTitle.trim() !== (selectedInfo.event.summary ?? '')) return true
    const was = (selectedInfo.event.attendees ?? [])
      .map(a => a.email)
      .filter(email => email !== myEmail?.toLowerCase())
      .sort()
    const now = [...guests].sort()
    return was.length !== now.length || was.some((email, i) => email !== now[i])
  }, [selectedInfo, selectedTitle, guests, myEmail])

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
        <div style={{ width: rail, flexShrink: 0 }} />
      </div>

      {/* All-day strip: things pinned to the day rather than to a time. */}
      <div style={{
        display: 'flex', flexShrink: 0,
        borderBottom: '1px solid var(--bd2)', background: 'var(--bg2)',
        maxHeight: 112, overflowY: 'scroll', scrollbarGutter: 'stable',
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
                  ...(awaitingMe(ev)
                    ? {
                        background: 'transparent',
                        border: `1.5px dashed ${ev.calendarColor || '#337EA9'}`,
                        boxSizing: 'border-box' as const,
                      }
                    : {
                        background: tint(ev.calendarColor || '#337EA9', .13),
                        borderLeft: `3px solid ${ev.calendarColor || '#337EA9'}`,
                      }),
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
          dirty={selectedDirty}
          /* 주최자에게는 안 묻습니다 — myAttendance 참고. 응답 값이 아예
             없는 초대는 '아직 안 함'입니다. 없다고 버튼을 감추면 답할
             방법이 사라집니다. */
          myResponse={(() => {
            const me = myAttendance(selectedInfo.event)
            return me ? (me.responseStatus ?? 'needsAction') : undefined
          })()}
          onRespond={r => { void respond(selectedInfo.event.id, r) }}
          onClose={() => setSelected(null)}
        />
      )}

      <div ref={gridRef} style={{ flex: 1, overflowY: 'scroll', scrollbarGutter: 'stable', position: 'relative' }}>
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
  // 아직 수락 안 한 초대는 면을 안 칠합니다 — 확정된 것만 칠해져 있어야
  // 오늘이 실제로 얼마나 찼는지 보입니다. awaitingMe 참고.
  const pending = awaitingMe(event)
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
        background: pending ? 'transparent' : tint(colour, ghost ? .28 : .13),
        // 왼쪽 굵은 선은 '이 캘린더의 확정된 일정'이라는 표시입니다. 점선
        // 테두리가 그 자리를 대신하므로 둘을 같이 쓰지 않습니다.
        ...(pending
          ? { border: `1.5px dashed ${colour}`, boxSizing: 'border-box' as const }
          : { borderLeft: `3px solid ${colour}` }),
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

/**
 * ── 참석자 ───────────────────────────────────────────────────────────────────
 *
 * 예전에는 팀원 **전원**을 동그란 칩으로 늘어놓고 고르게 했습니다. 열다섯 명일
 * 때도 벽이었는데 우리는 쉰 명입니다 — 그러면 일정 하나 만드는 데 필요한
 * 이름 두 개를 마흔여덟 개 사이에서 찾아야 합니다. 게다가 이미 초대된
 * 사람들의 응답('수락', '대기')은 카드 저 아래 따로 적혀 있어서, 같은 사람이
 * 화면의 두 군데에 다른 모습으로 있었습니다.
 *
 * 그래서 뒤집었습니다. **초대된 사람만 목록으로** 보이고, 응답은 그 사람 이름
 * 왼쪽에 붙습니다. 추가는 밑의 '초대할 사람'을 눌러 이름을 쳐서 합니다.
 * 화면에 있는 이름 수가 쉰이 아니라 실제 참석자 수만큼입니다.
 *
 * 저장하는 순간 구글이 메일을 보내므로, 아직 발송되지 않은 사람이 몇 명인지
 * 미리 말해 둡니다. 초대장이 조용히 나가면 안 됩니다.
 */

const ROW_H = 26

/** 응답을 한 글자로. 색이 안 보여도 모양이 다릅니다. */
const RESPONSE_MARK: Record<string, { glyph: string; color: string; label: string }> = {
  accepted:    { glyph: '✓', color: '#448361',      label: '수락' },
  declined:    { glyph: '✕', color: 'var(--danger)', label: '거절' },
  tentative:   { glyph: '~', color: '#D9730D',      label: '미정' },
  needsAction: { glyph: '?', color: 'var(--t3)',    label: '응답 대기' },
}

function AttendeeList({ teammates, chosen, nameOf, onToggle, responses }: {
  teammates: string[]
  chosen: string[]
  nameOf: (email: string) => string
  onToggle: (email: string) => void
  responses?: { email: string; responseStatus?: string }[]
}) {
  const [adding, setAdding] = useState(false)
  const [q, setQ] = useState('')
  const [pick, setPick] = useState(0)

  const answered = new Map((responses ?? []).map(r => [r.email, r.responseStatus ?? 'needsAction']))
  // 목록에 있지만 아직 구글이 모르는 사람 = 이번에 저장하면 초대장이 갈 사람.
  const fresh = chosen.filter(e => !answered.has(e))

  const needle = q.trim().toLowerCase()
  const candidates = teammates.filter(email =>
    !chosen.includes(email) &&
    (!needle || nameOf(email).toLowerCase().includes(needle) || email.toLowerCase().includes(needle)),
  )

  useEffect(() => { setPick(0) }, [q])

  const add = (email: string | undefined) => {
    if (!email) return
    onToggle(email)
    // 창을 닫지 않습니다 — 회의에 한 명만 부르는 경우는 드뭅니다.
    setQ('')
    setPick(0)
  }

  return (
    <div>
      {chosen.length === 0 && !adding && (
        <div style={{ fontSize: 11, color: 'var(--t3)', padding: '2px 0 4px' }}>아직 아무도 없습니다</div>
      )}

      {chosen.map(email => {
        const mark = RESPONSE_MARK[answered.get(email) ?? ''] ?? null
        return (
          <AttendeeRow
            key={email}
            name={nameOf(email)}
            email={email}
            mark={mark}
            onRemove={() => onToggle(email)}
          />
        )
      })}

      {adding ? (
        <div style={{ marginTop: 4 }}>
          <input
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (isComposing(e)) return
              if (e.key === 'Escape') { e.stopPropagation(); setQ(''); setAdding(false) }
              if (e.key === 'ArrowDown') { e.preventDefault(); setPick(p => Math.min(p + 1, candidates.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setPick(p => Math.max(p - 1, 0)) }
              // 카드 전체의 Enter는 '저장'입니다. 이름을 고르는 중에는 여기서 멈춰야 합니다.
              if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); add(candidates[pick]) }
            }}
            placeholder="이름으로 찾기"
            style={{
              width: '100%', boxSizing: 'border-box', padding: '5px 8px',
              borderRadius: 'var(--r1)', border: '1px solid var(--bd)',
              background: 'var(--bg2)', color: 'var(--t1)', fontSize: 12,
              outline: 'none', fontFamily: 'var(--font)',
            }}
          />
          {/* 여섯 줄까지. 더 있으면 스크롤이 그렇다고 말합니다 — 이름을 더
              치면 좁혀진다는 것도 같이. */}
          <div style={{ maxHeight: ROW_H * 6, overflowY: 'auto', marginTop: 4 }}>
            {candidates.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--t3)', padding: '4px 2px' }}>
                {teammates.length ? '찾는 사람이 없습니다' : '초대할 팀원이 없습니다'}
              </div>
            )}
            {candidates.map((email, i) => (
              <div
                key={email}
                onMouseEnter={() => setPick(i)}
                onMouseDown={e => { e.preventDefault(); add(email) }}
                title={email}
                style={{
                  display: 'flex', alignItems: 'center', height: ROW_H, padding: '0 6px',
                  borderRadius: 'var(--r1)', cursor: 'pointer', fontSize: 12,
                  color: 'var(--t1)', background: i === pick ? 'var(--bg3)' : 'transparent',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >{nameOf(email)}</div>
            ))}
          </div>
          <button
            onClick={() => { setQ(''); setAdding(false) }}
            style={{ ...linkBtn, marginTop: 2 }}
          >닫기</button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, height: ROW_H, padding: '0 4px',
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--ac)', fontSize: 12, fontFamily: 'var(--font)',
          }}
        >
          <span style={{ fontSize: 13, lineHeight: 1 }}>＋</span>
          초대할 사람
        </button>
      )}

      {fresh.length > 0 && (
        <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 6, lineHeight: 1.5 }}>
          저장하면 {fresh.length}명에게 구글 캘린더 초대장이 발송됩니다.
        </div>
      )}
    </div>
  )
}

function AttendeeRow({ name, email, mark, onRemove }: {
  name: string
  email: string
  mark: { glyph: string; color: string; label: string } | null
  onRemove: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={mark ? `${email} · ${mark.label}` : `${email} · 초대 예정`}
      style={{
        display: 'flex', alignItems: 'center', gap: 7, height: ROW_H, padding: '0 4px',
        borderRadius: 'var(--r1)', background: hovered ? 'var(--bg3)' : 'transparent',
      }}
    >
      {/* 아직 초대 안 나간 사람은 빈 동그라미. 응답이 없는 것과 물어본 적이
          없는 것은 다른 상태입니다. */}
      <span style={{
        width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: `1px solid ${mark ? mark.color : 'var(--bd2)'}`,
        color: mark ? mark.color : 'transparent', fontSize: 9, lineHeight: 1,
      }}>{mark?.glyph ?? ''}</span>
      <span style={{
        flex: 1, minWidth: 0, fontSize: 12, color: 'var(--t1)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{name}</span>
      <button
        onClick={onRemove}
        aria-label={`${name} 빼기`}
        style={{
          flexShrink: 0, background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--t3)', fontSize: 13, lineHeight: 1, padding: '0 2px',
          opacity: hovered ? 1 : 0, fontFamily: 'var(--font)',
        }}
      >×</button>
    </div>
  )
}

const linkBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--t3)', fontSize: 11, padding: '2px 4px', fontFamily: 'var(--font)',
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
  onSave, onDelete, onClose, openLink, responses, myResponse, onRespond, dirty = true,
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
  /** 내 응답. 초대받은 일정에만 있습니다 — 내가 만든 것에는 답할 게 없습니다. */
  myResponse?: string
  onRespond?: (response: Rsvp) => void
  /**
   * 고친 게 있는가.
   *
   * 아무것도 안 고쳤는데 '저장'이 놓여 있으면, 그 버튼이 무엇을 저장하는지
   * 알 수가 없습니다 — 누르면 뭔가 일어날 것 같아서 안 누르게 되고, 그 자리는
   * 계속 신경 쓰이는 자리로 남습니다. 새 일정은 늘 저장할 게 있으므로 기본이
   * 참입니다.
   */
  dirty?: boolean
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--t3)' }}>{heading}</span>
          {/* 삭제는 여기 들어갑니다. 아래에 빨간 버튼으로 놓여 있으면 '저장'
              옆에 나란히 앉아서, 자주 하는 일과 되돌릴 수 없는 일이 같은
              크기로 같은 줄에 있게 됩니다. */}
          {onDelete && <CardMenu onDelete={onDelete} />}
        </div>
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

        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--t2)', margin: '10px 0 4px' }}>참석자</div>
        {/* 응답도 여기 있습니다. 예전에는 카드 아래에 '김하연 · 수락'이 따로
            적혀 있어서 같은 사람이 화면 두 군데에 다른 모습으로 있었습니다. */}
        <AttendeeList
          teammates={teammates} chosen={guests} nameOf={nameOf}
          onToggle={onToggleGuest} responses={responses}
        />

        {onRespond && myResponse && (
          <RsvpRow current={myResponse} onRespond={onRespond} />
        )}

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 12, minHeight: 24 }}>
          {dirty && (
            <button onClick={onSave} disabled={saving} style={{ ...navStyle, borderColor: 'var(--ac)', color: '#fff', background: 'var(--ac)' }}>
              {saving ? '저장 중…' : '저장'}
            </button>
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

/**
 * 카드의 ⋯ — 지금은 삭제 하나뿐입니다.
 *
 * 하나짜리 메뉴가 과해 보이지만, 이 하나가 **되돌릴 수 없는 일**입니다. 자주
 * 누르는 것과 한 번 누르면 끝인 것이 같은 줄에 같은 크기로 있으면 언젠가
 * 잘못 누릅니다. 한 겹 뒤에 두면 그 실수가 안 일어납니다.
 */
function CardMenu({ onDelete }: { onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  /**
   * 바깥을 누르면 닫힙니다 — **잡는 단계(capture)로** 듣습니다.
   *
   * 처음엔 평범하게 document에 걸었는데 안 닫혔습니다. 카드가 자기
   * mousedown에 stopPropagation을 걸고 있기 때문입니다 — 카드 안을 눌렀을
   * 때 뒤의 덮개가 카드를 닫아 버리지 않게 하려고요. 그 덕에 카드 안에서
   * 일어난 mousedown은 document까지 못 올라오고, document에 걸어 둔 귀는
   * 아무것도 못 듣습니다. 이벤트가 안 온 게 아니라 막힌 것인데, 코드에서는
   * 둘이 똑같아 보입니다.
   *
   * 잡는 단계는 document에서 대상으로 **내려가는** 길이라 아래에서 무엇을
   * 막든 먼저 지나갑니다. 제목 칸을 눌러도, 참석자를 눌러도 닫힙니다.
   */
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    // 이 메뉴를 연 클릭이 곧바로 닫지 않도록 다음 클릭부터.
    const t = setTimeout(() => document.addEventListener('mousedown', away, true), 0)
    document.addEventListener('keydown', key)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', away, true)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  return (
    <div ref={box} style={{ marginLeft: 'auto', position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="더 보기"
        style={{
          width: 22, height: 22, borderRadius: 'var(--r1)', border: 'none', padding: 0,
          cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 13, lineHeight: 1,
          background: open ? 'var(--bg3)' : 'transparent', color: 'var(--t3)',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
        onMouseLeave={e => (e.currentTarget.style.background = open ? 'var(--bg3)' : 'transparent')}
      >⋯</button>
      {open && (
        <div style={{
          position: 'absolute', top: 24, right: 0, minWidth: 132, zIndex: 10,
          background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r2)',
          boxShadow: 'var(--sh-md)', padding: 4,
        }}>
          <button
            onClick={() => { setOpen(false); onDelete() }}
            style={{
              display: 'flex', alignItems: 'center', gap: 7, width: '100%',
              padding: '5px 8px', borderRadius: 'var(--r1)', border: 'none',
              background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font)',
              fontSize: 12.5, color: 'var(--danger)', textAlign: 'left',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--danger-l)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <Icon name="trash" size={13} />
            일정 삭제
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * ── 갈 건가 ──────────────────────────────────────────────────────────────────
 *
 * 초대만 받아 놓은 일정은 점선으로 그려 두었는데, 그것만으로는 절반입니다 —
 * 점선을 보고 나서 답하려면 앱을 나가 구글로 가야 했습니다. 그 화면에서 하는
 * 일이 '오늘 뭘 할지 정하는 것'인데 정하는 버튼이 딴 데 있었던 겁니다.
 *
 * 세 개를 다 놓습니다. 수락만 놓으면 안 가는 회의를 거절할 데가 없어서 점선이
 * 영원히 남고, 그러면 점선이 '아직 안 정함'이 아니라 '무시하는 것'이 됩니다.
 *
 * **답한 뒤에도 셋이 남지만, 조용해집니다.** 답을 바꾸는 일은 자주 있습니다 —
 * 일정이 겹쳐서 못 가게 되면요 — 그래서 없애면 구글까지 나가야 합니다. 다만
 * 셋이 똑같은 크기로 똑같이 강조돼 있으면 이미 답했는데도 계속 묻고 있는
 * 것처럼 보입니다. 그래서 정하기 전에는 질문의 모양(큰 버튼 셋, '초대받았
 * 습니다')이고, 정한 뒤에는 상태의 모양(작은 한 줄, 고른 것만 표시)입니다.
 * 있는 것은 같고 목소리만 다릅니다.
 */
function RsvpRow({ current, onRespond }: { current: string; onRespond: (r: Rsvp) => void }) {
  /**
   * `soft`를 따로 두는 이유: `--danger`는 밝은 화면과 어두운 화면에서 값이
   * 다릅니다. tint()에 넣으면 hex가 아니라서 회색으로 떨어집니다 — 거절만
   * 색을 잃습니다. 빨강은 이미 있는 --danger-l을 씁니다.
   */
  const options: { value: Rsvp; label: string; tone: string; soft: string }[] = [
    { value: 'accepted',  label: '수락', tone: '#448361',      soft: tint('#448361', .16) },
    { value: 'tentative', label: '미정', tone: '#D9730D',      soft: tint('#D9730D', .16) },
    { value: 'declined',  label: '거절', tone: 'var(--danger)', soft: 'var(--danger-l)' },
  ]
  const undecided = current === 'needsAction'

  if (undecided) {
    return (
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--bd)' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--t2)', marginBottom: 6 }}>
          초대받았습니다
        </div>
        <div style={{ display: 'flex', gap: 5 }}>
          {options.map(o => (
            <button
              key={o.value}
              onClick={() => onRespond(o.value)}
              style={{
                flex: 1, padding: '5px 0', borderRadius: 'var(--r1)', cursor: 'pointer',
                fontFamily: 'var(--font)', fontSize: 12,
                border: `1px solid ${o.value === 'accepted' ? o.tone : 'var(--bd)'}`,
                background: o.value === 'accepted' ? o.tone : 'transparent',
                color: o.value === 'accepted' ? '#fff' : 'var(--t2)',
                fontWeight: o.value === 'accepted' ? 600 : 400,
              }}
            >{o.label}</button>
          ))}
        </div>
      </div>
    )
  }

  // 정한 뒤 — 한 줄. 고른 것만 색을 갖고, 나머지는 눌릴 수 있다는 것만 보입니다.
  return (
    <div style={{
      marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--bd)',
      display: 'flex', alignItems: 'center', gap: 6,
    }}>
      <span style={{ fontSize: 11, color: 'var(--t3)', flexShrink: 0 }}>내 응답</span>
      <div style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
        {options.map(o => {
          const on = current === o.value
          return (
            <button
              key={o.value}
              onClick={() => onRespond(o.value)}
              style={{
                padding: '2px 8px', borderRadius: 'var(--r1)', border: 'none', cursor: 'pointer',
                fontFamily: 'var(--font)', fontSize: 11.5,
                fontWeight: on ? 600 : 400,
                background: on ? o.soft : 'transparent',
                color: on ? o.tone : 'var(--t3)',
              }}
              onMouseEnter={e => { if (!on) e.currentTarget.style.background = 'var(--bg3)' }}
              onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent' }}
            >{o.label}</button>
          )
        })}
      </div>
    </div>
  )
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
