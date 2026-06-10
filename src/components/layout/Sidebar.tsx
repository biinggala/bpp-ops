import { useState, useRef, useEffect } from 'react'
import { canAccessProject } from '../../lib/utils'
import { useUiStore } from '../../store/uiStore'
import { useTaskStore } from '../../store/taskStore'
import { useAuthStore } from '../../store/authStore'
import { useProjectStore } from '../../store/projectStore'
import { useMilestoneStore } from '../../store/milestoneStore'
import { usePresenceStore } from '../../store/presenceStore'
import { useMobile } from '../../hooks/useMobile'
import { MEMBERS } from '../../types'
import type { MemberKey, Project } from '../../types'

export function Sidebar() {
  const { filters, setFilters, projectId, setProject, myTasksOnly, setMyTasksOnly, sidebarOpen, setSidebarOpen } = useUiStore()
  const isMobile = useMobile()
  const tasks = useTaskStore(s => s.tasks)
  const { projects, addProject, updateProject, deleteProject, addMember, removeMember } = useProjectStore()
  const deleteMilestonesForProject = useMilestoneStore(s => s.deleteMilestonesForProject)
  const milestones = useMilestoneStore(s => s.milestones)
  const { memberKey, displayName, email, photoURL, signOutUser } = useAuthStore()

  // Project state
  const [addingProject, setAddingProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const projectNameRef = useRef<HTMLInputElement>(null)
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [editProjectName, setEditProjectName] = useState('')
  const projectEditRef = useRef<HTMLInputElement>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string; name: string; type: 'project' } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null)
  const [memberModal, setMemberModal] = useState<{ id: string; name: string } | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const profileRef = useRef<HTMLDivElement>(null)
  const [assetsExpanded, setAssetsExpanded] = useState(false)

  useEffect(() => { if (addingProject) projectNameRef.current?.focus() }, [addingProject])
  useEffect(() => { if (editingProjectId) projectEditRef.current?.select() }, [editingProjectId])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
    }
  }, [contextMenu])

  useEffect(() => {
    if (!profileOpen) return
    const close = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false)
      }
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [profileOpen])

  const accessibleProjectIds = new Set(
    projects
      .filter(p => canAccessProject(p, email))
      .map(p => p.id)
  )
  const hasAccess = accessibleProjectIds.size > 0
  const accessibleTasks = tasks.filter(t =>
    t.projectId ? accessibleProjectIds.has(t.projectId) : hasAccess
  )

  const isProjectCreator = (id: string): boolean => {
    const p = projects.find(pj => pj.id === id)
    if (!p || !email) return false
    if (p.creatorEmail) return p.creatorEmail.toLowerCase() === email.toLowerCase()
    return p.memberEmails?.[0]?.toLowerCase() === email.toLowerCase()
  }

  const handleLeaveProject = (id: string) => {
    if (!email) return
    if (!confirm('이 프로젝트에서 나가시겠어요?')) return
    if (projectId === id) setProject(null)
    removeMember(id, email)
    setContextMenu(null)
  }

  const handleAddProject = () => {
    const trimmed = newProjectName.trim()
    if (trimmed) {
      addProject(trimmed, undefined, undefined, undefined, email || undefined)
    }
    setNewProjectName('')
    setAddingProject(false)
  }

  const handleCancelAddProject = () => {
    setNewProjectName('')
    setAddingProject(false)
  }

  const handleRenameProject = (id: string) => {
    if (editProjectName.trim()) updateProject(id, { name: editProjectName.trim() })
    setEditingProjectId(null)
  }

  const handleDeleteProject = (id: string) => {
    if (projectId === id) setProject(null)
    deleteProject(id)
    deleteMilestonesForProject(id)
    setDeleteConfirm(null)
  }

  const handleContextMenu = (e: React.MouseEvent, id: string, name: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, id, name, type: 'project' })
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
  const userName = member?.n ?? displayName ?? null
  const presences = usePresenceStore(s => s.presences)

  const visibleProjects = projects.filter(p =>
    canAccessProject(p, email)
  )
  const onlineUsers = Object.values(presences).filter(p => p.online)

  const closeSidebar = () => { if (isMobile) setSidebarOpen(false) }

  return (
    <>
      {/* Mobile backdrop */}
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 999, backdropFilter: 'blur(2px)' }}
        />
      )}
      <aside style={{
        width: 240, background: 'var(--sb-bg)', display: 'flex', flexDirection: 'column', flexShrink: 0,
        borderRight: '1px solid rgba(255,255,255,.06)',
        ...(isMobile ? {
          position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 1000,
          transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform .25s cubic-bezier(.4,0,.2,1)',
          boxShadow: sidebarOpen ? '4px 0 24px rgba(0,0,0,.5)' : 'none',
        } : {}),
      }}>

        {/* Workspace header */}
        <div style={{ padding: '14px 12px 10px', paddingTop: isMobile ? 'calc(env(safe-area-inset-top, 0px) + 14px)' : '14px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid rgba(255,255,255,.06)', position: 'relative' }} ref={profileRef}>
          {/* Profile avatar — clickable */}
          <div
            onClick={() => setProfileOpen(o => !o)}
            title="계정 정보"
            style={{ width: 26, height: 26, borderRadius: 6, background: member?.grad ?? 'var(--ac)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0, cursor: 'pointer', overflow: 'hidden', outline: profileOpen ? '2px solid var(--ac)' : 'none', outlineOffset: 1 }}
          >
            {photoURL
              ? <img src={photoURL} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : (userName?.[0]?.toUpperCase() ?? 'W')
            }
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sb-t1)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              크린지 플로우
            </div>
            {userName && (
              <div style={{ fontSize: 11, color: 'var(--sb-t3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userName}</div>
            )}
          </div>
          <button
            onClick={() => signOutUser()}
            title="로그아웃"
            style={{ width: 22, height: 22, borderRadius: 4, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--sb-t3)', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--sb-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            ↩
          </button>

          {/* Profile popover */}
          {profileOpen && (
            <div style={{
              position: 'fixed',
              top: (() => { const r = profileRef.current?.getBoundingClientRect(); return r ? r.bottom + 6 : 60 })(),
              left: (() => { const r = profileRef.current?.getBoundingClientRect(); return r ? r.left : 12 })(),
              zIndex: 9999,
              background: 'var(--bg)',
              border: '1px solid var(--bd)',
              borderRadius: 'var(--r3)',
              boxShadow: 'var(--sh-lg)',
              padding: '12px',
              minWidth: 220,
              maxWidth: 280,
            }}>
              {/* Avatar + name */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: member?.grad ?? 'var(--ac)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#fff', flexShrink: 0, overflow: 'hidden' }}>
                  {photoURL
                    ? <img src={photoURL} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : (userName?.[0]?.toUpperCase() ?? 'W')
                  }
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {userName && (
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {userName}
                    </div>
                  )}
                  {email && (
                    <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {email}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 8 }}>
                <button
                  onClick={() => { setProfileOpen(false); signOutUser() }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 'var(--r2)', border: 'none', background: 'transparent', fontSize: 12, color: 'var(--t2)', cursor: 'pointer', fontFamily: 'var(--font)' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg2)'; e.currentTarget.style.color = 'var(--t1)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t2)' }}
                >
                  <span style={{ fontSize: 13 }}>↩</span> 로그아웃
                </button>
                <div style={{ fontSize: 10, color: 'var(--t3)', padding: '6px 8px 0', userSelect: 'text' }}>
                  빌드 {__BUILD_ID__}
                </div>
              </div>
            </div>
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

          <NavItem
            active={!myTasksOnly && projectId === null}
            onClick={() => { setProject(null); setMyTasksOnly(false); closeSidebar() }}
            count={accessibleTasks.length}
            icon="◈"
          >
            전체 업무
          </NavItem>

          <NavItem
            active={myTasksOnly}
            onClick={() => { setMyTasksOnly(!myTasksOnly); setProject(null); closeSidebar() }}
            count={tasks.filter(t => memberKey ? t.assignee === memberKey : false).length}
            icon="☑"
          >
            내 할 일
          </NavItem>

          {/* Projects section */}
          <SectionLabel>Projects</SectionLabel>

          {visibleProjects.map(p => {
            const taskCount = tasks.filter(t => t.projectId === p.id).length
            const daysInfo = p.dueDate ? getDaysRemaining(p.dueDate) : null

            if (editingProjectId === p.id) {
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px 4px 14px', margin: '1px 0' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                  <input
                    ref={projectEditRef}
                    style={{ flex: 1, background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)', borderRadius: 'var(--r1)', padding: '2px 6px', fontSize: 12, color: 'var(--sb-t1)', outline: 'none' }}
                    value={editProjectName}
                    onChange={e => setEditProjectName(e.target.value)}
                    onBlur={() => handleRenameProject(p.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleRenameProject(p.id)
                      if (e.key === 'Escape') setEditingProjectId(null)
                    }}
                  />
                </div>
              )
            }

            return (
              <ProjectItem
                key={p.id}
                active={projectId === p.id}
                dot={p.color}
                count={taskCount}
                daysInfo={daysInfo}
                inviteCode={p.inviteCode}
                onClick={() => { setProject(p.id); setMyTasksOnly(false); closeSidebar() }}
                onContextMenu={e => handleContextMenu(e, p.id, p.name)}
              >
                {p.name}
              </ProjectItem>
            )
          })}

          {/* Add project */}
          {addingProject ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px 4px 14px', margin: '1px 0' }}>
              <input
                ref={projectNameRef}
                style={{ flex: 1, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 'var(--r1)', padding: '3px 7px', fontSize: 12, color: 'var(--sb-t1)', outline: 'none' }}
                placeholder="프로젝트 이름..."
                value={newProjectName}
                onChange={e => setNewProjectName(e.target.value)}
                onBlur={handleAddProject}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAddProject()
                  if (e.key === 'Escape') handleCancelAddProject()
                }}
              />
            </div>
          ) : (
            <AddBtn onClick={() => setAddingProject(true)}>프로젝트 추가</AddBtn>
          )}

          {/* ASSETS section */}
          {(() => {
            const doneMsIds = new Set(milestones.filter(m => m.done).map(m => m.id))
            const allLinks = accessibleTasks
              .filter(t => !t.milestoneId || !doneMsIds.has(t.milestoneId))
              .flatMap(t => (t.links ?? []).map(link => ({ link, task: t })))
            const visibleLinks = assetsExpanded ? allLinks : allLinks.slice(0, 6)
            return (
              <>
                <SectionLabel>Assets</SectionLabel>
                {allLinks.length === 0 ? (
                  <div style={{ padding: '4px 10px', fontSize: 11, color: 'var(--sb-t3)' }}>링크가 없습니다</div>
                ) : (
                  <>
                    {visibleLinks.map(({ link, task }) => (
                      <AssetLinkItem key={link.id} title={link.title} url={link.url} taskName={task.name} />
                    ))}
                    {allLinks.length > 6 && (
                      <div
                        onClick={() => setAssetsExpanded(e => !e)}
                        style={{ padding: '4px 10px', fontSize: 11, color: 'var(--sb-t3)', cursor: 'pointer', transition: 'color .1s' }}
                        onMouseEnter={e => (e.currentTarget.style.color = 'var(--sb-t2)')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--sb-t3)')}
                      >
                        {assetsExpanded ? '접기' : `${allLinks.length - 6}개 더보기`}
                      </div>
                    )}
                  </>
                )}
              </>
            )
          })()}

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
                const avatarGrad = m?.grad ?? 'linear-gradient(135deg,#667eea,#764ba2)'
                const name = p.name
                return (
                  <div key={p.memberKey} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div style={{ width: 22, height: 22, borderRadius: '50%', background: avatarGrad, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff' }}>
                        {name[0]?.toUpperCase() ?? '?'}
                      </div>
                      <div style={{ position: 'absolute', bottom: 0, right: 0, width: 7, height: 7, borderRadius: '50%', background: '#22c55e', border: '1.5px solid var(--sb-bg)' }} />
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--sb-t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {name}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </aside>

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 9999,
            background: 'var(--bg2)',
            border: '1px solid var(--bd)',
            borderRadius: 'var(--r2)',
            boxShadow: '0 4px 20px rgba(0,0,0,.35)',
            minWidth: 148,
            overflow: 'hidden',
            padding: '4px 0',
          }}
          onClick={e => e.stopPropagation()}
        >
          {isProjectCreator(contextMenu.id) ? (
            <>
              <ContextMenuItem onClick={() => { setEditingProjectId(contextMenu.id); setEditProjectName(contextMenu.name); setContextMenu(null) }}>
                ✎&nbsp;&nbsp;이름 수정
              </ContextMenuItem>
              <ContextMenuItem onClick={() => { setMemberModal({ id: contextMenu.id, name: contextMenu.name }); setContextMenu(null) }}>
                👥&nbsp;&nbsp;멤버 관리
              </ContextMenuItem>
              <div style={{ height: 1, background: 'var(--bd)', margin: '4px 0' }} />
              <ContextMenuItem danger onClick={() => { setDeleteConfirm({ id: contextMenu.id, name: contextMenu.name }); setContextMenu(null) }}>
                ×&nbsp;&nbsp;삭제
              </ContextMenuItem>
            </>
          ) : (
            <ContextMenuItem danger onClick={() => handleLeaveProject(contextMenu.id)}>
              →&nbsp;&nbsp;나가기
            </ContextMenuItem>
          )}
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <DeleteConfirmModal
          name={deleteConfirm.name}
          onConfirm={() => handleDeleteProject(deleteConfirm.id)}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}

      {/* Member management modal */}
      {memberModal && (() => {
        const proj = projects.find(p => p.id === memberModal.id)
        if (!proj) return null
        return (
          <MemberManageModal
            project={proj}
            currentEmail={email ?? undefined}
            onAddMember={e => addMember(proj.id, e)}
            onRemoveMember={e => removeMember(proj.id, e)}
            onClose={() => setMemberModal(null)}
          />
        )
      })()}
    </>
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

function ProjectItem({ children, active, dot, count, daysInfo, inviteCode, onClick, onContextMenu }: {
  children: React.ReactNode; active: boolean; dot: string; count: number
  daysInfo: { days: number; overdue: boolean } | null
  inviteCode?: string
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [copied, setCopied] = useState(false)

  const copyLink = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!inviteCode) return
    const link = `${window.location.origin}${window.location.pathname}?invite=${inviteCode}`
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }

  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
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

      {hovered && inviteCode ? (
        <div style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
          <ActionIcon onClick={copyLink} title={copied ? '복사됨!' : '초대 링크 복사'}>
            {copied ? '✓' : '↗'}
          </ActionIcon>
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

function ActionIcon({ children, onClick, danger, title }: { children: React.ReactNode; onClick: (e: React.MouseEvent) => void; danger?: boolean; title?: string }) {
  return (
    <span
      onClick={onClick}
      title={title}
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

function AssetLinkItem({ title, url, taskName }: { title: string; url: string; taskName: string }) {
  return (
    <div
      onClick={() => window.open(url, '_blank', 'noopener')}
      style={{ padding: '5px 8px 5px 10px', borderRadius: 'var(--r2)', cursor: 'pointer', margin: '1px 0', transition: 'background .1s' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--sb-hover)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      title={url}
    >
      <div style={{ fontSize: 12, color: 'var(--sb-t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
        ↗ {title || url}
      </div>
      <div style={{ fontSize: 10, color: 'var(--sb-t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
        {taskName}
      </div>
    </div>
  )
}

function ContextMenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '7px 14px',
        fontSize: 13,
        color: danger ? '#f87171' : 'var(--t2)',
        cursor: 'pointer',
        transition: 'background .1s',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg3)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      {children}
    </div>
  )
}

function DeleteConfirmModal({ name, onConfirm, onCancel }: {
  name: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const [typed, setTyped] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: 'var(--bg2)',
          border: '1px solid var(--bd)',
          borderRadius: 'var(--r3)',
          padding: '28px 28px 24px',
          width: 380,
          boxShadow: '0 8px 40px rgba(0,0,0,.45)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--t1)', marginBottom: 8 }}>
          프로젝트 삭제
        </div>
        <div style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.6, marginBottom: 20 }}>
          이 작업은 되돌릴 수 없습니다. 삭제하려면 아래에 프로젝트 이름을 정확히 입력하세요.
          <br />
          <span style={{ fontWeight: 600, color: 'var(--t1)' }}>{name}</span>
        </div>
        <input
          ref={inputRef}
          value={typed}
          onChange={e => setTyped(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && typed === name) onConfirm()
            if (e.key === 'Escape') onCancel()
          }}
          placeholder={name}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'var(--bg3)', border: '1px solid var(--bd2)',
            borderRadius: 'var(--r2)', padding: '8px 10px',
            fontSize: 13, color: 'var(--t1)', outline: 'none',
            marginBottom: 16,
          }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '7px 16px', borderRadius: 'var(--r2)', border: '1px solid var(--bd)',
              background: 'transparent', color: 'var(--t2)', fontSize: 13, cursor: 'pointer',
            }}
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            disabled={typed !== name}
            style={{
              padding: '7px 16px', borderRadius: 'var(--r2)', border: 'none',
              background: typed === name ? '#dc2626' : 'rgba(220,38,38,.3)',
              color: typed === name ? '#fff' : 'rgba(255,255,255,.35)',
              fontSize: 13, fontWeight: 600,
              cursor: typed === name ? 'pointer' : 'not-allowed',
              transition: 'background .15s, color .15s',
            }}
          >
            삭제
          </button>
        </div>
      </div>
    </div>
  )
}

function MemberManageModal({ project, currentEmail, onAddMember, onRemoveMember, onClose }: {
  project: Project
  currentEmail?: string
  onAddMember: (email: string) => void
  onRemoveMember: (email: string) => void
  onClose: () => void
}) {
  const [newEmail, setNewEmail] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  const handleAdd = () => {
    const e = newEmail.trim().toLowerCase()
    if (!e || !e.includes('@')) return
    onAddMember(e)
    setNewEmail('')
  }

  const members = project.memberEmails ?? []
  const pending = project.pendingEmails ?? []

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 'var(--r3)', padding: '24px', width: 420, boxShadow: '0 8px 40px rgba(0,0,0,.45)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: project.color, flexShrink: 0 }} />
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--t1)' }}>{project.name} 멤버 관리</span>
          <button onClick={onClose} style={{ marginLeft: 'auto', width: 24, height: 24, borderRadius: 4, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--t3)', fontSize: 14 }}>✕</button>
        </div>

        <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 12 }}>
          추가된 이메일만 이 프로젝트에 접근할 수 있습니다.
        </div>

        {/* Current members */}
        <div style={{ marginBottom: 16, maxHeight: 240, overflowY: 'auto' }}>
          {members.length === 0 && pending.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--t3)', padding: '8px 0' }}>멤버가 없습니다 (공개 프로젝트)</div>
          ) : (
            <>
              {members.map(m => {
                const isSelf = currentEmail ? m.toLowerCase() === currentEmail.toLowerCase() : false
                return (
                  <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--bd)' }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#667eea,#764ba2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                      {m[0]?.toUpperCase()}
                    </div>
                    <span style={{ flex: 1, fontSize: 13, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m}</span>
                    {isSelf ? (
                      <span style={{ padding: '2px 8px', fontSize: 11, color: 'var(--t3)' }}>나</span>
                    ) : (
                      <button
                        onClick={() => onRemoveMember(m)}
                        style={{ padding: '2px 8px', borderRadius: 'var(--r1)', border: '1px solid rgba(239,68,68,.3)', background: 'transparent', color: '#f87171', fontSize: 11, cursor: 'pointer' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,.07)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        제거
                      </button>
                    )}
                  </div>
                )
              })}
              {pending.map(m => (
                <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--bd)', opacity: 0.75 }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#a3a3a3,#737373)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                    {m[0]?.toUpperCase()}
                  </div>
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m}</span>
                  <span style={{ padding: '2px 7px', borderRadius: 'var(--r1)', fontSize: 10, fontWeight: 600, color: '#d97706', background: 'rgba(217,119,6,.1)', border: '1px solid rgba(217,119,6,.25)', whiteSpace: 'nowrap' }}>
                    초대됨
                  </span>
                  <button
                    onClick={() => onRemoveMember(m)}
                    style={{ padding: '2px 8px', borderRadius: 'var(--r1)', border: '1px solid rgba(239,68,68,.3)', background: 'transparent', color: '#f87171', fontSize: 11, cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,.07)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    취소
                  </button>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Add member */}
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            ref={inputRef}
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
            placeholder="이메일 주소 입력..."
            style={{ flex: 1, background: 'var(--bg3)', border: '1px solid var(--bd2)', borderRadius: 'var(--r2)', padding: '8px 10px', fontSize: 13, color: 'var(--t1)', outline: 'none' }}
          />
          <button
            onClick={handleAdd}
            style={{ padding: '8px 14px', borderRadius: 'var(--r2)', border: 'none', background: 'var(--ac)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            초대
          </button>
        </div>
      </div>
    </div>
  )
}
