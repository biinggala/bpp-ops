import React, { useEffect, useRef } from 'react'
import { STATUS_LIST } from '../../types'
import type { Task, Status } from '../../types'

interface ContextMenuProps {
  x: number
  y: number
  task: Task
  onClose: () => void
  onEdit: () => void
  onAddSubtask: () => void
  onStatusChange: (s: Status) => void
  onDelete: () => void
}

const STATUS_ICONS: Record<Status, string> = {
  진행중: '🔵', 대기: '⚪', 검토중: '🟡', 완료: '🟢',
}

export function ContextMenu({ x, y, task, onClose, onEdit, onAddSubtask, onStatusChange, onDelete }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent | TouchEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) { if (e.key === 'Escape') onClose(); return }
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close, { passive: true })
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('touchstart', close)
      document.removeEventListener('keydown', close)
    }
  }, [onClose])

  // Clamp to viewport
  const menuW = 200
  const clampedX = Math.min(x, window.innerWidth - menuW - 8)
  const clampedY = Math.min(y, window.innerHeight - 260)

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed', left: clampedX, top: clampedY,
        width: menuW, background: 'var(--bg)',
        border: '1px solid var(--bd)', borderRadius: 'var(--r3)',
        boxShadow: '0 8px 28px rgba(0,0,0,.18), 0 2px 8px rgba(0,0,0,.1)',
        zIndex: 500, padding: '4px 0', userSelect: 'none',
      }}
    >
      <Item icon="✎" label="수정" onClick={() => { onEdit(); onClose() }} />
      <Item icon="+" label="하위 업무 추가" onClick={() => { onAddSubtask(); onClose() }} />

      <Divider />
      <div style={{ padding: '4px 12px 2px', fontSize: 10, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>상태 변경</div>
      {STATUS_LIST.map(s => (
        <Item
          key={s}
          icon={STATUS_ICONS[s]}
          label={s}
          active={task.status === s}
          onClick={() => { onStatusChange(s); onClose() }}
        />
      ))}

      <Divider />
      <Item icon="✕" label="삭제" danger onClick={() => { onDelete(); onClose() }} />
    </div>
  )
}

function Item({ icon, label, onClick, active, danger }: {
  icon: string; label: string; onClick: () => void; active?: boolean; danger?: boolean
}) {
  const [hovered, setHovered] = React.useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px', cursor: 'pointer', fontSize: 13,
        color: danger ? '#ef4444' : active ? 'var(--ac)' : 'var(--t1)',
        background: hovered ? 'var(--bg3)' : 'transparent',
        fontWeight: active ? 500 : 400,
        transition: 'background .06s',
      }}
    >
      <span style={{ fontSize: 12, width: 16, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
      {label}
      {active && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ac)' }}>✓</span>}
    </div>
  )
}

function Divider() {
  return <div style={{ height: 1, background: 'var(--bd)', margin: '3px 0' }} />
}
