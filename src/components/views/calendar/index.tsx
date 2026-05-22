import { useUiStore } from '../../../store/uiStore'
import { useFilteredTasks } from '../../../hooks/useFilteredTasks'
import { CAT_COLORS } from '../../../types'
import type { Task, Category } from '../../../types'

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']
const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']

export function CalendarView() {
  const { calYear, calMonth, calNav, calToday, setDetailTaskId } = useUiStore()
  const tasks = useFilteredTasks()

  const today = new Date()
  const firstDay = new Date(calYear, calMonth, 1).getDay()
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate()
  const daysInPrev = new Date(calYear, calMonth, 0).getDate()

  // 6주 그리드 (42칸)
  const cells: { date: Date; isCurrentMonth: boolean }[] = []
  for (let i = 0; i < 42; i++) {
    const offset = i - firstDay
    const date = new Date(calYear, calMonth, 1 + offset)
    cells.push({ date, isCurrentMonth: date.getMonth() === calMonth })
  }

  const tasksByDate = (date: Date): Task[] => {
    const d = fmt(date)
    return tasks.filter(t => {
      if (t.start && t.due) return t.start <= d && t.due >= d
      return t.due === d || t.start === d
    })
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Toolbar */}
      <div className="bg-white/75 backdrop-blur-[16px] border-b border-black/[.07] px-[16px] h-[44px] flex items-center gap-[8px] flex-shrink-0">
        <button onClick={calToday} className="px-[10px] py-[4px] rounded-[5px] border border-black/[.1] bg-white text-[11px] font-semibold text-gray-500 cursor-pointer hover:bg-gray-50">
          Today
        </button>
        <button onClick={() => calNav(-1)} className="w-[26px] h-[26px] rounded-[5px] border border-black/[.1] bg-white flex items-center justify-center text-[14px] text-gray-500 cursor-pointer hover:bg-gray-50">‹</button>
        <button onClick={() => calNav(1)}  className="w-[26px] h-[26px] rounded-[5px] border border-black/[.1] bg-white flex items-center justify-center text-[14px] text-gray-500 cursor-pointer hover:bg-gray-50">›</button>
        <span className="text-[14px] font-bold text-gray-800 min-w-[100px]">
          {calYear}년 {MONTHS[calMonth]}
        </span>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-black/[.08] bg-white flex-shrink-0">
        {DAY_LABELS.map(d => (
          <div key={d} className="py-[8px] text-right pr-[10px] text-[11px] font-semibold text-gray-400">{d}</div>
        ))}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto bg-white">
        <div className="grid grid-cols-7 h-full" style={{ gridTemplateRows: 'repeat(6, 1fr)' }}>
          {cells.map(({ date, isCurrentMonth }, i) => {
            const isToday = fmt(date) === fmt(today)
            const dayTasks = tasksByDate(date)
            return (
              <div
                key={i}
                className={`border-r border-b border-black/[.06] last:border-r-0 flex flex-col min-h-[100px] ${
                  !isCurrentMonth ? 'bg-gray-50/50' : isToday ? 'bg-[#faf8ff]' : ''
                }`}
              >
                {/* Date number */}
                <div className="text-right px-[8px] pt-[5px] pb-[3px]">
                  <span className={`text-[12px] font-medium inline-flex items-center justify-center ${
                    isToday
                      ? 'w-[22px] h-[22px] rounded-full bg-[#007aff] text-white font-bold text-[11px]'
                      : isCurrentMonth ? 'text-gray-500' : 'text-gray-300'
                  }`}>
                    {date.getDate()}
                  </span>
                </div>

                {/* Events */}
                <div className="flex flex-col gap-[2px] px-[3px] pb-[4px]">
                  {dayTasks.slice(0, 3).map(t => {
                    const color = CAT_COLORS[t.cat as Category]
                    return (
                      <div
                        key={t.id}
                        onClick={() => setDetailTaskId(t.id)}
                        className="text-[10px] font-semibold px-[6px] py-[2px] rounded-[4px] cursor-pointer truncate hover:opacity-80 transition-opacity"
                        style={{ background: color.bg, color: color.text }}
                      >
                        {t.name}
                      </div>
                    )
                  })}
                  {dayTasks.length > 3 && (
                    <div className="text-[10px] text-gray-400 px-[6px]">+{dayTasks.length - 3}개</div>
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

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
