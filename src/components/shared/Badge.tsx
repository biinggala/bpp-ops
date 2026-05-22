import { getCatColor, STATUS_COLORS } from '../../types'
import type { Status, Priority } from '../../types'

function Badge({ children, style, className = '' }: {
  children: React.ReactNode; style?: React.CSSProperties; className?: string
}) {
  return (
    <span
      className={`inline-flex items-center text-[10px] font-semibold px-[7px] py-[2px] rounded-full whitespace-nowrap flex-shrink-0 ${className}`}
      style={style}
    >
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
  const colors: Record<Priority, { bg: string; text: string }> = {
    높음: { bg: '#fee2e2', text: '#b91c1c' },
    중간: { bg: '#fef3c7', text: '#d97706' },
    낮음: { bg: '#f3f4f6', text: '#6b7280' },
  }
  const c = colors[priority]
  return <Badge style={{ background: c.bg, color: c.text }}>{priority}</Badge>
}

export function TypeBadge({ type }: { type: '상위' | '세부' }) {
  return (
    <Badge
      style={
        type === '상위'
          ? { background: 'rgba(0,122,255,.1)', color: '#007aff' }
          : { background: 'rgba(0,0,0,.05)', color: '#6b7280' }
      }
    >
      {type}
    </Badge>
  )
}
