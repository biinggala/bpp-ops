import { useFilteredTasks } from '../../../hooks/useFilteredTasks'
import { useTaskStore } from '../../../store/taskStore'
import { useUiStore } from '../../../store/uiStore'
import { TypeBadge, CategoryBadge, StatusBadge, PriorityBadge } from '../../shared/Badge'
import { AssigneeGroup } from '../../shared/Avatar'
import { ProgressBar } from '../../shared/ProgressBar'
import { useToast } from '../../shared/Toast'
import { fmtDate, isOverdue } from '../../../lib/utils'
import type { Task } from '../../../types'

export function TableView() {
  const tasks = useFilteredTasks()
  const { deleteTask, updateTask } = useTaskStore()
  const { openTaskModal, setDetailTaskId } = useUiStore()
  const toast = useToast(s => s.show)

  const parents = tasks.filter(t => t.type === '상위')
  const children = tasks.filter(t => t.type === '세부')
  const orphans = children.filter(c => !c.parentId)
  const sorted = [...parents, ...orphans]

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (!confirm('삭제할까요?')) return
    deleteTask(id)
    toast('삭제됨')
  }

  const renderRow = (task: Task, isChild = false) => {
    const overdue = isOverdue(task.due, task.status)
    const childTasks = isChild ? [] : tasks.filter(t => t.parentId === task.id)

    return (
      <div key={task.id}>
        <div
          onClick={() => setDetailTaskId(task.id)}
          className={`grid border-b border-black/[.06] cursor-pointer transition-all border-l-[3px] border-l-transparent hover:bg-[rgba(0,122,255,.03)] hover:border-l-[#007aff] ${
            task.type === '상위' ? 'bg-black/[.015]' : ''
          } ${task.status === '완료' ? 'opacity-60' : ''}`}
          style={{ gridTemplateColumns: '400px 120px 190px 92px 100px 72px 90px 80px 1fr' }}
        >
          <Cell className="gap-[6px]">
            {isChild && <span className="text-gray-300 text-[11px] ml-3">↳</span>}
            <TypeBadge type={task.type} />
            <span className={`text-[12px] flex-1 overflow-hidden text-ellipsis whitespace-nowrap ${task.type === '상위' ? 'font-semibold' : ''}`}>
              {task.name}
            </span>
            <div className="flex gap-[2px] opacity-0 group-hover:opacity-100 transition-opacity ml-auto flex-shrink-0">
              <ActionBtn onClick={e => { e.stopPropagation(); openTaskModal(task.id) }} title="수정">✏️</ActionBtn>
              <ActionBtn onClick={e => handleDelete(e, task.id)} title="삭제" danger>🗑</ActionBtn>
            </div>
          </Cell>
          <Cell><CategoryBadge cat={task.cat} /></Cell>
          <Cell><AssigneeGroup assignee={task.assignee} /></Cell>
          <Cell><StatusBadge status={task.status} /></Cell>
          <Cell>
            {task.due && (
              <span className={`text-[11px] font-medium ${overdue ? 'text-red-500' : 'text-gray-600'}`}>
                {overdue && '⚠ '}{fmtDate(task.due)}
              </span>
            )}
          </Cell>
          <Cell><PriorityBadge priority={task.priority} /></Cell>
          <Cell><ProgressBar value={task.progress} /></Cell>
          <Cell>
            <select
              value={task.status}
              onClick={e => e.stopPropagation()}
              onChange={e => updateTask(task.id, { status: e.target.value as Task['status'] })}
              className="text-[11px] font-semibold border-none rounded-lg px-1 py-[2px] cursor-pointer outline-none bg-gray-100 text-gray-700 appearance-none"
            >
              <option>진행중</option>
              <option>대기</option>
              <option>검토중</option>
              <option>완료</option>
            </select>
          </Cell>
          <Cell>
            {task.memo && (
              <span className="text-[11px] text-gray-500 overflow-hidden text-ellipsis whitespace-nowrap">{task.memo}</span>
            )}
          </Cell>
        </div>

        {/* Child rows */}
        {childTasks.map(child => renderRow(child, true))}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto p-[16px]">
      <div className="bg-white/82 backdrop-blur-[12px] border border-black/[.07] rounded-[14px] overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,.05),0_2px_14px_rgba(0,0,0,.06)]">
        {/* Header */}
        <div
          className="grid bg-[rgba(248,248,250,.9)] border-b-2 border-black/[.07] border-l-[3px] border-l-transparent"
          style={{ gridTemplateColumns: '400px 120px 190px 92px 100px 72px 90px 80px 1fr' }}
        >
          {['업무', '카테고리', '담당자', '상태', '마감일', '우선순위', '진행률', '상태변경', '메모'].map(h => (
            <div key={h} className="px-[9px] py-[7px] text-[10px] font-bold text-gray-400 uppercase tracking-[.4px] border-r border-black/[.06] last:border-r-0">
              {h}
            </div>
          ))}
        </div>

        {/* Rows */}
        <div className="group">
          {sorted.map(t => renderRow(t))}
        </div>

        {/* Add row */}
        <button
          onClick={() => openTaskModal()}
          className="w-full flex items-center gap-[6px] px-[14px] py-[8px] text-[12px] text-gray-400 cursor-pointer border-t border-black/[.06] hover:bg-[rgba(0,122,255,.04)] hover:text-[#007aff] transition-colors bg-transparent border-none text-left"
        >
          + 업무 추가
        </button>
      </div>
    </div>
  )
}

function Cell({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return (
    <div className={`px-[9px] py-[6px] text-[12px] border-r border-black/[.06] last:border-r-0 flex items-center gap-[5px] min-h-[36px] overflow-hidden ${className}`}>
      {children}
    </div>
  )
}

function ActionBtn({ onClick, title, danger, children }: {
  onClick: (e: React.MouseEvent) => void
  title: string
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`border-none cursor-pointer text-[11px] px-[4px] py-[2px] rounded-[3px] bg-transparent transition-colors ${
        danger ? 'text-red-500 hover:bg-red-50' : 'text-gray-400 hover:bg-[#ede9fe]'
      }`}
    >
      {children}
    </button>
  )
}
