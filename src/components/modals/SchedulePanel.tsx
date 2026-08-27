import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGCalStore, type GCalEvent } from '../../store/gcalStore'
import { useAuthStore } from '../../store/authStore'
import { ActionMenu } from '../shared/ContextMenu'
import { openExternal } from '../../lib/desktopLinks'
import { isComposing, parseAssignees } from '../../lib/utils'
import { NOTION } from '../../types'
import type { Task } from '../../types'
import { DayTimeGrid, hhmm, localIso, durationLabel, minutesOfIso } from '../shared/DayTimeGrid'

/**
 * ── The events a task is made of ─────────────────────────────────────────────
 *
 * "스태프 모집" is one row in the list and fourteen interviews in a calendar.
 * This is where the fourteen are tied to the one — created from here so Google
 * sends the invitations, or attached after the fact because the interview was
 * agreed in a mail thread.
 *
 * Both ways in used to be a form: two dropdowns for the time, a text box for
 * the search. Both asked a question the answer to which was on the calendar the
 * whole time — *is 2pm free*, *which interview do I mean* — and neither showed
 * the calendar. So both now start from the same week strip: pick a day, then
 * either drag a slot in that day's hours (with everything already booked drawn
 * behind you) or click one of the events already sitting there.
 *
 * The days come out of the window the calendar views already hold in memory, so
 * moving between weeks costs nothing until you leave that window.
 *
 * What is shown is what *this person's* calendars hold. The link lives on the
 * event in Google, so a teammate who cannot see that calendar does not see the
 * event here either — the same rule the calendar itself follows, rather than a
 * copy of everyone's appointments kept in our database.
 */

const DOW = ['일', '월', '화', '수', '목', '금', '토']


function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function shift(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return ymd(d)
}
/** Sunday of the week `date` falls in — the calendar view starts weeks there too. */
function weekStartOf(date: string): string {
  const d = new Date(date + 'T00:00:00')
  return shift(date, -d.getDay())
}
function whenLabel(ev: GCalEvent): string {
  const d = new Date((ev.startIso ?? `${ev.start}T00:00:00`).slice(0, 19))
  const head = `${d.getMonth() + 1}/${d.getDate()} (${DOW[d.getDay()]})`
  if (ev.allDay) return `${head} 종일`
  return `${head} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const CHIP: React.CSSProperties = {
  padding: '3px 9px', fontSize: 12, borderRadius: 999, cursor: 'pointer',
  border: '1px solid var(--bd)', background: 'transparent', color: 'var(--t2)',
  fontFamily: 'var(--font)', whiteSpace: 'nowrap',
}
const FIELD: React.CSSProperties = {
  border: '1px solid var(--bd)', borderRadius: 'var(--r1)', background: 'var(--bg)',
  color: 'var(--t1)', fontFamily: 'var(--font)', fontSize: 13, padding: '4px 7px', outline: 'none',
}

export function SchedulePanel({ task, memberEmails }: {
  task: Task
  /** The project's people — who an interview is likely to be with. */
  memberEmails: string[]
}) {
  const wasConnected = useGCalStore(s => s.wasConnected)
  const windowEvents = useGCalStore(s => s.events)
  const ensureEvents = useGCalStore(s => s.ensureEvents)
  const eventsForTask = useGCalStore(s => s.eventsForTask)
  const setEventTask = useGCalStore(s => s.setEventTask)
  const createEvent = useGCalStore(s => s.createEvent)
  const myEmail = useAuthStore(s => s.email)

  const [events, setEvents] = useState<GCalEvent[] | null>(null)
  const [adding, setAdding] = useState<null | 'new' | 'link'>(null)
  const [busy, setBusy] = useState(false)

  // The week opens on the task's deadline — the day the work is actually being
  // arranged around — and falls back to this week when it has none.
  const [day, setDay] = useState(() => task.due || ymd(new Date()))
  const [weekStart, setWeekStart] = useState(() => weekStartOf(task.due || ymd(new Date())))

  const candidates = useMemo(() => {
    const set = new Set<string>([...memberEmails, ...parseAssignees(task.assignee)])
    if (myEmail) set.delete(myEmail)
    return Array.from(set).filter(e => e.includes('@'))
  }, [memberEmails, task.assignee, myEmail])

  const reload = useCallback(async () => {
    if (!wasConnected) { setEvents([]); return }
    setEvents(await eventsForTask(task.id))
  }, [wasConnected, eventsForTask, task.id])

  useEffect(() => { void reload() }, [reload])

  // Whatever week is on screen has to be loaded for its events to be drawn.
  useEffect(() => {
    if (!wasConnected || !adding) return
    void ensureEvents(weekStart, shift(weekStart, 6))
  }, [wasConnected, adding, weekStart, ensureEvents])

  const byDay = useMemo(() => {
    const m = new Map<string, GCalEvent[]>()
    for (const ev of windowEvents) {
      const list = m.get(ev.start)
      if (list) list.push(ev)
      else m.set(ev.start, [ev])
    }
    for (const list of m.values()) {
      list.sort((a, b) => (a.startIso ?? a.start).localeCompare(b.startIso ?? b.start))
    }
    return m
  }, [windowEvents])

  const upcoming = useMemo(() => {
    const now = new Date().toISOString().slice(0, 19)
    return (events ?? []).filter(e => (e.startIso ?? `${e.start}T23:59:59`) >= now)
  }, [events])

  const detach = async (ev: GCalEvent) => {
    setBusy(true)
    const ok = await setEventTask(ev.id, null)
    setBusy(false)
    if (ok) setEvents(prev => (prev ?? []).filter(e => e.id !== ev.id))
  }

  const openAdd = (mode: 'new' | 'link') => {
    const start = task.due || ymd(new Date())
    setDay(start)
    setWeekStart(weekStartOf(start))
    setAdding(mode)
  }

  const goWeek = (delta: number) => {
    const next = shift(weekStart, delta * 7)
    setWeekStart(next)
    // Keep the same weekday selected, so paging feels like moving the whole week.
    setDay(shift(day, delta * 7))
  }

  return (
    <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 12, marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
          일정{(events?.length ?? 0) > 0 ? ` ${events!.length}` : ''}
        </span>
        {wasConnected && (
          <button
            onClick={() => (adding ? setAdding(null) : openAdd('new'))}
            title={adding ? '닫기' : '일정 추가'}
            style={{ width: 20, height: 20, borderRadius: 3, border: 'none', background: 'transparent', cursor: 'pointer', color: adding ? 'var(--ac)' : 'var(--t3)', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, fontFamily: 'var(--font)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg3)'; e.currentTarget.style.color = 'var(--t1)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = adding ? 'var(--ac)' : 'var(--t3)' }}
          >{adding ? '×' : '+'}</button>
        )}
      </div>

      {!wasConnected && (
        <div style={{ fontSize: 12, color: 'var(--t3)' }}>캘린더를 연동하면 이 업무에 일정을 붙일 수 있습니다</div>
      )}
      {wasConnected && events === null && (
        <div style={{ fontSize: 12, color: 'var(--t3)' }}>불러오는 중...</div>
      )}
      {wasConnected && events?.length === 0 && !adding && (
        <div style={{ fontSize: 12, color: 'var(--t3)' }}>일정 없음</div>
      )}

      {!!events?.length && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {events.map(ev => (
            <EventRow key={ev.id} ev={ev} busy={busy} onDetach={() => detach(ev)} />
          ))}
          {upcoming.length > 0 && events.length > 1 && (
            <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
              다음 일정 {whenLabel(upcoming[0])}
            </div>
          )}
        </div>
      )}

      {adding && (
        <div style={{ marginTop: 8, borderRadius: 'var(--r3)', border: '1px solid var(--bd)', background: 'var(--bg)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--bd)' }}>
            {([['new', '새 일정'], ['link', '있는 일정에서 고르기']] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setAdding(key)}
                style={{
                  flex: 1, padding: '7px 8px', fontSize: 12, fontFamily: 'var(--font)',
                  border: 'none', cursor: 'pointer', background: 'transparent',
                  color: adding === key ? 'var(--t1)' : 'var(--t3)',
                  fontWeight: adding === key ? 600 : 400,
                  boxShadow: adding === key ? 'inset 0 -2px 0 var(--ac)' : 'none',
                }}
              >{label}</button>
            ))}
          </div>

          {/* One week strip for both tabs: the day is the question they share. */}
          <WeekStrip
            weekStart={weekStart}
            selected={day}
            due={task.due}
            countFor={d => (byDay.get(d)?.length ?? 0)}
            onSelect={setDay}
            onShift={goWeek}
          />

          {adding === 'new' ? (
            <NewEventBody
              task={task}
              day={day}
              dayEvents={byDay.get(day) ?? []}
              candidates={candidates}
              onCreate={async (input) => {
                setBusy(true)
                // createEvent가 만든 일정의 id를 돌려줍니다(회의실 예약을
                // 그 일정에 묶기 위해서). 여기서는 성공 여부만 필요합니다.
                const created = await createEvent({ ...input, taskId: task.id })
                setBusy(false)
                if (created) { setAdding(null); await reload() }
                return !!created
              }}
            />
          ) : (
            <PickExisting
              day={day}
              dayEvents={byDay.get(day) ?? []}
              linkedIds={new Set((events ?? []).map(e => e.id))}
              taskId={task.id}
              onPick={async (ev) => {
                setBusy(true)
                const ok = await setEventTask(ev.id, task.id)
                setBusy(false)
                if (ok) { setAdding(null); await reload() }
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}

/* ── WeekStrip ── */

/**
 * Seven days, with a dot under the ones that already have something on them.
 *
 * The dots are the point: they are why picking a day here beats typing one into
 * a field. A week where Thursday is solid and Friday is empty is visible before
 * any day is clicked.
 */
function WeekStrip({ weekStart, selected, due, countFor, onSelect, onShift }: {
  weekStart: string
  selected: string
  /** The task's deadline, marked so the week reads against the work. */
  due?: string
  countFor: (day: string) => number
  onSelect: (day: string) => void
  onShift: (delta: number) => void
}) {
  const today = ymd(new Date())
  const days = Array.from({ length: 7 }, (_, i) => shift(weekStart, i))
  const first = new Date(weekStart + 'T00:00:00')

  const arrow = (delta: number, glyph: string) => (
    <button
      onClick={() => onShift(delta)}
      style={{ width: 20, height: 20, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--t3)', fontSize: 11, borderRadius: 3, fontFamily: 'var(--font)', flexShrink: 0 }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg3)'; e.currentTarget.style.color = 'var(--t1)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t3)' }}
    >{glyph}</button>
  )

  return (
    <div style={{ padding: '8px 8px 6px', borderBottom: '1px solid var(--bd)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
        {arrow(-1, '‹')}
        <span style={{ fontSize: 11, color: 'var(--t3)' }}>{first.getFullYear()}. {first.getMonth() + 1}월</span>
        {arrow(1, '›')}
      </div>
      <div style={{ display: 'flex', gap: 2 }}>
        {days.map(d => {
          const on = d === selected
          const isToday = d === today
          const n = countFor(d)
          const dow = new Date(d + 'T00:00:00').getDay()
          return (
            <button
              key={d}
              onClick={() => onSelect(d)}
              title={`${n ? `${n}개 일정` : '일정 없음'}${d === due ? ' · 이 업무 마감일' : ''}`}
              style={{
                flex: 1, minWidth: 0, padding: '4px 0 3px', borderRadius: 'var(--r1)',
                border: '1px solid ' + (on ? 'var(--ac)' : 'transparent'),
                background: on ? 'var(--ac-l)' : 'transparent',
                cursor: 'pointer', fontFamily: 'var(--font)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              }}
              onMouseEnter={e => { if (!on) e.currentTarget.style.background = 'var(--bg3)' }}
              onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent' }}
            >
              <span style={{ fontSize: 9, color: dow === 0 ? 'var(--danger)' : dow === 6 ? '#487CA5' : 'var(--t3)' }}>{DOW[dow]}</span>
              <span style={{
                fontSize: 12, fontWeight: on || isToday ? 700 : 400,
                color: on ? 'var(--ac)' : isToday ? 'var(--t1)' : 'var(--t2)',
                borderBottom: d === due ? '1.5px solid #9065B0' : '1.5px solid transparent',
                lineHeight: 1.15,
              }}>{new Date(d + 'T00:00:00').getDate()}</span>
              <span style={{
                width: 4, height: 4, borderRadius: '50%', flexShrink: 0,
                background: n ? (on ? 'var(--ac)' : 'var(--bd2)') : 'transparent',
              }} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ── 새 일정 ── */

function NewEventBody({ task, day, dayEvents, candidates, onCreate }: {
  task: Task
  day: string
  dayEvents: GCalEvent[]
  candidates: string[]
  onCreate: (input: { summary: string; startDateTime: string; endDateTime: string; attendees?: string[] }) => Promise<boolean>
}) {
  const [summary, setSummary] = useState(task.name)
  const [startMin, setStartMin] = useState(14 * 60)
  const [minutes, setMinutes] = useState(60)
  const [invited, setInvited] = useState<string[]>([])
  const [extra, setExtra] = useState('')
  const [saving, setSaving] = useState(false)

  const toggle = (email: string) =>
    setInvited(prev => prev.includes(email) ? prev.filter(e => e !== email) : [...prev, email])

  const clash = dayEvents.some(ev => {
    if (ev.allDay || !ev.startIso || !ev.endIso) return false
    const s = minutesOfIso(ev.startIso), e = minutesOfIso(ev.endIso)
    return startMin < e && s < startMin + minutes
  })

  const submit = async () => {
    const title = summary.trim()
    if (!title || saving) return
    const typed = extra.split(/[,\s]+/).map(s => s.trim()).filter(s => s.includes('@'))
    setSaving(true)
    await onCreate({
      summary: title,
      startDateTime: localIso(day, startMin),
      endDateTime: localIso(day, startMin + minutes),
      attendees: [...new Set([...invited, ...typed])],
    })
    setSaving(false)
  }

  return (
    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}
      onKeyDown={e => { if (e.key === 'Enter' && !isComposing(e)) { e.preventDefault(); void submit() } }}>
      <input
        autoFocus value={summary} onChange={e => setSummary(e.target.value)}
        placeholder="일정 제목"
        style={{ ...FIELD, width: '100%' }}
      />

      <DayTimeGrid
        day={day} dayEvents={dayEvents}
        startMin={startMin} minutes={minutes}
        onChange={(s, m) => { setStartMin(s); setMinutes(m) }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--t1)' }}>
          {hhmm(startMin)}–{hhmm(startMin + minutes)}
        </span>
        <span style={{ fontSize: 11, color: 'var(--t3)' }}>{durationLabel(minutes)}</span>
        {[30, 60, 90].map(m => (
          <button key={m} onClick={() => setMinutes(m)}
            style={{ ...CHIP, padding: '1px 7px', fontSize: 11, borderColor: minutes === m ? 'var(--ac)' : 'var(--bd)', color: minutes === m ? 'var(--ac)' : 'var(--t3)' }}
          >{m < 60 ? `${m}분` : `${m / 60}시간`}</button>
        ))}
        {clash && <span style={{ fontSize: 11, color: '#D9730D' }}>겹치는 일정 있음</span>}
      </div>

      {candidates.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {candidates.slice(0, 8).map(email => {
            const on = invited.includes(email)
            return (
              <button
                key={email} onClick={() => toggle(email)} title={email}
                style={{
                  ...CHIP,
                  background: on ? 'var(--ac-l)' : 'transparent',
                  borderColor: on ? 'var(--ac)' : 'var(--bd)',
                  color: on ? 'var(--ac)' : 'var(--t2)',
                }}
              >{on ? '✓ ' : ''}{email.split('@')[0]}</button>
            )
          })}
        </div>
      )}

      {/* Anyone outside the project — a candidate, a client — by address. */}
      <input
        value={extra} onChange={e => setExtra(e.target.value)}
        placeholder="초대할 다른 이메일 (쉼표로 구분)"
        style={{ ...FIELD, width: '100%' }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={() => void submit()}
          disabled={!summary.trim() || saving}
          style={{
            padding: '5px 12px', fontSize: 12, fontWeight: 600, borderRadius: 'var(--r1)',
            border: 'none', background: 'var(--ac)', color: '#fff',
            cursor: summary.trim() && !saving ? 'pointer' : 'default',
            opacity: summary.trim() && !saving ? 1 : .5, fontFamily: 'var(--font)',
          }}
        >{saving ? '만드는 중...' : invited.length || extra.trim() ? '만들고 초대' : '일정 만들기'}</button>
        <span style={{ fontSize: 11, color: 'var(--t3)' }}>
          {invited.length || extra.trim() ? '초대 메일이 발송됩니다' : '초대 없이 내 캘린더에만'}
        </span>
      </div>
    </div>
  )
}

/* ── 있는 일정에서 고르기 ── */

function PickExisting({ day, dayEvents, linkedIds, taskId, onPick }: {
  day: string
  dayEvents: GCalEvent[]
  linkedIds: Set<string>
  taskId: string
  onPick: (ev: GCalEvent) => void
}) {
  const search = useGCalStore(s => s.findLinkableEvents)
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<GCalEvent[] | null>(null)
  const shown = (found ?? dayEvents).filter(e => !linkedIds.has(e.id))

  const run = async () => {
    if (!query.trim()) { setFound(null); return }
    setFound(null)
    setFound(await search(query))
  }

  return (
    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 220, overflowY: 'auto' }}>
        {shown.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--t3)' }}>
            {found ? '찾지 못했습니다' : '이 날에는 일정이 없습니다 — 위에서 다른 날을 고르세요'}
          </div>
        )}
        {shown.map(ev => {
          const other = ev.taskId && ev.taskId !== taskId
          return (
            <button
              key={ev.id}
              onClick={() => onPick(ev)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 7px', textAlign: 'left',
                border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 'var(--r1)',
                fontFamily: 'var(--font)', minWidth: 0,
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, background: ev.calendarColor || NOTION.blue.text, flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.summary}</span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--t3)' }}>
                  {found ? whenLabel(ev) : ev.allDay ? '종일' : `${hhmm(minutesOfIso(ev.startIso!))}${ev.endIso ? `–${hhmm(minutesOfIso(ev.endIso))}` : ''}`}
                  {ev.attendees?.length ? ` · 참석 ${ev.attendees.length}명` : ''}
                </span>
              </span>
              {other && <span style={{ fontSize: 10, color: 'var(--t3)', flexShrink: 0 }}>다른 업무</span>}
            </button>
          )
        })}
      </div>

      {/* The day list covers the usual case — the interview was booked this week.
          Search is for the one that was not, so it sits underneath rather than
          in front of it. */}
      <div style={{ display: 'flex', gap: 6, borderTop: '1px solid var(--bd)', paddingTop: 8 }}>
        <input
          value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !isComposing(e)) { e.preventDefault(); void run() } }}
          placeholder="멀리 있는 일정 검색"
          style={{ ...FIELD, flex: 1, fontSize: 12 }}
        />
        <button onClick={() => void run()} style={{ ...CHIP, borderRadius: 'var(--r1)', fontSize: 12 }}>검색</button>
        {found && (
          <button onClick={() => { setFound(null); setQuery('') }} style={{ ...CHIP, borderRadius: 'var(--r1)', fontSize: 12 }}>
            {new Date(day + 'T00:00:00').getDate()}일로
          </button>
        )}
      </div>
    </div>
  )
}

/* ── 연결된 일정 한 줄 ── */

function EventRow({ ev, busy, onDetach }: { ev: GCalEvent; busy: boolean; onDetach: () => void }) {
  const [hovered, setHovered] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const guests = ev.attendees?.length ?? 0
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY }) }}
      title="우클릭 — 연결 해제"
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '5px 7px',
        borderRadius: 'var(--r1)', background: hovered ? 'var(--bg3)' : 'transparent',
        transition: 'background .1s', minWidth: 0,
      }}
    >
      <span style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, background: ev.calendarColor || NOTION.blue.text, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {ev.summary}
        </div>
        <div style={{ fontSize: 11, color: 'var(--t3)' }}>
          {whenLabel(ev)}{guests > 0 ? ` · 참석 ${guests}명` : ''}
        </div>
      </div>
      {/* '열기' stays on hover — it is the harmless one, and it is what the row
          is mostly for. '해제' left: a destructive control that appears under a
          pointer which arrived for some other reason is one stray click from
          undoing somebody's work. It is a right-click now, like a milestone's
          delete and a task's. */}
      {ev.htmlLink && (
        <button
          onClick={() => openExternal(ev.htmlLink)}
          title="구글 캘린더에서 열기"
          style={{ ...CHIP, padding: '2px 7px', opacity: hovered ? 1 : 0, transition: 'opacity .1s' }}
        >열기</button>
      )}
      {menu && (
        <ActionMenu
          x={menu.x} y={menu.y}
          onClose={() => setMenu(null)}
          actions={[
            ...(ev.htmlLink ? [{ label: '구글 캘린더에서 열기', icon: 'external' as const, onSelect: () => openExternal(ev.htmlLink) }] : []),
            {
              label: '연결 해제', icon: 'unlink' as const, danger: true,
              // The event itself is not touched — unpinning an interview from a
              // task must never read as cancelling the interview.
              onSelect: () => { if (!busy) onDetach() },
            },
          ]}
        />
      )}
    </div>
  )
}
