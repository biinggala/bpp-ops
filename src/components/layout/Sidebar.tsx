import { useState, useRef, useEffect } from 'react'
import { useUiStore } from '../../store/uiStore'
import { useTaskStore } from '../../store/taskStore'
import { useSpaceStore } from '../../store/spaceStore'
import { useAuthStore } from '../../store/authStore'
import { useProjectStore } from '../../store/projectStore'
import { usePresenceStore } from '../../store/presenceStore'
import { MEMBERS } from '../../types'
import type { MemberKey } from '../../types'

export function Sidebar() {
  const { space, setSpace, filters, setFilters, projectId, setProject, myTasksOnly, setMyTasksOnly } = useUiStore()
  const tasks = useTaskStore(s => s.tasks)
  const { spaces, addSpace, deleteSpace, updateSpace } = useSpaceStore()
  const { projects, addProject, deleteProject } = useProjectStore()
  const { memberKey, signOutUser } = useAuthStore()

  // Space state
  const [addingSpace, setAddingSpace] = useState(false)
  const [newSpaceName, setNewSpaceName] = useState('')
  const [editingSpaceId, setEditingSpaceId] = useState<string | null>(null)
  const [editSpaceName, setEditSpaceName] = useState('')
  const spaceInputRef = useRef<HTMLInputElement>(null)
  const spaceEditRef = useRef<HTMLInputElement>(null)

  // Project state
  const [addingProject, setAddingProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDueDate, setNewProjectDueDate] = useState('')
  const projectNameRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (addingSpace) spaceInputRef.current?.focus() }, [addingSpace])
  useEffect(() => { if (editingSpaceId) spaceEditRef.current?.select() }, [editingSpaceId])
  useEffect(() => { if (addingProject) projectNameRef.current?.focus() }, [addingProject])

  const countFor = (name: string | null) =>
    name ? tasks.filter(t => t.cat === name).length : tasks.length

  const handleAddSpace = () => {
    const trimmed = newSpaceName.trim()
    if (trimmed) addSpace(trimmed)
    setNewSpaceName('')
    setAddingSpace(false)
  }

  const handleRenameSpace = (id: string) => {
    if (editSpaceName.trim()) updateSpace(id, { name: editSpaceName.trim() })
    setEditingSpaceId(null)
  }

  const handleDeleteSpace = (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation()
    if (!confirm(`"${name}" 스페이스를 삭제할까요?`)) return
    if (space === name) setSpace(null)
    deleteSpace(id)
  }

  const handleAddProject = () => {
    const trimmed = newProjectName.trim()
    if (trimmed) {
      addProject(trimmed, undefined, newProjectDueDate || undefined)
    }
    setNewProjectName('')
    setNewProjectDueDate('')
    setAddingProject(false)
  }

  const handleCancelAddProject = () => {
    setNewProjectName('')
    setNewProjectDueDate('')
    setAddingProject(false)
  }

  const handleDeleteProject = (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation()
    if (!confirm(`"${name}" 프로젝트를 삭제할까요?`)) return
    if (projectId === id) setProject(null)
    deleteProject(id)
  }

  const getDaysRemaining = (dueDate: string): { days: number; overdue: boolean } => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const due = new Date(dueDate)
    due.setHours(0, 0, 0, 0)
    const diff = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    return { days: Math.abs(diff), overdue: diff < 0 }
  }

  const member = memberKey ? MEMBERS[memberKey as MemberKey] : null
  const presences = usePresenceStore(s => s.presences)
  const onlineUsers = Object.values(presences).filter(p => p.online)

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

        {/* Quick nav items */}
        <NavItem
          active={space === null && !myTasksOnly && projectId === null}
          onClick={() => { setSpace(null); setProject(null); setMyTasksOnly(false) }}
          count={countFor(null)}
          icon="◈"
        >
          전체 업무
        </NavItem>

        <NavItem
          active={myTasksOnly}
          onClick={() => { setMyTasksOnly(!myTasksOnly); setSpace(null); setProject(null) }}
          count={tasks.filter(t => memberKey ? t.assignee === memberKey : false).length}
          icon="☑"
        >
          내 할 일
        </NavItem>

        {/* Projects section */}
        <SectionLabel>Projects</SectionLabel>

        {projects.map(p => {
          const taskCount = tasks.filter(t => t.projectId === p.id).length
          const daysInfo = p.dueDate ? getDaysRemaining(p.dueDate) : null
          return (
            <ProjectItem
              key={p.id}
              active={projectId === p.id}
              dot={p.color}
              count={taskCount}
              daysInfo={daysInfo}
              onClick={() => { setProject(p.id); setMyTasksOnly(false) }}
              onDelete={e => handleDeleteProject(e, p.id, p.name)}
            >
              {p.name}
            </ProjectItem>
          )
        })}

        {/* Add project */}
        {addingProject ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 8px 4px 14px', margin: '1px 0' }}>
            <input
              ref={projectNameRef}
              style={{ flex: 1, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 'var(--r1)', padding: '3px 7px', fontSize: 12, color: 'var(--sb-t1)', outline: 'none' }}
              placeholder="프로젝트 이름..."
              value={newProjectName}
              onChange={e => setNewProjectName(e.target.value)}
              onBlur={() => {
                // Only submit on blur if due date is not focused
                setTimeout(() => {
                  if (document.activeElement !== document.querySelector('[data-project-due]')) {
                    handleAddProject()
                  }
                }, 100)
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAddProject()
                if (e.key === 'Escape') handleCancelAddProject()
              }}
            />
            <input
              data-project-due
              type="date"
              style={{ flex: 1, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 'var(--r1)', padding: '3px 7px', fontSize: 11, color: 'var(--sb-t2)', outline: 'none', colorScheme: 'dark' }}
              value={newProjectDueDate}
              onChange={e => setNewProjectDueDate(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAddProject()
                if (e.key === 'Escape') handleCancelAddProject()
              }}
            />
          </div>
        ) : (
          <AddBtn onClick={() => setAddingProject(true)}>프로젝트 추가</AddBtn>
        )}

        {/* Spaces section */}
        <SectionLabel>Spaces</SectionLabel>

        {spaces.map(s => (
          <div key={s.id} style={{ position: 'relative' }}>
            {editingSpaceId === s.id ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', margin: '1px 0' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                <input
                  ref={spaceEditRef}
                  style={{ flex: 1, background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)', borderRadius: 'var(--r1)', padding: '2px 6px', fontSize: 12, color: 'var(--sb-t1)', outline: 'none' }}
                  value={editSpaceName}
                  onChange={e => setEditSpaceName(e.target.value)}
                  onBlur={() => handleRenameSpace(s.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleRenameSpace(s.id)
                    if (e.key === 'Escape') setEditingSpaceId(null)
                  }}
                />
              </div>
            ) : (
              <SpaceItem
                active={space === s.name}
                dot={s.color}
                count={countFor(s.name)}
                onClick={() => setSpace(s.name)}
                onEdit={() => { setEditingSpaceId(s.id); setEditSpaceName(s.name) }}
                onDelete={e => handleDeleteSpace(e, s.id, s.name)}
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
              ref={spaceInputRef}
              style={{ flex: 1, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 'var(--r1)', padding: '3px 7px', fontSize: 12, color: 'var(--sb-t1)', outline: 'none' }}
              placeholder="스페이스 이름..."
              value={newSpaceName}
              onChange={e => setNewSpaceName(e.target.value)}
              onBlur={handleAddSpace}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAddSpace()
                if (e.key === 'Escape') { setAddingSpace(false); setNewSpaceName('') }
              }}
            />
          </div>
        ) : (
          <AddBtn onClick={() => setAddingSpace(true)}>스페이스 추가</AddBtn>
        )}
      </div>

      {/* Online users */}
      {onlineUsers.length > 0 && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,.06)', padding: '8px 10px' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--sb-t3)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 6 }}>
            접속 중
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {onlineUsers.map(p => {
              const m = MEMBERS[p.memberKey as MemberKey]
              return (
                <div key={p.memberKey} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: m?.grad ?? 'var(--ac)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff' }}>
                      {(m?.n ?? p.name)[0]}
                    </div>
                    <div style={{ position: 'absolute', bottom: 0, right: 0, width: 7, height: 7, borderRadius: '50%', background: '#22c55e', border: '1.5px solid var(--sb-bg)' }} />
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--sb-t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m?.n ?? p.name}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
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
      <span style={{ fontSize: 12, color: 'var(--sb-t3)', marginLeft: 'auto', flexShrink: 0 }}>{count}</span>
    </div>
  )
}

function ProjectItem({ children, active, dot, count, daysInfo, onClick, onDelete }: {
  children: React.ReactNode; active: boolean; dot: string; count: number
  daysInfo: { days: number; overdue: boolean } | null
  onClick: () => void; onDelete: (e: React.MouseEvent) => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '5px 8px 5px 14px', borderRadius: 'var(--r2)', cursor: 'pointer',
        fontSize: 13, fontWeight: active ? 500 : 400, margin: '1px 0',
        color: active ? 'var(--sb-t1)' : 'var(--sb-t2)',
        background: active ? 'var(--sb-active)' : hovered ? 'var(--sb-hover)' : 'transparent',
        transition: 'background .1s',
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>

      {hovered ? (
        <div style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
          <ActionIcon onClick={onDelete} danger>×</ActionIcon>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto', flexShrink: 0 }}>
          {daysInfo && (
            <span style={{
              fontSize: 10, fontWeight: 600, flexShrink: 0,
              color: daysInfo.overdue ? '#f87171' : 'var(--sb-t3)',
            }}>
              {daysInfo.overdue ? `D+${daysInfo.days}` : `D-${daysInfo.days}`}
            </span>
          )}
          <span style={{ fontSize: 11, color: 'var(--sb-t3)', flexShrink: 0 }}>{count}</span>
        </div>
      )}
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
        padding: '5px 8px 5px 14px', borderRadius: 'var(--r2)', cursor: 'pointer',
        fontSize: 13, fontWeight: active ? 500 : 400, margin: '1px 0',
        color: active ? 'var(--sb-t1)' : 'var(--sb-t2)',
        background: active ? 'var(--sb-active)' : hovered ? 'var(--sb-hover)' : 'transparent',
        transition: 'background .1s',
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
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
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px 5px 14px', borderRadius: 'var(--r2)', cursor: 'pointer', fontSize: 13, color: 'var(--sb-t3)', margin: '1px 0', transition: 'background .1s' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--sb-hover)'; (e.currentTarget.style.color = 'var(--sb-t2)') }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; (e.currentTarget.style.color = 'var(--sb-t3)') }}
    >
      <span style={{ fontSize: 14, lineHeight: 1, opacity: .7 }}>+</span>
      {children}
    </div>
  )
}
