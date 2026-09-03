import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useTouch } from '../../hooks/useTouch'
import { isComposing, authorizedEmails, isAssignedTo, copyText } from '../../lib/utils'
import { askConfirm } from '../shared/Confirm'
import { useUiStore } from '../../store/uiStore'
import { useTaskStore } from '../../store/taskStore'
import { useAuthStore } from '../../store/authStore'
import { useProjectStore } from '../../store/projectStore'
import { useVisibleProjects } from '../../hooks/useVisibleProjects'
import { useMilestoneStore } from '../../store/milestoneStore'
import { usePresenceStore } from '../../store/presenceStore'
import { useUserProfileStore } from '../../store/userProfileStore'
import { usePeople } from '../../hooks/usePeople'
import { mergePeople, personLabel, searchPeople } from '../../lib/people'
import { useMobile } from '../../hooks/useMobile'
import { haptic } from '../../lib/haptics'
import { Icon, type IconName } from '../shared/Icon'
import { gradForKey } from '../shared/Avatar'
import { GetDesktopApp } from '../shared/GetDesktopApp'
import { Tip, CMD } from '../shared/Tip'
import { WidthHandle } from '../shared/WidthHandle'
import { SettingsModal } from '../modals/SettingsModal'
import { useNoticeInbox, NoticeList } from './Notices'
import { useOrgStore, pendingJoinCount } from '../../store/orgStore'
import { usePrefsStore } from '../../store/prefsStore'
import { useTodayCount } from '../views/today/count'
import { useNoticeToast } from './NoticeToast'
import { buildInviteToken } from '../../lib/paths'
import { getCatColor } from '../../types'
import type { Project } from '../../types'
import { useShallow } from 'zustand/react/shallow'

/** The topbar's row height. The two headers' bottom rules are one line. */
const HEADER_H = 52

/**
 * ── 사이드바 폭 ──────────────────────────────────────────────────────────────
 *
 * 이 기기의 것입니다 — 순서와 같은 이유로요. 27인치에서 넓게 쓰는 사람과
 * 13인치에서 좁게 쓰는 사람이 서로의 화면을 밀어낼 이유가 없습니다.
 *
 * 하한은 프로젝트 이름이 두어 글자로 잘리기 시작하는 지점, 상한은 사이드바가
 * 본문보다 중요해 보이기 시작하는 지점입니다.
 */
const WIDTH_KEY = 'sidebar_width'
const WIDTH_DEFAULT = 240
const WIDTH_MIN = 190
const WIDTH_MAX = 420

function saveWidth(next: number) {
  try { localStorage.setItem(WIDTH_KEY, String(Math.round(next))) } catch { /* private mode */ }
}

function loadWidth(): number {
  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY))
    if (saved >= WIDTH_MIN && saved <= WIDTH_MAX) return saved
  } catch { /* private mode */ }
  return WIDTH_DEFAULT
}

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
  const { projectId, setProject, myTasksOnly, setMyTasksOnly, personalOnly, setPersonalOnly, sidebarOpen, setSidebarOpen, screen, setScreen, openCalendar, openCommandPalette } = useUiStore(useShallow(s => ({ projectId: s.projectId, setProject: s.setProject, myTasksOnly: s.myTasksOnly, setMyTasksOnly: s.setMyTasksOnly, personalOnly: s.personalOnly, setPersonalOnly: s.setPersonalOnly, sidebarOpen: s.sidebarOpen, setSidebarOpen: s.setSidebarOpen, screen: s.screen, setScreen: s.setScreen, openCalendar: s.openCalendar, openCommandPalette: s.openCommandPalette })))
  const isMobile = useMobile()
  const tasks = useTaskStore(s => s.tasks)
  const { projects, addProject, updateProject, deleteProject, addMember, removeMember } = useProjectStore(useShallow(s => ({ projects: s.projects, addProject: s.addProject, updateProject: s.updateProject, deleteProject: s.deleteProject, addMember: s.addMember, removeMember: s.removeMember })))
  const deleteMilestonesForProject = useMilestoneStore(s => s.deleteMilestonesForProject)
  const { displayName, email, photoURL, signOutUser } = useAuthStore(useShallow(s => ({ displayName: s.displayName, email: s.email, photoURL: s.photoURL, signOutUser: s.signOutUser })))
  const { orgName, myOrgs, isGuest } = useOrgStore(useShallow(s => ({ orgName: s.name, myOrgs: s.myOrgs, isGuest: s.isGuest })))
  const setActiveOrg = usePrefsStore(s => s.setActiveOrg)

  // Project state
  const [addingProject, setAddingProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const projectNameRef = useRef<HTMLInputElement>(null)
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [editProjectName, setEditProjectName] = useState('')
  const projectEditRef = useRef<HTMLInputElement>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string; name: string; archived: boolean; type: 'project' } | null>(null)
  const [copiedInvite, setCopiedInvite] = useState<'yes' | 'no' | null>(null)
  const [archivedExpanded, setArchivedExpanded] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null)
  const [memberModal, setMemberModal] = useState<{ id: string; name: string } | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** 설정을 어느 장으로 열 것인가. 프로필 메뉴가 자리를 지정합니다. */
  const [settingsPage, setSettingsPage] = useState<'general' | 'org-new'>('general')
  /**
   * 사이드바가 무엇을 보여주고 있는가.
   *
   * 받은 알림을 nav 줄로 넣었더니 내 할 일·전체 업무·프로젝트와 같은 열에
   * 앉아서 '또 하나의 업무 뷰'로 읽혔습니다. 성격이 다른 것을 같은 모양으로
   * 그리면 같은 것이 됩니다.
   *
   * 그래서 세로 목록이 아니라 가로 토글입니다 — 모양부터 다르고, 누르면 이
   * 열이 통째로 바뀝니다. 노션이 홈과 인박스를 가르는 방식과 같습니다.
   */
  const pane = useUiStore(s => s.sidebarPane)
  const setPane = useUiStore(s => s.setSidebarPane)
  const [width, setWidth] = useState(loadWidth)
  const { unread, external } = useNoticeInbox()
  const orgId = useOrgStore(s => s.orgId)
  const orgAdmins = useOrgStore(s => s.admins)
  const joinRequests = useOrgStore(s => s.joinRequests)
  const pendingJoins = useMemo(
    () => pendingJoinCount(joinRequests, new Set(projects.map(p => p.id))),
    [joinRequests, projects],
  )
  const todayOpen = useTodayCount()
  const profileRef = useRef<HTMLDivElement>(null)

  // The banner hides itself while the list is on screen — reading a notice and
  // being handed the same notice again is noise.
  const inboxVisible = pane === 'inbox' && (!isMobile || sidebarOpen)
  useEffect(() => {
    const store = useNoticeToast.getState()
    store.setPanelOpen(inboxVisible)
    // 설정의 '테스트'가 배너를 띄우려면 이 열을 먼저 비켜세울 수 있어야 합니다.
    store.registerClose(() => setPane('home'))
    return () => {
      useNoticeToast.getState().setPanelOpen(false)
      useNoticeToast.getState().registerClose(null)
    }
  }, [inboxVisible])

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
    () => activeTasks.filter(t => t.status !== '완료' && isAssignedTo(t.assignee, email)).length,
    [activeTasks, email],
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

  /**
   * 초대 링크.
   *
   * 줄 위 아이콘이었습니다. 프로젝트가 수십 개 놓이는 목록에서는 마우스가
   * 지나갈 때마다 줄 끝이 바뀌어서, 목록이 가만있지를 않았습니다. 자주 쓰는
   * 것도 아닙니다 — 우클릭 메뉴가 제자리입니다.
   */
  const inviteLinkItem = (id: string) => {
    const project = projects.find(p => p.id === id)
    const code = project?.inviteCode
    if (!code) return null
    return (
      <ContextMenuItem icon="link" onClick={() => {
        // 링크에 프로젝트와 회사를 같이 싣습니다. 받는 사람은 아직 프로젝트를
        // 못 읽는데 소속이 그 안에 적혀 있어서, 링크가 말해 주지 않으면 조직
        // 명단에 자기 자리를 앉힐 수가 없습니다. docs/tenants.md 3.5단계.
        const link = `${window.location.origin}${window.location.pathname}?invite=${buildInviteToken(id, code, project.orgId)}`
        void copyText(link).then(ok => {
          // 눌린 티는 내야 하는데 토스트가 없어서, 메뉴가 잠깐 더 서 있다가
          // 스스로 닫힙니다. 바로 닫으면 복사됐는지를 알 수가 없습니다.
          setCopiedInvite(ok ? 'yes' : 'no')
          setTimeout(() => { setCopiedInvite(null); setContextMenu(null) }, 900)
        })
      }}>
        {copiedInvite === 'yes' ? '복사됨!' : copiedInvite === 'no' ? '복사 실패' : '초대 링크 복사'}
      </ContextMenuItem>
    )
  }

  const isProjectCreator = (id: string): boolean => {
    const p = projects.find(pj => pj.id === id)
    if (!p || !email) return false
    if (p.creatorEmail) return p.creatorEmail.toLowerCase() === email.toLowerCase()
    return p.memberEmails?.[0]?.toLowerCase() === email.toLowerCase()
  }

  /**
   * ── 지울 수 있는 사람 ──────────────────────────────────────────────────────
   *
   * 업무 하나를 지우면 휴지통으로 가지만 **프로젝트는 통째로 사라집니다.**
   * 그런데 멤버면 누구나 지울 수 있었습니다 — 초대 링크로 어제 들어온
   * 사람도요.
   *
   * 만든 사람, 그리고 그 프로젝트가 속한 워크스페이스의 관리자입니다.
   * '그 프로젝트가 속한'이 중요합니다 — 내가 다른 곳의 관리자인 것은
   * 여기서 아무 말도 안 합니다.
   *
   * 막는 것은 규칙입니다. 여기서는 눌러 봤자 안 되는 것을 안 보여 줄 뿐이고,
   * 그래서 둘이 같은 말을 해야 합니다.
   */
  const canDeleteProject = (id: string): boolean => {
    if (isProjectCreator(id)) return true
    const p = projects.find(pj => pj.id === id)
    if (!p?.orgId || !email) return false
    if (p.orgId !== orgId) return false
    return orgAdmins.some(a => a.toLowerCase() === email.toLowerCase())
  }

  const deleteItem = (id: string, name: string) => canDeleteProject(id) ? (
    <>
      {/* 되돌릴 수 없는 것 앞에는 한 칸 더 둡니다. 붙어 있으면 손이
          미끄러지는 거리가 그만큼 짧아집니다. */}
      <div style={{ height: 1, background: 'var(--bd)', margin: '5px 6px' }} />
      <ContextMenuItem icon="trash" danger onClick={() => { setDeleteConfirm({ id, name }); setContextMenu(null) }}>
        삭제
      </ContextMenuItem>
    </>
  ) : null

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

  const userName = displayName ?? null
  const presences = usePresenceStore(s => s.presences)

  /**
   * 사이드바에 서는 것은 **지금 서 있는 워크스페이스의 것만**입니다.
   *
   * 전환 단추를 만들어 놓고 목록을 안 갈랐더니, 워크스페이스를 바꿔도
   * 프로젝트가 그대로여서 전환이 이름표만 바꾸는 단추로 보였습니다.
   * 무엇이 숨고 무엇이 남는지는 useVisibleProjects에 적어 두었습니다.
   */
  const accessibleProjects = useVisibleProjects()
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
  /**
   * 접속 목록은 규칙 때문에 오래 비어 있었고, 열리자 옛 항목들이 처음
   * 화면에 닿았습니다 — `who`가 없는 것도 있었고, 그게 화면을 통째로
   * 멈췄습니다. 키가 곧 uid이니 빠진 칸은 키로 채우고, 모양이 아닌 것은
   * 버립니다. 남의 데이터 한 줄이 내 화면을 멈추면 안 됩니다.
   */
  const onlineUsers = Object.entries(presences)
    .filter(([, p]) => p && typeof p === 'object' && p.online)
    .map(([uid, p]) => ({ ...p, who: typeof p.who === 'string' && p.who ? p.who : uid, name: typeof p.name === 'string' ? p.name : '' }))

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
        width: isMobile ? WIDTH_DEFAULT : width, background: 'var(--sb-bg)', display: 'flex', flexDirection: 'column', flexShrink: 0,
        position: 'relative',
        borderRight: '1px solid var(--sb-bd)',
        ...(isMobile ? {
          position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 1000,
          transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform .25s cubic-bezier(.4,0,.2,1)',
          boxShadow: sidebarOpen ? '4px 0 24px rgba(0,0,0,.5)' : 'none',
        } : {}),
      }}>

        {/*
          Workspace header.

          Built exactly like the topbar — an outer band that carries the safe-area
          inset and the rule, and an inner row of a fixed HEADER_H — because the
          two rules meet at the sidebar's edge and have to be the same line. This
          one used to be sized by its padding, which put it about six pixels below
          the other: close enough that nothing looked broken and everything looked
          slightly wrong.
        */}
        <div
          ref={profileRef}
          style={{
            paddingTop: isMobile ? 'env(safe-area-inset-top, 0px)' : 0,
            borderBottom: '1px solid var(--sb-bd)', position: 'relative', flexShrink: 0,
          }}
        >
        <div style={{ height: HEADER_H, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 8, boxSizing: 'border-box' }}>
          {/* Profile avatar — clickable */}
          <div
            onClick={() => setProfileOpen(o => !o)}
            title="계정 정보"
            style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--ac)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0, cursor: 'pointer', overflow: 'hidden', outline: profileOpen ? '2px solid var(--ac)' : 'none', outlineOffset: 1 }}
          >
            {photoURL
              ? <img src={photoURL} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : (userName?.[0]?.toUpperCase() ?? 'W')
            }
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {/*
              지금 보고 있는 워크스페이스 이름. 여기 'bpp-ops'가 박혀 있었는데,
              두 곳에 걸친 사람에게는 그게 어디를 보고 있는지 아무 말도 안
              해 줍니다. 아직 워크스페이스가 없는 사람에게는 예전 이름 그대로.
            */}
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sb-t1)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {orgName || 'bpp-ops'}
            </div>
            {userName && (
              <div style={{ fontSize: 12, color: 'var(--sb-t3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userName}</div>
            )}
          </div>
          {/* 설정 rather than 로그아웃: signing out already lives one click away
              in the profile popover, and putting the rarer, more destructive of
              the two on the always-visible button was backwards. */}
          <button
            onClick={() => { haptic('tap'); setProfileOpen(false); setSettingsPage('general'); setSettingsOpen(true) }}
            title={pendingJoins ? `설정 · 참여 요청 ${pendingJoins}건` : '설정'}
            style={{ position: 'relative', width: 24, height: 24, borderRadius: 'var(--r1)', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--sb-t3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background .1s, color .1s' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--sb-hover)'; e.currentTarget.style.color = 'var(--sb-t1)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--sb-t3)' }}
          >
            <Icon name="settings" size={15} />
            {/*
              내 프로젝트로 온 참여 요청.

              요청은 설정 창 안에만 있어서, 아무도 설정을 안 열면 며칠이고
              방치됩니다. 원래는 받은 알림에 넣는 게 맞는데 요청하는 사람은
              그 프로젝트의 멤버 목록을 읽을 수 없습니다 — 아직 멤버가 아니니까
              당연하고, 그래서 누구의 알림함에 써야 할지 모릅니다. 서버가
              생기면 서버가 남기는 게 답이고, 그때까지는 이 점이 그 자리입니다.

              숫자를 안 씁니다. 24px 버튼에 숫자를 얹으면 기어가 안 보이고,
              몇 건인지는 눌러서 알면 됩니다 — 이 점이 해야 하는 말은 '볼 게
              있다' 하나입니다.
            */}
            {pendingJoins > 0 && (
              <span aria-label={`참여 요청 ${pendingJoins}건`} style={{
                position: 'absolute', top: 1, right: 1,
                width: 7, height: 7, borderRadius: '50%',
                background: 'var(--danger)',
                boxShadow: '0 0 0 1.5px var(--sb-bg)',
              }} />
            )}
          </button>

        </div>

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
                <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--ac)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#fff', flexShrink: 0, overflow: 'hidden' }}>
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
              {/*
                ── 워크스페이스 ────────────────────────────────────────────────
                **한 곳뿐이어도 그립니다.** 전에는 안 그렸습니다 — 고를 것이
                없는 목록은 고르는 법을 안 가르치니까요. 그 말은 지금도 맞는데,
                이 자리가 이제 고르는 곳만이 아니라 **워크스페이스가 사는
                곳**입니다: 새로 만드는 것도 여기서 합니다.
                (전에는 설정 > 워크스페이스 맨 아래에 접혀 있었고, 두 번째
                워크스페이스를 만들려면 그걸 찾아내야 했습니다.)

                줄마다 이름 앞에 색 네모가 섭니다. 이름은 짧고 서로 닮을 수
                있어서, 훑을 때 먼저 눈에 걸리는 건 글자가 아니라 색입니다.
              */}
              <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 8, marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: 'var(--t3)', padding: '0 8px 5px', letterSpacing: .3 }}>워크스페이스</div>
                {myOrgs.map(o => {
                  const on = o.id === orgId
                  const tint = getCatColor(o.name).text
                  return (
                    <button
                      key={o.id}
                      onClick={() => { if (email && !on) setActiveOrg(email, o.id); setProfileOpen(false) }}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 'var(--r2)', border: 'none', background: 'transparent', fontSize: 12, color: on ? 'var(--t1)' : 'var(--t2)', cursor: 'pointer', fontFamily: 'var(--font)', textAlign: 'left' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg2)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                    >
                      <span style={{
                        width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: tint, color: '#fff', fontSize: 10, fontWeight: 700,
                      }}>{o.name.trim()[0]?.toUpperCase() ?? 'W'}</span>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: on ? 600 : 400 }}>{o.name}</span>
                      {/* 게스트로 들어가 있는 곳이라고 적습니다. 안 적으면 내
                          회사와 남의 회사가 같은 줄로 보이고, 거기 서서
                          회의실을 찾다가 없는 이유를 못 찾습니다. */}
                      {o.guest && <span style={{ flexShrink: 0, fontSize: 10, color: 'var(--t3)' }}>게스트</span>}
                      {on && <span style={{ flexShrink: 0, color: 'var(--ac)', fontSize: 11 }}>✓</span>}
                    </button>
                  )
                })}
                <button
                  onClick={() => { setProfileOpen(false); setSettingsPage('org-new'); setSettingsOpen(true) }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 'var(--r2)', border: 'none', background: 'transparent', fontSize: 12, color: 'var(--ac)', cursor: 'pointer', fontFamily: 'var(--font)', textAlign: 'left' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg2)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{ width: 20, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon name="plus" size={13} />
                  </span>
                  새 워크스페이스
                </button>
              </div>
              <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 8 }}>
                <button
                  onClick={() => { setProfileOpen(false); setSettingsPage('general'); setSettingsOpen(true) }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 'var(--r2)', border: 'none', background: 'transparent', fontSize: 12, color: 'var(--t2)', cursor: 'pointer', fontFamily: 'var(--font)' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg2)'; e.currentTarget.style.color = 'var(--t1)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t2)' }}
                >
                  <Icon name="settings" size={14} /> 설정
                </button>
                {/* 브라우저로 보고 있을 때만 나타납니다 — 앱 안에서는 이
                    컴포넌트가 스스로 아무것도 그리지 않습니다. */}
                <GetDesktopApp variant="menu" onPick={() => setProfileOpen(false)} />
                <button
                  onClick={() => { setProfileOpen(false); signOutUser() }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 'var(--r2)', border: 'none', background: 'transparent', fontSize: 12, color: 'var(--t2)', cursor: 'pointer', fontFamily: 'var(--font)' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg2)'; e.currentTarget.style.color = 'var(--t1)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t2)' }}
                >
                  <Icon name="exit" size={14} /> 로그아웃
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 홈 · 받은 알림 · 검색 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 10px', minWidth: 0 }}>
          <PaneTab icon="home" label="홈" active={pane === 'home'} onClick={() => setPane('home')} />
          <PaneTab icon="inbox" label="받은 알림" tour="inbox" active={pane === 'inbox'} count={unread + external} onClick={() => { setPane('inbox'); haptic('tap') }} />
          {/*
            여기 있던 검색 상자를 돋보기로 바꿨습니다.

            그 상자는 `filters.search`만 건드렸습니다 — 업무 목록에만 걸리는
            값입니다. 그런데 앱을 켜면 서 있는 곳은 '오늘'이라, 대부분의 사람은
            거기서 타이핑하고 아무 일도 안 일어나는 걸 봤습니다. 걸러 줄 목록이
            화면에 없는데 목록 거르개를 놓아 둔 셈입니다.

            ⌘K는 서 있는 곳과 무관하게 업무·프로젝트·데일리 노트 본문까지
            찾습니다. 상자보다 넓고, 무엇보다 어디서 눌러도 답이 나옵니다.
          */}
          <IconAction
            tour="search"
            label="검색"
            keys={isMobile ? undefined : [CMD, 'K']}
            // 폰에서 서랍은 화면을 덮고 있습니다. 검색 창을 그 위에 또 얹으면
            // 판 두 장이 겹쳐서, 닫고 나면 서랍이 아직 열려 있습니다.
            onClick={() => { haptic('tap'); closeSidebar(); openCommandPalette() }}
          />
        </div>

        {pane === 'inbox' && <NoticeList onClose={closeSidebar} />}

        {/* Nav */}
        {pane === 'home' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 6px' }}>

          {/*
            오늘이 먼저입니다.

            내 할 일은 나에게 배정된 것 전부를 세워 놓은 목록 — 재고입니다.
            아침에 필요한 건 재고가 아니라 '오늘 이것들'이라는 결정이고,
            그 결정이 내려지는 곳이 오늘입니다.
          */}
          <NavItem
            active={screen === 'today'}
            onClick={() => { setScreen('today'); closeSidebar() }}
            node={<Icon name="today" size={14} />}
            tour="today"
            count={todayOpen}
            emphasis
            pill
          >
            오늘
          </NavItem>

          {/*
            ── 캘린더 ──────────────────────────────────────────────────────────
            뷰 탭에도 캘린더가 있습니다. 같은 것이 아닙니다.

            거기 캘린더는 *지금 보고 있는 범위*를 달력에 그립니다 — 이 프로젝트의
            마감들. 여기 캘린더는 범위가 없는 **내 일정 전부**입니다. 사람들이
            하루에 몇 번씩 열고 싶은 건 뒤쪽이고, 그걸 보려면 지금까지는 업무
            목록에 들어가 → 범위를 전체로 바꾸고 → 탭을 눌러야 했습니다.

            그래서 오늘 옆에 세웁니다. 이 둘은 '무엇을 보느냐'가 아니라
            '어디로 가느냐'라서, 아래 줄들과는 종류가 다릅니다.
          */}
          <NavItem
            active={screen === 'calendar'}
            onClick={() => { openCalendar(); closeSidebar() }}
            node={<Icon name="calendar" size={14} />}
            tour="calendar"
            emphasis
          >
            캘린더
          </NavItem>

          {/*
            함께 쓰는 것들의 현황. '가는 곳'이라 오늘·캘린더와 같은 층입니다.

            회의실과 장비를 한 줄로 묶습니다. 둘은 같은 질문에 답합니다 —
            '지금 이거 비었나'. 줄을 둘로 나누면 그 질문을 두 군데서
            물어야 합니다.

            굵게 하지 않았습니다. 위의 둘은 매일 아침 여는 곳이고, 여기는
            촬영이 잡혔을 때 여는 곳입니다. 굵은 줄이 셋이면 굵기가 아무
            말도 안 하게 됩니다.
          */}
          {/* 게스트에게는 이 줄이 없습니다. 회의실도 장비도 못 읽으므로
              눌러 봐야 빈 화면이고, 눌러도 안 되는 것을 눌리게 두지 않습니다. */}
          {!isGuest && (
          <NavItem
            active={screen === 'res'}
            onClick={() => { setScreen('res'); closeSidebar() }}
            node={<Icon name="camera" size={14} />}
          >
            회의실 · 장비
          </NavItem>
          )}

          {/*
            여기서 한 번 끊깁니다.

            위의 둘은 *장소*입니다 — 생김새부터 다른 화면으로 갑니다. 아래의
            것들은 전부 같은 업무 화면이고, 다른 건 거기 걸리는 *범위*뿐입니다
            (내 것 / 전부 / 개인 / 이 프로젝트). 프로젝트도 그 범위 중 하나라
            'Projects' 위에 선을 하나 더 긋지는 않습니다 — 이름표가 이미 그
            자리를 말하고 있고, 한 경계에 표시가 둘이면 경계가 둘로 보입니다.
          */}
          <NavRule />

          {/* 둘 다 매일 쓰는 줄이라 둘 다 굵습니다. 다른 건 숫자의 성격입니다 —
              오늘의 숫자는 '지금 남은 것'이라 채워진 알약이고, 여기 숫자는
              재고의 크기라 회색입니다. 채워진 알약이 둘이면 눈이 어디로 갈지
              정하지 못합니다. */}
          <NavItem
            active={screen === 'work' && myTasksOnly}
            /* 토글이 아니라 지정입니다. 뒤집기였을 때, 오늘에 서서 이 줄을
               누르면 myTasksOnly가 이미 true라 false로 뒤집혀 전체 업무로
               갔습니다 — 이름이 '내 할 일'인 줄이 하는 일로는 틀렸습니다.
               끄는 건 아래 '전체 업무'가 합니다. */
            onClick={() => { setPersonalOnly(false); setMyTasksOnly(true); setProject(null); closeSidebar() }}
            count={myOpenCount}
            tour="mine"
            emphasis
            node={<Icon name="checkSquare" size={14} />}
          >
            내 할 일
          </NavItem>

          <NavItem
            active={screen === 'work' && !myTasksOnly && !personalOnly && projectId === null}
            onClick={() => { setPersonalOnly(false); setProject(null); setMyTasksOnly(false); closeSidebar() }}
            node={<Icon name="stack" size={14} />}
          >
            전체 업무
          </NavItem>

          {/*
            ── 개인 ────────────────────────────────────────────────────────────
            프로젝트에 속하지 않은 업무들. `personalTasks/{내 계정}`에 살고
            **아무도 못 봅니다** — 공유될 경로 자체가 없습니다.

            목록에 섞여 있으면 '이건 나만 아는 일'이라는 사실이 화면에서
            사라집니다. 따로 세워 두면 그 줄에 선 것만으로 그 뜻이 됩니다.

            숫자를 붙이지 않습니다. 여기 쌓이는 건 재고가 아니라 메모에 가깝고,
            '개인 업무 12개'는 재촉으로 읽힙니다.
          */}
          <NavItem
            active={screen === 'work' && personalOnly}
            onClick={() => { setPersonalOnly(true); setMyTasksOnly(false); closeSidebar() }}
            node={<Icon name="person" size={14} />}
          >
            개인
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
                          style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', background: 'var(--sb-field)', border: '1px solid var(--sb-bd2)', borderRadius: 'var(--r1)', padding: '2px 6px', fontSize: 14, fontWeight: 500, color: 'var(--sb-t1)', outline: 'none' }}
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
                      active={screen === 'work' && projectId === p.id}
                      dot={p.color}
                      overdue={overdueByProject.get(p.id) ?? 0}
                      daysInfo={daysInfo}
                      projectId={p.id}
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
                /* minWidth: 0 이 없으면 input은 기본 size(약 20글자)만큼을 최소
                   폭으로 우기고, flex는 그 아래로 못 줄입니다 — 사이드바가
                   좁아도 칸 혼자 길어져서 밖으로 잘려 나갑니다. */
                style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', background: 'var(--sb-field)', border: '1px solid var(--sb-bd2)', borderRadius: 'var(--r1)', padding: '3px 7px', fontSize: 14, fontWeight: 500, color: 'var(--sb-t1)', outline: 'none' }}
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
                style={{ padding: '12px 8px 4px', fontSize: 12, fontWeight: 600, color: 'var(--sb-t3)', letterSpacing: '.04em', textTransform: 'uppercase', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, userSelect: 'none' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--sb-t2)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--sb-t3)')}
              >
                <span style={{ fontSize: 8, display: 'inline-block', transform: archivedExpanded ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}>▶</span>
                Archived
                <span style={{ marginLeft: 'auto', fontSize: 11, opacity: .8, letterSpacing: 0 }}>{archivedProjects.length}</span>
              </div>

              {archivedExpanded && archivedProjects.map(p => {
                return (
                  <ProjectItem
                    key={p.id}
                    active={screen === 'work' && projectId === p.id}
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
        )}

        {/* Online users */}
        {onlineUsers.length > 0 && (
          <div style={{ borderTop: '1px solid var(--sb-bd)', padding: '8px 10px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sb-t3)', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 6 }}>
              접속 중
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {onlineUsers.map(p => {
                const avatarGrad = gradForKey(p.who)
                const name = p.name
                return (
                  <div key={p.who} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div style={{ width: 22, height: 22, borderRadius: '50%', background: avatarGrad, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff' }}>
                        {name[0]?.toUpperCase() ?? '?'}
                      </div>
                      <div style={{ position: 'absolute', bottom: 0, right: 0, width: 7, height: 7, borderRadius: '50%', background: '#448361', border: '1.5px solid var(--sb-bg)' }} />
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--sb-t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {name}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

      {/* 앱을 아직 안 받은 사람에게 설정은 들어가 볼 이유가 없는 곳이라,
          늘 보이는 자리에 한 줄 둡니다. 브라우저로 볼 때만 나타납니다. */}
      <GetDesktopApp variant="rail" onPick={closeSidebar} />

      {!isMobile && (
        <WidthHandle
          width={width} min={WIDTH_MIN} max={WIDTH_MAX} defaultWidth={WIDTH_DEFAULT}
          side="right" onChange={setWidth} onCommit={saveWidth}
        />
      )}
      </aside>

      {/*
        Right-click context menu.

        누른 자리에 그대로 놓기만 했더니 목록 아래쪽 프로젝트에서는 메뉴가
        화면 밑으로 잘렸습니다 — 일정 카드에서 고쳤던 그것과 같은 문제입니다.
        아래가 모자라면 위로 열고, 옆으로도 화면 안쪽으로 당깁니다.
        높이는 재지 않습니다: 항목 수로 셈해 두고, 그보다 길어지면 메뉴가
        제 안에서 스크롤합니다. 재서 다시 놓으면 열릴 때 한 번 덜컹거립니다.
      */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            ...menuPlace(contextMenu.x, contextMenu.y, isProjectCreator(contextMenu.id) ? 8 : canDeleteProject(contextMenu.id) ? 5 : 4),
            zIndex: 9999,
            background: 'var(--bg)',
            border: '1px solid var(--bd)',
            borderRadius: 'var(--r3)',
            boxShadow: 'var(--sh-md)',
            minWidth: 168,
            overflowY: 'auto',
            padding: 4,
          }}
          onClick={e => e.stopPropagation()}
        >
          {isProjectCreator(contextMenu.id) ? (
            <>
              <ContextMenuItem icon="pencil" onClick={() => { setEditingProjectId(contextMenu.id); setEditProjectName(contextMenu.name); setContextMenu(null) }}>
                이름 수정
              </ContextMenuItem>
              <ContextMenuItem icon="users" onClick={() => { setMemberModal({ id: contextMenu.id, name: contextMenu.name }); setContextMenu(null) }}>
                멤버 관리
              </ContextMenuItem>
              {inviteLinkItem(contextMenu.id)}
              <ContextMenuItem icon="layers" onClick={() => {
                const project = projects.find(p => p.id === contextMenu.id)
                setGroupFor({ id: contextMenu.id, name: contextMenu.name, group: project?.group ?? '' })
                setContextMenu(null)
              }}>
                그룹 지정
              </ContextMenuItem>
              <ContextMenuItem icon={contextMenu.archived ? 'unarchive' : 'archive'} onClick={() => handleArchiveProject(contextMenu.id, !contextMenu.archived)}>
                {contextMenu.archived ? '아카이브 해제' : '아카이브'}
              </ContextMenuItem>
              <div style={{ height: 1, background: 'var(--bd)', margin: '4px -4px' }} />
              {deleteItem(contextMenu.id, contextMenu.name)}
            </>
          ) : (
            <>
              {inviteLinkItem(contextMenu.id)}
              <ContextMenuItem icon="exit" danger onClick={() => handleLeaveProject(contextMenu.id)}>
                나가기
              </ContextMenuItem>
              {deleteItem(contextMenu.id, contextMenu.name)}
            </>
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

      {settingsOpen && <SettingsModal start={settingsPage} onClose={() => setSettingsOpen(false)} />}

      {/* Member management modal */}
      {memberModal && (() => {
        const proj = projects.find(p => p.id === memberModal.id)
        if (!proj) return null
        return (
          <MemberManageModal
            project={proj}
            currentEmail={email ?? undefined}
            /**
             * 고를 수 있는 사람 — **이 프로젝트와 같은 워크스페이스**에서만.
             *
             * 원래는 내가 멤버인 프로젝트 전부에서 모았습니다. 유출은
             * 아닙니다(내가 이미 명단을 볼 수 있는 사람들입니다). 그런데
             * 개인 계정으로 회사 프로젝트에 게스트로 들어가 있으면, 자기
             * 워크스페이스에서 사람을 부르는데 회사 동료들이 목록에 섰습니다.
             * 한 번 잘못 누르면 남을 엉뚱한 데로 부릅니다.
             *
             * **'지금 서 있는 곳'으로는 못 거릅니다.** 게스트로 들어간
             * 남의 회사 프로젝트는 어느 워크스페이스에서든 보이도록 만들어
             * 뒀습니다(외부 협업자가 자기 일을 잃지 않게). 그래서 기준이
             * 서 있는 곳이 아니라 **부르려는 그 프로젝트의 소속**입니다.
             *
             * 소속 없는 프로젝트는 어디에도 걸치므로 늘 같이 셉니다.
             * 목록에 없는 사람도 주소를 다 적으면 부를 수 있습니다 — 여기서
             * 줄이는 것은 실수할 거리지 할 수 있는 일이 아닙니다.
             */
            suggestable={authorizedEmails(
              projects.filter(p => !p.orgId || p.orgId === proj.orgId),
              email,
            )}
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

/**
 * ── 오른쪽 클릭 메뉴가 설 자리 ───────────────────────────────────────────────
 *
 * **위로 뒤집지 않습니다.** 처음엔 아래가 모자라면 위로 열게 했는데, 그러면
 * 메뉴의 *아래쪽*이 포인터에 붙습니다 — 맨 아래 줄이 '삭제'인 메뉴에서
 * 그건 포인터 바로 밑에 삭제를 놓는 일입니다. 잘리지 않게 하려다 더 나쁜
 * 것을 만든 셈입니다.
 *
 * 대신 **화면 안으로 밀어 넣습니다.** 그리고 밀어 넣느라 포인터가 메뉴 안에
 * 들어가게 되면, 메뉴를 오른쪽으로 조금 비켜 세워 **포인터가 어떤 줄 위에도
 * 놓이지 않게** 합니다. 안 움직이고 그대로 누르면 아무 줄도 안 눌립니다 —
 * 메뉴가 닫힐 뿐입니다. 무언가를 고르려면 손을 움직여야 합니다.
 *
 * 화면보다 긴 메뉴는 제 안에서 스크롤합니다.
 *
 * 높이는 재지 않고 항목 수로 셈합니다 — 재려면 한 번 그린 다음이라야 하고,
 * 그리고 나서 옮기면 그 한 프레임이 눈에 보입니다(일정 카드에서 겪은 그것).
 */
const MENU_ROW_H = 32
const MENU_W = 176

function menuPlace(x: number, y: number, items: number): React.CSSProperties {
  const M = 8
  const guess = items * MENU_ROW_H + 16
  const maxH = window.innerHeight - M * 2
  const height = Math.min(guess, maxH)

  const top = Math.max(M, Math.min(y, window.innerHeight - height - M))
  // 밀어 넣은 만큼 포인터가 메뉴 안으로 들어왔으면 옆으로 비켜세웁니다.
  const nudged = top < y
  const left = Math.min(nudged ? x + 10 : x, window.innerWidth - MENU_W - M)

  return { left, top, maxHeight: maxH }
}

/** 장소와 범위 사이의 한 줄. 여백만으로는 '끊겼다'가 아니라 '떨어졌다'로 읽힙니다. */
function NavRule() {
  return <div style={{ height: 1, background: 'var(--sb-bd)', margin: '7px 8px 6px' }} />
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: '12px 8px 4px', fontSize: 12, fontWeight: 600, color: 'var(--sb-t3)', letterSpacing: '.04em', textTransform: 'uppercase' }}>
      {children}
    </div>
  )
}

function NavItem({ children, active, onClick, count, emphasis, pill, node, tour }: {
  children: React.ReactNode; active: boolean; onClick: () => void
  /** 소개 투어가 이 줄을 찾을 때 쓰는 이름. Welcome 참고. */
  tour?: string
  /** Omitted where a number would be decoration rather than information. */
  count?: number
  /** Bolder than the rest — a row somebody uses every day, not now and then. */
  emphasis?: boolean
  /** Draws the count as a filled pill. One row gets this: the one you start from. */
  pill?: boolean
  /**
   * 줄 앞의 그림.
   *
   * 전에는 글자(☑ ◈ ◦)로도 받았습니다. 글자는 굵기와 크기를 글꼴이 정해서
   * 옆에 그려 놓은 아이콘과 안 맞았고, 한 열에 선 다섯 줄 중 셋만 다른
   * 손으로 그린 것처럼 보였습니다. 이제 전부 그린 것입니다.
   */
  node?: React.ReactNode
}) {
  return (
    <div
      onClick={onClick}
      data-tour={tour}
      style={{
        display: 'flex', alignItems: 'center', gap: 7,
        minHeight: 28, boxSizing: 'border-box',
        padding: '4px 8px', borderRadius: 'var(--r2)', cursor: 'pointer',
        // 사이드바의 기본 굵기는 medium입니다. 얇은 회색 글씨는 '읽을 것'이
        // 아니라 '배경'으로 읽혀서, 매일 누르는 줄들이 화면에서 뒤로 물러나
        // 있었습니다. 굵게 하는 건 지금 서 있는 줄과 매일 쓰는 줄뿐입니다 —
        // 전부 굵으면 아무것도 안 굵은 것과 같습니다.
        fontSize: 14, fontWeight: active || emphasis ? 600 : 500, margin: '1px 0',
        color: active || emphasis ? 'var(--sb-t1)' : 'var(--sb-t2)',
        background: active ? 'var(--sb-active)' : 'transparent',
        transition: 'background .1s, color .1s',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--sb-hover)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
    >
      {node && (
        <span style={{
          width: 16, display: 'flex', justifyContent: 'center', flexShrink: 0,
          // 매일 누르는 줄은 조금 더 또렷합니다 — 글자 굵기가 하는 말과 같은 말.
          opacity: active || emphasis ? .85 : .6,
        }}>{node}</span>
      )}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
      {count !== undefined && count > 0 && (
        pill ? (
          <span title="아직 안 끝난 오늘 할 일" style={{
            marginLeft: 'auto', flexShrink: 0,
            minWidth: 18, padding: '0 6px', height: 17,
            borderRadius: 999, background: 'var(--ac)', color: '#fff',
            fontSize: 11, fontWeight: 600,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>{count}</span>
        ) : (
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--sb-t3)', marginLeft: 'auto', flexShrink: 0 }}>{count}</span>
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
            <button onClick={() => onSave('')} style={{ marginRight: 'auto', padding: '6px 12px', fontSize: 13, borderRadius: 'var(--r1)', border: '1px solid var(--bd)', background: 'transparent', color: 'var(--danger)', cursor: 'pointer', fontFamily: 'var(--font)' }}>
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
        display: 'flex', alignItems: 'center', gap: 5, minHeight: 28, boxSizing: 'border-box',
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
          style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', background: 'var(--sb-field)', border: '1px solid var(--sb-bd2)', borderRadius: 'var(--r1)', padding: '1px 5px', fontSize: 12, fontWeight: 600, color: 'var(--sb-t1)', outline: 'none' }}
        />
      ) : (
        <span style={{
          flex: 1, fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase',
          color: 'var(--sb-t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {name}
        </span>
      )}
      {/*
        갯수와 ✎가 **같은 크기의 칸**을 씁니다.

        예전에는 둘을 그냥 바꿔 놨는데, 갯수는 10px 글자(12px 높이)고 ✎는
        18px 상자라 마우스를 올릴 때마다 줄이 6px 자랐습니다. 그룹을 지나가는
        동안 목록이 위아래로 덜컹거리던 게 그것입니다. 바뀌는 것은 안에 든
        것이지 줄의 크기가 아니어야 합니다.
      */}
      {!editing && (
        <span style={{
          width: 18, height: 18, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {hovered
            ? <ActionIcon onClick={e => { e.stopPropagation(); setDraft(name); setEditing(true) }} title="그룹 이름 수정">✎</ActionIcon>
            : <span style={{ fontSize: 11, color: 'var(--sb-t3)', opacity: .7 }}>{count}</span>}
        </span>
      )}
    </div>
  )
}

function ProjectItem({
  children, active, dot, overdue, daysInfo, projectId, dimmed, indented,
  dragging, dropAt, onDragStart, onDragEnd, onDragOver, onDrop, onClick, onContextMenu,
}: {
  children: React.ReactNode; active: boolean; dot: string
  /** Tasks past their due date. Nothing is drawn at zero. */
  overdue: number
  daysInfo: { days: number; overdue: boolean } | null
  projectId: string
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
  const touch = useTouch()

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
        minHeight: 28, boxSizing: 'border-box',
        fontSize: 14, fontWeight: active ? 600 : 500, margin: '1px 0',
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
      {(hovered || touch) && onDragStart ? (
        <span
          title="드래그해서 순서 변경 · 그룹 헤더에 놓으면 그룹 이동"
          style={{ width: 8, flexShrink: 0, display: 'flex', justifyContent: 'center', fontSize: 10, lineHeight: 1, color: 'var(--sb-t3)', cursor: 'grab' }}
        >⠿</span>
      ) : (
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0, opacity: dimmed ? .5 : 1 }} />
      )}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
      {/* 오른쪽 끝은 마감 하나만 씁니다. 프로젝트가 수십 개 놓이는 목록에서
          줄마다 표시가 붙으면 정작 급한 것이 안 보입니다. 공개 여부와 초대
          링크는 우클릭 메뉴에 있습니다. */}
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
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--sb-active)' }}
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
      style={{ display: 'flex', alignItems: 'center', gap: 7, minHeight: 28, boxSizing: 'border-box', padding: '5px 8px 5px 14px', borderRadius: 'var(--r2)', cursor: 'pointer', fontSize: 14, fontWeight: 500, color: 'var(--sb-t3)', margin: '1px 0', transition: 'background .1s' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--sb-hover)'; (e.currentTarget.style.color = 'var(--sb-t2)') }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; (e.currentTarget.style.color = 'var(--sb-t3)') }}
    >
      <span style={{ fontSize: 15, lineHeight: 1, opacity: .7 }}>+</span>
      {children}
    </div>
  )
}

/**
 * One row of the project menu.
 *
 * The icon is drawn rather than typed, and it takes its colour from the row, so
 * the red item goes red whole instead of a grey glyph sitting next to red text.
 */
function ContextMenuItem({ children, onClick, danger, icon }: {
  children: React.ReactNode; onClick: () => void; danger?: boolean; icon?: IconName
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 9,
        padding: '6px 9px', borderRadius: 'var(--r1)',
        fontSize: 13,
        color: danger ? 'var(--danger)' : 'var(--t1)',
        background: hovered ? (danger ? 'var(--danger-l)' : 'var(--bg3)') : 'transparent',
        cursor: 'pointer',
        transition: 'background .06s',
        whiteSpace: 'nowrap',
      }}
    >
      {icon && (
        <span style={{ display: 'flex', opacity: danger ? 1 : .65 }}><Icon name={icon} size={15} /></span>
      )}
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
              background: typed === name ? 'var(--danger)' : 'rgba(212,76,71,.3)',
              color: typed === name ? 'var(--sb-t1)' : 'var(--sb-t3)',
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
  /**
   * 이 프로젝트가 속한 회사의 이름 명단. 같은 프로젝트에 없어도 같은 회사
   * 사람이면 이름만 쳐도 섭니다 — 그게 이 창이 있는 이유입니다.
   */
  const { people: company } = usePeople(project.orgId)

  const members = project.memberEmails ?? []
  const pending = project.pendingEmails ?? []

  // Suggestions are drawn from two lists: people already sharing a project with
  // the inviter, and the company directory of this project's workspace. Not
  // from profiles at large — those are keyed by uid and cover the entire user
  // base, so the restriction is not cosmetic.
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const taken = [...members, ...pending]
    const shared = Object.values(profiles)
      .filter(p => p?.email && suggestable.has(p.email.toLowerCase()))
      .map(p => ({ email: p.email, name: p.name, nickname: p.nickname }))
    return searchPeople(mergePeople(shared, company), q, taken).slice(0, 6)
  }, [profiles, company, query, suggestable, members.join(','), pending.join(',')])

  useEffect(() => { setHighlight(0) }, [query])

  // 사진은 프로필에만 있습니다. 명단으로만 아는 사람은 첫 글자로.
  const photoOf = (email: string) => Object.values(profiles).find(p => p.email?.toLowerCase() === email)?.photoURL ?? null

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
        style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 'var(--r3)', padding: '24px', width: 'min(420px, calc(100vw - 32px))', boxShadow: '0 8px 40px rgba(0,0,0,.45)' }}
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
                  {photoOf(p.email)
                    ? <img src={photoOf(p.email)!} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : (p.name?.[0]?.toUpperCase() ?? p.email[0]?.toUpperCase())}
                </div>
                <span style={{ fontSize: 13, color: 'var(--t1)', flexShrink: 0 }}>{personLabel(p)}</span>
                <span style={{ fontSize: 11, color: 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.email}</span>
              </div>
            ))}
          </div>
        )}

        {query.trim() && suggestions.length === 0 && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--t3)' }}>
            {query.includes('@')
              ? 'Enter를 누르면 이 주소로 초대합니다.'
              : '같은 워크스페이스 사람 중에는 없습니다. 이메일 주소 전체를 입력하면 초대할 수 있습니다.'}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * ── 홈 · 받은 알림 ───────────────────────────────────────────────────────────
 *
 * 노션이 하는 대로: **켜져 있는 쪽만 이름을 답니다.** 꺼진 쪽은 아이콘 하나로
 * 줄어듭니다. 240px 열에서 두 개의 이름표를 나란히 두면 그것만으로 한 줄이
 * 차고, 어느 쪽이 켜져 있는지는 색으로만 구분해야 합니다 — 이름의 유무가
 * 색보다 훨씬 빨리 읽힙니다.
 *
 * 안 읽은 수는 아이콘 어깨에 붙는 빨간 점입니다. 옆의 '내 할 일' 숫자와
 * 색으로 갈립니다: 파란 것은 내가 할 일의 양이고, 빨간 것은 나를 부르는
 * 신호입니다.
 */
/**
 * 홈·받은 알림 옆에 서지만 '열'이 아니라 '동작'입니다.
 *
 * 그래서 켜진 상태가 없습니다 — 눌러도 이 자리가 바뀌지 않고 창이 하나 뜹니다.
 * 안 켜진 PaneTab과 같은 크기·모양이라 줄은 고르게 보이고, 오른쪽 끝에 혼자
 * 떨어져 있어서 왼쪽 둘과 성격이 다르다는 게 자리로 읽힙니다.
 */
function IconAction({ label, keys, onClick, tour }: {
  label: string
  keys?: string[]
  onClick: () => void
  tour?: string
}) {
  const [hovered, setHovered] = useState(false)
  // native title은 웹뷰에서 가리키는 것과 상관없이 화면 구석에 뜹니다.
  // docs/desktop-updates.md의 금지 목록에 있는 그것입니다.
  return (
    // 오른쪽 끝으로 미는 건 Tip 바깥에서 합니다 — Tip은 자기 안에서
    // inline-flex 한 칸이라, 그 안의 margin:auto는 아무 데도 안 밉니다.
    <span style={{ marginLeft: 'auto', flexShrink: 0, display: 'flex' }}>
    <Tip label={label} keys={keys}>
    <button
      onClick={onClick}
      data-tour={tour}
      aria-label={label}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 30, height: 30, padding: 0,
        borderRadius: 'var(--r2)', border: 'none', cursor: 'pointer',
        color: hovered ? 'var(--sb-t1)' : 'var(--sb-t2)',
        background: hovered ? 'var(--sb-hover)' : 'transparent',
        transition: 'background .1s, color .1s', flexShrink: 0,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Icon name="search" size={16} />
    </button>
    </Tip>
    </span>
  )
}

function PaneTab({ icon, label, active, count = 0, onClick, tour }: {
  icon: IconName; label: string; active: boolean; count?: number; onClick: () => void
  tour?: string
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      data-tour={tour}
      aria-label={label}
      aria-pressed={active}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, position: 'relative',
        height: 30, padding: active ? '0 11px 0 9px' : '0 8px',
        borderRadius: 'var(--r2)', border: 'none', cursor: 'pointer',
        fontFamily: 'var(--font)', fontSize: 14, fontWeight: active ? 600 : 500,
        color: active ? 'var(--sb-t1)' : 'var(--sb-t2)',
        background: active ? 'var(--sb-active)' : hovered ? 'var(--sb-hover)' : 'transparent',
        transition: 'background .1s, color .1s',
        /**
         * 이름이 붙어 있는 건 켜진 탭 하나뿐이라, 줄이 넘칠 때 줄어들 수
         * 있는 것도 그 하나입니다. 셋 다 안 줄어들게 두었더니 사이드바를
         * 좁히는 순간 맨 오른쪽 돋보기가 밖으로 밀려 잘렸습니다.
         */
        flexShrink: active ? 1 : 0,
        minWidth: 0,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ display: 'flex', position: 'relative' }}>
        <Icon name={icon} size={16} />
        {count > 0 && !active && (
          <span style={{
            position: 'absolute', top: -5, right: -7,
            minWidth: 15, height: 15, padding: '0 4px',
            borderRadius: 999, background: 'var(--danger)', color: '#fff',
            fontSize: 9, fontWeight: 700, lineHeight: '15px', textAlign: 'center',
            boxShadow: '0 0 0 2px var(--sb-bg)',
          }}>{count > 99 ? '99+' : count}</span>
        )}
      </span>
      {active && (
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
      )}
      {active && count > 0 && (
        <span style={{
          minWidth: 17, padding: '0 5px', height: 16, borderRadius: 999,
          background: 'var(--danger)', color: '#fff',
          fontSize: 10, fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>{count > 99 ? '99+' : count}</span>
      )}
    </button>
  )
}

