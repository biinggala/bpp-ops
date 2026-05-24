import { useUserProfileStore } from '../../store/userProfileStore'
import { MEMBERS } from '../../types'
import type { MemberKey } from '../../types'
import { parseAssignees } from '../../lib/utils'

const GRAD_PALETTE = [
  'linear-gradient(135deg,#f093fb,#f5576c)',
  'linear-gradient(135deg,#4facfe,#00f2fe)',
  'linear-gradient(135deg,#43e97b,#38f9d7)',
  'linear-gradient(135deg,#fa709a,#fee140)',
  'linear-gradient(135deg,#a18cd1,#fbc2eb)',
  'linear-gradient(135deg,#667eea,#764ba2)',
  'linear-gradient(135deg,#f6d365,#fda085)',
  'linear-gradient(135deg,#96fbc4,#f9f586)',
]

function gradForKey(key: string) {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0xffff
  return GRAD_PALETTE[h % GRAD_PALETTE.length]
}

// Resolve a single assignee key (MemberKey or email) → { initial, grad, name }
export function useAssigneeDisplay(key: string) {
  const getProfileByEmail = useUserProfileStore(s => s.getProfileByEmail)
  const legacy = MEMBERS[key as MemberKey]
  if (legacy) return { initial: legacy.key[0], grad: legacy.grad, name: legacy.n, photoURL: null }
  const profile = getProfileByEmail(key)
  const name = profile?.name ?? (key.includes('@') ? key.split('@')[0] : key)
  return { initial: name[0]?.toUpperCase() ?? '?', grad: gradForKey(key), name, photoURL: profile?.photoURL ?? null }
}

export function AssigneeAvatar({ assigneeKey, size = 22 }: { assigneeKey: string; size?: number }) {
  const { initial, grad, name, photoURL } = useAssigneeDisplay(assigneeKey)
  return (
    <span
      title={name}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: size, height: size, borderRadius: '50%',
        fontSize: size * 0.38, fontWeight: 700, color: '#fff',
        background: grad, flexShrink: 0, border: '2px solid var(--bg)',
        overflow: 'hidden',
      }}
    >
      {photoURL ? <img src={photoURL} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initial}
    </span>
  )
}

export function AssigneeGroup({ assignee, size = 22 }: { assignee: string; size?: number }) {
  const keys = parseAssignees(assignee)
  if (!keys.length) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      {keys.map((k, i) => (
        <span key={k} style={{ marginLeft: i > 0 ? -6 : 0, zIndex: keys.length - i }}>
          <AssigneeAvatar assigneeKey={k} size={size} />
        </span>
      ))}
    </span>
  )
}

// Legacy named export kept for backward compat
export function Avatar({ memberKey, size = 22 }: { memberKey: MemberKey; size?: number }) {
  return <AssigneeAvatar assigneeKey={memberKey} size={size} />
}
