import React, { useState, useMemo, useRef, useEffect, Component } from 'react'
import { useUiStore } from '../../../store/uiStore'
import { useFilteredTasks } from '../../../hooks/useFilteredTasks'
import { useTaskStore } from '../../../store/taskStore'
import { useMilestoneStore } from '../../../store/milestoneStore'
import { DayPlanner } from './DayPlanner'
import { useProjectStore } from '../../../store/projectStore'
import { useUserProfileStore } from '../../../store/userProfileStore'
import { useGCalStore } from '../../../store/gcalStore'
import { TimelineGrid } from '../timeline'
import { writableCalendars } from '../../../lib/googleCalendar'
import type { CalRange } from '../../../types'
import type { GCalEvent } from '../../../store/gcalStore'
import { useAuthStore } from '../../../store/authStore'
import { useMobile } from '../../../hooks/useMobile'
import { getCatColor, MEMBERS, STATUS_LIST, NOTION } from '../../../types'
import type { MemberKey, Status } from '../../../types'
import { addDays, toDate, fmtYMD, dayDiff, getBlockingCascade } from '../../../lib/utils'
import type { Task } from '../../../types'

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
  const { openTaskModal, openTaskDetail, filters, setFilters, resetFilters, showGCal, setShowGCal } = useUiStore()
  const tasks = useFilteredTasks()
  const { token, events: gcalEvents, ensureEvents } = useGCalStore()
  const allProjects = useProjectStore(s => s.projects)
  const getNameByEmail = useUserProfileStore(s => s.getNameByEmail)
  const email = useAuthStore(s => s.email)

  const accessibleProjects = useMemo(() =>
    allProjects
  , [allProjects, email])

  const allAssigneeOptions = useMemo(() => {
    const keys = new Set<string>()
    accessibleProjects.forEach(p => p.memberEmails?.forEach(e => keys.add(e)))
    return Array.from(keys).sort().map(key => {
      const known = MEMBERS[key as MemberKey]
      return { value: key, label: known?.n ?? getNameByEmail(key) }
    })
  }, [accessibleProjects, getNameByEmail])
  const allTagOptions = useMemo(() => {
    const s = new Set<string>(); tasks.forEach(t => t.tags?.forEach(tag => s.add(tag))); return Array.from(s).sort()
  }, [tasks])
  const hasFilters = filters.assignees.length > 0 || filters.statuses.length > 0 || filters.tags.length > 0 || filters.projects.length > 0

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

        {/* Filter row */}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, scrollbarWidth: 'none' }}>
          {accessibleProjects.length > 1 && (
            <MobFilterSelect
              label="프로젝트" active={filters.projects.length > 0}
              options={accessibleProjects.map(p => ({ value: p.id, label: p.name }))}
              selected={filters.projects} onChange={v => setFilters({ projects: v })}
            />
          )}
          {allAssigneeOptions.length > 0 && (
            <MobFilterSelect
              label="담당자" active={filters.assignees.length > 0}
              options={allAssigneeOptions}
              selected={filters.assignees} onChange={v => setFilters({ assignees: v })}
            />
          )}
          <MobFilterSelect
            label="상태" active={filters.statuses.length > 0}
            options={STATUS_LIST.map(s => ({ value: s, label: s }))}
            selected={filters.statuses} onChange={v => setFilters({ statuses: v as Status[] })}
          />
          {allTagOptions.length > 0 && (
            <MobFilterSelect
              label="태그" active={filters.tags.length > 0}
              options={allTagOptions.map(t => ({ value: t, label: `#${t}` }))}
              selected={filters.tags} onChange={v => setFilters({ tags: v })}
            />
          )}
          <button
            onClick={() => setShowGCal(!showGCal)}
            style={{ flexShrink: 0, padding: '4px 10px', borderRadius: 20, border: showGCal ? '1px solid rgba(68,131,97,.4)' : '1px solid var(--bd)', background: showGCal ? 'rgba(68,131,97,.12)' : 'transparent', color: showGCal ? '#448361' : 'var(--t3)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font)', whiteSpace: 'nowrap' }}
          >
            📅 일정
          </button>
          {hasFilters && (
            <button onClick={resetFilters} style={{ flexShrink: 0, padding: '4px 10px', borderRadius: 20, border: '1px solid rgba(212,76,71,.25)', background: 'rgba(212,76,71,.05)', color: '#D44C47', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font)', whiteSpace: 'nowrap' }}>
              ✕ 초기화
            </button>
          )}
        </div>

        {/* Date strip */}
        <div ref={stripRef} style={{ display: 'flex', gap: 2, overflowX: 'auto', paddingBottom: 10, scrollbarWidth: 'none' }}>
          {stripDates.map(dateStr => {
            const d = new Date(dateStr + 'T00:00:00')
            const dow = DAY_LABELS[d.getDay()]
            const day = d.getDate()
            const isToday    = dateStr === todayStr
            const isSelected = dateStr === selectedDate
            const hasTasks   = tasksByDate.has(dateStr)
            const hasGCal    = showGCal && gcalByDate.has(dateStr)
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
          const dayGCal  = showGCal ? (gcalByDate.get(dateStr) ?? []) : []
          const total = dayTasks.length + dayGCal.length
          return (
            <div key={dateStr} ref={el => { if (el) sectionRefs.current.set(dateStr, el) }}>
              {/* Tapping the day's heading opens the planner for it — the same
                  place the desktop grid puts it, and the only element here that
                  means "this day" rather than "this task". */}
              <div onClick={e => setPlanning({ date: dateStr, anchor: e.currentTarget })} style={{ cursor: 'pointer' }}>
                <SectionHeader label={fmtSection(dateStr)} count={total} color={dateStr === todayStr ? 'var(--ac)' : 'var(--t2)'} />
              </div>
              {dayGCal.map(ev => <MobGCalRow key={ev.id} event={ev} />)}
              {dayTasks.length === 0 && dayGCal.length === 0 ? (
                <div
                  onClick={e => setPlanning({ date: dateStr, anchor: e.currentTarget })}
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

// ── Mobile filter select ──────────────────────────────────────────────────────

function MobFilterSelect<T extends string>({ label, active, options, selected, onChange }: {
  label: string; active: boolean
  options: { value: T; label: string }[]
  selected: T[]; onChange: (v: T[]) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [pos, setPos] = React.useState({ top: 0, left: 0 })
  const ref = React.useRef<HTMLDivElement>(null)
  const btnRef = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const toggle = (v: T) => onChange(selected.includes(v) ? selected.filter(s => s !== v) : [...selected, v])

  const handleOpen = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 180) })
    }
    setOpen(o => !o)
  }

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        ref={btnRef}
        onClick={handleOpen}
        style={{ padding: '4px 10px', borderRadius: 20, border: active ? '1px solid var(--ac)' : '1px solid var(--bd)', background: active ? 'var(--ac-l)' : 'transparent', color: active ? 'var(--ac)' : 'var(--t2)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font)', whiteSpace: 'nowrap' }}
      >
        {active ? `${label} (${selected.length})` : label} <span style={{ fontSize: 8, opacity: .5 }}>▾</span>
      </button>
      {open && (
        <div style={{ position: 'fixed', top: pos.top, left: pos.left, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r3)', boxShadow: 'var(--sh-md)', zIndex: 9000, minWidth: 160, padding: '4px 0' }}>
          {options.map(opt => (
            <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', fontSize: 13, color: 'var(--t1)', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <input type="checkbox" checked={selected.includes(opt.value)} onChange={() => toggle(opt.value)} style={{ accentColor: 'var(--ac)', width: 13, height: 13, cursor: 'pointer', flexShrink: 0 }} />
              {opt.label}
            </label>
          ))}
          {selected.length > 0 && (
            <>
              <div style={{ height: 1, background: 'var(--bd)', margin: '3px 0' }} />
              <button onClick={() => { onChange([]); setOpen(false) }} style={{ width: '100%', padding: '6px 12px', fontSize: 12, color: 'var(--ac)', cursor: 'pointer', border: 'none', background: 'transparent', textAlign: 'left', fontFamily: 'var(--font)' }}>전체 해제</button>
            </>
          )}
        </div>
      )}
    </div>
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
function DesktopCalendar() {
  const { calRange, calAnchor, setCalRange, setCalAnchor } = useUiStore()
  const { calendars, targetCalendarId, canWrite, setTargetCalendar } = useGCalStore()

  const anchor = toDate(calAnchor)
  const isMonth = calRange === 'month'
  const days = useMemo(() => {
    if (calRange === 'month') return []
    // A week starts on Sunday, as the month grid does; a day or three-day range
    // starts where you are.
    const start = calRange === 7 ? addDays(anchor, -anchor.getDay()) : anchor
    return Array.from({ length: calRange }, (_, i) => fmt(addDays(start, i)))
  }, [calAnchor, calRange])

  const shift = (direction: number) => {
    if (calRange === 'month') {
      const next = new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1)
      setCalAnchor(fmt(next))
    } else {
      setCalAnchor(fmt(addDays(anchor, direction * calRange)))
    }
  }

  const label = isMonth
    ? `${anchor.getFullYear()}년 ${MONTHS[anchor.getMonth()]}`
    : days.length === 1
      ? `${anchor.getFullYear()}년 ${MONTHS[anchor.getMonth()]} ${anchor.getDate()}일`
      : (() => {
          const first = toDate(days[0]); const last = toDate(days[days.length - 1])
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
        <NavBtn onClick={() => setCalAnchor(fmt(new Date()))}>오늘</NavBtn>
        <NavBtn onClick={() => shift(-1)}>‹</NavBtn>
        <NavBtn onClick={() => shift(1)}>›</NavBtn>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)', minWidth: 130 }}>{label}</span>

        <RangeSwitch value={calRange} onChange={setCalRange} />

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

      {isMonth
        ? <MonthGrid calYear={anchor.getFullYear()} calMonth={anchor.getMonth()} />
        : <TimelineGrid days={days} />}
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

function MonthGrid({ calYear, calMonth }: { calYear: number; calMonth: number }) {
  // Clicking a day opens the planner there; see DayPlanner for why both
  // "make a new one" and "place an existing one" live in the same popover.
  const [planning, setPlanning] = useState<{ date: string; anchor: HTMLElement } | null>(null)
  const { openTaskDetail, projectId, showGCal } = useUiStore()
  const tasks = useFilteredTasks()
  const { updateTask, tasks: allTasks } = useTaskStore()
  const allMilestones = useMilestoneStore(s => s.milestones)
  const projects = useProjectStore(s => s.projects)
  const milestones = useMemo(() => {
    const ids = new Set(projects.map(p => p.id))
    return allMilestones.filter(m => ids.has(m.projectId))
  }, [allMilestones, projects])
  const { token, events: gcalEvents, ensureEvents } = useGCalStore()

  // Fetch GCal events when month changes
  useEffect(() => {
    if (!token) return
    // Cover the full 6-week grid: some days before/after the month
    const start = new Date(calYear, calMonth, -6)
    const end   = new Date(calYear, calMonth + 1, 14)
    ensureEvents(fmt(start), fmt(end))
  }, [token, calYear, calMonth])

  const milestoneByDate = useMemo(() => {
    const map: Record<string, { name: string; color: string }[]> = {}
    const filtered = projectId ? milestones.filter(m => m.projectId === projectId) : milestones
    filtered.forEach(m => {
      if (!map[m.dueDate]) map[m.dueDate] = []
      map[m.dueDate].push({ name: m.name, color: '#9065B0' })
    })
    return map
  }, [milestones, projectId])

  // GCal events indexed by start date only (avoids long-span events flooding every cell)
  const gcalByDate = useMemo(() => {
    const map: Record<string, GCalEvent[]> = {}
    gcalEvents.forEach(ev => {
      if (!ev.start) return
      if (!map[ev.start]) map[ev.start] = []
      map[ev.start].push(ev)
    })
    return map
  }, [gcalEvents])

  const [dragOver, setDragOver]     = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const today    = new Date()
  const firstDay = new Date(calYear, calMonth, 1).getDay()

  const cells: { date: Date; isCurrentMonth: boolean }[] = []
  for (let i = 0; i < 42; i++) {
    const date = new Date(calYear, calMonth, 1 + (i - firstDay))
    cells.push({ date, isCurrentMonth: date.getMonth() === calMonth })
  }

  const tasksByDate = (date: Date): Task[] => {
    const d = fmt(date)
    return tasks.filter(t => {
      const key = t.due ?? t.start
      return key === d
    })
  }

  const handleDrop = (e: React.DragEvent, dropDate: Date) => {
    e.preventDefault()
    const taskId      = e.dataTransfer.getData('taskId')
    const fromDateStr = e.dataTransfer.getData('fromDate')
    if (!taskId || !fromDateStr) return
    const task = tasks.find(t => t.id === taskId)
    if (!task) return
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
  }

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
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)' }}>
        {/* minmax(0, 1fr) rather than 1fr: a track sized 1fr still refuses to go
            below its content's own width, so one long entry used to widen its
            column and squeeze the rest. Paired with minWidth: 0 down the tree,
            the seven columns stay identical at any window size. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gridTemplateRows: 'repeat(6, 1fr)', height: '100%' }}>
          {cells.map(({ date, isCurrentMonth }, i) => {
            const dateStr      = fmt(date)
            const isToday      = dateStr === fmt(today)
            const isDragTarget = dragOver === dateStr
            const dayTasks     = tasksByDate(date)
            const dayGCal      = showGCal ? (gcalByDate[dateStr] ?? []) : []
            const dayMilestones = milestoneByDate[dateStr] ?? []
            const hasMilestone = dayMilestones.length > 0
            const dow = date.getDay()
            const isWeekend = dow === 0 || dow === 6

            // Combined chip list: GCal first, then tasks
            type Chip = { kind: 'gcal'; ev: GCalEvent } | { kind: 'task'; t: Task }
            const allChips: Chip[] = [
              ...dayGCal.map(ev => ({ kind: 'gcal' as const, ev })),
              ...dayTasks.map(t => ({ kind: 'task' as const, t })),
            ]
            const LIMIT = 5
            const visibleChips = allChips.length <= LIMIT ? allChips : allChips.slice(0, LIMIT - 1)
            const overflow = allChips.length - visibleChips.length

            return (
              <div
                key={i}
                onDragOver={e => { e.preventDefault(); setDragOver(dateStr) }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null) }}
                onDrop={e => handleDrop(e, date)}
                onClick={e => setPlanning({ date: dateStr, anchor: e.currentTarget })}
                style={{
                  cursor: 'pointer',
                  borderRight: (i + 1) % 7 === 0 ? 'none' : '1px solid var(--bd)',
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
                      {dayMilestones.map((ms, mi) => (
                        <span key={mi} title={ms.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 600, color: NOTION.purple.text, background: NOTION.purple.bg, borderRadius: 4, padding: '1px 5px', minWidth: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          ◆ {ms.name}
                        </span>
                      ))}
                    </div>
                  )}
                  <span style={{ fontSize: 12, fontWeight: isToday ? 700 : 400, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: isToday ? 22 : 'auto', height: isToday ? 22 : 'auto', borderRadius: isToday ? '50%' : 0, background: isToday ? 'var(--ac)' : 'transparent', color: isToday ? '#fff' : !isCurrentMonth ? 'var(--t3)' : 'var(--t2)' }}>
                    {date.getDate()}
                  </span>
                </div>

                {/* Events */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 3px 4px', minWidth: 0 }}>
                  {visibleChips.map((chip, ci) => {
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
                        onDragStart={e => { e.dataTransfer.setData('taskId', t.id); e.dataTransfer.setData('fromDate', dateStr); e.dataTransfer.effectAllowed = 'move'; setDraggingId(t.id) }}
                        onDragEnd={() => { setDraggingId(null); setDragOver(null) }}
                        onClick={e => { e.stopPropagation(); openTaskDetail(t.id) }}
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
