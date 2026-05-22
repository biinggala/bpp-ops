import { getCatColor, getTagColor, STATUS_COLORS } from '../../types'
import type { Status, Priority } from '../../types'

function Badge({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      fontSize: 11, fontWeight: 500,
      padding: '2px 7px', borderRadius: 4,
      whiteSpace: 'nowrap', flexShrink: 0,
      letterSpacing: '.01em',
      ...style,
    }}>
      {children}
    </span>
  )
}

export function CategoryBadge({ cat }: { cat: string }) {
  const c = getCatColor(cat)
  return <Badge style={{ background: c.bg, color: c.text }}>{cat}</Badge>
}

export function StatusBadge({ status }: { status: Status }) {
  const c = STATUS_COLORS[status]
  return <Badge style={{ background: c.bg, color: c.text }}>{status}</Badge>
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const map: Record<Priority, React.CSSProperties> = {
    높음: { background: 'rgba(239,68,68,.1)',  color: '#dc2626' },
    중간: { background: 'rgba(245,158,11,.1)', color: '#d97706' },
    낮음: { background: 'var(--bg3)',          color: 'var(--t3)' },
  }
  return <Badge style={map[priority]}>{priority}</Badge>
}

export function TagBadge({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
  const c = getTagColor(tag)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', borderRadius: 3, fontSize: 11, fontWeight: 500, background: c.bg, color: c.text, whiteSpace: 'nowrap' }}>
      #{tag}
      {onRemove && (
        <span onClick={e => { e.stopPropagation(); onRemove() }} style={{ cursor: 'pointer', opacity: .65, fontSize: 12, lineHeight: 1 }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '.65'}
        >×</span>
      )}
    </span>
  )
}

export function TypeBadge({ type }: { type: '상위' | '세부' }) {
  return (
    <Badge style={
      type === '상위'
        ? { background: 'var(--ac-l)', color: 'var(--ac)' }
        : { background: 'var(--bg3)', color: 'var(--t3)' }
    }>
      {type}
    </Badge>
  )
}
