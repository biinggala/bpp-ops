import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { isComposing, authorizedEmails, isAssignedTo, copyText } from '../../lib/utils'
import { askConfirm } from '../shared/Confirm'
import { useUiStore } from '../../store/uiStore'
import { useTaskStore } from '../../store/taskStore'
import { useAuthStore } from '../../store/authStore'
import { useProjectStore } from '../../store/projectStore'
import { useMilestoneStore } from '../../store/milestoneStore'
import { usePresenceStore } from '../../store/presenceStore'
import { useUserProfileStore } from '../../store/userProfileStore'
import { useMobile } from '../../hooks/useMobile'
import { haptic } from '../../lib/haptics'
import { MEMBERS } from '../../types'
import { buildInviteToken } from '../../lib/paths'
import type { MemberKey, Project } from '../../types'

const ORDER_KEY = 'sidebar_project_order'
const GROUPS_KEY = 'sidebar_collapsed_groups'

/**
 * The sidebar's arrangement is this machine's business.
 *
 * A shared order would mean any of fifty people could rearrange everyone else's
 * list by dragging one row, and nobody could trust the shape of their own
 * screen. The shelves themselves are shared; where they sit is not.
 */
function loadOrder(): string[] {
  try { return JSON.parse(localStorage.getItem(ORDER_KEY) ?? '[]') as string[] } catch { return [] }
}
function saveOrder(next: string[]): string[] {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  return next
}
function loadCollapsedGroups(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '[]') as string[]) } catch { return new Set() }
}
function saveCollapsedGroups(next: Set<string>) {
  try { localStorage.setItem(GROUPS_KEY, JSON.stringify([...next])) } catch { /* ignore */ }
}

export function Sidebar() {
  const { filters, setFilters, projectId, setProject, myTasksOnly, setMyTasksOnly, sidebarOpen, setSidebarOpen } = useUiStore()
  const isMobile = useMobile()
  const tasks = useTaskStore(s => s.tasks)
  const { projects, addProject, updateProject, deleteProject, addMember, removeMember } = useProjectStore()
  const deleteMilestonesForProject = useMilestoneStore(s => s.deleteMilestonesForProject)
  const { memberKey, displayName, email, photoURL, signOutUser } = useAuthStore()

  // Project state
  const [addingProject, setAddingProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const projectNameRef = useRef<HTMLInputElement>(null)
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [editProjectName, setEditProjectName] = useState('')
  const projectEditRef = useRef<HTMLInputElement>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string; name: string; archived: boolean; type: 'project' } | null>(null)
  const [archivedExpanded, setArchivedExpanded] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null)
  const [memberModal, setMemberModal] = useState<{ id: string; name: string } | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const profileRef = useRef<HTMLDivElement>(null)

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

  // Archived projects are excluded so the counts match the views they describe
  // what that view actually shows.
  const accessibleProjectIds = new Set(
    projects
      .filter(p => !p.archived)
      .map(p => p.id)
  )
  const hasAccess = accessibleProjectIds.size > 0
  const accessibleTasks = tasks.filter(t =>
    t.projectId ? accessibleProjectIds.has(t.projectId) : hasAccess
  )

  // Archived projects are absent from every aggregate view, so they must be
  // absent from the numbers describing those views too.
  const archivedIds = useMemo(
    () => new Set(projects.filter(p => p.archived).map(p => p.id)),
    [projects],
  )
  const activeTasks = useMemo(
    () => accessibleTasks.filter(t => !t.projectId || !archivedIds.has(t.projectId)),
    [accessibleTasks, archivedIds],
  )

  // What is still on my plate — the same predicate 내 할 일 filters by, minus
  // the ones already finished. A count of everything ever assigned answers no
  // question anyone asks of a sidebar.
  const myOpenCount = useMemo(
    () => activeTasks.filter(t => t.status !== '완료' && isAssignedTo(t.assignee, memberKey, email)).length,
    [activeTasks, memberKey, email],
  )

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])
  /** Per project: only what has blown its deadline. Zero shows nothing at all. */
  const overdueByProject = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of accessibleTasks) {
      if (!t.projectId || t.status === '완료' || !t.due) continue
      if (new Date(t.due).setHours(0, 0, 0, 0) >= today.getTime()) continue
      m.set(t.projectId, (m.get(t.projectId) ?? 0) + 1)
    }
    return m
  }, [accessibleTasks, today])

  const isProjectCreator = (id: string): boolean => {
    const p = projects.find(pj => pj.id === id)
    if (!p || !email) return false
    if (p.creatorEmail) return p.creatorEmail.toLowerCase() === email.toLowerCase()
    return p.memberEmails?.[0]?.toLowerCase() === email.toLowerCase()
  }

  const handleLeaveProject = async (id: string) => {
    if (!email) return
    const ok = await askConfirm({
      message: '이 프로젝트에서 나가시겠어요?',
      detail: '다시 초대받아야 볼 수 있습니다.',
      confirmLabel: '나가기',
    })
    if (!ok) return
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

  const handleContextMenu = (e: React.MouseEvent, id: string, name: string, archived: boolean) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, id, name, archived, type: 'project' })
  }

  const handleArchiveProject = (id: string, archived: boolean) => {
    // Leaving an archived project selected would strand the user on a view that
    // is hidden everywhere else, so drop back to 전체 업무.
    if (archived && projectId === id) setProject(null)
    updateProject(id, { archived })
    if (archived) setArchivedExpanded(true)
    setContextMenu(null)
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

  const accessibleProjects = projects
  const visibleProjects = accessibleProjects.filter(p => !p.archived)
  const archivedProjects = accessibleProjects.filter(p => p.archived)

  // ── Shelves ───────────────────────────────────────────────────────────────
  //
  // Two different kinds of thing, kept apart on purpose.
  //
  // The *group* is a fact about the project — 프로덕션 work is 프로덕션 work for
  // everyone — so it lives on the project and everybody sees the same shelves.
  // The *order* is a preference, and with fifty people sharing one list a drag
  // by any of them would rearrange everyone else's sidebar. That one stays here,
  // on this machine.
  const [order, setOrder] = useState<string[]>(loadOrder)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(loadCollapsedGroups)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<{ id: string; below: boolean } | null>(null)
  const [groupFor, setGroupFor] = useState<{ id: string; name: string; group: string } | null>(null)

  const rank = useCallback((id: string) => {
    const at = order.indexOf(id)
    return at === -1 ? Number.MAX_SAFE_INTEGER : at
  }, [order])

  const shelves = useMemo(() => {
    const byGroup = new Map<string, Project[]>()
    for (const p of visibleProjects) {
      const key = p.group?.trim() || ''
      const at = byGroup.get(key)
      if (at) at.push(p); else byGroup.set(key, [p])
    }
    const out = [...byGroup.entries()].map(([name, list]) => ({
      name,
      projects: [...list].sort((a, b) => rank(a.id) - rank(b.id)),
    }))
    // Loose projects lead — they are the ones still looking for a shelf. The
    // shelves themselves follow whatever their first project's position says.
    return out.sort((a, b) => {
      if (!a.name !== !b.name) return a.name ? 1 : -1
      return rank(a.projects[0]?.id ?? '') - rank(b.projects[0]?.id ?? '')
    })
  }, [visibleProjects, rank])

  const groupNames = useMemo(
    () => [...new Set(accessibleProjects.map(p => p.group?.trim()).filter((g): g is string => !!g))].sort(),
    [accessibleProjects],
  )

  /** Writes the new arrangement, and files the dragged project on the shelf it landed on. */
  const dropProject = (draggedId: string, target: { id: string; below: boolean } | { group: string }) => {
    const flat = shelves.flatMap(sh => sh.projects.map(p => p.id))
    const without = flat.filter(id => id !== draggedId)

    let next: string[]
    let group: string
    if ('group' in target) {
      // Dropped on a shelf's own header: it goes to the end of that shelf.
      group = target.group
      const last = shelves.find(sh => sh.name === target.group)?.projects.slice(-1)[0]?.id
      const at = last ? without.indexOf(last) + 1 : without.length
      next = [...without.slice(0, at), draggedId, ...without.slice(at)]
      } else {
      const onto = visibleProjects.find(p => p.id === target.id)
      group = onto?.group?.trim() || ''
      const at = without.indexOf(target.id) + (target.below ? 1 : 0)
      next = [...without.slice(0, at), draggedId, ...without.slice(at)]
    }

    setOrder(saveOrder(next))
    const dragged = visibleProjects.find(p => p.id === draggedId)
    if (dragged && (dragged.group?.trim() || '') !== group) {
      updateProject(draggedId, { group: group || undefined })
    }
  }

  const renameGroup = (from: string, to: string) => {
    const name = to.trim()
    if (name === from) return
    visibleProjects
      .filter(p => (p.group?.trim() || '') === from)
      .forEach(p => updateProject(p.id, { group: name || undefined }))
  }

  const toggleGroup = (name: string) =>
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      saveCollapsedGroups(next)
      return next
    })
  const onlineUsers = Object.values(presences).filter(p => p.online)

  const closeSidebar = () => { if (isMobile) { haptic('tap'); setSidebarOpen(false) } }

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
              bpp-ops
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

          {/* 내 할 일 comes first and is the only nav row carrying a number.
              It is where the day starts, and "how many are still mine" is the
              one count in this sidebar that changes what someone does next. */}
          <NavItem
            active={myTasksOnly}
            onClick={() => { setMyTasksOnly(!myTasksOnly); setProject(null); closeSidebar() }}
            count={myOpenCount}
            emphasis
            icon="☑"
          >
            내 할 일
          </NavItem>

          <NavItem
            active={!myTasksOnly && projectId === null}
            onClick={() => { setProject(null); setMyTasksOnly(false); closeSidebar() }}
            icon="◈"
          >
            전체 업무
          </NavItem>

          {/* Projects section */}
          <SectionLabel>Projects</SectionLabel>

          {shelves.map(shelf => {
            const collapsed = collapsedGroups.has(shelf.name)
            return (
              <div key={shelf.name || '__loose__'} style={{ marginBottom: shelf.name ? 2 : 0 }}>
                {/* A shelf with no name is not a shelf — those projects are just
                    the list, and a header over them would name nothing. */}
                {shelf.name && (
                  <GroupHeader
                    name={shelf.name}
                    count={shelf.projects.length}
                    collapsed={collapsed}
                    onToggle={() => toggleGroup(shelf.name)}
                    onRename={to => renameGroup(shelf.name, to)}
                    onDropProject={() => {
                      if (dragging) dropProject(dragging, { group: shelf.name })
                      setDragging(null); setDropAt(null)
                    }}
                    dragging={!!dragging}
                  />
                )}
                {!collapsed && shelf.projects.map(p => {
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
                            if (e.key === 'Enter' && !isComposing(e)) handleRenameProject(p.id)
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
                      overdue={overdueByProject.get(p.id) ?? 0}
                      daysInfo={daysInfo}
                      projectId={p.id}
                      inviteCode={p.inviteCode}
                      indented={!!shelf.name}
                      dragging={dragging === p.id}
                      dropAt={dropAt?.id === p.id ? (dropAt.below ? 'below' : 'above') : null}
                      onDragStart={() => setDragging(p.id)}
                      onDragEnd={() => { setDragging(null); setDropAt(null) }}
                      onDragOver={below => setDropAt({ id: p.id, below })}
                      onDrop={() => {
                        if (dragging && dragging !== p.id) dropProject(dragging, { id: p.id, below: !!dropAt?.below })
                        setDragging(null); setDropAt(null)
                      }}
                      onClick={() => { setProject(p.id); setMyTasksOnly(false); closeSidebar() }}
                      onContextMenu={e => handleContextMenu(e, p.id, p.name, false)}
                    >
                      {p.name}
                    </ProjectItem>
                  )
                })}
              </div>
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
                  if (e.key === 'Enter' && !isComposing(e)) handleAddProject()
                  if (e.key === 'Escape') handleCancelAddProject()
                }}
              />
            </div>
          ) : (
            <AddBtn onClick={() => setAddingProject(true)}>프로젝트 추가</AddBtn>
          )}

          {/* Archived projects — collapsed by default, out of the way */}
          {archivedProjects.length > 0 && (
            <>
              <div
                onClick={() => setArchivedExpanded(v => !v)}
                style={{ padding: '10px 8px 3px', fontSize: 11, fontWeight: 600, color: 'var(--sb-t3)', letterSpacing: '.06em', textTransform: 'uppercase', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, userSelect: 'none' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--sb-t2)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--sb-t3)')}
              >
                <span style={{ fontSize: 8, display: 'inline-block', transform: archivedExpanded ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}>▶</span>
                Archived
                <span style={{ marginLeft: 'auto', fontSize: 10, opacity: .8, letterSpacing: 0 }}>{archivedProjects.length}</span>
              </div>

              {archivedExpanded && archivedProjects.map(p => {
                return (
                  <ProjectItem
                    key={p.id}
                    active={projectId === p.id}
                    dot={p.color}
                    overdue={0}
                    daysInfo={null}
                    projectId={p.id}
                    dimmed
                    onClick={() => { setProject(p.id); setMyTasksOnly(false); closeSidebar() }}
                    onContextMenu={e => handleContextMenu(e, p.id, p.name, true)}
                  >
                    {p.name}
                  </ProjectItem>
                )
              })}
            </>
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
                const avatarGrad = m?.grad ?? 'linear-gradient(135deg,#667eea,#764ba2)'
                const name = p.name
                return (
                  <div key={p.memberKey} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div style={{ width: 22, height: 22, borderRadius: '50%', background: avatarGrad, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff' }}>
                        {name[0]?.toUpperCase() ?? '?'}
                      </div>
                      <div style={{ position: 'absolute', bottom: 0, right: 0, width: 7, height: 7, borderRadius: '50%', background: '#448361', border: '1.5px solid var(--sb-bg)' }} />
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
              <ContextMenuItem onClick={() => {
                const project = projects.find(p => p.id === contextMenu.id)
                setGroupFor({ id: contextMenu.id, name: contextMenu.name, group: project?.group ?? '' })
                setContextMenu(null)
              }}>
                ▤&nbsp;&nbsp;그룹 지정
              </ContextMenuItem>
              <ContextMenuItem onClick={() => handleArchiveProject(contextMenu.id, !contextMenu.archived)}>
                {contextMenu.archived ? '↩  아카이브 해제' : '📦  아카이브'}
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

      {/* Which shelf a project sits on — the one thing a drag cannot say, because
          a shelf that does not exist yet has nothing to drop onto. */}
      {groupFor && (
        <GroupPicker
          name={groupFor.name}
          value={groupFor.group}
          options={groupNames}
          onSave={g => { updateProject(groupFor.id, { group: g || undefined }); setGroupFor(null) }}
          onCancel={() => setGroupFor(null)}
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
            // Only people already sharing a project with the inviter may be
            // suggested — userProfiles holds every account that has ever signed
            // in, which is not a team.
            suggestable={authorizedEmails(projects, email)}
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

function NavItem({ children, active, onClick, count, emphasis, icon }: {
  children: React.ReactNode; active: boolean; onClick: () => void
  /** Omitted where a number would be decoration rather than information. */
  count?: number
  /** Draws the count as a filled pill — the row you are meant to start from. */
  emphasis?: boolean
  icon?: string
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 8px', borderRadius: 'var(--r2)', cursor: 'pointer',
        fontSize: 13, fontWeight: active || emphasis ? 500 : 400, margin: '1px 0',
        color: active || emphasis ? 'var(--sb-t1)' : 'var(--sb-t2)',
        background: active ? 'var(--sb-active)' : 'transparent',
        transition: 'background .1s, color .1s',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--sb-hover)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
    >
      {icon && <span style={{ fontSize: 11, opacity: emphasis ? .85 : .6, width: 16, textAlign: 'center', flexShrink: 0 }}>{icon}</span>}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
      {count !== undefined && count > 0 && (
        emphasis ? (
          <span title="아직 완료하지 않은 내 업무" style={{
            marginLeft: 'auto', flexShrink: 0,
            minWidth: 18, padding: '0 6px', height: 17,
            borderRadius: 999, background: 'var(--ac)', color: '#fff',
            fontSize: 11, fontWeight: 600,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>{count}</span>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--sb-t3)', marginLeft: 'auto', flexShrink: 0 }}>{count}</span>
        )
      )}
    </div>
  )
}

/**
 * The head of one shelf.
 *
 * Quiet by design: it is a divider that happens to have a name, not a row that
 * competes with the projects under it. Dropping a project on it files it here,
 * which is the only way to put something on a shelf it is not next to.
 */
function GroupPicker({ name, value, options, onSave, onCancel }: {
  name: string
  value: string
  options: string[]
  onSave: (group: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(value)

  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,15,.45)', zIndex: 9500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg)', borderRadius: 'var(--r3)', boxShadow: 'var(--sh-lg)', width: '100%', maxWidth: 420, padding: '22px 24px' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--t1)' }}>그룹 지정</div>
        <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 4, marginBottom: 14, lineHeight: 1.6 }}>
          {name} 을(를) 어떤 묶음에 둘까요. 이 이름은 <b>모두에게 같게 보입니다</b> — 사이드바 순서는 각자 정하지만, 무슨 종류의 일인지는 팀이 함께 쓰는 말이니까요.
        </div>

        {options.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {options.map(g => (
              <button
                key={g}
                onClick={() => setDraft(g)}
                style={{
                  padding: '3px 10px', fontSize: 12, borderRadius: 999, cursor: 'pointer', fontFamily: 'var(--font)',
                  border: `1px solid ${draft === g ? 'var(--ac)' : 'var(--bd)'}`,
                  background: draft === g ? 'var(--ac-l)' : 'transparent',
                  color: draft === g ? 'var(--ac)' : 'var(--t2)',
                }}
              >{g}</button>
            ))}
          </div>
        )}

        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !isComposing(e)) onSave(draft.trim()); if (e.key === 'Escape') onCancel() }}
          placeholder="예: 프로덕션, 앱개발"
          style={{ width: '100%', padding: '9px 11px', borderRadius: 'var(--r1)', border: '1px solid var(--bd)', background: 'var(--bg)', fontSize: 13, color: 'var(--t1)', outline: 'none', fontFamily: 'var(--font)' }}
        />

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 18 }}>
          {value && (
            <button onClick={() => onSave('')} style={{ marginRight: 'auto', padding: '6px 12px', fontSize: 13, borderRadius: 'var(--r1)', border: '1px solid var(--bd)', background: 'transparent', color: '#D44C47', cursor: 'pointer', fontFamily: 'var(--font)' }}>
              그룹에서 빼기
            </button>
          )}
          <button onClick={onCancel} style={{ padding: '6px 14px', fontSize: 13, borderRadius: 'var(--r1)', border: '1px solid var(--bd)', background: 'transparent', color: 'var(--t2)', cursor: 'pointer', fontFamily: 'var(--font)' }}>취소</button>
          <button onClick={() => onSave(draft.trim())} style={{ padding: '6px 14px', fontSize: 13, fontWeight: 500, borderRadius: 'var(--r1)', border: '1px solid var(--ac)', background: 'var(--ac)', color: '#fff', cursor: 'pointer', fontFamily: 'var(--font)' }}>저장</button>
        </div>
      </div>
    </div>
  )
}

function GroupHeader({ name, count, collapsed, onToggle, onRename, onDropProject, dragging }: {
  name: string
  count: number
  collapsed: boolean
  onToggle: () => void
  onRename: (to: string) => void
  onDropProject: () => void
  dragging: boolean
}) {
  const [hovered, setHovered] = useState(false)
  const [over, setOver] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)

  const commit = () => { setEditing(false); onRename(draft) }

  return (
    <div
      onDragOver={e => { if (dragging) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={e => {
        if (!dragging) return
        e.preventDefault(); e.stopPropagation()
        setOver(false)
        onDropProject()
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '6px 8px 4px 10px', margin: '6px 0 0', borderRadius: 'var(--r1)',
        cursor: 'pointer', userSelect: 'none',
        background: over ? 'var(--sb-hover)' : 'transparent',
        boxShadow: over ? 'inset 0 0 0 1px var(--ac)' : 'none',
      }}
      onClick={() => { if (!editing) onToggle() }}
    >
      <span style={{ fontSize: 8, color: 'var(--sb-t3)', width: 8, flexShrink: 0 }}>{collapsed ? '▶' : '▼'}</span>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onClick={e => e.stopPropagation()}
          onBlur={commit}
          onKeyDown={e => {
            if (isComposing(e)) return
            if (e.key === 'Enter') { e.preventDefault(); commit() }
            if (e.key === 'Escape') { setDraft(name); setEditing(false) }
          }}
          style={{ flex: 1, minWidth: 0, background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)', borderRadius: 'var(--r1)', padding: '1px 5px', fontSize: 11, color: 'var(--sb-t1)', outline: 'none' }}
        />
      ) : (
        <span style={{
          flex: 1, fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
          color: 'var(--sb-t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {name}
        </span>
      )}
      {!editing && (
        hovered
          ? <ActionIcon onClick={e => { e.stopPropagation(); setDraft(name); setEditing(true) }} title="그룹 이름 수정">✎</ActionIcon>
          : <span style={{ fontSize: 10, color: 'var(--sb-t3)', opacity: .7, flexShrink: 0 }}>{count}</span>
      )}
    </div>
  )
}

function ProjectItem({
  children, active, dot, overdue, daysInfo, projectId, inviteCode, dimmed, indented,
  dragging, dropAt, onDragStart, onDragEnd, onDragOver, onDrop, onClick, onContextMenu,
}: {
  children: React.ReactNode; active: boolean; dot: string
  /** Tasks past their due date. Nothing is drawn at zero. */
  overdue: number
  daysInfo: { days: number; overdue: boolean } | null
  projectId: string
  inviteCode?: string
  dimmed?: boolean
  /** Sitting on a named shelf, which is a step in from the loose ones. */
  indented?: boolean
  dragging?: boolean
  /** Where the row being dragged would land relative to this one. */
  dropAt?: 'above' | 'below' | null
  onDragStart?: () => void
  onDragEnd?: () => void
  onDragOver?: (below: boolean) => void
  onDrop?: () => void
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null)
  const copyLink = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!inviteCode) return
    // The token names the project as well as the code — whoever opens the link
    // is not a member yet and cannot look the project up by code alone.
    const link = `${window.location.origin}${window.location.pathname}?invite=${buildInviteToken(projectId, inviteCode)}`
    setCopied(await copyText(link) ? 'yes' : 'no')
    setTimeout(() => setCopied(null), 1800)
  }

  return (
    <div
      draggable={!!onDragStart}
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart?.() }}
      onDragEnd={onDragEnd}
      onDragOver={e => {
        if (!onDragOver) return
        e.preventDefault()
        const box = e.currentTarget.getBoundingClientRect()
        onDragOver(e.clientY > box.top + box.height / 2)
      }}
      onDrop={e => { if (onDrop) { e.preventDefault(); onDrop() } }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: `5px 8px 5px ${indented ? 24 : 14}px`, borderRadius: 'var(--r2)', cursor: 'pointer',
        fontSize: 13, fontWeight: active ? 500 : 400, margin: '1px 0',
        color: active ? 'var(--sb-t1)' : dimmed ? 'var(--sb-t3)' : 'var(--sb-t2)',
        background: active ? 'var(--sb-active)' : hovered ? 'var(--sb-hover)' : 'transparent',
        transition: 'background .1s',
        opacity: dragging ? .4 : 1,
        // The line is where it would land, drawn on the edge it would land on.
        boxShadow: dropAt === 'above' ? 'inset 0 2px 0 var(--ac)' : dropAt === 'below' ? 'inset 0 -2px 0 var(--ac)' : 'none',
      }}
    >
      {/* The dot's slot holds the grip while you are over the row. A row that
          can be dragged and never says so is a row nobody drags — which is how
          this shipped the first time. */}
      {hovered && onDragStart ? (
        <span
          title="드래그해서 순서 변경 · 그룹 헤더에 놓으면 그룹 이동"
          style={{ width: 8, flexShrink: 0, display: 'flex', justifyContent: 'center', fontSize: 10, lineHeight: 1, color: 'var(--sb-t3)', cursor: 'grab' }}
        >⠿</span>
      ) : (
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0, opacity: dimmed ? .5 : 1 }} />
      )}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>

      {hovered && inviteCode ? (
        <div style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
          <ActionIcon
            onClick={copyLink}
            title={copied === 'yes' ? '복사됨!' : copied === 'no' ? '복사 실패 — 링크를 직접 선택해 주세요' : '초대 링크 복사'}
          >
            {copied === 'yes' ? '✓' : copied === 'no' ? '✕' : '↗'}
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
          {/* A project's total task count is the same big number every day and
              nobody acts on it. What is past due is worth interrupting for. */}
          {overdue > 0 && (
            <span title={`마감 지난 업무 ${overdue}개`} style={{
              fontSize: 10, fontWeight: 600, flexShrink: 0,
              minWidth: 16, padding: '0 5px', height: 15, borderRadius: 999,
              background: 'rgba(248,113,113,.16)', color: '#f87171',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>{overdue}</span>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * One folder address per project, so the files for a job are a click from the
 * job itself rather than a search away.
 *
 * Only the address is stored — nothing is read from Drive, so no additional
 * Google permission is involved and whatever the folder is shared with stays
 * exactly as Drive has it.
 */
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
            if (e.key === 'Enter' && !isComposing(e) && typed === name) onConfirm()
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
              background: typed === name ? '#D44C47' : 'rgba(212,76,71,.3)',
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

function MemberManageModal({ project, currentEmail, suggestable, onAddMember, onRemoveMember, onClose }: {
  project: Project
  currentEmail?: string
  /** Emails the inviter already shares a project with — the only ones that may
   *  be suggested. userProfiles contains every account that has ever signed in,
   *  so suggesting from it directly would disclose the whole user base. */
  suggestable: Set<string>
  onAddMember: (email: string) => void
  onRemoveMember: (email: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  const profiles = useUserProfileStore(s => s.profiles)
  const getNameByEmail = useUserProfileStore(s => s.getNameByEmail)

  const members = project.memberEmails ?? []
  const pending = project.pendingEmails ?? []

  // Suggestions are drawn only from people already sharing a project with the
  // inviter, and only once something has been typed — profiles are keyed by uid
  // and cover the entire user base, so neither restriction is cosmetic.
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const taken = new Set([...members, ...pending].map(e => e.toLowerCase()))
    const seen = new Set<string>()
    return Object.values(profiles).filter(p => {
      if (!p?.email) return false
      const key = p.email.toLowerCase()
      if (!suggestable.has(key)) return false
      if (taken.has(key) || seen.has(key)) return false
      if (!(p.name?.toLowerCase().includes(q) || key.includes(q))) return false
      seen.add(key)
      return true
    }).slice(0, 6)
  }, [profiles, query, suggestable, members.join(','), pending.join(',')])

  useEffect(() => { setHighlight(0) }, [query])

  const invite = (email: string) => {
    onAddMember(email.trim().toLowerCase())
    setQuery('')
  }

  // Falls back to the typed text so someone who has never signed in — and so has
  // no profile to match against — can still be invited by address.
  const handleAdd = () => {
    const picked = suggestions[highlight]
    if (picked) return invite(picked.email)
    const typed = query.trim().toLowerCase()
    if (typed.includes('@')) invite(typed)
  }

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
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getNameByEmail(m)}</div>
                      <div style={{ fontSize: 11, color: 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m}</div>
                    </div>
                    {isSelf ? (
                      <span style={{ padding: '2px 8px', fontSize: 11, color: 'var(--t3)' }}>나</span>
                    ) : (
                      <button
                        onClick={() => onRemoveMember(m)}
                        style={{ padding: '2px 8px', borderRadius: 'var(--r1)', border: '1px solid rgba(212,76,71,.3)', background: 'transparent', color: '#f87171', fontSize: 11, cursor: 'pointer' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(212,76,71,.07)'}
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
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getNameByEmail(m)}</div>
                    <div style={{ fontSize: 11, color: 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m}</div>
                  </div>
                  <span style={{ padding: '2px 7px', borderRadius: 'var(--r1)', fontSize: 10, fontWeight: 600, color: '#D9730D', background: 'rgba(217,119,6,.1)', border: '1px solid rgba(217,119,6,.25)', whiteSpace: 'nowrap' }}>
                    초대됨
                  </span>
                  <button
                    onClick={() => onRemoveMember(m)}
                    style={{ padding: '2px 8px', borderRadius: 'var(--r1)', border: '1px solid rgba(212,76,71,.3)', background: 'transparent', color: '#f87171', fontSize: 11, cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(212,76,71,.07)'}
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
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (isComposing(e)) return
              if (e.key === 'Enter') { e.preventDefault(); handleAdd(); return }
              if (!suggestions.length) return
              if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => (h + 1) % suggestions.length) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => (h - 1 + suggestions.length) % suggestions.length) }
            }}
            placeholder="이름 또는 이메일로 검색..."
            style={{ flex: 1, background: 'var(--bg3)', border: '1px solid var(--bd2)', borderRadius: 'var(--r2)', padding: '8px 10px', fontSize: 13, color: 'var(--t1)', outline: 'none' }}
          />
          <button
            onClick={handleAdd}
            style={{ padding: '8px 14px', borderRadius: 'var(--r2)', border: 'none', background: 'var(--ac)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            초대
          </button>
        </div>

        {suggestions.length > 0 && (
          <div style={{ marginTop: 8, border: '1px solid var(--bd)', borderRadius: 'var(--r2)', overflow: 'hidden', maxHeight: 200, overflowY: 'auto' }}>
            {suggestions.map((p, i) => (
              <div
                key={p.email}
                onClick={() => invite(p.email)}
                onMouseEnter={() => setHighlight(i)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', cursor: 'pointer', background: i === highlight ? 'var(--bg3)' : 'transparent' }}
              >
                <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'linear-gradient(135deg,#667eea,#764ba2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0, overflow: 'hidden' }}>
                  {p.photoURL
                    ? <img src={p.photoURL} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : (p.name?.[0]?.toUpperCase() ?? p.email[0]?.toUpperCase())}
                </div>
                <span style={{ fontSize: 13, color: 'var(--t1)', flexShrink: 0 }}>{p.name || p.email.split('@')[0]}</span>
                <span style={{ fontSize: 11, color: 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.email}</span>
              </div>
            ))}
          </div>
        )}

        {query.trim() && suggestions.length === 0 && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--t3)' }}>
            {query.includes('@')
              ? 'Enter를 누르면 이 주소로 초대합니다.'
              : '같이 일하는 사람 중에는 없습니다. 이메일 주소 전체를 입력하면 초대할 수 있습니다.'}
          </div>
        )}
      </div>
    </div>
  )
}
