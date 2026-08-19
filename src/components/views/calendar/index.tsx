import React, { useState, useMemo, useRef, useEffect, useCallback, Component } from 'react'
import { useUiStore } from '../../../store/uiStore'
import { useFilteredTasks } from '../../../hooks/useFilteredTasks'
import { useTaskStore } from '../../../store/taskStore'
import { useMilestoneStore } from '../../../store/milestoneStore'
import { DayPlanner } from './DayPlanner'
import { haptic } from '../../../lib/haptics'
import { useProjectStore } from '../../../store/projectStore'
import { useGCalStore } from '../../../store/gcalStore'
import { TimelineGrid, GUTTER as HOUR_GUTTER } from '../timeline'
import { writableCalendars } from '../../../lib/googleCalendar'
import type { CalRange } from '../../../types'
import type { GCalEvent } from '../../../store/gcalStore'
import { useMobile } from '../../../hooks/useMobile'
import { getCatColor, NOTION } from '../../../types'
import { addDays, toDate, fmtYMD, dayDiff, getBlockingCascade } from '../../../lib/utils'
import type { Task } from '../../../types'

type Chip = { kind: 'gcal'; ev: GCalEvent } | { kind: 'task'; t: Task }

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']
const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']

const fmt = fmtYMD
const parseDate = toDate

// Google Calendar event color
const GCAL_BG   = 'rgba(68,131,97,.18)'
const GCAL_TEXT = '#448361'

// ── Status badge (mobile) ─────────────────────────────────────────────────────

const MOB_STATUS: Record<string, { bg: string; color: string }> = {
  '진행중': { bg: 'rgba(35,131,226,.15)', color: '#487CA5' },
  '대기':   { bg: 'rgba(120,117,114,.14)', color: '#5a5857' },
  '검토중': { bg: '#fef3c7',              color: '#D9730D' },
  '완료':   { bg: '#d1fae5',              color: '#448361' },
}

// ── GCal connect button ───────────────────────────────────────────────────────

function GCalButton() {
  const { token, loading, autoRefreshing, wasConnected, error, calendars, enabledCalendarIds, connect, disconnect, autoReconnect, fetchCalendars, setCalendarEnabled, refreshEvents } = useGCalStore()
  const [pickerOpen, setPickerOpen] = React.useState(false)

  // The calendar list is what makes shared team calendars reachable at all, so
  // it is read as soon as there is a token to read it with.
  React.useEffect(() => {
    if (token && !calendars.length) fetchCalendars()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // On mount: if user was connected before but token expired, silently refresh
  React.useEffect(() => {
    if (wasConnected && !token && !loading && !autoRefreshing) autoReconnect()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (token) {
    // One control for the whole integration. A chip announcing "연동됨" states
    // what the visible events already prove, and an always-present ✕ puts
    // disconnecting a click away from nothing — it belongs inside the menu with
    // the rest of the settings.
    return (
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setPickerOpen(o => !o)}
          title="표시할 캘린더 선택"
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            fontSize: 12, color: error ? '#D44C47' : 'var(--t2)',
            background: 'transparent',
            border: `1px solid ${error ? 'rgba(212,76,71,.35)' : 'var(--bd2)'}`,
            cursor: 'pointer', padding: '3px 9px', borderRadius: 'var(--r2)',
            fontFamily: 'var(--font)', whiteSpace: 'nowrap',
          }}
        >
          <GoogleDot />
          {error ? '일정 로드 오류' : loading ? '불러오는 중…' : `캘린더 ${enabledCalendarIds?.length ?? 0}/${calendars.length}`}
          <span style={{ fontSize: 9, opacity: .5 }}>▾</span>
        </button>

        {pickerOpen && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 8998 }} onClick={() => setPickerOpen(false)} />
            <div style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 8999,
              background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r3)',
              boxShadow: 'var(--sh-md)', minWidth: 230, maxHeight: 320, overflowY: 'auto', padding: '4px 0',
            }}>
              {error && (
                <div style={{ padding: '6px 12px', fontSize: 11, color: '#D44C47', lineHeight: 1.5 }}>{error}</div>
              )}
              {calendars.length === 0 && (
                <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--t3)' }}>캘린더를 불러오는 중…</div>
              )}
              {calendars.map(c => {
                const on = (enabledCalendarIds ?? []).includes(c.id)
                return (
                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', fontSize: 13, color: 'var(--t1)', cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <input type="checkbox" checked={on} onChange={() => setCalendarEnabled(c.id, !on)}
                      style={{ accentColor: 'var(--ac)', width: 13, height: 13, cursor: 'pointer', flexShrink: 0 }} />
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: c.backgroundColor, flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.summary}</span>
                  </label>
                )
              })}
              <div style={{ height: 1, background: 'var(--bd)', margin: '4px 0' }} />
              <button
                onClick={() => { setPickerOpen(false); refreshEvents() }}
                style={{
                  width: '100%', textAlign: 'left', padding: '6px 12px', fontSize: 12,
                  color: 'var(--t2)', background: 'transparent', border: 'none',
                  cursor: 'pointer', fontFamily: 'var(--font)',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                지금 새로고침
              </button>
              <button
                onClick={() => { setPickerOpen(false); disconnect() }}
                style={{
                  width: '100%', textAlign: 'left', padding: '6px 12px', fontSize: 12,
                  color: '#D44C47', background: 'transparent', border: 'none',
                  cursor: 'pointer', fontFamily: 'var(--font)',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                연동 해제
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  // Silent reconnect in progress
  if (autoRefreshing) {
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--t3)', background: 'var(--bg3)', padding: '3px 8px', borderRadius: 20 }}>
        <GoogleDot /> 갱신 중…
      </span>
    )
  }

  // Was connected before but token expired and silent refresh failed → compact reconnect button
  if (wasConnected) {
    return (
      <button
        onClick={connect}
        disabled={loading}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '3px 8px', borderRadius: 20,
          border: '1px solid rgba(68,131,97,.35)',
          background: 'rgba(68,131,97,.07)',
          fontSize: 12, color: '#448361',
          cursor: loading ? 'default' : 'pointer',
          opacity: loading ? .6 : 1,
          fontFamily: 'var(--font)', whiteSpace: 'nowrap',
        }}
      >
        <GoogleDot /> {loading ? '연동 중…' : '캘린더 재연동'}
      </button>
    )
  }

  return (
    <button
      onClick={connect}
      disabled={loading}
      title={error ?? undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '4px 10px', borderRadius: 'var(--r1)',
        border: `1px solid ${error ? '#fca5a5' : 'var(--bd)'}`,
        background: error ? 'rgba(212,76,71,.07)' : 'transparent',
        fontSize: 12, color: error ? '#D44C47' : 'var(--t2)',
        cursor: loading ? 'default' : 'pointer',
        opacity: loading ? .6 : 1,
        fontFamily: 'var(--font)',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => { if (!loading) e.currentTarget.style.background = 'var(--bg2)' }}
      onMouseLeave={e => { e.currentTarget.style.background = error ? 'rgba(212,76,71,.07)' : 'transparent' }}
    >
      <GoogleDot />
      {loading ? '연동 중…' : error ? '다시 연동' : '구글 캘린더 연동'}
    </button>
  )
}

function GoogleDot() {
  return (
    <svg width="12" height="12" viewBox="0 0 18 18" style={{ flexShrink: 0 }}>
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908C16.658 12.015 17.64 10.734 17.64 9.2z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
    </svg>
  )
}

// ── Mobile calendar ───────────────────────────────────────────────────────────

function MobileCalendar() {
  const { openTaskModal, openTaskDetail } = useUiStore()
  const tasks = useFilteredTasks()
  const { token, events: gcalEvents, ensureEvents } = useGCalStore()
  const todayDate = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])
  const todayStr  = useMemo(() => fmt(todayDate), [todayDate])
  const [selectedDate, setSelectedDate] = useState(todayStr)
  /** Placing work on one day, from that day's section header. */
  const [planning, setPlanning] = useState<{ date: string; anchor: HTMLElement } | null>(null)

  // Fetch GCal events for a 3-month window around today. Re-runs when the set of
  // shown calendars changes, otherwise ticking one on would do nothing visible.
  const enabledKey = (useGCalStore(s => s.enabledCalendarIds) ?? []).join(',')
  useEffect(() => {
    if (!token) return
    const from = fmt(addDays(todayDate, -14))
    const to   = fmt(addDays(todayDate, 75))
    ensureEvents(from, to)
  }, [token, enabledKey])

  // Group tasks by due date
  const tasksByDate = useMemo(() => {
    const map = new Map<string, Task[]>()
    tasks.forEach(t => {
      const key = t.due ?? t.start
      if (!key) return
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(t)
    })
    return map
  }, [tasks])

  // Group GCal events by START date only (avoid repeating multi-day events on every day in list view)
  const gcalByDate = useMemo(() => {
    const map = new Map<string, GCalEvent[]>()
    gcalEvents.forEach(ev => {
      if (!ev.start) return
      if (!map.has(ev.start)) map.set(ev.start, [])
      map.get(ev.start)!.push(ev)
    })
    return map
  }, [gcalEvents])

  const overdueTasks = useMemo(() =>
    tasks.filter(t => {
      const due = t.due ?? t.start
      return due && due < todayStr && t.status !== '완료'
    }),
    [tasks, todayStr]
  )

  // Date strip: 14 days before + 45 days after
  const stripDates = useMemo(() => {
    const dates: string[] = []
    for (let i = -14; i <= 45; i++) dates.push(fmt(addDays(todayDate, i)))
    return dates
  }, [todayDate])

  // Content dates: days with tasks or GCal events, plus selected date
  const contentDates = useMemo(() => {
    const set = new Set<string>()
    for (let i = 0; i <= 75; i++) {
      const d = fmt(addDays(todayDate, i))
      if (tasksByDate.has(d) || gcalByDate.has(d)) set.add(d)
    }
    set.add(selectedDate)
    return Array.from(set).sort()
  }, [tasksByDate, gcalByDate, todayDate, selectedDate])

  const stripRef    = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  useEffect(() => {
    const el = stripRef.current?.querySelector(`[data-date="${selectedDate}"]`) as HTMLElement | null
    if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [selectedDate])

  const handleDateSelect = (dateStr: string) => {
    haptic('tap')
    setSelectedDate(dateStr)
    setTimeout(() => {
      const el = sectionRefs.current.get(dateStr)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
  }

  const fmtSection = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00')
    const dow = DAY_LABELS[d.getDay()]
    const diff = Math.round((d.getTime() - todayDate.getTime()) / 86400000)
    const m = d.getMonth() + 1; const day = d.getDate()
    if (diff === 0) return `오늘 (${m}/${day} ${dow})`
    if (diff === 1) return `내일 (${m}/${day} ${dow})`
    if (diff === -1) return `어제 (${m}/${day} ${dow})`
    return `${m}/${day} (${dow})`
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ background: 'var(--bg)', borderBottom: '1px solid var(--bd)', padding: '10px 16px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          {overdueTasks.length > 0 ? (
            <div
              onClick={() => {
                const el = sectionRefs.current.get('__overdue__')
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(212,76,71,.12)', color: '#D44C47', borderRadius: 20, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              <span>⚠</span> 기한 초과 {overdueTasks.length}개
            </div>
          ) : <div />}
          <GCalButton />
        </div>

        {/* The filter row that used to sit here is now the ⚙ sheet in the top
            bar, together with the sort and grouping a phone had nowhere to put.
            One door, and a few more lines of calendar on screen. */}

        {/* Date strip */}
        <div ref={stripRef} style={{ display: 'flex', gap: 2, overflowX: 'auto', paddingBottom: 10, scrollbarWidth: 'none' }}>
          {stripDates.map(dateStr => {
            const d = new Date(dateStr + 'T00:00:00')
            const dow = DAY_LABELS[d.getDay()]
            const day = d.getDate()
            const isToday    = dateStr === todayStr
            const isSelected = dateStr === selectedDate
            const hasTasks   = tasksByDate.has(dateStr)
            const hasGCal    = gcalByDate.has(dateStr)
            const isSun = d.getDay() === 0
            const isSat = d.getDay() === 6
            return (
              <button
                key={dateStr}
                data-date={dateStr}
                onClick={() => handleDateSelect(dateStr)}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 44, padding: '6px 4px', border: 'none', borderRadius: 10, background: isSelected ? 'var(--ac)' : 'transparent', cursor: 'pointer', flexShrink: 0 }}
              >
                <span style={{ fontSize: 10, fontWeight: 500, color: isSelected ? 'rgba(255,255,255,.8)' : isSun ? '#D44C47' : isSat ? '#3b82f6' : 'var(--t3)' }}>
                  {isToday ? '오늘' : dow}
                </span>
                <span style={{ fontSize: 16, fontWeight: isToday || isSelected ? 700 : 400, color: isSelected ? '#fff' : isToday ? 'var(--ac)' : 'var(--t1)', lineHeight: 1 }}>
                  {day}
                </span>
                {/* Dots: task dot (blue) + GCal dot (green) */}
                <div style={{ display: 'flex', gap: 3 }}>
                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: hasTasks ? (isSelected ? 'rgba(255,255,255,.7)' : 'var(--ac)') : 'transparent' }} />
                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: hasGCal ? (isSelected ? 'rgba(255,255,255,.7)' : GCAL_TEXT) : 'transparent' }} />
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 20px' }}>
        {/* Overdue */}
        {overdueTasks.length > 0 && (
          <div ref={el => { if (el) sectionRefs.current.set('__overdue__', el) }}>
            <SectionHeader label="기한 초과" count={overdueTasks.length} color="#D44C47" />
            {overdueTasks.map(t => <MobCalTaskRow key={t.id} task={t} onOpen={() => openTaskDetail(t.id)} overdue />)}
          </div>
        )}

        {/* Per-day sections */}
        {contentDates.map(dateStr => {
          const dayTasks = tasksByDate.get(dateStr) ?? []
          const dayGCal  = gcalByDate.get(dateStr) ?? []
          const total = dayTasks.length + dayGCal.length
          return (
            <div key={dateStr} ref={el => { if (el) sectionRefs.current.set(dateStr, el) }}>
              {/* Tapping the day's heading opens the planner for it — the same
                  place the desktop grid puts it, and the only element here that
                  means "this day" rather than "this task". */}
              <div onClick={e => { haptic('tap'); setPlanning({ date: dateStr, anchor: e.currentTarget }) }} style={{ cursor: 'pointer' }}>
                <SectionHeader label={fmtSection(dateStr)} count={total} color={dateStr === todayStr ? 'var(--ac)' : 'var(--t2)'} />
              </div>
              {dayGCal.map(ev => <MobGCalRow key={ev.id} event={ev} />)}
              {dayTasks.length === 0 && dayGCal.length === 0 ? (
                <div
                  onClick={e => { haptic('tap'); setPlanning({ date: dateStr, anchor: e.currentTarget }) }}
                  style={{ padding: '10px 16px', fontSize: 13, color: 'var(--t3)', cursor: 'pointer' }}
                >
                  업무 없음 · 눌러서 추가
                </div>
              ) : dayTasks.map(t => <MobCalTaskRow key={t.id} task={t} onOpen={() => openTaskDetail(t.id)} />)}
            </div>
          )
        })}

        <div style={{ padding: '4px 16px 8px' }}>
          <button
            onClick={() => openTaskModal()}
            style={{ width: '100%', padding: '12px', border: '1px dashed var(--bd2)', borderRadius: 'var(--r2)', background: 'transparent', color: 'var(--t3)', fontSize: 13, cursor: 'pointer' }}
          >
            + 업무 추가
          </button>
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

function SectionHeader({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div style={{ padding: '14px 16px 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color, letterSpacing: '0.03em' }}>{label}</span>
      {count > 0 && (
        <span style={{ fontSize: 11, color: 'var(--t3)', background: 'var(--bg3)', borderRadius: 10, padding: '1px 7px' }}>{count}</span>
      )}
    </div>
  )
}

function MobCalTaskRow({ task, onOpen, overdue }: { task: Task; onOpen: () => void; overdue?: boolean }) {
  const st = MOB_STATUS[task.status] ?? MOB_STATUS['대기']
  const isDone = task.status === '완료'
  return (
    <div
      onClick={onOpen}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--bd)', cursor: 'pointer', opacity: isDone ? 0.55 : 1 }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: overdue ? '#D44C47' : 'var(--ac)', flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 14, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: isDone ? 'line-through' : 'none' }}>
        {task.name}
      </span>
      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: st.bg, color: st.color, flexShrink: 0 }}>
        {task.status}
      </span>
      <span style={{ fontSize: 12, color: 'var(--t3)', flexShrink: 0 }}>›</span>
    </div>
  )
}

function MobGCalRow({ event }: { event: GCalEvent }) {
  return (
    <a
      href={event.htmlLink}
      target="_blank"
      rel="noopener noreferrer"
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--bd)', textDecoration: 'none' }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: event.calendarColor || GCAL_TEXT, flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 14, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {event.startTime && <span style={{ color: event.calendarColor || GCAL_TEXT, fontWeight: 500, marginRight: 5 }}>{event.startTime}</span>}
        {event.summary}
      </span>
      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: GCAL_BG, color: GCAL_TEXT, flexShrink: 0 }}>
        구글
      </span>
      <span style={{ fontSize: 12, color: 'var(--t3)', flexShrink: 0 }}>↗</span>
    </a>
  )
}

// ── Error boundary ────────────────────────────────────────────────────────────

class CalendarErrorBoundary extends Component<{ children: React.ReactNode }, { error: string | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : '알 수 없는 오류' }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, color: 'var(--t2)' }}>
          <div style={{ fontSize: 13, color: '#D44C47' }}>캘린더 로드 오류</div>
          <div style={{ fontSize: 12, color: 'var(--t3)', textAlign: 'center', maxWidth: 280 }}>{this.state.error}</div>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ padding: '6px 14px', borderRadius: 'var(--r2)', border: '1px solid var(--bd)', background: 'transparent', fontSize: 13, color: 'var(--t2)', cursor: 'pointer', fontFamily: 'var(--font)' }}
          >
            다시 시도
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ── Desktop calendar ──────────────────────────────────────────────────────────

export function CalendarView() {
  const isMobile = useMobile()
  return (
    <CalendarErrorBoundary>
      {isMobile ? <MobileCalendar /> : <DesktopCalendar />}
    </CalendarErrorBoundary>
  )
}

/**
 * One calendar with a range switch, rather than a calendar view and a timeline
 * view sitting side by side in the tab bar.
 *
 * A team that lives in Google Calendar reads 일/3일/주/월 as one screen showing
 * more or less time; two separate tabs read as two different features, and
 * choosing between them is a question nobody should have to answer.
 */
/**
 * ── Scrolling through time ───────────────────────────────────────────────────
 *
 * Apple Calendar does not turn pages. Scroll a week view and the days travel
 * under your fingers — a flick runs several past and then eases to a stop
 * wherever the momentum ran out, very often mid-week. Two halves make that up,
 * and both are needed or it reads as chunky:
 *
 *   · the whole days, which change the anchor and let React redraw the grid;
 *   · the remainder — the part of the day currently being crossed — which is
 *     written to --slide and moves the columns by transform alone, every frame,
 *     without React in the loop at all.
 *
 * Each grid draws one column of buffer on either side of the frame, so there is
 * always something to see in the gap the remainder opens up. The remainder is
 * kept inside half a column: past that, a whole step is handed over and the
 * transform is credited back the same distance, which is why the swap is
 * invisible. When the events stop arriving the remainder is eased to zero — the
 * "스스륵" landing on a day boundary.
 *
 * A step is exactly one column, measured off the DOM rather than assumed, or
 * the days would travel at a different rate from the gesture.
 */
const QUIET_MS = 140
const SETTLE_MS = 220
/** No single wheel event may cover more than this; a stray page-sized delta
 *  would otherwise throw the calendar into next season. */
const MAX_STEP = 4

function useWheelSlide(
  ref: React.RefObject<HTMLDivElement | null>,
  axis: 'x' | 'y',
  stepPx: () => number,
  onStep: (steps: number) => void,
  scrubbing: React.MutableRefObject<boolean>,
) {
  const onStepRef = useRef(onStep); onStepRef.current = onStep
  const stepRef = useRef(stepPx);   stepRef.current = stepPx

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let travelled = 0
    let lastAt = 0
    let idle: number | undefined
    let tween: number | undefined
    // Measured once per gesture. Reading it per event puts a forced layout
    // between two style writes, which is the shape of a stutter.
    let step = 0

    const paint = () => el.style.setProperty('--slide', `${-travelled}px`)

    // Ease-out to the nearest day: fast at first, then barely moving.
    const settle = () => {
      const from = travelled
      scrubbing.current = false
      if (!from) return
      const started = performance.now()
      const tick = (t: number) => {
        const p = Math.min(1, (t - started) / SETTLE_MS)
        travelled = from * (1 - p) ** 3
        paint()
        if (p < 1) tween = requestAnimationFrame(tick)
        else { travelled = 0; paint() }
      }
      tween = requestAnimationFrame(tick)
    }

    const handle = (e: WheelEvent) => {
      // Lines and pages, as some mice and older browsers report them.
      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
      const delta  = (axis === 'y' ? e.deltaY : e.deltaX) * scale
      const across = (axis === 'y' ? e.deltaX : e.deltaY) * scale
      // A trackpad never travels on one axis alone. Whichever way the gesture is
      // mostly going wins, so that scrolling the hours does not also drag the
      // days sideways.
      if (delta === 0 || Math.abs(delta) <= Math.abs(across)) return

      // Horizontal travel has to be taken: left, the browser would read it as a
      // back-navigation swipe and the calendar would vanish mid-gesture.
      e.preventDefault()

      if (tween !== undefined) { cancelAnimationFrame(tween); tween = undefined }
      const now = e.timeStamp
      if (now - lastAt > QUIET_MS) { travelled = 0; step = 0 }
      if (!step) step = Math.max(1, stepRef.current())
      lastAt = now

      // The slide-in animation belongs to the arrows; playing it on every day of
      // a scroll would strobe.
      scrubbing.current = true
      window.clearTimeout(idle)
      idle = window.setTimeout(settle, QUIET_MS)

      travelled += delta
      let steps = Math.round(travelled / step)
      if (steps) {
        steps = Math.max(-MAX_STEP, Math.min(MAX_STEP, steps))
        travelled -= steps * step
        // Only a clamped step can leave more than half a column over, and that
        // would show past the buffer.
        travelled = Math.max(-step / 2, Math.min(step / 2, travelled))
        onStepRef.current(steps)
      }
      paint()
    }

    el.addEventListener('wheel', handle, { passive: false })
    return () => {
      el.removeEventListener('wheel', handle)
      window.clearTimeout(idle)
      if (tween !== undefined) cancelAnimationFrame(tween)
      el.style.removeProperty('--slide')
    }
  }, [ref, axis, scrubbing])
}

/**
 * Slides the body in from whichever way time just moved.
 *
 * Animated rather than re-keyed: remounting would reset the hour grid's own
 * scroll, so moving a week would throw you back to nine in the morning.
 */
function useSlideOnChange(
  ref: React.RefObject<HTMLElement | null>,
  anchor: string,
  axis: 'x' | 'y',
  suppress: React.MutableRefObject<boolean>,
) {
  const previous = useRef(anchor)
  useEffect(() => {
    const before = previous.current
    if (before === anchor) return
    previous.current = anchor
    const el = ref.current
    if (!el || suppress.current) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const forward = toDate(anchor) > toDate(before)
    const offset = axis === 'y' ? 18 : 28
    const from = axis === 'y'
      ? `translateY(${forward ? offset : -offset}px)`
      : `translateX(${forward ? offset : -offset}px)`
    el.animate(
      [{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }],
      { duration: 240, easing: 'cubic-bezier(.22,.61,.36,1)' },
    )
  }, [anchor, axis, ref, suppress])
}

/** The Sunday the month grid starts on: the one on or before the 1st. */
function monthGridStart(year: number, month: number) {
  const first = new Date(year, month, 1)
  return addDays(first, -first.getDay())
}

function DesktopCalendar() {
  const { calRange, calAnchor, setCalRange, setCalAnchor } = useUiStore()
  const { calendars, targetCalendarId, canWrite, setTargetCalendar } = useGCalStore()

  const anchor = toDate(calAnchor)
  const isMonth = calRange === 'month'

  // The anchor is the first day on screen, so that a scroll can move it by a
  // single day. A week is snapped to its Sunday when it is chosen — as a week
  // is normally read — and left wherever scrolling puts it afterwards.
  useEffect(() => {
    if (calRange !== 7) return
    const a = toDate(useUiStore.getState().calAnchor)
    if (a.getDay() !== 0) setCalAnchor(fmt(addDays(a, -a.getDay())))
  }, [calRange])

  // One day of buffer on either side, so a scroll parked between two days has
  // something to show in the gap.
  const LEAD = 1
  const visibleDays = useMemo(
    () => (isMonth ? [] : Array.from({ length: calRange as number }, (_, i) => fmt(addDays(anchor, i)))),
    [calAnchor, calRange],
  )
  const days = useMemo(
    () => (isMonth ? [] : Array.from({ length: (calRange as number) + LEAD * 2 }, (_, i) => fmt(addDays(anchor, i - LEAD)))),
    [calAnchor, calRange],
  )

  // The month grid keeps its own offset: scrolling it moves whole weeks, and a
  // month that starts mid-grid is still that month until another one takes over
  // the middle row, at which point the label — and the anchor behind it — follow.
  const [weekOffset, setWeekOffsetState] = useState(0)
  const weekRef = useRef(0)
  const setWeekOffset = (n: number) => { weekRef.current = n; setWeekOffsetState(n) }
  const gridStart = useMemo(
    () => addDays(monthGridStart(anchor.getFullYear(), anchor.getMonth()), weekOffset * 7),
    [calAnchor, weekOffset],
  )

  const shift = (direction: number) => {
    if (isMonth) {
      setWeekOffset(0)
      setCalAnchor(fmt(new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1)))
    } else {
      setCalAnchor(fmt(addDays(anchor, direction * calRange)))
    }
  }

  const goToday = () => {
    setWeekOffset(0)
    const now = new Date()
    setCalAnchor(fmt(calRange === 7 ? addDays(now, -now.getDay()) : now))
  }

  // Scrolling reads from the store rather than from this render: a flick fires
  // several steps before React has drawn any of them.
  const scrubDays = (steps: number) => {
    setCalAnchor(fmt(addDays(toDate(useUiStore.getState().calAnchor), steps)))
  }
  const scrubWeeks = (steps: number) => {
    const cur = toDate(useUiStore.getState().calAnchor)
    const nextStart = addDays(
      addDays(monthGridStart(cur.getFullYear(), cur.getMonth()), weekRef.current * 7),
      steps * 7,
    )
    // Row three is the middle of the grid, so the month it falls in is the month
    // the grid is mostly showing.
    const middle = addDays(nextStart, 17)
    if (middle.getMonth() !== cur.getMonth() || middle.getFullYear() !== cur.getFullYear()) {
      const aligned = monthGridStart(middle.getFullYear(), middle.getMonth())
      setCalAnchor(fmt(new Date(middle.getFullYear(), middle.getMonth(), 1)))
      setWeekOffset(Math.round(dayDiff(aligned, nextStart) / 7))
    } else {
      setWeekOffset(weekRef.current + steps)
    }
  }

  // Months move under a vertical scroll, days and weeks under a horizontal one —
  // the axis each range is already laid out along, so the gesture matches the
  // grid rather than fighting it. One step is one column: a day sideways, a week
  // down.
  const bodyRef = useRef<HTMLDivElement>(null)
  const scrubbing = useRef(false)
  // Measured, not assumed: the transform and the anchor have to agree on how
  // far one column is, or the swap between them shows.
  const stepPx = () => {
    const el = bodyRef.current
    if (!el) return 120
    const cell = el.querySelector(isMonth ? '[data-month-cell]' : '[data-day-column]')
    if (cell) {
      const box = cell.getBoundingClientRect()
      const size = isMonth ? box.height : box.width
      if (size > 1) return size
    }
    return isMonth ? el.clientHeight / 6 : (el.clientWidth - HOUR_GUTTER) / (calRange as number)
  }
  useWheelSlide(bodyRef, isMonth ? 'y' : 'x', stepPx, isMonth ? scrubWeeks : scrubDays, scrubbing)
  useSlideOnChange(bodyRef, calAnchor, isMonth ? 'y' : 'x', scrubbing)

  const label = isMonth
    ? `${anchor.getFullYear()}년 ${MONTHS[anchor.getMonth()]}`
    : visibleDays.length === 1
      ? `${anchor.getFullYear()}년 ${MONTHS[anchor.getMonth()]} ${anchor.getDate()}일`
      : (() => {
          const first = toDate(visibleDays[0]); const last = toDate(visibleDays[visibleDays.length - 1])
          const sameMonth = first.getMonth() === last.getMonth()
          return sameMonth
            ? `${first.getFullYear()}년 ${MONTHS[first.getMonth()]} ${first.getDate()} – ${last.getDate()}`
            : `${MONTHS[first.getMonth()]} ${first.getDate()} – ${MONTHS[last.getMonth()]} ${last.getDate()}`
        })()

  const writable = writableCalendars(calendars)
  const target = targetCalendarId ?? calendars.find(c => c.primary)?.id ?? writable[0]?.id ?? ''

  // Coming back to the tab is the moment someone expects to see what changed in
  // Google meanwhile. The cached window is only re-read if it has gone stale.
  useEffect(() => {
    const onFocus = () => {
      const { loadedFrom, loadedTo } = useGCalStore.getState()
      if (loadedFrom && loadedTo) useGCalStore.getState().ensureEvents(loadedFrom, loadedTo)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div style={{ background: 'var(--bg)', borderBottom: '1px solid var(--bd)', padding: '0 16px', minHeight: 44, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
        <NavBtn onClick={goToday}>오늘</NavBtn>
        <NavBtn onClick={() => shift(-1)}>‹</NavBtn>
        <NavBtn onClick={() => shift(1)}>›</NavBtn>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)', minWidth: 130 }}>{label}</span>

        <RangeSwitch value={calRange} onChange={r => { setWeekOffset(0); setCalRange(r) }} />

        <div style={{ flex: 1 }} />

        {!isMonth && writable.length > 0 && (
          <select
            value={target}
            onChange={e => setTargetCalendar(e.target.value)}
            title={canWrite ? '새 일정을 넣을 캘린더' : '첫 생성 시 구글 권한을 요청합니다'}
            style={{ padding: '3px 6px', borderRadius: 'var(--r1)', border: '1px solid var(--bd)', background: 'transparent', fontSize: 12, color: 'var(--t2)', fontFamily: 'var(--font)', maxWidth: 170 }}
          >
            {writable.map(c => <option key={c.id} value={c.id}>{c.summary}에 추가</option>)}
          </select>
        )}
        <GCalButton />
      </div>

      <div ref={bodyRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {isMonth
          ? <MonthGrid gridStart={fmt(gridStart)} calYear={anchor.getFullYear()} calMonth={anchor.getMonth()} />
          : <TimelineGrid days={days} lead={LEAD} />}
      </div>
    </div>
  )
}

/** 일 / 3일 / 주 / 월, as one segmented control. */
function RangeSwitch({ value, onChange }: { value: CalRange; onChange: (r: CalRange) => void }) {
  const options: { key: CalRange; label: string }[] = [
    { key: 1, label: '일' },
    { key: 3, label: '3일' },
    { key: 7, label: '주' },
    { key: 'month', label: '월' },
  ]
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 2, padding: 2,
      background: 'var(--bg3)', borderRadius: 999, flexShrink: 0,
    }}>
      {options.map(o => {
        const on = o.key === value
        return (
          <button
            key={String(o.key)}
            onClick={() => onChange(o.key)}
            style={{
              padding: '3px 12px', borderRadius: 999, border: 'none', cursor: 'pointer',
              background: on ? 'var(--bg)' : 'transparent',
              color: on ? 'var(--t1)' : 'var(--t2)',
              fontWeight: on ? 600 : 400, fontSize: 12,
              boxShadow: on ? '0 1px 2px rgba(0,0,0,.08)' : 'none',
              fontFamily: 'var(--font)', whiteSpace: 'nowrap',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function MonthGrid({ gridStart, calYear, calMonth }: { gridStart: string; calYear: number; calMonth: number }) {
  // Clicking a day opens the planner there; see DayPlanner for why both
  // "make a new one" and "place an existing one" live in the same popover.
  const [planning, setPlanning] = useState<{ date: string; anchor: HTMLElement } | null>(null)
  const { openTaskDetail, projectId } = useUiStore()
  const tasks = useFilteredTasks()
  const { updateTask, tasks: allTasks } = useTaskStore()
  const allMilestones = useMilestoneStore(s => s.milestones)
  const projects = useProjectStore(s => s.projects)
  const milestones = useMemo(() => {
    const ids = new Set(projects.map(p => p.id))
    return allMilestones.filter(m => ids.has(m.projectId))
  }, [allMilestones, projects])
  const { token, events: gcalEvents, ensureEvents } = useGCalStore()

  // A buffer week above and below the six on screen, so a scroll parked between
  // two weeks has something to show in the gap.
  const trackStart = useMemo(() => addDays(toDate(gridStart), -7), [gridStart])

  // Fetch GCal events for the grid on screen, whichever weeks it happens to
  // start and end on.
  useEffect(() => {
    if (!token) return
    ensureEvents(fmt(trackStart), fmt(addDays(trackStart, 55)))
  }, [token, gridStart])

  const milestoneByDate = useMemo(() => {
    const map: Record<string, { name: string; color: string }[]> = {}
    const filtered = projectId ? milestones.filter(m => m.projectId === projectId) : milestones
    filtered.forEach(m => {
      if (!map[m.dueDate]) map[m.dueDate] = []
      map[m.dueDate].push({ name: m.name, color: '#9065B0' })
    })
    return map
  }, [milestones, projectId])

  // Everything a cell draws, indexed by day and built once.
  //
  // Each cell used to filter the whole task list for itself — 56 passes per
  // render — and rebuild its own arrays, so no cell could ever be skipped on a
  // re-render. Scrolling a month redrew all 56 for the sake of the 7 that had
  // changed, and that is what made it stutter. Stable arrays let MonthCell's
  // memo hold.
  //
  // Events are indexed by their start day only; a week-long one would otherwise
  // flood every cell it touches.
  const chipsByDate = useMemo(() => {
    const map = new Map<string, Chip[]>()
    const put = (day: string, chip: Chip) => {
      const at = map.get(day)
      if (at) at.push(chip); else map.set(day, [chip])
    }
    gcalEvents.forEach(ev => { if (ev.start) put(ev.start, { kind: 'gcal', ev }) })
    tasks.forEach(t => { const day = t.due ?? t.start; if (day) put(day, { kind: 'task', t }) })
    return map
  }, [gcalEvents, tasks])

  const [dragOver, setDragOver]     = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const todayStr = fmt(new Date())

  const cells: { date: Date; isCurrentMonth: boolean }[] = []
  for (let i = 0; i < 56; i++) {
    const date = addDays(trackStart, i)
    cells.push({ date, isCurrentMonth: date.getMonth() === calMonth && date.getFullYear() === calYear })
  }

  const handleDrop = useCallback((e: React.DragEvent, dropDay: string) => {
    e.preventDefault()
    const taskId      = e.dataTransfer.getData('taskId')
    const fromDateStr = e.dataTransfer.getData('fromDate')
    if (!taskId || !fromDateStr) return
    const task = tasks.find(t => t.id === taskId)
    if (!task) return
    const dropDate = parseDate(dropDay)
    const offset = dayDiff(parseDate(fromDateStr), dropDate)
    if (offset === 0) { setDragOver(null); return }
    const patch: Partial<Task> = {}
    if (task.start) patch.start = fmt(addDays(parseDate(task.start), offset))
    if (task.due)   patch.due   = fmt(addDays(parseDate(task.due),   offset))
    if (!task.start && !task.due) patch.due = fmt(dropDate)
    updateTask(taskId, patch)
    getBlockingCascade(taskId, allTasks).forEach(id => {
      const dep = allTasks.find(t => t.id === id)
      if (!dep) return
      const cp: Partial<Task> = {}
      if (dep.start) cp.start = fmt(addDays(parseDate(dep.start), offset))
      if (dep.due)   cp.due   = fmt(addDays(parseDate(dep.due),   offset))
      updateTask(id, cp)
    })
    setDragOver(null)
  }, [tasks, allTasks, updateTask])

  const onDragOverDay   = useCallback((day: string) => setDragOver(day), [])
  const onDragLeaveDay  = useCallback(() => setDragOver(null), [])
  const onPlanDay       = useCallback((day: string, anchor: HTMLElement) => setPlanning({ date: day, anchor }), [])
  const onTaskDragStart = useCallback((taskId: string) => setDraggingId(taskId), [])
  const onTaskDragEnd   = useCallback(() => { setDraggingId(null); setDragOver(null) }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {/* Day-of-week labels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderBottom: '1px solid var(--bd)', background: 'var(--bg2)', flexShrink: 0 }}>
        {DAY_LABELS.map((d, i) => (
          <div key={d} style={{ padding: '7px 10px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: i === 0 || i === 6 ? 'rgba(55,53,47,.35)' : 'var(--t3)' }}>
            {d}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflow: 'hidden', background: 'var(--bg)' }}>
        {/* Eight rows in the height of six, pulled up by one: the first and last
            are the buffer the scroll slides into. --slide is the part of a week
            currently being crossed; see useWheelSlide.

            minmax(0, 1fr) rather than 1fr: a track sized 1fr still refuses to go
            below its content's own width, so one long entry used to widen its
            column and squeeze the rest. Paired with minWidth: 0 down the tree,
            the seven columns stay identical at any window size. */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
          gridTemplateRows: 'repeat(8, 1fr)', height: `${(8 / 6) * 100}%`,
          transform: 'translateY(calc(-12.5% + var(--slide, 0px)))',
          willChange: 'transform',
        }}>
          {cells.map(({ date, isCurrentMonth }, i) => {
            const dateStr = fmt(date)
            return (
              <MonthCell
                key={dateStr}
                day={dateStr}
                dayOfMonth={date.getDate()}
                column={i % 7}
                isCurrentMonth={isCurrentMonth}
                isToday={dateStr === todayStr}
                isDragTarget={dragOver === dateStr}
                chips={chipsByDate.get(dateStr)}
                milestones={milestoneByDate[dateStr]}
                draggingId={draggingId}
                onDragOverDay={onDragOverDay}
                onDragLeaveDay={onDragLeaveDay}
                onDropDay={handleDrop}
                onPlanDay={onPlanDay}
                onOpenTask={openTaskDetail}
                onTaskDragStart={onTaskDragStart}
                onTaskDragEnd={onTaskDragEnd}
              />
            )
          })}
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
 * One day of the month grid.
 *
 * Memoised, and that is the point: scrolling a month swaps seven cells and
 * leaves forty-nine exactly as they were. Every prop is a primitive or an array
 * whose identity the parent holds stable, so React can compare them cheaply and
 * skip the rest.
 */
const MonthCell = React.memo(function MonthCell({
  day, dayOfMonth, column, isCurrentMonth, isToday, isDragTarget,
  chips, milestones, draggingId,
  onDragOverDay, onDragLeaveDay, onDropDay, onPlanDay, onOpenTask,
  onTaskDragStart, onTaskDragEnd,
}: {
  day: string
  dayOfMonth: number
  column: number
  isCurrentMonth: boolean
  isToday: boolean
  isDragTarget: boolean
  chips?: Chip[]
  milestones?: { name: string; color: string }[]
  draggingId: string | null
  onDragOverDay: (day: string) => void
  onDragLeaveDay: () => void
  onDropDay: (e: React.DragEvent, day: string) => void
  onPlanDay: (day: string, anchor: HTMLElement) => void
  onOpenTask: (id: string) => void
  onTaskDragStart: (taskId: string) => void
  onTaskDragEnd: () => void
}) {
  const all = chips ?? []
  const hasMilestone = !!milestones?.length
  const isWeekend = column === 0 || column === 6

  const LIMIT = 5
  const visible = all.length <= LIMIT ? all : all.slice(0, LIMIT - 1)
  const overflow = all.length - visible.length

  return (
    <div
      data-month-cell
      onDragOver={e => { e.preventDefault(); onDragOverDay(day) }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) onDragLeaveDay() }}
      onDrop={e => onDropDay(e, day)}
      onClick={e => onPlanDay(day, e.currentTarget)}
      style={{
        cursor: 'pointer',
        borderRight: column === 6 ? 'none' : '1px solid var(--bd)',
        borderBottom: '1px solid var(--bd)',
        display: 'flex', flexDirection: 'column',
        minHeight: 90, minWidth: 0, overflow: 'hidden',
        background: isDragTarget ? 'var(--ac-l)' : hasMilestone ? 'rgba(144,101,176,.05)' : !isCurrentMonth ? 'var(--bg2)' : isToday ? 'rgba(35,131,226,.03)' : isWeekend ? 'var(--bg2)' : 'transparent',
        outline: isDragTarget ? '2px solid var(--ac)' : hasMilestone ? '2px solid rgba(144,101,176,.30)' : 'none',
        outlineOffset: '-2px',
        transition: 'background .08s',
      }}
    >
      {/* Date number + milestone diamonds */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '5px 8px 3px', gap: 4 }}>
        {hasMilestone && (
          <div style={{ display: 'flex', gap: 3, alignItems: 'center', flex: 1, minWidth: 0, overflow: 'hidden' }}>
            {milestones!.map((ms, mi) => (
              <span key={mi} title={ms.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 600, color: NOTION.purple.text, background: NOTION.purple.bg, borderRadius: 4, padding: '1px 5px', minWidth: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                ◆ {ms.name}
              </span>
            ))}
          </div>
        )}
        <span style={{ fontSize: 12, fontWeight: isToday ? 700 : 400, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: isToday ? 22 : 'auto', height: isToday ? 22 : 'auto', borderRadius: isToday ? '50%' : 0, background: isToday ? 'var(--ac)' : 'transparent', color: isToday ? '#fff' : !isCurrentMonth ? 'var(--t3)' : 'var(--t2)' }}>
          {dayOfMonth}
        </span>
      </div>

      {/* Events */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 3px 4px', minWidth: 0 }}>
        {visible.map((chip, ci) => {
          if (chip.kind === 'gcal') {
            const ev = chip.ev
            return (
              <a
                key={ev.id}
                href={ev.htmlLink}
                target="_blank"
                rel="noopener noreferrer"
                title={ev.summary}
                style={{ fontSize: 10, fontWeight: 500, padding: '2px 6px', borderRadius: 3, background: GCAL_BG, color: GCAL_TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none', display: 'block', cursor: 'pointer', minWidth: 0 }}
                onClick={e => e.stopPropagation()}
                onMouseEnter={e => e.currentTarget.style.opacity = '.75'}
                onMouseLeave={e => e.currentTarget.style.opacity = '1'}
              >
                {ev.startTime ? `${ev.startTime} ` : ''}{ev.summary}
              </a>
            )
          }
          const t = chip.t
          const color = getCatColor(t.cat)
          const isBeingDragged = draggingId === t.id
          return (
            <div
              key={t.id + ci}
              draggable
              onDragStart={e => { e.dataTransfer.setData('taskId', t.id); e.dataTransfer.setData('fromDate', day); e.dataTransfer.effectAllowed = 'move'; onTaskDragStart(t.id) }}
              onDragEnd={onTaskDragEnd}
              onClick={e => { e.stopPropagation(); onOpenTask(t.id) }}
              style={{ fontSize: 10, fontWeight: 500, padding: '2px 6px', borderRadius: 3, background: color.bg, color: color.text, cursor: 'grab', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: isBeingDragged ? .35 : 1, transition: 'opacity .1s', userSelect: 'none', minWidth: 0 }}
              onMouseEnter={e => { if (!isBeingDragged) e.currentTarget.style.opacity = '.75' }}
              onMouseLeave={e => { if (!isBeingDragged) e.currentTarget.style.opacity = '1' }}
            >
              {t.name}
            </div>
          )
        })}
        {overflow > 0 && (
          <div style={{ fontSize: 10, color: 'var(--t3)', padding: '0 6px' }}>+{overflow}개 더</div>
        )}
      </div>
    </div>
  )
})

function NavBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ padding: '4px 10px', borderRadius: 'var(--r1)', border: '1px solid var(--bd)', background: 'transparent', fontSize: 12, color: 'var(--t2)', cursor: 'pointer', fontFamily: 'var(--font)', lineHeight: 1.5 }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg2)'; e.currentTarget.style.color = 'var(--t1)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t2)' }}
    >
      {children}
    </button>
  )
}
