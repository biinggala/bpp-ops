import { useState, useMemo, useRef, useEffect } from 'react'
import { useFilteredTasks } from '../../../hooks/useFilteredTasks'
import { useUiStore } from '../../../store/uiStore'
import { getCatColor } from '../../../types'
import { CategoryBadge } from '../../shared/Badge'
import type { Task } from '../../../types'

const DAY_W = 26   // px per day
const ROW_H = 36   // px per row
const LEFT_W = 230 // left column width
const MONTH_H = 28 // month header height
const DAY_H = 24   // day number header height

function toDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function dayDiff(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

export function GanttView() {
  const tasks = useFilteredTasks()
  const { setDetailTaskId } = useUiStore()
  const wrapRef = useRef<HTMLDivElement>(null)

  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])

  const { rangeStart, rangeEnd } = useMemo(() => {
    const all: Date[] = []
    for (const t of tasks) {
      if (t.start) all.push(toDate(t.start))
      if (t.due) all.push(toDate(t.due))
    }
    const PAD = 14
    const s = all.length
      ? addDays(new Date(Math.min(...all.map(d => d.getTime()))), -PAD)
      : new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const e = all.length
      ? addDays(new Date(Math.max(...all.map(d => d.getTime()))), PAD)
      : new Date(today.getFullYear(), today.getMonth() + 2, 0)
    return { rangeStart: s, rangeEnd: e }
  }, [tasks, today])

  const totalDays = dayDiff(rangeStart, rangeEnd) + 1
  const timelineW = totalDays * DAY_W
  const todayCol = dayDiff(rangeStart, today)

  // Scroll to center on today on mount
  useEffect(() => {
    const el = wrapRef.current
    if (el) {
      const target = todayCol * DAY_W - (el.clientWidth - LEFT_W) / 2
      el.scrollLeft = Math.max(0, target)
    }
  }, [todayCol])

  const months = useMemo(() => {
    const res: { label: string; col: number; span: number }[] = []
    let cur = new Date(rangeStart)
    while (cur <= rangeEnd) {
      const col = dayDiff(rangeStart, cur)
      const monthEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0)
      const actualEnd = monthEnd < rangeEnd ? monthEnd : rangeEnd
      const span = dayDiff(cur, actualEnd) + 1
      res.push({
        label: `${cur.getFullYear()}년 ${cur.getMonth() + 1}월`,
        col,
        span,
      })
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
    }
    return res
  }, [rangeStart, rangeEnd])

  const days = useMemo(
    () => Array.from({ length: totalDays }, (_, i) => addDays(rangeStart, i)),
    [rangeStart, totalDays]
  )

  const hasDates = tasks.filter(t => t.start || t.due)
  const noDates = tasks.filter(t => !t.start && !t.due)

  if (tasks.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t3)', fontSize: 14 }}>
        업무가 없습니다
      </div>
    )
  }

  return (
    <div ref={wrapRef} style={{ flex: 1, overflow: 'auto', background: 'var(--bg)' }}>
      <div style={{ minWidth: LEFT_W + timelineW, position: 'relative' }}>

        {/* Month header */}
        <div style={{
          display: 'flex', position: 'sticky', top: 0, zIndex: 10,
          height: MONTH_H, background: 'var(--bg2)', borderBottom: '1px solid var(--bd)',
        }}>
          <div style={{
            width: LEFT_W, flexShrink: 0, position: 'sticky', left: 0, zIndex: 11,
            background: 'var(--bg2)', borderRight: '1px solid var(--bd)',
          }} />
          <div style={{ width: timelineW, flexShrink: 0, position: 'relative' }}>
            {months.map(m => (
              <div key={m.label} style={{
                position: 'absolute', left: m.col * DAY_W, width: m.span * DAY_W,
                top: 0, bottom: 0,
                display: 'flex', alignItems: 'center', paddingLeft: 10,
                fontSize: 11, fontWeight: 600, color: 'var(--t2)',
                borderRight: '1px solid var(--bd)', overflow: 'hidden',
              }}>
                {m.label}
              </div>
            ))}
          </div>
        </div>

        {/* Day header */}
        <div style={{
          display: 'flex', position: 'sticky', top: MONTH_H, zIndex: 10,
          height: DAY_H, background: 'var(--bg)', borderBottom: '2px solid var(--bd)',
        }}>
          <div style={{
            width: LEFT_W, flexShrink: 0, position: 'sticky', left: 0, zIndex: 11,
            background: 'var(--bg2)', borderRight: '1px solid var(--bd)',
            display: 'flex', alignItems: 'center', paddingLeft: 16,
            fontSize: 11, fontWeight: 500, color: 'var(--t3)',
          }}>
            업무
          </div>
          <div style={{ display: 'flex', flexShrink: 0 }}>
            {days.map((d, i) => {
              const isToday = i === todayCol
              const dow = d.getDay()
              const isWeekend = dow === 0 || dow === 6
              const isMonthEnd = d.getDate() === new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
              return (
                <div key={i} style={{
                  width: DAY_W, height: DAY_H, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10,
                  color: isToday ? 'var(--ac)' : 'var(--t3)',
                  fontWeight: isToday ? 700 : 400,
                  background: isToday ? 'var(--ac-l)' : isWeekend ? 'var(--bg2)' : 'transparent',
                  borderRight: isMonthEnd ? '1px solid var(--bd)' : 'none',
                }}>
                  {d.getDate()}
                </div>
              )
            })}
          </div>
        </div>

        {/* Task rows with dates */}
        {hasDates.map(task => (
          <GanttRow
            key={task.id}
            task={task}
            rangeStart={rangeStart}
            todayCol={todayCol}
            totalDays={totalDays}
            timelineW={timelineW}
            today={today}
            onOpen={() => setDetailTaskId(task.id)}
          />
        ))}

        {/* No-date section */}
        {noDates.length > 0 && (
          <>
            <div style={{
              padding: '6px 16px', background: 'var(--bg2)',
              borderTop: hasDates.length > 0 ? '2px solid var(--bd)' : 'none',
              borderBottom: '1px solid var(--bd)',
              fontSize: 11, fontWeight: 600, color: 'var(--t3)',
              textTransform: 'uppercase', letterSpacing: '.04em',
              position: 'sticky', left: 0,
            }}>
              날짜 미설정 · {noDates.length}
            </div>
            {noDates.map(task => (
              <GanttRow
                key={task.id}
                task={task}
                rangeStart={rangeStart}
                todayCol={todayCol}
                totalDays={totalDays}
                timelineW={timelineW}
                today={today}
                onOpen={() => setDetailTaskId(task.id)}
                noBar
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function GanttRow({
  task, rangeStart, todayCol, totalDays, timelineW, today, onOpen, noBar,
}: {
  task: Task
  rangeStart: Date
  todayCol: number
  totalDays: number
  timelineW: number
  today: Date
  onOpen: () => void
  noBar?: boolean
}) {
  const [hovered, setHovered] = useState(false)
  const color = getCatColor(task.cat || '')
  const isOverdue = Boolean(task.due && task.status !== '완료' && toDate(task.due) < today)

  let barLeft = 0
  let barWidth = 0
  if (!noBar) {
    const startCol = task.start ? dayDiff(rangeStart, toDate(task.start)) : null
    const endCol = task.due ? dayDiff(rangeStart, toDate(task.due)) : null
    barLeft = startCol ?? endCol ?? 0
    const barRight = endCol ?? startCol ?? 0
    barWidth = Math.max((barRight - barLeft + 1) * DAY_W - 4, DAY_W - 4)
  }

  const rowBg = hovered ? 'var(--bg2)' : 'var(--bg)'

  return (
    <div
      style={{ display: 'flex', height: ROW_H, borderBottom: '1px solid var(--bd)' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Left: task name */}
      <div
        onClick={onOpen}
        style={{
          width: LEFT_W, flexShrink: 0,
          position: 'sticky', left: 0, zIndex: 2,
          background: rowBg, borderRight: '1px solid var(--bd)',
          padding: '0 12px 0 16px',
          display: 'flex', alignItems: 'center', gap: 8,
          overflow: 'hidden', cursor: 'pointer',
          transition: 'background .08s',
        }}
      >
        <span style={{
          fontSize: 12, color: noBar ? 'var(--t3)' : 'var(--t1)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
        }}>
          {task.name}
        </span>
        {task.cat && <CategoryBadge cat={task.cat} />}
      </div>

      {/* Timeline */}
      <div style={{
        width: timelineW, flexShrink: 0, position: 'relative', height: ROW_H,
        background: hovered ? 'rgba(55,53,47,.015)' : 'transparent',
      }}>
        {/* Today vertical line */}
        {todayCol >= 0 && todayCol < totalDays && (
          <div style={{
            position: 'absolute',
            left: todayCol * DAY_W + Math.floor(DAY_W / 2),
            top: 0, bottom: 0, width: 1,
            background: 'var(--ac)', opacity: .4,
            pointerEvents: 'none',
          }} />
        )}

        {/* Bar */}
        {!noBar && (
          <div
            onClick={onOpen}
            style={{
              position: 'absolute',
              left: barLeft * DAY_W + 2,
              width: barWidth,
              top: '50%', transform: 'translateY(-50%)',
              height: 22, borderRadius: 5,
              background: isOverdue ? 'rgba(239,68,68,.1)' : color.bg,
              border: `1.5px solid ${isOverdue ? '#ef4444' : color.text}`,
              display: 'flex', alignItems: 'center', paddingLeft: 6,
              overflow: 'hidden', cursor: 'pointer', zIndex: 1,
            }}
          >
            {barWidth > 54 && (
              <span style={{
                fontSize: 10, fontWeight: 500,
                color: isOverdue ? '#ef4444' : color.text,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {task.name}
              </span>
            )}
            {task.progress > 0 && (
              <div style={{
                position: 'absolute', bottom: 0, left: 0, height: 3,
                width: `${task.progress}%`, opacity: .55,
                background: isOverdue ? '#ef4444' : color.text,
                borderRadius: '0 0 0 5px',
              }} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
