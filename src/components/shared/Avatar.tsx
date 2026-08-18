import { useResolveMember } from '../../store/memberStore'
import { getMemberGrad } from '../../types'
import { parseAssignees } from '../../lib/utils'

interface AvatarProps {
  memberKey: string
  size?: number
  showName?: boolean
}

export function Avatar({ memberKey, size = 22, showName = false }: AvatarProps) {
  const resolve = useResolveMember()
  if (!memberKey) return null
  const m = resolve(memberKey)
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-flex items-center justify-center rounded-full text-white font-bold flex-shrink-0 border-2 border-white"
        style={{ width: size, height: size, fontSize: size * 0.38, background: getMemberGrad(m.color) }}
        title={m.name}
      >
        {m.key}
      </span>
      {showName && <span className="text-[11px] text-gray-500">{m.name}</span>}
    </span>
  )
}

export function AssigneeGroup({ assignee, size = 22 }: { assignee: string; size?: number }) {
  const keys = parseAssignees(assignee)
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
