import { STATUS_SOLID, PRIORITY_ORDER } from '../../types'
import type { Priority, Status } from '../../types'
import { StatusMark } from './StatusMark'

/**
 * 상태, as it appears in a list row: a filled pill carrying its own mark.
 *
 * One definition, used by the trigger, the menu it opens, the mobile card and
 * the detail panel — a status that changed shape depending on where you looked
 * at it would defeat the point of giving it a shape at all.
 */
export function StatusPill({ status, compact = false }: { status: Status; compact?: boolean }) {
  const s = STATUS_SOLID[status] ?? STATUS_SOLID['대기']
  const outlined = s.fill === 'transparent'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: compact ? 4 : 5,
      padding: compact ? '2px 8px 2px 7px' : '3px 10px 3px 8px',
      borderRadius: 999,
      background: s.fill,
      color: s.text,
      border: `1px solid ${outlined ? s.ring : 'transparent'}`,
      fontSize: compact ? 11.5 : 12,
      fontWeight: 600,
      letterSpacing: '.005em',
      lineHeight: 1.45,
      whiteSpace: 'nowrap',
      // A single hairline of light along the top edge. Enough to read as a
      // physical chip rather than a flat rectangle of colour; not enough to
      // notice as an effect.
      boxShadow: outlined ? 'none' : 'inset 0 1px 0 rgba(255,255,255,.16)',
    }}>
      <StatusMark status={status} size={compact ? 11 : 12} />
      {status}
    </span>
  )
}

/**
 * 우선순위, as a word rather than a pill.
 *
 * It used to be the same pill as 상태, in the next column along, which is how
 * the status stopped being findable. A ranking does not need a container — it
 * needs to be readable in order, and to stay out of the way of the field people
 * are actually scanning for.
 */
export function PriorityLabel({ priority }: { priority: Priority }) {
  const rank = PRIORITY_ORDER[priority]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 12, whiteSpace: 'nowrap',
      color: rank.color,
      fontWeight: rank.weight,
    }}>
      <span style={{
        width: 3, height: 11, borderRadius: 2, flexShrink: 0,
        background: rank.color, opacity: rank.bar,
      }} />
      {priority}
    </span>
  )
}
