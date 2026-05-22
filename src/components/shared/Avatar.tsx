import { MEMBERS } from '../../types'
import type { MemberKey } from '../../types'
import { parseAssignees } from '../../lib/utils'

interface AvatarProps {
  memberKey: MemberKey
  size?: number
  showName?: boolean
}

export function Avatar({ memberKey, size = 22, showName = false }: AvatarProps) {
  const m = MEMBERS[memberKey]
  if (!m) return null
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-flex items-center justify-center rounded-full text-white font-bold flex-shrink-0 border-2 border-white"
        style={{ width: size, height: size, fontSize: size * 0.38, background: m.grad }}
      >
        {memberKey}
      </span>
      {showName && <span className="text-[11px] text-gray-500">{m.n}</span>}
    </span>
  )
}

export function AssigneeGroup({ assignee, size = 22 }: { assignee: string; size?: number }) {
  const keys = parseAssignees(assignee) as MemberKey[]
  return (
    <span className="inline-flex items-center">
      {keys.map((k, i) => (
        <span key={k} style={{ marginLeft: i > 0 ? -6 : 0, zIndex: keys.length - i }}>
          <Avatar memberKey={k} size={size} />
        </span>
      ))}
    </span>
  )
}
