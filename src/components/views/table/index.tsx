import { useFilteredTasks } from '../../../hooks/useFilteredTasks'
import { useTaskStore } from '../../../store/taskStore'
import { useUiStore } from '../../../store/uiStore'
import { CategoryBadge, StatusBadge, PriorityBadge, TypeBadge } from '../../shared/Badge'
import { AssigneeGroup } from '../../shared/Avatar'
import { ProgressBar } from '../../shared/ProgressBar'
import { fmtDate, isOverdue } from '../../../lib/utils'
import type { Task } from '../../../types'
import React from 'react'

const COLS = [
  { label: '업무', flex: 3.5 },
  { label: '스페이스', flex: 1.2 },
  { label: '담당자', flex: 1.2 },
  { label: '상태', flex: 1 },
  { label: '마감일', flex: 0.9 },
  { label: '우선순위', flex: 0.8 },
  { label: '진행률', flex: 1.2 },
  { label: '메모', flex: 1.8 },
]

export function TableView() {
  const tasks = useFilteredTasks()
  const { deleteTask, updateTask } = useTaskStore()
  const { openTaskModal, setDetailTaskId } = useUiStore()

  const parents = tasks.filter(t => t.type === '상위')
  const orphans = tasks.filter(t => t.type === '세부' && !t.parentId)
  const sorted = [...parents, ...orphans]

  const renderRow = (task: Task, isChild = false): React.ReactNode => {
    const childTasks = isChild ? [] : tasks.filter(t => t.parentId === task.id)
    const overdue = isOverdue(task.due, task.status)

    return (
      <React.Fragment key={task.id}>
        <Row
          task={task}
          isChild={isChild}
          overdue={overdue}
          onOpen={() => setDetailTaskId(task.id)}
          onEdit={e => { e.stopPropagation(); openTaskModal(task.id) }}
          onDelete={e => {
            e.stopPropagation()
            if (confirm('삭제할까요?')) deleteTask(task.id)
          }}
          onStatusChange={s => updateTask(task.id, { status: s })}
        />
        {childTasks.map(c => renderRow(c, true))}
      </React.Fragment>
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
      <div style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r4)', overflow: 'hidden', minWidth: 800 }}>
        {/* Header */}
        <div style={{ display: 'flex', background: 'var(--bg2)', borderBottom: '1px solid var(--bd)' }}>
          {COLS.map(c => (
            <div key={c.label} style={{ flex: c.flex, padding: '7px 12px', fontSize: 11, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.04em', borderRight: '1px solid var(--bd)' }}>
              {c.label}
            </div>
          ))}
        </div>

        {/* Rows */}
        {sorted.map(t => renderRow(t))}

        {/* Add row */}
        <button
          onClick={() => openTaskModal()}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', fontSize: 13, color: 'var(--t3)', background: 'transparent', border: 'none', borderTop: '1px solid var(--bd)', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font)', transition: 'background .1s' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg3)'; e.currentTarget.style.color = 'var(--t2)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t3)' }}
        >
          <span style={{ fontSize: 16, lineHeight: 1, marginTop: -1 }}>+</span> 업무 추가
        </button>
      </div>
    </div>
  )
}

function Row({ task, isChild, overdue, onOpen, onEdit, onDelete, onStatusChange }: {
  task: Task; isChild: boolean; overdue: boolean
  onOpen: () => void
  onEdit: (e: React.MouseEvent) => void
  onDelete: (e: React.MouseEvent) => void
  onStatusChange: (s: Task['status']) => void
}) {
  const [hovered, setHovered] = React.useState(false)

  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', cursor: 'pointer',
        background: hovered ? 'var(--bg3)' : 'transparent',
        borderBottom: '1px solid var(--bd)',
        borderLeft: `3px solid ${hovered ? 'var(--ac)' : 'transparent'}`,
        transition: 'background .08s',
        opacity: task.status === '완료' ? .55 : 1,
      }}
    >
      {/* 업무명 */}
      <Cell flex={3.5} style={{ gap: 6, overflow: 'hidden' }}>
        {isChild && <span style={{ fontSize: 11, color: 'var(--t3)', marginLeft: 8, flexShrink: 0 }}>↳</span>}
        <TypeBadge type={task.type} />
        <span style={{ fontSize: 13, fontWeight: task.type === '상위' ? 500 : 400, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--t1)' }}>
          {task.name}
        </span>
        {hovered && (
          <div style={{ display: 'flex', gap: 2, marginLeft: 'auto', flexShrink: 0 }}>
            <RowBtn onClick={onEdit} title="수정">✎</RowBtn>
            <RowBtn onClick={onDelete} title="삭제" danger>✕</RowBtn>
          </div>
        )}
      </Cell>

      {/* 스페이스 */}
      <Cell flex={1.2}>{task.cat ? <CategoryBadge cat={task.cat} /> : <span style={{ color: 'var(--t3)', fontSize: 12 }}>—</span>}</Cell>

      {/* 담당자 */}
      <Cell flex={1.2}><AssigneeGroup assignee={task.assignee} size={20} /></Cell>

      {/* 상태 */}
      <Cell flex={1}>
        <select
          value={task.status}
          onClick={e => e.stopPropagation()}
          onChange={e => onStatusChange(e.target.value as Task['status'])}
          style={{ border: 'none', background: 'transparent', fontSize: 12, cursor: 'pointer', outline: 'none', color: 'var(--t2)', fontFamily: 'var(--font)', appearance: 'none', width: '100%' }}
        >
          <option>진행중</option>
          <option>대기</option>
          <option>검토중</option>
          <option>완료</option>
        </select>
      </Cell>

      {/* 마감일 */}
      <Cell flex={0.9}>
        {task.due ? (
          <span style={{ fontSize: 12, color: overdue ? '#ef4444' : 'var(--t2)', fontWeight: overdue ? 500 : 400 }}>
            {overdue && '⚠ '}{fmtDate(task.due)}
          </span>
        ) : <span style={{ color: 'var(--t3)', fontSize: 12 }}>—</span>}
      </Cell>

      {/* 우선순위 */}
      <Cell flex={0.8}><PriorityBadge priority={task.priority} /></Cell>

      {/* 진행률 */}
      <Cell flex={1.2}><ProgressBar value={task.progress} /></Cell>

      {/* 메모 */}
      <Cell flex={1.8} style={{ borderRight: 'none' }}>
        <span style={{ fontSize: 12, color: 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {task.memo || ''}
        </span>
      </Cell>
    </div>
  )
}

function Cell({ children, flex, style }: { children?: React.ReactNode; flex: number; style?: React.CSSProperties }) {
  return (
    <div style={{ flex, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 4, minHeight: 38, overflow: 'hidden', borderRight: '1px solid var(--bd)', ...style }}>
      {children}
    </div>
  )
}

function RowBtn({ children, onClick, title, danger }: { children: React.ReactNode; onClick: (e: React.MouseEvent) => void; title: string; danger?: boolean }) {
  return (
    <span
      onClick={onClick}
      title={title}
      style={{ width: 22, height: 22, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, cursor: 'pointer', color: danger ? '#ef4444' : 'var(--t2)', transition: 'background .08s' }}
      onMouseEnter={e => { e.currentTarget.style.background = danger ? 'rgba(239,68,68,.08)' : 'var(--bg4)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      {children}
    </span>
  )
}
