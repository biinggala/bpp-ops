import { useState } from 'react'
import type { CSSProperties } from 'react'
import { useUiStore } from '../../store/uiStore'
import { useMemberStore, useUnregisteredKeys, suggestMemberKey } from '../../store/memberStore'
import { MEMBER_PALETTE, getMemberGrad } from '../../types'
import type { Member } from '../../types'

export function MemberSettingsModal() {
  const { isMemberSettingsOpen, closeMemberSettings } = useUiStore()
  const { members, addMember, updateMember, deleteMember } = useMemberStore()
  const unregisteredKeys = useUnregisteredKeys()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  if (!isMemberSettingsOpen) return null

  const takenKeys = members.map(m => m.key)
  const previewKey = key.trim().toUpperCase() || suggestMemberKey(name, email, takenKeys)

  const submit = () => {
    const trimmedName = name.trim()
    const trimmedEmail = email.trim().toLowerCase()
    if (!trimmedName) return setError('이름을 입력하세요.')
    if (!trimmedEmail.includes('@')) return setError('올바른 이메일을 입력하세요.')
    if (members.some(m => m.email === trimmedEmail)) return setError('이미 등록된 이메일입니다.')
    if (takenKeys.includes(previewKey)) return setError(`이니셜 ${previewKey}는 이미 사용 중입니다.`)

    addMember({ name: trimmedName, email: trimmedEmail, key: previewKey })
    setName(''); setEmail(''); setKey(''); setError(null)
  }

  return (
    <div
      onClick={closeMemberSettings}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,15,.45)', zIndex: 9500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bg)', borderRadius: 'var(--r3)', boxShadow: 'var(--sh-lg)', width: '100%', maxWidth: 560, maxHeight: '86vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--t1)' }}>팀원 관리</div>
            <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 3 }}>
              여기 등록된 팀원이 담당자 선택·필터·통계에 사용됩니다.
            </div>
          </div>
          <button onClick={closeMemberSettings} style={closeBtnStyle}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 22px' }}>

          {/* Existing members */}
          {members.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--t3)', padding: '18px 0', textAlign: 'center', lineHeight: 1.7 }}>
              아직 등록된 팀원이 없습니다.<br />아래에서 첫 팀원을 추가하세요.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
              {members.map(m => (
                <MemberRow
                  key={m.id + (editingId === m.id ? ':edit' : '')}
                  member={m}
                  editing={editingId === m.id}
                  onEdit={() => setEditingId(m.id)}
                  onCancel={() => setEditingId(null)}
                  onSave={patch => { updateMember(m.id, patch); setEditingId(null) }}
                  onDelete={() => {
                    if (confirm(`'${m.name}'님을 팀원 목록에서 제거할까요?\n\n기존 업무의 담당자 표시는 '${m.key}'로 남습니다.`)) {
                      deleteMember(m.id)
                      setEditingId(null)
                    }
                  }}
                />
              ))}
            </div>
          )}

          {/* Unregistered keys found in existing tasks */}
          {unregisteredKeys.length > 0 && (
            <div style={{ marginBottom: 20, padding: '12px 14px', borderRadius: 'var(--r2)', background: '#fffbeb', border: '1px solid #fde68a' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#92400e', marginBottom: 4 }}>
                등록되지 않은 담당자 ({unregisteredKeys.length})
              </div>
              <div style={{ fontSize: 11, color: '#b45309', lineHeight: 1.6, marginBottom: 8 }}>
                업무에는 쓰이지만 팀원 목록에 없는 값입니다. 이니셜을 그대로 두고 등록하면 기존 업무가 자동으로 연결됩니다.
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {unregisteredKeys.map(k => (
                  <button
                    key={k}
                    onClick={() => { setKey(k); setError(null) }}
                    style={{ padding: '3px 10px', borderRadius: 999, border: '1px solid #fcd34d', background: '#fef3c7', color: '#92400e', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}
                    title={`${k}로 팀원 등록하기`}
                  >
                    {k} +
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Add form */}
          <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)', marginBottom: 10 }}>팀원 추가</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input
                value={name}
                onChange={e => { setName(e.target.value); setError(null) }}
                onKeyDown={e => { if (e.key === 'Enter') submit() }}
                placeholder="이름"
                style={{ ...inputStyle, flex: 1.2 }}
              />
              <input
                value={email}
                onChange={e => { setEmail(e.target.value); setError(null) }}
                onKeyDown={e => { if (e.key === 'Enter') submit() }}
                placeholder="이메일 (Google 계정)"
                style={{ ...inputStyle, flex: 2 }}
              />
              <input
                value={key}
                onChange={e => { setKey(e.target.value.toUpperCase().slice(0, 4)); setError(null) }}
                onKeyDown={e => { if (e.key === 'Enter') submit() }}
                placeholder={previewKey}
                title="아바타에 표시되는 이니셜. 기존 업무의 담당자 값과 맞추면 자동으로 연결됩니다."
                style={{ ...inputStyle, width: 62, textAlign: 'center', fontWeight: 600 }}
              />
            </div>
            <div style={{ fontSize: 11, color: 'var(--t3)', lineHeight: 1.6, marginBottom: 10 }}>
              이메일은 Google 로그인 계정과 일치해야 본인 계정과 연결됩니다. 이니셜은 비워두면 자동 생성됩니다.
            </div>
            {error && <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 10 }}>{error}</div>}
            <button onClick={submit} style={primaryBtnStyle}>추가</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function MemberRow({ member, editing, onEdit, onCancel, onSave, onDelete }: {
  member: Member
  editing: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: (patch: Partial<Omit<Member, 'id'>>) => void
  onDelete: () => void
}) {
  const [name, setName] = useState(member.name)
  const [email, setEmail] = useState(member.email)
  const [color, setColor] = useState(member.color)

  if (editing) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', borderRadius: 'var(--r2)', border: '1px solid var(--ac)', background: 'var(--bg2)' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="이름" style={{ ...inputStyle, flex: 1 }} />
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="이메일" style={{ ...inputStyle, flex: 1.6 }} />
        </div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {MEMBER_PALETTE.map(p => (
            <button
              key={p.color}
              onClick={() => setColor(p.color)}
              title="아바타 색상"
              style={{ width: 22, height: 22, borderRadius: '50%', background: p.grad, cursor: 'pointer', border: color === p.color ? '2px solid var(--t1)' : '2px solid transparent' }}
            />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={ghostBtnStyle}>취소</button>
          <button onClick={() => onSave({ name: name.trim(), email: email.trim(), color })} style={primaryBtnStyle}>저장</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 'var(--r2)', border: '1px solid var(--bd)' }}>
      <div style={{ width: 28, height: 28, borderRadius: '50%', background: getMemberGrad(member.color), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 10, flexShrink: 0 }}>
        {member.key}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--t1)' }}>{member.name}</div>
        <div style={{ fontSize: 11, color: 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{member.email}</div>
      </div>
      <button onClick={onEdit} style={ghostBtnStyle}>수정</button>
      <button onClick={onDelete} style={{ ...ghostBtnStyle, color: '#dc2626' }}>삭제</button>
    </div>
  )
}

const inputStyle: CSSProperties = {
  padding: '7px 10px', borderRadius: 'var(--r1)', border: '1px solid var(--bd)',
  background: 'var(--bg)', fontSize: 13, color: 'var(--t1)', outline: 'none',
  fontFamily: 'var(--font)', minWidth: 0,
}

const primaryBtnStyle: CSSProperties = {
  padding: '7px 16px', borderRadius: 'var(--r2)', border: 'none',
  background: 'var(--ac)', color: '#fff', fontSize: 13, fontWeight: 500,
  cursor: 'pointer', fontFamily: 'var(--font)',
}

const closeBtnStyle: CSSProperties = {
  width: 26, height: 26, borderRadius: 'var(--r1)', border: 'none',
  background: 'transparent', color: 'var(--t3)', fontSize: 13,
  cursor: 'pointer', fontFamily: 'var(--font)', flexShrink: 0,
}

const ghostBtnStyle: CSSProperties = {
  padding: '5px 10px', borderRadius: 'var(--r1)', border: '1px solid var(--bd)',
  background: 'transparent', color: 'var(--t2)', fontSize: 12,
  cursor: 'pointer', fontFamily: 'var(--font)', flexShrink: 0,
}
