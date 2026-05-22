import { useState, useRef, useEffect } from 'react'
import { useUiStore } from '../../store/uiStore'
import { useTaskStore } from '../../store/taskStore'
import { useSpaceStore } from '../../store/spaceStore'
import { useAuthStore } from '../../store/authStore'
import { MEMBERS } from '../../types'
import type { MemberKey } from '../../types'

export function Sidebar() {
  const { space, setSpace, filters, setFilters } = useUiStore()
  const tasks = useTaskStore(s => s.tasks)
  const { spaces, addSpace, deleteSpace, updateSpace } = useSpaceStore()
  const { memberKey, signOutUser } = useAuthStore()

  const [addingSpace, setAddingSpace] = useState(false)
  const [newSpaceName, setNewSpaceName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const editRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (addingSpace) inputRef.current?.focus() }, [addingSpace])
  useEffect(() => { if (editingId) editRef.current?.select() }, [editingId])

  const countFor = (name: string | null) =>
    name ? tasks.filter(t => t.cat === name).length : tasks.length

  const handleAdd = () => {
    const trimmed = newSpaceName.trim()
    if (trimmed) addSpace(trimmed)
    setNewSpaceName('')
    setAddingSpace(false)
  }

  const handleRename = (id: string) => {
    if (editName.trim()) updateSpace(id, { name: editName.trim() })
    setEditingId(null)
  }

  const handleDelete = (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation()
    if (!confirm(`"${name}" 스페이스를 삭제할까요?`)) return
    if (space === name) setSpace(null)
    deleteSpace(id)
  }

  const member = memberKey ? MEMBERS[memberKey as MemberKey] : null

  return (
    <aside style={{ width: 240, background: 'var(--sb-bg)', display: 'flex', flexDirection: 'column', flexShrink: 0, borderRight: '1px solid rgba(255,255,255,.06)' }}>

      {/* Workspace header */}
      <div style={{ padding: '14px 12px 10px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid rgba(255,255,255,.06)' }}>
        <div style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--ac)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
          {(member?.n?.[0] ?? 'W')}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sb-t1)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            업무 보드
          </div>
          {member && (
            <div style={{ fontSize: 11, color: 'var(--sb-t3)', marginTop: 1 }}>{member.n}</div>
          )}
        </div>
        {member && (
          <button
            onClick={() => signOutUser()}
            title="로그아웃"
            style={{ width: 22, height: 22, borderRadius: 4, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--sb-t3)', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--sb-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            ↩
          </button>
        )}
      </div>

      {/* Search */}
      <div style={{ padding: '8px 10px' }}>
        <input
          style={{ width: '100%', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 'var(--r2)', padding: '5px 9px', fontSize: 12, color: 'var(--sb-t2)', outline: 'none' }}
          placeholder="검색..."
          value={filters.search}
          onChange={e => setFilters({ search: e.target.value })}
        />
      </div>

      {/* Nav */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 6px' }}>
        <SectionLabel>Spaces</SectionLabel>

        <NavItem
          active={space === null}
          onClick={() => setSpace(null)}
          count={countFor(null)}
          icon="◈"
        >
          전체 업무
        </NavItem>

        {spaces.map(s => (
          <div key={s.id} style={{ position: 'relative' }}>
            {editingId === s.id ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', margin: '1px 0' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                <input
                  ref={editRef}
                  style={{ flex: 1, background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)', borderRadius: 'var(--r1)', padding: '2px 6px', fontSize: 12, color: 'var(--sb-t1)', outline: 'none' }}
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onBlur={() => handleRename(s.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleRename(s.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                />
              </div>
            ) : (
              <SpaceItem
                active={space === s.name}
                dot={s.color}
                count={countFor(s.name)}
                onClick={() => setSpace(s.name)}
                onEdit={() => { setEditingId(s.id); setEditName(s.name) }}
                onDelete={e => handleDelete(e, s.id, s.name)}
              >
                {s.name}
              </SpaceItem>
            )}
          </div>
        ))}

        {/* Add space */}
        {addingSpace ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px 4px 28px', margin: '1px 0' }}>
            <input
              ref={inputRef}
              style={{ flex: 1, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 'var(--r1)', padding: '3px 7px', fontSize: 12, color: 'var(--sb-t1)', outline: 'none' }}
              placeholder="스페이스 이름..."
              value={newSpaceName}
              onChange={e => setNewSpaceName(e.target.value)}
              onBlur={handleAdd}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAdd()
                if (e.key === 'Escape') { setAddingSpace(false); setNewSpaceName('') }
              }}
            />
          </div>
        ) : (
          <AddBtn onClick={() => setAddingSpace(true)}>스페이스 추가</AddBtn>
        )}
      </div>
    </aside>
  )
}

/* ── Sub-components ── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: '10px 8px 3px', fontSize: 11, fontWeight: 600, color: 'var(--sb-t3)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
      {children}
    </div>
  )
}

function NavItem({ children, active, onClick, count, icon }: {
  children: React.ReactNode; active: boolean; onClick: () => void
  count: number; icon?: string
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 8px', borderRadius: 'var(--r2)', cursor: 'pointer',
        fontSize: 13, fontWeight: active ? 500 : 400, margin: '1px 0',
        color: active ? 'var(--sb-t1)' : 'var(--sb-t2)',
        background: active ? 'var(--sb-active)' : 'transparent',
        transition: 'background .1s, color .1s',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--sb-hover)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
    >
      {icon && <span style={{ fontSize: 11, opacity: .6, width: 16, textAlign: 'center', flexShrink: 0 }}>{icon}</span>}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
      <span style={{ fontSize: 11, color: 'var(--sb-t3)', marginLeft: 'auto', flexShrink: 0 }}>{count}</span>
    </div>
  )
}

function SpaceItem({ children, active, dot, count, onClick, onEdit, onDelete }: {
  children: React.ReactNode; active: boolean; dot: string; count: number
  onClick: () => void; onEdit: () => void; onDelete: (e: React.MouseEvent) => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 8px 4px 14px', borderRadius: 'var(--r2)', cursor: 'pointer',
        fontSize: 12, fontWeight: active ? 500 : 400, margin: '1px 0',
        color: active ? 'var(--sb-t1)' : 'var(--sb-t2)',
        background: active ? 'var(--sb-active)' : hovered ? 'var(--sb-hover)' : 'transparent',
        transition: 'background .1s',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot, flexShrink: 0 }} />
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>

      {hovered ? (
        <div style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
          <ActionIcon onClick={e => { e.stopPropagation(); onEdit() }}>✎</ActionIcon>
          <ActionIcon onClick={onDelete} danger>×</ActionIcon>
        </div>
      ) : (
        <span style={{ fontSize: 11, color: 'var(--sb-t3)', marginLeft: 'auto', flexShrink: 0 }}>{count}</span>
      )}
    </div>
  )
}

function ActionIcon({ children, onClick, danger }: { children: React.ReactNode; onClick: (e: React.MouseEvent) => void; danger?: boolean }) {
  return (
    <span
      onClick={onClick}
      style={{ width: 18, height: 18, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, cursor: 'pointer', color: danger ? '#f87171' : 'var(--sb-t3)', transition: 'background .1s' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.1)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      {children}
    </span>
  )
}

function AddBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px 4px 14px', borderRadius: 'var(--r2)', cursor: 'pointer', fontSize: 12, color: 'var(--sb-t3)', margin: '1px 0', transition: 'background .1s' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--sb-hover)'; (e.currentTarget.style.color = 'var(--sb-t2)') }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; (e.currentTarget.style.color = 'var(--sb-t3)') }}
    >
      <span style={{ fontSize: 14, lineHeight: 1, opacity: .7 }}>+</span>
      {children}
    </div>
  )
}
