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

const STATUS_COLOR: Record<Status, string> = {
  진행중: '#2383e2', 대기: '#9b9a97', 검토중: '#d97706', 완료: '#059669',
}

export function BoardView() {
  const tasks = useFilteredTasks()
  const { updateTask, deleteTask } = useTaskStore()
  const { setDetailTaskId, openTaskModal } = useUiStore()
  const [dragging, setDragging] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<Status | null>(null)

  const handleDrop = (status: Status) => {
    if (dragging) { updateTask(dragging, { status }); setDragging(null); setDragOver(null) }
  }

  return (
    <div style={{ flex: 1, overflowX: 'auto', padding: '20px 24px' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', minWidth: 'max-content', paddingBottom: 20 }}>
        {STATUS_LIST.map(status => {
          const col = tasks.filter(t => t.status === status)
          return (
            <div
              key={status}
              style={{ width: 260, flexShrink: 0, borderRadius: 'var(--r4)', background: dragOver === status ? 'rgba(35,131,226,.04)' : 'var(--bg2)', border: '1px solid var(--bd)', transition: 'background .15s' }}
              onDragOver={e => { e.preventDefault(); setDragOver(status) }}
              onDragLeave={() => setDragOver(null)}
              onDrop={() => handleDrop(status)}
            >
              {/* Column header */}
              <div style={{ padding: '10px 12px 8px', display: 'flex', alignItems: 'center', gap: 7, borderBottom: '1px solid var(--bd)' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLOR[status], flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--t1)' }}>{status}</span>
                <span style={{ fontSize: 11, color: 'var(--t3)', marginLeft: 2 }}>{col.length}</span>
              </div>

              {/* Cards */}
              <div style={{ padding: '6px 8px', minHeight: 40 }}>
                {col.map(task => (
                  <BoardCard
                    key={task.id}
                    task={task}
                    isDragging={dragging === task.id}
                    onDragStart={() => setDragging(task.id)}
                    onDragEnd={() => { setDragging(null); setDragOver(null) }}
                    onClick={() => openTaskModal(task.id)}
                    onEdit={() => openTaskModal(task.id)}
                    onDelete={() => deleteTask(task.id)}
                  />
                ))}
              </div>

              <button
                onClick={() => openTaskModal()}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', fontSize: 12, color: 'var(--t3)', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'var(--font)', borderTop: col.length > 0 ? '1px solid var(--bd)' : 'none', borderRadius: '0 0 var(--r4) var(--r4)', transition: 'background .1s' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg3)'; e.currentTarget.style.color = 'var(--t2)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t3)' }}
              >
                <span style={{ fontSize: 14 }}>+</span> 추가
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BoardCard({ task, isDragging, onDragStart, onDragEnd, onClick, onEdit, onDelete }: {
  task: Task; isDragging: boolean
  onDragStart: () => void; onDragEnd: () => void; onClick: () => void
  onEdit: () => void; onDelete: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'var(--bg)', border: '1px solid var(--bd)',
        borderRadius: 'var(--r3)', padding: '10px 12px', marginBottom: 6,
        cursor: 'grab', opacity: isDragging ? .4 : 1,
        boxShadow: hovered ? 'var(--sh-md)' : 'var(--sh-sm)',
        transform: hovered ? 'translateY(-1px)' : 'none',
        transition: 'box-shadow .15s, transform .15s',
        position: 'relative',
      }}
    >
      {/* Actions */}
      {hovered && (
        <div style={{ position: 'absolute', top: 7, right: 8, display: 'flex', gap: 2 }}>
          <CardBtn onClick={e => { e.stopPropagation(); onEdit() }}>✎</CardBtn>
          <CardBtn onClick={e => { e.stopPropagation(); onDelete() }} danger>✕</CardBtn>
        </div>
      )}

      <div style={{ fontSize: 13, fontWeight: 400, color: 'var(--t1)', lineHeight: 1.5, marginBottom: 8, paddingRight: hovered ? 44 : 0 }}>
        {task.name}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
        {task.cat && <CategoryBadge cat={task.cat} />}
        <PriorityBadge priority={task.priority} />
        <AssigneeGroup assignee={task.assignee} size={18} />
        {task.due && (
          <span style={{ fontSize: 11, color: 'var(--t3)', marginLeft: 'auto' }}>{fmtDate(task.due)}</span>
        )}
      </div>

      {task.progress > 0 && (
        <div style={{ marginTop: 8 }}>
          <ProgressBar value={task.progress} height={3} />
        </div>
      )}
    </div>
  )
}

function CardBtn({ children, onClick, danger }: { children: React.ReactNode; onClick: (e: React.MouseEvent) => void; danger?: boolean }) {
  return (
    <span
      onClick={onClick}
      style={{ width: 20, height: 20, borderRadius: 3, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, cursor: 'pointer', color: danger ? '#ef4444' : 'var(--t3)', background: 'var(--bg2)', transition: 'background .08s' }}
      onMouseEnter={e => { e.currentTarget.style.background = danger ? 'rgba(239,68,68,.1)' : 'var(--bg4)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg2)' }}
    >
      {children}
    </span>
  )
}
