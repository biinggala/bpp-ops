import React, { useEffect, useRef } from 'react'
import { STATUS_LIST, STATUS_COLORS, NOTION } from '../../types'
import { haptic } from '../../lib/haptics'
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

/** Dismissal, shared by both menus: outside, Escape, or a touch elsewhere. */
function useDismiss(onClose: () => void) {
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
  return ref
}

const MENU_W = 200

function panelStyle(x: number, y: number, height: number): React.CSSProperties {
  return {
    position: 'fixed',
    left: Math.min(x, window.innerWidth - MENU_W - 8),
    top: Math.min(y, window.innerHeight - height),
    width: MENU_W, background: 'var(--bg)',
    border: '1px solid var(--bd)', borderRadius: 'var(--r3)',
    boxShadow: 'var(--sh-md)',
    zIndex: 500, padding: 4, userSelect: 'none', boxSizing: 'border-box',
  }
}

/**
 * ── 우클릭 메뉴 (일반) ───────────────────────────────────────────────────────
 *
 * For the things that used to reveal a button on hover.
 *
 * A control that only exists while the pointer is over it is undiscoverable —
 * nobody hovers a row to find out what it can do — and a *destructive* one
 * there is worse: it sits under a pointer that arrived for some other reason.
 * Right-click asks for the menu, and the dangerous item is then a second,
 * deliberate press.
 */
export interface MenuAction {
  label: string
  icon?: string
  danger?: boolean
  onSelect: () => void
}

export function ActionMenu({ x, y, actions, onClose }: {
  x: number; y: number; actions: MenuAction[]; onClose: () => void
}) {
  const ref = useDismiss(onClose)
  return (
    <div ref={ref} style={panelStyle(x, y, actions.length * 32 + 16)}>
      {actions.map((action, i) => (
        <Item
          key={i}
          icon={action.icon ?? '·'}
          label={action.label}
          danger={action.danger}
          onClick={() => { haptic(action.danger ? 'warn' : 'tap'); action.onSelect(); onClose() }}
        />
      ))}
    </div>
  )
}

export function ContextMenu({ x, y, task, onClose, onEdit, onAddSubtask, onStatusChange, onDelete }: ContextMenuProps) {
  const ref = useDismiss(onClose)

  return (
    <div ref={ref} style={panelStyle(x, y, 260)}>
      <Item icon="✎" label="수정" onClick={() => { haptic('tap'); onEdit(); onClose() }} />
      <Item icon="+" label="하위 업무 추가" onClick={() => { haptic('tap'); onAddSubtask(); onClose() }} />

      <Divider />
      <div style={{ padding: '4px 8px 2px', fontSize: 10, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>상태 변경</div>
      {STATUS_LIST.map(s => (
        <Item
          key={s}
          dot={STATUS_COLORS[s].text}
          label={s}
          active={task.status === s}
          // Finishing something earns a different note from merely changing it.
          onClick={() => { haptic(s === '완료' ? 'success' : 'toggle'); onStatusChange(s); onClose() }}
        />
      ))}

      <Divider />
      <Item icon="✕" label="삭제" danger onClick={() => { haptic('warn'); onDelete(); onClose() }} />
    </div>
  )
}

function Item({ icon, dot, label, onClick, active, danger }: {
  icon?: string; dot?: string; label: string; onClick: () => void; active?: boolean; danger?: boolean
}) {
  const [hovered, setHovered] = React.useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 8px', borderRadius: 'var(--r1)', cursor: 'pointer', fontSize: 13,
        color: danger ? NOTION.red.text : 'var(--t1)',
        background: hovered ? (danger ? NOTION.red.bg : 'var(--bg3)') : 'transparent',
        fontWeight: active ? 500 : 400,
        transition: 'background .06s',
      }}
    >
      {dot
        ? <span style={{ width: 14, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot }} />
          </span>
        : <span style={{ fontSize: 12, width: 14, textAlign: 'center', flexShrink: 0, color: 'var(--t3)' }}>{icon}</span>}
      {label}
      {active && <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--ac)' }}>✓</span>}
    </div>
  )
}

function Divider() {
  return <div style={{ height: 1, background: 'var(--bd)', margin: '4px -4px' }} />
}
