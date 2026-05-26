import React, { useState, useMemo, useRef, useEffect } from 'react'
import { useUiStore } from '../../../store/uiStore'
import { useFilteredTasks } from '../../../hooks/useFilteredTasks'
import { useTaskStore } from '../../../store/taskStore'
import { useMilestoneStore } from '../../../store/milestoneStore'
import { useProjectStore } from '../../../store/projectStore'
import { useGCalStore } from '../../../store/gcalStore'
import type { GCalEvent } from '../../../store/gcalStore'
import { useMobile } from '../../../hooks/useMobile'
import { getCatColor } from '../../../types'
import { addDays, toDate, fmtYMD, dayDiff, getBlockingCascade } from '../../../lib/utils'
import type { Task } from '../../../types'

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']
const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']

const fmt = fmtYMD
const parseDate = toDate

// Google Calendar event color
const GCAL_BG   = 'rgba(52,168,83,.18)'
const GCAL_TEXT = '#1a7a33'

// ── Status badge (mobile) ─────────────────────────────────────────────────────

const MOB_STATUS: Record<string, { bg: string; color: string }> = {
  '진행중': { bg: 'rgba(35,131,226,.15)', color: '#1869c9' },
  '대기':   { bg: 'rgba(120,117,114,.14)', color: '#5a5857' },
  '검토중': { bg: '#fef3c7',              color: '#b45309' },
  '완료':   { bg: '#d1fae5',              color: '#047857' },
}

// ── GCal connect button ───────────────────────────────────────────────────────

function GCalButton() {
  const { token, loading, error, connect, disconnect } = useGCalStore()

  if (token) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: GCAL_TEXT, background: GCAL_BG, padding: '3px 8px', borderRadius: 20, fontWeight: 600 }}>
          <GoogleDot /> 캘린더 연동됨
        </span>
        <button
          onClick={disconnect}
          title="연동 해제"
          style={{ fontSize: 11, color: 'var(--t3)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 'var(--r1)' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--t1)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--t3)'}
        >
          ✕
        </button>
      </div>
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
        background: error ? 'rgba(239,68,68,.07)' : 'transparent',
        fontSize: 12, color: error ? '#dc2626' : 'var(--t2)',
        cursor: loading ? 'default' : 'pointer',
        opacity: loading ? .6 : 1,
        fontFamily: 'var(--font)',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => { if (!loading) e.currentTarget.style.background = 'var(--bg2)' }}
      onMouseLeave={e => { e.currentTarget.style.background = error ? 'rgba(239,68,68,.07)' : 'transparent' }}
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
  const { token, events: gcalEvents, fetchEvents } = useGCalStore()

  const todayDate = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])
  const todayStr  = useMemo(() => fmt(todayDate), [todayDate])
  const [selectedDate, setSelectedDate] = useState(todayStr)

  // Fetch GCal events for a 3-month window around today
  useEffect(() => {
    if (!token) return
    const from = fmt(addDays(todayDate, -14))
    const to   = fmt(addDays(todayDate, 75))
    fetchEvents(from, to)
  }, [token])

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

  // Group GCal events by date (may span multiple days)
  const gcalByDate = useMemo(() => {
    const map = new Map<string, GCalEvent[]>()
    gcalEvents.forEach(ev => {
      let cur = ev.start
      while (cur <= ev.end) {
        if (!map.has(cur)) map.set(cur, [])
        map.get(cur)!.push(ev)
        // advance 1 day
        const d = new Date(cur + 'T00:00:00')
        d.setDate(d.getDate() + 1)
        cur = d.toISOString().slice(0, 10)
      }
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
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(239,68,68,.12)', color: '#dc2626', borderRadius: 20, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              <span>⚠</span> 기한 초과 {overdueTasks.length}개
            </div>
          ) : <div />}
          <GCalButton />
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
                <span style={{ fontSize: 10, fontWeight: 500, color: isSelected ? 'rgba(255,255,255,.8)' : isSun ? '#ef4444' : isSat ? '#3b82f6' : 'var(--t3)' }}>
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
            <SectionHeader label="기한 초과" count={overdueTasks.length} color="#dc2626" />
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
              <SectionHeader label={fmtSection(dateStr)} count={total} color={dateStr === todayStr ? 'var(--ac)' : 'var(--t2)'} />
              {dayGCal.map(ev => <MobGCalRow key={ev.id} event={ev} />)}
              {dayTasks.length === 0 && dayGCal.length === 0 ? (
                <div style={{ padding: '4px 16px 8px', fontSize: 13, color: 'var(--t3)' }}>업무 없음</div>
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
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: overdue ? '#ef4444' : 'var(--ac)', flexShrink: 0 }} />
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
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: GCAL_TEXT, flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 14, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {event.summary}
      </span>
      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: GCAL_BG, color: GCAL_TEXT, flexShrink: 0 }}>
        구글
      </span>
      <span style={{ fontSize: 12, color: 'var(--t3)', flexShrink: 0 }}>↗</span>
    </a>
  )
}

// ── Desktop calendar ──────────────────────────────────────────────────────────

export function CalendarView() {
  const isMobile = useMobile()
  if (isMobile) return <MobileCalendar />
  return <DesktopCalendar />
}

function DesktopCalendar() {
  const { calYear, calMonth, calNav, calToday, openTaskDetail, projectId } = useUiStore()
  const tasks = useFilteredTasks()
  const { updateTask, tasks: allTasks } = useTaskStore()
  const allMilestones = useMilestoneStore(s => s.milestones)
  const projects = useProjectStore(s => s.projects)
  const milestones = useMemo(() => {
    const ids = new Set(projects.map(p => p.id))
    return allMilestones.filter(m => ids.has(m.projectId))
  }, [allMilestones, projects])
  const { token, events: gcalEvents, fetchEvents } = useGCalStore()

  // Fetch GCal events when month changes
  useEffect(() => {
    if (!token) return
    // Cover the full 6-week grid: some days before/after the month
    const start = new Date(calYear, calMonth, -6)
    const end   = new Date(calYear, calMonth + 1, 14)
    fetchEvents(fmt(start), fmt(end))
  }, [token, calYear, calMonth])

  const milestoneByDate = useMemo(() => {
    const map: Record<string, { name: string; color: string }[]> = {}
    const filtered = projectId ? milestones.filter(m => m.projectId === projectId) : milestones
    filtered.forEach(m => {
      if (!map[m.dueDate]) map[m.dueDate] = []
      map[m.dueDate].push({ name: m.name, color: '#8b5cf6' })
    })
    return map
  }, [milestones, projectId])

  // GCal events indexed per date (multi-day events appear on each day)
  const gcalByDate = useMemo(() => {
    const map: Record<string, GCalEvent[]> = {}
    gcalEvents.forEach(ev => {
      let cur = ev.start
      while (cur <= ev.end) {
        if (!map[cur]) map[cur] = []
        map[cur].push(ev)
        const d = new Date(cur + 'T00:00:00'); d.setDate(d.getDate() + 1)
        cur = d.toISOString().slice(0, 10)
      }
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
      if (t.start && t.due) return t.start <= d && t.due >= d
      return t.due === d || t.start === d
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
      {/* Toolbar */}
      <div style={{ background: 'var(--bg)', borderBottom: '1px solid var(--bd)', padding: '0 16px', height: 44, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <NavBtn onClick={calToday}>오늘</NavBtn>
        <NavBtn onClick={() => calNav(-1)}>‹</NavBtn>
        <NavBtn onClick={() => calNav(1)}>›</NavBtn>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)', minWidth: 110 }}>
          {calYear}년 {MONTHS[calMonth]}
        </span>
        <div style={{ flex: 1 }} />
        <GCalButton />
      </div>

      {/* Day-of-week labels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--bd)', background: 'var(--bg2)', flexShrink: 0 }}>
        {DAY_LABELS.map((d, i) => (
          <div key={d} style={{ padding: '7px 10px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: i === 0 || i === 6 ? 'rgba(55,53,47,.35)' : 'var(--t3)' }}>
            {d}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridTemplateRows: 'repeat(6, 1fr)', height: '100%' }}>
          {cells.map(({ date, isCurrentMonth }, i) => {
            const dateStr      = fmt(date)
            const isToday      = dateStr === fmt(today)
            const isDragTarget = dragOver === dateStr
            const dayTasks     = tasksByDate(date)
            const dayGCal      = gcalByDate[dateStr] ?? []
            const dayMilestones = milestoneByDate[dateStr] ?? []
            const hasMilestone = dayMilestones.length > 0
            const dow = date.getDay()
            const isWeekend = dow === 0 || dow === 6
            // How many task chips we can show (leave 1 slot for GCal)
            const maxTaskChips = dayGCal.length > 0 ? 2 : 3

            return (
              <div
                key={i}
                onDragOver={e => { e.preventDefault(); setDragOver(dateStr) }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null) }}
                onDrop={e => handleDrop(e, date)}
                style={{
                  borderRight: (i + 1) % 7 === 0 ? 'none' : '1px solid var(--bd)',
                  borderBottom: '1px solid var(--bd)',
                  display: 'flex', flexDirection: 'column',
                  minHeight: 90,
                  background: isDragTarget ? 'var(--ac-l)' : hasMilestone ? 'rgba(139,92,246,.04)' : !isCurrentMonth ? 'var(--bg2)' : isToday ? 'rgba(35,131,226,.03)' : isWeekend ? 'var(--bg2)' : 'transparent',
                  outline: isDragTarget ? '2px solid var(--ac)' : hasMilestone ? '2px solid rgba(139,92,246,.35)' : 'none',
                  outlineOffset: '-2px',
                  transition: 'background .08s',
                }}
              >
                {/* Date number + milestone diamonds */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '5px 8px 3px', gap: 4 }}>
                  {hasMilestone && (
                    <div style={{ display: 'flex', gap: 3, alignItems: 'center', flex: 1 }}>
                      {dayMilestones.map((ms, mi) => (
                        <span key={mi} title={ms.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 600, color: '#8b5cf6', background: 'rgba(139,92,246,.12)', borderRadius: 4, padding: '1px 5px', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 3px 4px' }}>
                  {/* Task chips */}
                  {dayTasks.slice(0, maxTaskChips).map(t => {
                    const color = getCatColor(t.cat)
                    const isBeingDragged = draggingId === t.id
                    return (
                      <div
                        key={t.id}
                        draggable
                        onDragStart={e => { e.dataTransfer.setData('taskId', t.id); e.dataTransfer.setData('fromDate', dateStr); e.dataTransfer.effectAllowed = 'move'; setDraggingId(t.id) }}
                        onDragEnd={() => { setDraggingId(null); setDragOver(null) }}
                        onClick={() => openTaskDetail(t.id)}
                        style={{ fontSize: 10, fontWeight: 500, padding: '2px 6px', borderRadius: 3, background: color.bg, color: color.text, cursor: 'grab', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: isBeingDragged ? .35 : 1, transition: 'opacity .1s', userSelect: 'none' }}
                        onMouseEnter={e => { if (!isBeingDragged) e.currentTarget.style.opacity = '.75' }}
                        onMouseLeave={e => { if (!isBeingDragged) e.currentTarget.style.opacity = '1' }}
                      >
                        {t.name}
                      </div>
                    )
                  })}

                  {/* GCal chips */}
                  {dayGCal.slice(0, 1).map(ev => (
                    <a
                      key={ev.id}
                      href={ev.htmlLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={ev.summary}
                      style={{ fontSize: 10, fontWeight: 500, padding: '2px 6px', borderRadius: 3, background: GCAL_BG, color: GCAL_TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none', display: 'block', cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.opacity = '.75'}
                      onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                    >
                      📅 {ev.summary}
                    </a>
                  ))}

                  {/* Overflow indicator */}
                  {(dayTasks.length > maxTaskChips || dayGCal.length > 1) && (
                    <div style={{ fontSize: 10, color: 'var(--t3)', padding: '0 6px' }}>
                      +{Math.max(0, dayTasks.length - maxTaskChips) + Math.max(0, dayGCal.length - 1)}개 더
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
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
