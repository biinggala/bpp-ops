import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useGCalStore, type GCalEvent } from '../../store/gcalStore'
import { useAuthStore } from '../../store/authStore'
import { openExternal } from '../../lib/desktopLinks'
import { DateField } from '../shared/DatePicker'
import { isComposing, parseAssignees } from '../../lib/utils'
import { NOTION } from '../../types'
import type { Task } from '../../types'

/**
 * ── The events a task is made of ─────────────────────────────────────────────
 *
 * 자료 has been attachable for a while; 일정 was not, and the two are the same
 * kind of thing. "스태프 모집" is one row in the list and fourteen interviews in
 * a calendar, and until now nothing tied the fourteen to the one: opening the
 * task told you a deadline and a status, and the actual work — who is coming in,
 * when — lived somewhere the task could not see.
 *
 * Two ways in, because two things happen in practice:
 *
 * - **새 일정** — the interview is being arranged now. Title, day, time, and the
 *   people to invite, in one small form; Google sends the invitations, which is
 *   the entire reason to create it from here rather than write it down twice.
 * - **기존 일정 연결** — the interview was already booked, from the mail thread
 *   it was agreed in. Nothing is sent to anyone: the guests were invited when
 *   the event was made, and re-inviting them from a task board would be noise.
 *
 * What is shown is what *this person's* calendars hold. The link lives on the
 * event in Google, so a teammate who cannot see that calendar does not see the
 * event here either — the same rule the calendar itself follows, rather than a
 * copy of everyone's appointments kept in our database.
 */

const DOW = ['일', '월', '화', '수', '목', '금', '토']

/** 09:00 → 21:30, the half hours anything gets scheduled at. */
const TIMES = Array.from({ length: 26 }, (_, i) => {
  const m = 9 * 60 + i * 30
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
})
const LENGTHS = [30, 60, 90, 120]

function todayYmd(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "8/22 (금) 14:00" — the day first, because that is what is being scanned. */
function whenLabel(ev: GCalEvent): string {
  const d = new Date((ev.startIso ?? `${ev.start}T00:00:00`).slice(0, 19))
  const head = `${d.getMonth() + 1}/${d.getDate()} (${DOW[d.getDay()]})`
  if (ev.allDay) return `${head} 종일`
  return `${head} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function addMinutes(date: string, time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number)
  const d = new Date(`${date}T00:00:00`)
  d.setHours(h, m + minutes, 0, 0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    + `T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`
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
  const { wasConnected, eventsForTask, findLinkableEvents, setEventTask, createEvent } = useGCalStore()
  const myEmail = useAuthStore(s => s.email)
  const [events, setEvents] = useState<GCalEvent[] | null>(null)
  const [adding, setAdding] = useState<null | 'new' | 'link'>(null)
  const [busy, setBusy] = useState(false)

  // Project members first, then whoever the task is assigned to, without me —
  // I am the organiser, and inviting yourself reads as a mistake.
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

  return (
    <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 12, marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
          일정{(events?.length ?? 0) > 0 ? ` ${events!.length}` : ''}
        </span>
        {wasConnected && (
          <button
            onClick={() => setAdding(a => (a ? null : 'new'))}
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
            {([['new', '새 일정'], ['link', '기존 일정 연결']] as const).map(([key, label]) => (
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

          {adding === 'new' ? (
            <NewEventForm
              task={task}
              candidates={candidates}
              onDone={async (input) => {
                setBusy(true)
                const ok = await createEvent({ ...input, taskId: task.id })
                setBusy(false)
                if (ok) { setAdding(null); await reload() }
                return ok
              }}
            />
          ) : (
            <LinkExisting
              defaultQuery={task.name}
              linkedIds={new Set((events ?? []).map(e => e.id))}
              search={findLinkableEvents}
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

function EventRow({ ev, busy, onDetach }: { ev: GCalEvent; busy: boolean; onDetach: () => void }) {
  const [hovered, setHovered] = useState(false)
  const guests = ev.attendees?.length ?? 0
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
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
      {ev.htmlLink && (
        <button
          onClick={() => openExternal(ev.htmlLink)}
          title="구글 캘린더에서 열기"
          style={{ ...CHIP, padding: '2px 7px', opacity: hovered ? 1 : 0, transition: 'opacity .1s' }}
        >열기</button>
      )}
      <button
        onClick={onDetach}
        disabled={busy}
        title="연결 해제 (일정은 지우지 않습니다)"
        style={{ ...CHIP, padding: '2px 7px', color: '#D44C47', borderColor: 'rgba(212,76,71,.35)', opacity: hovered ? 1 : 0, transition: 'opacity .1s' }}
      >해제</button>
    </div>
  )
}

function NewEventForm({ task, candidates, onDone }: {
  task: Task
  candidates: string[]
  onDone: (input: { summary: string; startDateTime: string; endDateTime: string; attendees?: string[] }) => Promise<boolean>
}) {
  const [summary, setSummary] = useState(task.name)
  const [date, setDate] = useState(task.due || todayYmd())
  const [time, setTime] = useState('14:00')
  const [minutes, setMinutes] = useState(60)
  const [invited, setInvited] = useState<string[]>([])
  const [extra, setExtra] = useState('')
  const [saving, setSaving] = useState(false)
  const nameOf = (email: string) => email.split('@')[0]

  const toggle = (email: string) =>
    setInvited(prev => prev.includes(email) ? prev.filter(e => e !== email) : [...prev, email])

  const submit = async () => {
    const title = summary.trim()
    if (!title || !date || saving) return
    const typed = extra.split(/[,\s]+/).map(s => s.trim()).filter(s => s.includes('@'))
    setSaving(true)
    const ok = await onDone({
      summary: title,
      startDateTime: addMinutes(date, time, 0),
      endDateTime: addMinutes(date, time, minutes),
      attendees: [...new Set([...invited, ...typed])],
    })
    setSaving(false)
    if (!ok) return
  }

  return (
    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}
      onKeyDown={e => { if (e.key === 'Enter' && !isComposing(e)) { e.preventDefault(); void submit() } }}>
      <input
        autoFocus value={summary} onChange={e => setSummary(e.target.value)}
        placeholder="일정 제목"
        style={{ ...FIELD, width: '100%' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ ...FIELD, display: 'inline-flex', padding: '3px 7px' }}>
          <DateField value={date} format="full" context={{ projectId: task.projectId, taskId: task.id }} onChange={setDate} />
        </span>
        <select value={time} onChange={e => setTime(e.target.value)} style={{ ...FIELD, cursor: 'pointer' }}>
          {TIMES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={minutes} onChange={e => setMinutes(Number(e.target.value))} style={{ ...FIELD, cursor: 'pointer' }}>
          {LENGTHS.map(m => <option key={m} value={m}>{m < 60 ? `${m}분` : `${m / 60}시간`}</option>)}
        </select>
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
              >{on ? '✓ ' : ''}{nameOf(email)}</button>
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
        >{saving ? '만드는 중...' : '만들고 초대'}</button>
        <span style={{ fontSize: 11, color: 'var(--t3)' }}>
          {invited.length || extra.trim() ? '초대 메일이 발송됩니다' : '초대 없이 내 캘린더에만'}
        </span>
      </div>
    </div>
  )
}

function LinkExisting({ defaultQuery, linkedIds, search, onPick }: {
  defaultQuery: string
  linkedIds: Set<string>
  search: (query: string) => Promise<GCalEvent[]>
  onPick: (ev: GCalEvent) => void
}) {
  const [query, setQuery] = useState(defaultQuery)
  const [results, setResults] = useState<GCalEvent[] | null>(null)

  // Typed, not live: each keystroke would be one request per calendar.
  const run = async (q: string) => { setResults(null); setResults(await search(q)) }
  useEffect(() => { void run(defaultQuery) }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const shown = (results ?? []).filter(e => !linkedIds.has(e.id))

  return (
    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          autoFocus value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !isComposing(e)) { e.preventDefault(); void run(query) } }}
          placeholder="일정 검색 (Enter)"
          style={{ ...FIELD, flex: 1 }}
        />
        <button onClick={() => void run(query)} style={{ ...CHIP, borderRadius: 'var(--r1)' }}>검색</button>
      </div>

      {results === null && <div style={{ fontSize: 12, color: 'var(--t3)' }}>찾는 중...</div>}
      {results !== null && shown.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--t3)' }}>최근 2개월 ~ 앞으로 6개월에서 찾지 못했습니다</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 220, overflowY: 'auto' }}>
        {shown.map(ev => (
          <button
            key={ev.id}
            onClick={() => onPick(ev)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '5px 7px', textAlign: 'left',
              border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 'var(--r1)',
              fontFamily: 'var(--font)', minWidth: 0,
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <span style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, background: ev.calendarColor || NOTION.blue.text, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.summary}</span>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--t3)' }}>{whenLabel(ev)}</span>
            </span>
            {ev.taskId && <span style={{ fontSize: 10, color: 'var(--t3)', flexShrink: 0 }}>다른 업무에 연결됨</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
