import { useUserProfileStore } from '../../store/userProfileStore'
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

/** 주소에서 계산한 색. 아무도 고르지 않았지만 같은 사람은 늘 같은 색입니다. */
export function gradForKey(key: string) {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0xffff
  return GRAD_PALETTE[h % GRAD_PALETTE.length]
}

/**
 * 담당자 한 명을 그리는 데 필요한 것 → { initial, grad, name, photoURL }.
 *
 * 이름과 사진은 그 사람이 로그인할 때 스스로 써 둔 프로필에서 옵니다. 색은
 * 주소에서 계산합니다 — 아무도 고르지 않았지만 같은 사람은 늘 같은 색입니다.
 *
 * 예전에는 여기 직원 세 명의 이름과 색이 표로 박혀 있었습니다. 회사가
 * 도메인을 옮긴 뒤로 아무와도 안 맞았고, 화면에는 이미 프로필 쪽 답이
 * 나오고 있었습니다.
 */
export function useAssigneeDisplay(key: string) {
  const getProfileByEmail = useUserProfileStore(s => s.getProfileByEmail)
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
    <span style={{ display: 'inline-flex', alignItems: 'center', isolation: 'isolate' }}>
      {keys.map((k, i) => (
        <span key={k} style={{ marginLeft: i > 0 ? -6 : 0, zIndex: keys.length - i, position: 'relative' }}>
          <AssigneeAvatar assigneeKey={k} size={size} />
        </span>
      ))}
    </span>
  )
}

