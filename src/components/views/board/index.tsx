import { useState } from 'react'
import { useFilteredTasks } from '../../../hooks/useFilteredTasks'
import { useTaskStore } from '../../../store/taskStore'
import { useUiStore } from '../../../store/uiStore'
import { CategoryBadge, PriorityBadge } from '../../shared/Badge'
import { AssigneeGroup } from '../../shared/Avatar'
import { ProgressBar } from '../../shared/ProgressBar'
import { fmtDate } from '../../../lib/utils'
import { STATUS_LIST } from '../../../types'
import type { Task, Status } from '../../../types'

export function BoardView() {
  const tasks = useFilteredTasks()
  const { updateTask, deleteTask } = useTaskStore()
  const { setDetailTaskId, openTaskModal } = useUiStore()
  const [dragging, setDragging] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<Status | null>(null)

  const handleDrop = (status: Status) => {
    if (dragging) {
      updateTask(dragging, { status })
      setDragging(null)
      setDragOver(null)
    }
  }

  return (
    <div className="flex-1 overflow-auto p-[16px]">
      <div className="flex gap-[13px] items-start pb-5">
        {STATUS_LIST.map(status => {
          const col = tasks.filter(t => t.status === status)
          return (
            <div
              key={status}
              className={`w-[260px] flex-shrink-0 rounded-[14px] transition-colors ${
                dragOver === status ? 'bg-[rgba(0,122,255,.06)]' : 'bg-black/[.025]'
              }`}
              onDragOver={e => { e.preventDefault(); setDragOver(status) }}
              onDragLeave={() => setDragOver(null)}
              onDrop={() => handleDrop(status)}
            >
              {/* Column header */}
              <div className="flex items-center gap-[6px] px-[12px] py-[10px] border-b border-black/[.06]">
                <div className="w-[8px] h-[8px] rounded-full" style={{ background: statusColor(status) }} />
                <span className="text-[11px] font-bold text-gray-800">{status}</span>
                <span className="text-[10px] bg-black/[.06] text-gray-500 px-[6px] py-[1px] rounded-lg ml-1">
                  {col.length}
                </span>
              </div>

              {/* Cards */}
              <div className="px-[7px] pb-[7px] min-h-[30px]">
                {col.map(task => (
                  <BoardCard
                    key={task.id}
                    task={task}
                    onDragStart={() => setDragging(task.id)}
                    onDragEnd={() => { setDragging(null); setDragOver(null) }}
                    onClick={() => setDetailTaskId(task.id)}
                    onDelete={() => deleteTask(task.id)}
                    onEdit={() => openTaskModal(task.id)}
                    isDragging={dragging === task.id}
                  />
                ))}
              </div>

              {/* Add */}
              <button
                onClick={() => openTaskModal()}
                className="flex items-center gap-[5px] px-[12px] py-[7px] text-[11px] text-gray-400 cursor-pointer rounded-b-[14px] w-full bg-none border-none hover:bg-[rgba(0,122,255,.06)] hover:text-[#007aff] transition-colors font-[inherit]"
              >
                + 추가
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BoardCard({ task, onDragStart, onDragEnd, onClick, onDelete, onEdit, isDragging }: {
  task: Task
  onDragStart: () => void
  onDragEnd: () => void
  onClick: () => void
  onDelete: () => void
  onEdit: () => void
  isDragging: boolean
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`bg-white/92 border border-black/[.07] rounded-[12px] p-[10px] mb-[7px] cursor-grab group transition-all shadow-[0_1px_3px_rgba(0,0,0,.05)] hover:shadow-[0_4px_24px_rgba(0,0,0,.1)] hover:border-[rgba(0,122,255,.25)] hover:-translate-y-[2px] ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      {/* Actions */}
      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity -mt-1 -mr-1 mb-1">
        <button onClick={e => { e.stopPropagation(); onEdit() }} className="text-[11px] text-gray-400 hover:text-[#007aff] bg-transparent border-none cursor-pointer p-1">✏️</button>
        <button onClick={e => { e.stopPropagation(); onDelete() }} className="text-[11px] text-red-400 hover:text-red-600 bg-transparent border-none cursor-pointer p-1">🗑</button>
      </div>

      <div className="text-[12px] font-medium text-gray-800 leading-[1.4] mt-1 mb-[7px]">{task.name}</div>

      <div className="flex items-center flex-wrap gap-1">
        <CategoryBadge cat={task.cat} />
        <PriorityBadge priority={task.priority} />
        <AssigneeGroup assignee={task.assignee} size={18} />
        {task.due && (
          <span className="text-[10px] text-gray-400 ml-auto">{fmtDate(task.due)}</span>
        )}
      </div>

      {task.progress > 0 && (
        <div className="mt-[7px]">
          <ProgressBar value={task.progress} height={3} />
        </div>
      )}
    </div>
  )
}

function statusColor(status: Status): string {
  const map: Record<Status, string> = {
    진행중: '#007aff', 대기: '#9ca3af', 검토중: '#d97706', 완료: '#10b981',
  }
  return map[status]
}
