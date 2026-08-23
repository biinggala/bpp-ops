import { useState } from 'react'
import { useFilteredTasks } from '../../../hooks/useFilteredTasks'
import { useTaskStore } from '../../../store/taskStore'
import { useUiStore } from '../../../store/uiStore'
import { CategoryBadge, PriorityBadge } from '../../shared/Badge'
import { AssigneeGroup } from '../../shared/Avatar'
import { ProgressBar } from '../../shared/ProgressBar'
import { fmtDate } from '../../../lib/utils'
import { STATUS_LIST, statusAccent } from '../../../types'
import { StatusMark } from '../../shared/StatusMark'
import type { Task, Status } from '../../../types'


export function BoardView() {
  const tasks = useFilteredTasks()
  const { updateTask, deleteTask } = useTaskStore()
  const { openTaskDetail, openTaskModal, filters } = useUiStore()

  // The board groups by status, so a status filter is a choice of columns.
  // Rendering the unselected ones as empty shells made the filter look broken —
  // you asked to see 진행중 and got three empty boxes next to it.
  const columns = filters.statuses.length
    ? STATUS_LIST.filter(s => filters.statuses.includes(s))
    : STATUS_LIST
  const [dragging, setDragging] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<Status | null>(null)

  const handleDrop = (status: Status) => {
    if (dragging) { updateTask(dragging, { status }); setDragging(null); setDragOver(null) }
  }

  return (
    <div style={{ flex: 1, overflowX: 'auto', padding: '20px 24px' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', minWidth: 'max-content', paddingBottom: 20 }}>
        {columns.map(status => {
          const col = tasks.filter(t => t.status === status)
          return (
            <div
              key={status}
              style={{ width: 280, flexShrink: 0, borderRadius: 'var(--r4)', background: dragOver === status ? 'rgba(35,131,226,.06)' : 'var(--bg2)', border: '1px solid var(--bd)', transition: 'background .15s' }}
              onDragOver={e => { e.preventDefault(); setDragOver(status) }}
              onDragLeave={() => setDragOver(null)}
              onDrop={() => handleDrop(status)}
            >
              {/* Column header */}
              <div style={{ padding: '12px 14px 10px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--bd)' }}>
                {/* The same mark the list uses, so a status is one shape across
                    the app rather than a dot here and a pill there. */}
                <span style={{ color: statusAccent(status), display: 'flex', flexShrink: 0 }}>
                  <StatusMark status={status} size={14} />
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{status}</span>
                <span style={{ fontSize: 12, color: 'var(--t3)', marginLeft: 2 }}>{col.length}</span>
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
                    onClick={() => openTaskDetail(task.id)}
                    onEdit={() => openTaskDetail(task.id)}
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
        borderRadius: 'var(--r3)', padding: '12px 14px', marginBottom: 8,
        cursor: 'grab', opacity: isDragging ? .4 : 1,
        boxShadow: hovered ? 'var(--sh-md)' : 'var(--sh-sm)',
        transition: 'box-shadow .15s',
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

      <div style={{ fontSize: 14, fontWeight: 400, color: 'var(--t1)', lineHeight: 1.5, marginBottom: 10, paddingRight: hovered ? 44 : 0 }}>
        {task.name}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
        {task.cat && <CategoryBadge cat={task.cat} />}
        <PriorityBadge priority={task.priority} />
        <AssigneeGroup assignee={task.assignee} size={18} />
        {task.due && (
          <span style={{ fontSize: 12, color: 'var(--t3)', marginLeft: 'auto' }}>{fmtDate(task.due)}</span>
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
      style={{ width: 20, height: 20, borderRadius: 3, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, cursor: 'pointer', color: danger ? 'var(--danger)' : 'var(--t3)', background: 'var(--bg2)', transition: 'background .08s' }}
      onMouseEnter={e => { e.currentTarget.style.background = danger ? 'rgba(212,76,71,.1)' : 'var(--bg4)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg2)' }}
    >
      {children}
    </span>
  )
}
