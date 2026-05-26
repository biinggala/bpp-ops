import React, { useState, useMemo, useRef, useEffect } from 'react'
import { useUiStore } from '../../../store/uiStore'
import { useFilteredTasks } from '../../../hooks/useFilteredTasks'
import { useTaskStore } from '../../../store/taskStore'
import { useMilestoneStore } from '../../../store/milestoneStore'
import { useMobile } from '../../../hooks/useMobile'
import { getCatColor } from '../../../types'
import { addDays, toDate, fmtYMD, dayDiff, getBlockingCascade } from '../../../lib/utils'
import type { Task } from '../../../types'

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']
const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']

const fmt = fmtYMD
const parseDate = toDate

// ── Status badge style ────────────────────────────────────────────────────────

const MOB_STATUS: Record<string, { bg: string; color: string }> = {
  '진행중': { bg: 'rgba(35,131,226,.15)', color: '#1869c9' },
  '대기':   { bg: 'rgba(120,117,114,.14)', color: '#5a5857' },
  '검토중': { bg: '#fef3c7',              color: '#b45309' },
  '완료':   { bg: '#d1fae5',              color: '#047857' },
}

// ── Mobile calendar ───────────────────────────────────────────────────────────

function MobileCalendar() {
  const { openTaskModal, openTaskDetail, projectId } = useUiStore()
  const tasks = useFilteredTasks()

  const todayDate = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d }, [])
  const todayStr = useMemo(() => fmt(todayDate), [todayDate])

  const [selectedDate, setSelectedDate] = useState(todayStr)

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

  const overdueTasks = useMemo(() =>
    tasks.filter(t => {
      const due = t.due ?? t.start
      return due && due < todayStr && t.status !== '완료'
    }),
    [tasks, todayStr]
  )

  // Date strip: 14 days before today + 45 days after
  const stripDates = useMemo(() => {
    const dates: string[] = []
    for (let i = -14; i <= 45; i++) {
      dates.push(fmt(addDays(todayDate, i)))
    }
    return dates
  }, [todayDate])

  // Content dates: today + 60 days that have tasks, plus always show selected date
  const contentDates = useMemo(() => {
    const set = new Set<string>()
    for (let i = 0; i <= 60; i++) {
      const d = fmt(addDays(todayDate, i))
      if (tasksByDate.has(d)) set.add(d)
    }
    set.add(selectedDate)
    return Array.from(set).sort()
  }, [tasksByDate, todayDate, selectedDate])

  // Refs for strip scroll and section scroll-to
  const stripRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Scroll strip so selected date is centered
  useEffect(() => {
    const el = stripRef.current?.querySelector(`[data-date="${selectedDate}"]`) as HTMLElement | null
    if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [selectedDate])

  const scrollToSection = (dateStr: string) => {
    const el = sectionRefs.current.get(dateStr)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleDateSelect = (dateStr: string) => {
    setSelectedDate(dateStr)
    scrollToSection(dateStr)
  }

  const fmtSection = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00')
    const dow = DAY_LABELS[d.getDay()]
    const diff = Math.round((d.getTime() - todayDate.getTime()) / 86400000)
    const month = d.getMonth() + 1
    const day = d.getDate()
    if (diff === 0) return `오늘 (${month}/${day} ${dow})`
    if (diff === 1) return `내일 (${month}/${day} ${dow})`
    if (diff === -1) return `어제 (${month}/${day} ${dow})`
    return `${month}/${day} (${dow})`
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ background: 'var(--bg)', borderBottom: '1px solid var(--bd)', padding: '10px 16px 0', flexShrink: 0 }}>
        {/* Overdue chip */}
        {overdueTasks.length > 0 && (
          <div
            onClick={() => {
              const el = sectionRefs.current.get('__overdue__')
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(239,68,68,.12)', color: '#dc2626', borderRadius: 20, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', marginBottom: 10 }}
          >
            <span style={{ fontSize: 14 }}>⚠</span>
            기한 초과 {overdueTasks.length}개
          </div>
        )}

        {/* Date strip */}
        <div
          ref={stripRef}
          style={{ display: 'flex', gap: 2, overflowX: 'auto', paddingBottom: 10, scrollbarWidth: 'none' }}
        >
          {stripDates.map(dateStr => {
            const d = new Date(dateStr + 'T00:00:00')
            const dow = DAY_LABELS[d.getDay()]
            const day = d.getDate()
            const isToday = dateStr === todayStr
            const isSelected = dateStr === selectedDate
            const hasTasks = tasksByDate.has(dateStr)
            const isSun = d.getDay() === 0
            const isSat = d.getDay() === 6
            return (
              <button
                key={dateStr}
                data-date={dateStr}
                onClick={() => handleDateSelect(dateStr)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                  minWidth: 44, padding: '6px 4px', border: 'none', borderRadius: 10,
                  background: isSelected ? 'var(--ac)' : 'transparent',
                  cursor: 'pointer', flexShrink: 0,
                }}
              >
                <span style={{ fontSize: 10, fontWeight: 500, color: isSelected ? 'rgba(255,255,255,.8)' : isSun ? '#ef4444' : isSat ? '#3b82f6' : 'var(--t3)' }}>
                  {isToday ? '오늘' : dow}
                </span>
                <span style={{ fontSize: 16, fontWeight: isToday || isSelected ? 700 : 400, color: isSelected ? '#fff' : isToday ? 'var(--ac)' : 'var(--t1)', lineHeight: 1 }}>
                  {day}
                </span>
                <span style={{ width: 4, height: 4, borderRadius: '50%', background: hasTasks ? (isSelected ? 'rgba(255,255,255,.7)' : 'var(--ac)') : 'transparent' }} />
              </button>
            )
          })}
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 20px' }}>
        {/* Overdue section */}
        {overdueTasks.length > 0 && (
          <div ref={el => { if (el) sectionRefs.current.set('__overdue__', el) }}>
            <div style={{ padding: '14px 16px 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', letterSpacing: '0.03em' }}>기한 초과</span>
              <span style={{ fontSize: 11, color: '#dc2626', background: 'rgba(239,68,68,.12)', borderRadius: 10, padding: '1px 7px' }}>{overdueTasks.length}</span>
            </div>
            {overdueTasks.map(t => <MobCalTaskRow key={t.id} task={t} onOpen={() => openTaskDetail(t.id)} overdue />)}
          </div>
        )}

        {/* Per-day sections */}
        {contentDates.map(dateStr => {
          const dayTasks = tasksByDate.get(dateStr) ?? []
          return (
            <div key={dateStr} ref={el => { if (el) sectionRefs.current.set(dateStr, el) }}>
              <div style={{ padding: '14px 16px 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: dateStr === todayStr ? 'var(--ac)' : 'var(--t2)', letterSpacing: '0.03em' }}>
                  {fmtSection(dateStr)}
                </span>
                {dayTasks.length > 0 && (
                  <span style={{ fontSize: 11, color: 'var(--t3)', background: 'var(--bg3)', borderRadius: 10, padding: '1px 7px' }}>{dayTasks.length}</span>
                )}
              </div>
              {dayTasks.length === 0 ? (
                <div style={{ padding: '4px 16px 8px', fontSize: 13, color: 'var(--t3)' }}>업무 없음</div>
              ) : (
                dayTasks.map(t => <MobCalTaskRow key={t.id} task={t} onOpen={() => openTaskDetail(t.id)} />)
              )}
            </div>
          )
        })}

        {/* Add task button */}
        <div style={{ padding: '4px 16px 8px' }}>
          <button
            onClick={() => openTaskModal()}
            style={{ width: '100%', padding: '12px', border: '1px dashed var(--bd2)', borderRadius: 'var(--r2)', background: 'transparent', color: 'var(--t3)', fontSize: 13, cursor: 'pointer', textAlign: 'center' }}
          >
            + 업무 추가
          </button>
        </div>
      </div>
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

// ── Desktop calendar ──────────────────────────────────────────────────────────

export function CalendarView() {
  const isMobile = useMobile()
  if (isMobile) return <MobileCalendar />

  return <DesktopCalendar />
}

function DesktopCalendar() {
  const { calYear, calMonth, calNav, calToday, openTaskModal, openTaskDetail, projectId } = useUiStore()
  const tasks = useFilteredTasks()
  const { updateTask, tasks: allTasks } = useTaskStore()
  const milestones = useMilestoneStore(s => s.milestones)

  // milestones for current project, keyed by dueDate string
  const milestoneByDate = useMemo(() => {
    const map: Record<string, { name: string; color: string }[]> = {}
    const filtered = projectId ? milestones.filter(m => m.projectId === projectId) : milestones
    filtered.forEach(m => {
      if (!map[m.dueDate]) map[m.dueDate] = []
      map[m.dueDate].push({ name: m.name, color: '#8b5cf6' })
    })
    return map
  }, [milestones, projectId])

  const [dragOver, setDragOver] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const today = new Date()
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
    const taskId = e.dataTransfer.getData('taskId')
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
            const dateStr = fmt(date)
            const isToday = dateStr === fmt(today)
            const isDragTarget = dragOver === dateStr
            const dayTasks = tasksByDate(date)
            const dayMilestones = milestoneByDate[dateStr] ?? []
            const hasMilestone = dayMilestones.length > 0
            const dow = date.getDay()
            const isWeekend = dow === 0 || dow === 6

            return (
              <div
                key={i}
                onDragOver={e => { e.preventDefault(); setDragOver(dateStr) }}
                onDragLeave={e => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null)
                }}
                onDrop={e => handleDrop(e, date)}
                style={{
                  borderRight: (i + 1) % 7 === 0 ? 'none' : '1px solid var(--bd)',
                  borderBottom: '1px solid var(--bd)',
                  display: 'flex', flexDirection: 'column',
                  minHeight: 90,
                  background: isDragTarget
                    ? 'var(--ac-l)'
                    : hasMilestone
                      ? 'rgba(139,92,246,.04)'
                      : !isCurrentMonth
                        ? 'var(--bg2)'
                        : isToday
                          ? 'rgba(35,131,226,.03)'
                          : isWeekend ? 'var(--bg2)' : 'transparent',
                  outline: isDragTarget ? '2px solid var(--ac)' : hasMilestone ? '2px solid rgba(139,92,246,.35)' : 'none',
                  outlineOffset: '-2px',
                  transition: 'background .08s',
                }}
              >
                {/* Date number row — with milestone diamond */}
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
                  <span style={{
                    fontSize: 12, fontWeight: isToday ? 700 : 400,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: isToday ? 22 : 'auto', height: isToday ? 22 : 'auto',
                    borderRadius: isToday ? '50%' : 0,
                    background: isToday ? 'var(--ac)' : 'transparent',
                    color: isToday ? '#fff' : !isCurrentMonth ? 'var(--t3)' : 'var(--t2)',
                  }}>
                    {date.getDate()}
                  </span>
                </div>

                {/* Events */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 3px 4px' }}>
                  {dayTasks.slice(0, 3).map(t => {
                    const color = getCatColor(t.cat)
                    const isBeingDragged = draggingId === t.id
                    return (
                      <div
                        key={t.id}
                        draggable
                        onDragStart={e => {
                          e.dataTransfer.setData('taskId', t.id)
                          e.dataTransfer.setData('fromDate', dateStr)
                          e.dataTransfer.effectAllowed = 'move'
                          setDraggingId(t.id)
                        }}
                        onDragEnd={() => { setDraggingId(null); setDragOver(null) }}
                        onClick={() => openTaskDetail(t.id)}
                        style={{
                          fontSize: 10, fontWeight: 500,
                          padding: '2px 6px', borderRadius: 3,
                          background: color.bg, color: color.text,
                          cursor: 'grab', overflow: 'hidden',
                          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          opacity: isBeingDragged ? .35 : 1,
                          transition: 'opacity .1s',
                          userSelect: 'none',
                        }}
                        onMouseEnter={e => { if (!isBeingDragged) e.currentTarget.style.opacity = '.75' }}
                        onMouseLeave={e => { if (!isBeingDragged) e.currentTarget.style.opacity = '1' }}
                      >
                        {t.name}
                      </div>
                    )
                  })}
                  {dayTasks.length > 3 && (
                    <div style={{ fontSize: 10, color: 'var(--t3)', padding: '0 6px' }}>
                      +{dayTasks.length - 3}개
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
