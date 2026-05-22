import { useTaskStore } from '../../../store/taskStore'
import { useSpaceStore } from '../../../store/spaceStore'
import { STATUS_COLORS, STATUS_LIST, MEMBERS, getCatColor } from '../../../types'
import type { Status, MemberKey } from '../../../types'

export function StatsView() {
  const tasks = useTaskStore(s => s.tasks)
  const spaces = useSpaceStore(s => s.spaces)

  const total = tasks.length
  const done = tasks.filter(t => t.status === '완료').length
  const inProgress = tasks.filter(t => t.status === '진행중').length
  const overdue = tasks.filter(t =>
    t.due && t.status !== '완료' && new Date(t.due) < new Date(new Date().toDateString())
  ).length
  const avgProgress = total ? Math.round(tasks.reduce((s, t) => s + t.progress, 0) / total) : 0

  return (
    <div className="flex-1 overflow-auto p-[16px]">
      <div className="flex flex-col gap-[16px]">
        {/* Summary cards */}
        <div className="grid grid-cols-5 gap-[12px]">
          {[
            { label: '전체 업무', val: total, color: '#007aff' },
            { label: '진행중', val: inProgress, color: '#007aff' },
            { label: '완료', val: done, color: '#10b981' },
            { label: '연체', val: overdue, color: '#ef4444' },
            { label: '평균 진행률', val: `${avgProgress}%`, color: '#8b5cf6' },
          ].map(c => (
            <div key={c.label} className="bg-white/82 backdrop-blur-[12px] border border-black/[.07] rounded-[14px] p-[14px] flex flex-col gap-1 shadow-[0_1px_3px_rgba(0,0,0,.05)]">
              <div className="text-[26px] font-black" style={{ color: c.color }}>{c.val}</div>
              <div className="text-[11px] text-gray-400 font-medium">{c.label}</div>
              <div className="h-[3px] rounded-full mt-[6px]" style={{ background: c.color, opacity: .3 }} />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-[16px]">
          {/* By space */}
          <StatSection title="📂 스페이스별">
            {spaces.length === 0 ? (
              <div className="text-[12px] text-gray-400 py-2">스페이스가 없습니다</div>
            ) : spaces.map(s => {
              const cnt = tasks.filter(t => t.cat === s.name).length
              const c = getCatColor(s.name)
              return <BarRow key={s.id} label={s.name} count={cnt} max={total} fill={c.text} />
            })}
          </StatSection>

          {/* By status */}
          <StatSection title="🔄 상태별">
            {STATUS_LIST.map(status => {
              const cnt = tasks.filter(t => t.status === status).length
              const c = STATUS_COLORS[status]
              return <BarRow key={status} label={status} count={cnt} max={total} fill={c.text} />
            })}
          </StatSection>
        </div>

        {/* By person */}
        <StatSection title="👤 담당자별">
          <div className="grid grid-cols-3 gap-[16px]">
            {(Object.keys(MEMBERS) as MemberKey[]).map(key => {
              const m = MEMBERS[key]
              const myTasks = tasks.filter(t => t.assignee.includes(key))
              const myProgress = myTasks.length
                ? Math.round(myTasks.reduce((s, t) => s + t.progress, 0) / myTasks.length)
                : 0

              return (
                <div key={key} className="p-[12px] rounded-[10px] bg-gray-50 border border-black/[.05]">
                  <div className="flex items-center gap-[8px] mb-[10px]">
                    <div className="w-[32px] h-[32px] rounded-full flex items-center justify-center text-white font-bold text-[12px]" style={{ background: m.grad }}>
                      {key}
                    </div>
                    <div>
                      <div className="text-[13px] font-bold text-gray-800">{m.n}</div>
                      <div className="text-[10px] text-gray-400">{myTasks.length}개 업무</div>
                    </div>
                  </div>
                  {STATUS_LIST.map(status => (
                    <div key={status} className="flex justify-between text-[11px] text-gray-500 py-[4px] border-b border-gray-100 last:border-b-0">
                      <span>{status}</span>
                      <span className="font-semibold">{myTasks.filter(t => t.status === status).length}</span>
                    </div>
                  ))}
                  <div className="mt-[8px] text-[11px] text-gray-500">
                    평균 진행률: <strong>{myProgress}%</strong>
                  </div>
                </div>
              )
            })}
          </div>
        </StatSection>
      </div>
    </div>
  )
}

function StatSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white/82 backdrop-blur-[12px] border border-black/[.07] rounded-[14px] p-[16px] shadow-[0_1px_3px_rgba(0,0,0,.05)]">
      <div className="text-[12px] font-bold text-gray-800 mb-[14px]">{title}</div>
      {children}
    </div>
  )
}

function BarRow({ label, count, max, fill }: { label: string; count: number; max: number; fill: string }) {
  return (
    <div className="flex items-center gap-[10px] mb-[9px]">
      <div className="text-[11px] text-gray-500 min-w-[90px] overflow-hidden text-ellipsis whitespace-nowrap">{label}</div>
      <div className="flex-1 h-[8px] bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: max ? `${(count / max) * 100}%` : '0%', background: fill }} />
      </div>
      <div className="text-[11px] font-semibold text-gray-500 min-w-[24px] text-right">{count}</div>
    </div>
  )
}

import React from 'react'
