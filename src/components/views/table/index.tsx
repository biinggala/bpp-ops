import React from 'react'
import { useFilteredTasks } from '../../../hooks/useFilteredTasks'
import { useTaskStore } from '../../../store/taskStore'
import { useUiStore } from '../../../store/uiStore'
import { CategoryBadge, StatusBadge, PriorityBadge } from '../../shared/Badge'
import { AssigneeGroup } from '../../shared/Avatar'
import { ProgressBar } from '../../shared/ProgressBar'
import { fmtDate, isOverdue } from '../../../lib/utils'
import type { Task } from '../../../types'

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
  const filteredTasks = useFilteredTasks()
  const allTasks = useTaskStore(s => s.tasks)
  const { deleteTask, updateTask } = useTaskStore()
  const { openTaskModal, setDetailTaskId } = useUiStore()
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set())

  // Root = no parentId, or parentId points to a non-existent task
  const rootTasks = filteredTasks.filter(t => !t.parentId)

  // Always get ALL children from full task list (not filtered)
  const getChildren = (id: string) => allTasks.filter(t => t.parentId === id)

  const toggle = (id: string) =>
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const makeHandlers = (task: Task) => ({
    onOpen: () => setDetailTaskId(task.id),
    onEdit: (e: React.MouseEvent) => { e.stopPropagation(); openTaskModal(task.id) },
    onDelete: (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!confirm('삭제할까요?')) return
      // Also delete all children
      getChildren(task.id).forEach(c => deleteTask(c.id))
      deleteTask(task.id)
    },
    onStatusChange: (s: Task['status']) => updateTask(task.id, { status: s }),
    onAddSubtask: (e: React.MouseEvent) => { e.stopPropagation(); openTaskModal(undefined, task.id) },
  })

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
      <div style={{
        background: 'var(--bg)', border: '1px solid var(--bd)',
        borderRadius: 'var(--r4)', overflow: 'hidden', minWidth: 860,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', background: 'var(--bg2)', borderBottom: '2px solid var(--bd)' }}>
          {COLS.map((c, i) => (
            <div key={c.label} style={{
              flex: c.flex, padding: '7px 12px',
              fontSize: 11, fontWeight: 600, color: 'var(--t3)',
              textTransform: 'uppercase', letterSpacing: '.04em',
              borderRight: i < COLS.length - 1 ? '1px solid var(--bd)' : 'none',
            }}>
              {c.label}
            </div>
          ))}
        </div>

        {/* Rows */}
        {rootTasks.map(task => {
          const children = getChildren(task.id)
          const hasChildren = children.length > 0
          const isExpanded = !collapsed.has(task.id)
          const h = makeHandlers(task)

          return (
            <React.Fragment key={task.id}>
              <Row
                task={task}
                hasChildren={hasChildren}
                isExpanded={isExpanded}
                childCount={children.length}
                doneCount={children.filter(c => c.status === '완료').length}
                onToggle={() => toggle(task.id)}
                {...h}
              />
              {hasChildren && isExpanded && children.map((child, idx) => {
                const ch = makeHandlers(child)
                return (
                  <Row
                    key={child.id}
                    task={child}
                    isChild
                    isLastChild={idx === children.length - 1}
                    {...ch}
                  />
                )
              })}
            </React.Fragment>
          )
        })}

        {/* Add task */}
        <button
          onClick={() => openTaskModal()}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 8,
            padding: '9px 14px', fontSize: 13, color: 'var(--t3)',
            background: 'transparent', border: 'none',
            borderTop: '1px solid var(--bd)',
            cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font)',
            transition: 'background .1s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg3)'; e.currentTarget.style.color = 'var(--t2)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t3)' }}
        >
          <span style={{ fontSize: 16, lineHeight: 1, marginTop: -1 }}>+</span> 업무 추가
        </button>
      </div>
    </div>
  )
}

// ── Row ──────────────────────────────────────────────────────────────────────

function Row({
  task, isChild = false, isLastChild = false,
  hasChildren = false, isExpanded = true,
  childCount = 0, doneCount = 0,
  onToggle, onOpen, onEdit, onDelete, onStatusChange, onAddSubtask,
}: {
  task: Task
  isChild?: boolean
  isLastChild?: boolean
  hasChildren?: boolean
  isExpanded?: boolean
  childCount?: number
  doneCount?: number
  onToggle?: () => void
  onOpen: () => void
  onEdit: (e: React.MouseEvent) => void
  onDelete: (e: React.MouseEvent) => void
  onStatusChange: (s: Task['status']) => void
  onAddSubtask?: (e: React.MouseEvent) => void
}) {
  const [hovered, setHovered] = React.useState(false)
  const overdue = isOverdue(task.due, task.status)

  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', cursor: 'pointer',
        background: isChild
          ? hovered ? 'rgba(55,53,47,.03)' : 'var(--bg2)'
          : hovered ? 'var(--bg3)' : 'transparent',
        borderBottom: '1px solid var(--bd)',
        borderLeft: `3px solid ${hovered ? 'var(--ac)' : 'transparent'}`,
        transition: 'background .08s',
        opacity: task.status === '완료' ? .55 : 1,
      }}
    >
      {/* 업무명 */}
      <div style={{
        flex: 3.5, padding: '8px 12px',
        display: 'flex', alignItems: 'center', gap: 5,
        minHeight: 38, overflow: 'hidden',
        borderRight: '1px solid var(--bd)',
      }}>
        {/* Indent / toggle */}
        {isChild ? (
          <div style={{
            width: 20, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            paddingLeft: 16,
          }}>
            <span style={{ fontSize: 10, color: 'var(--t3)', lineHeight: 1 }}>└</span>
          </div>
        ) : (
          <button
            onClick={e => { e.stopPropagation(); onToggle?.() }}
            style={{
              width: 18, height: 18, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', cursor: hasChildren ? 'pointer' : 'default',
              borderRadius: 3, padding: 0, color: 'var(--t3)', fontSize: 9,
              transition: 'background .08s, color .08s',
              visibility: hasChildren ? 'visible' : 'hidden',
            }}
            onMouseEnter={e => { if (hasChildren) { e.currentTarget.style.background = 'var(--bg4)'; e.currentTarget.style.color = 'var(--t1)' } }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t3)' }}
          >
            {isExpanded ? '▼' : '▶'}
          </button>
        )}

        {/* Name */}
        <span style={{
          fontSize: 13,
          fontWeight: !isChild && hasChildren ? 500 : 400,
          flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          color: 'var(--t1)',
        }}>
          {task.name}
        </span>

        {/* Child count badge on collapsed parent */}
        {hasChildren && !isExpanded && (
          <span style={{
            fontSize: 10, color: 'var(--t3)', background: 'var(--bg4)',
            borderRadius: 10, padding: '1px 6px', flexShrink: 0,
          }}>
            {doneCount}/{childCount}
          </span>
        )}

        {/* Hover actions */}
        {hovered && (
          <div style={{ display: 'flex', gap: 2, marginLeft: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            {!isChild && onAddSubtask && (
              <RowBtn onClick={onAddSubtask} title="하위 업무 추가" accent>+ 하위</RowBtn>
            )}
            <RowBtn onClick={onEdit} title="수정">✎</RowBtn>
            <RowBtn onClick={onDelete} title="삭제" danger>✕</RowBtn>
          </div>
        )}
      </div>

      {/* 스페이스 */}
      <Cell flex={1.2}>
        {task.cat ? <CategoryBadge cat={task.cat} /> : <Dash />}
      </Cell>

      {/* 담당자 */}
      <Cell flex={1.2}><AssigneeGroup assignee={task.assignee} size={20} /></Cell>

      {/* 상태 */}
      <Cell flex={1}>
        <select
          value={task.status}
          onClick={e => e.stopPropagation()}
          onChange={e => onStatusChange(e.target.value as Task['status'])}
          style={{
            border: 'none', background: 'transparent', fontSize: 12,
            cursor: 'pointer', outline: 'none', color: 'var(--t2)',
            fontFamily: 'var(--font)', appearance: 'none', width: '100%',
          }}
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
        ) : <Dash />}
      </Cell>

      {/* 우선순위 */}
      <Cell flex={0.8}><PriorityBadge priority={task.priority} /></Cell>

      {/* 진행률 */}
      <Cell flex={1.2}><ProgressBar value={task.progress} /></Cell>

      {/* 메모 */}
      <Cell flex={1.8} last>
        <span style={{ fontSize: 12, color: 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {task.memo || ''}
        </span>
      </Cell>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Cell({ children, flex, last }: { children?: React.ReactNode; flex: number; last?: boolean }) {
  return (
    <div style={{
      flex, padding: '8px 12px',
      display: 'flex', alignItems: 'center', gap: 4,
      minHeight: 38, overflow: 'hidden',
      borderRight: last ? 'none' : '1px solid var(--bd)',
    }}>
      {children}
    </div>
  )
}

function Dash() {
  return <span style={{ color: 'var(--t3)', fontSize: 12 }}>—</span>
}

function RowBtn({ children, onClick, title, danger, accent }: {
  children: React.ReactNode
  onClick: (e: React.MouseEvent) => void
  title: string
  danger?: boolean
  accent?: boolean
}) {
  const base: React.CSSProperties = {
    height: 22, borderRadius: 4,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 11, cursor: 'pointer',
    border: accent ? '1px solid var(--ac)' : 'none',
    padding: accent ? '0 7px' : '0',
    width: accent ? 'auto' : 22,
    color: danger ? '#ef4444' : accent ? 'var(--ac)' : 'var(--t2)',
    background: accent ? 'var(--ac-l)' : 'transparent',
    transition: 'background .08s',
    fontFamily: 'var(--font)',
  }
  return (
    <span
      onClick={onClick}
      title={title}
      style={base}
      onMouseEnter={e => {
        e.currentTarget.style.background = danger ? 'rgba(239,68,68,.08)' : accent ? 'rgba(35,131,226,.18)' : 'var(--bg4)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = accent ? 'var(--ac-l)' : 'transparent'
      }}
    >
      {children}
    </span>
  )
}
