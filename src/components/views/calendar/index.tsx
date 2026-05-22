import { useState, useMemo } from 'react'
import { useUiStore } from '../../../store/uiStore'
import { useFilteredTasks } from '../../../hooks/useFilteredTasks'
import { useTaskStore } from '../../../store/taskStore'
import { useMilestoneStore } from '../../../store/milestoneStore'
import { getCatColor } from '../../../types'
import type { Task } from '../../../types'

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']
const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r
}
function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

export function CalendarView() {
  const { calYear, calMonth, calNav, calToday, openTaskModal, projectId } = useUiStore()
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

  const [dragOver, setDragOver] = useState<string | null>(null)   // fmt(date) of hovered cell
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

  // On drop: move task so grabbed date aligns with drop date (preserve duration)
  const handleDrop = (e: React.DragEvent, dropDate: Date) => {
    e.preventDefault()
    const taskId = e.dataTransfer.getData('taskId')
    const fromDateStr = e.dataTransfer.getData('fromDate')
    if (!taskId || !fromDateStr) return

    const task = tasks.find(t => t.id === taskId)
    if (!task) return

    const offset = diffDays(parseDate(fromDateStr), dropDate)
    if (offset === 0) { setDragOver(null); return }

    const patch: Partial<Task> = {}
    if (task.start) patch.start = fmt(addDays(parseDate(task.start), offset))
    if (task.due)   patch.due   = fmt(addDays(parseDate(task.due),   offset))
    if (!task.start && !task.due) patch.due = fmt(dropDate)

    updateTask(taskId, patch)

    // cascade: shift all downstream tasks by the same offset
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
                        onClick={() => openTaskModal(t.id)}
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

function getBlockingCascade(startId: string, allTasks: Task[]): string[] {
  const result: string[] = []
  const visited = new Set<string>([startId])
  const queue = [startId]
  while (queue.length) {
    const id = queue.shift()!
    const task = allTasks.find(t => t.id === id)
    task?.blocking?.forEach(bid => {
      if (!visited.has(bid)) {
        visited.add(bid)
        result.push(bid)
        queue.push(bid)
      }
    })
  }
  return result
}
