import React, { useEffect, useRef, useState } from 'react'
import { useUiStore } from '../store/uiStore'
import { useTaskStore } from '../store/taskStore'
import { useSpaceStore } from '../store/spaceStore'
import { useProjectStore } from '../store/projectStore'
import { useMilestoneStore } from '../store/milestoneStore'
import { useAuthStore } from '../store/authStore'
import { usePresenceStore } from '../store/presenceStore'
import { useUserProfileStore } from '../store/userProfileStore'
import { useSyncStore } from '../store/syncStore'
import { useOrgStore } from '../store/orgStore'
import { parseInviteToken } from '../lib/paths'
import { useMobile } from '../hooks/useMobile'
import type { Project } from '../types'
import { Sidebar } from '../components/layout/Sidebar'
import { Topbar } from '../components/layout/Topbar'
import { ViewBar } from '../components/layout/ViewBar'
import { TableView } from '../components/views/table'
import { BoardView } from '../components/views/board'
import { CalendarView } from '../components/views/calendar'
import { StatsView } from '../components/views/stats'
import { FilesView } from '../components/views/files'
import { GanttView } from '../components/views/gantt'
import { TodayView } from '../components/views/today'
import { TaskModal } from '../components/modals/TaskModal'
import { TaskDetailModal } from '../components/modals/TaskDetailModal'
import { CommandPalette } from '../components/modals/CommandPalette'
import { EmptyState } from '../components/shared/EmptyState'
import { LoadingRows } from '../components/shared/Loading'
import { Toast } from '../components/shared/Toast'
import { NoticeToast } from '../components/layout/NoticeToast'
import { setNoticeReporter } from '../lib/notify'
import { useToast } from '../components/shared/Toast'

class TaskDetailErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch(err: Error, info: React.ErrorInfo) {
    console.error('[TaskDetail crash]', err, info)
  }
  render() {
    if (this.state.hasError) return null
    return this.props.children
  }
}

export function AppPage() {
  const isMobile = useMobile()
  const view = useUiStore(s => s.view)
  const screen = useUiStore(s => s.screen)
  const tasks = useTaskStore(s => s.tasks)
  const subscribeWorkspace = useSyncStore(s => s.subscribe)
  const ready = useSyncStore(s => s.ready)
  const sidebarHidden = useUiStore(s => s.sidebarHidden)
  const joinProject = useProjectStore(s => s.joinProject)
  const invites = useProjectStore(s => s.invites)
  const projects = useProjectStore(s => s.projects)
  const setProject = useUiStore(s => s.setProject)
  const [invitePending, setInvitePending] = useState<{ project: Project } | null>(null)
  const dismissedInvites = useRef(new Set<string>())
  // Read invite code once at mount; sessionStorage is cleared immediately to avoid replay on refresh
  const pendingInviteRef = useRef((() => {
    const code = sessionStorage.getItem('pending_invite')
    if (code) sessionStorage.removeItem('pending_invite')
    return code
  })())
  const openCommandPalette = useUiStore(s => s.openCommandPalette)
  const isTaskModalOpen = useUiStore(s => s.isTaskModalOpen)
  const undo = useTaskStore(s => s.undo)
  const { uid, memberKey, displayName, email } = useAuthStore()
  const detailTaskId = useUiStore(s => s.detailTaskId)
  const subscribePresence = usePresenceStore(s => s.subscribe)

  // Everything the workspace reads hangs off the signed-in account now: the
  // project list is per-user, and so is the invite inbox.
  useEffect(() => {
    if (!uid) return
    return subscribeWorkspace(uid, email ?? null)
  }, [uid, email])

  // 조직 — 회의실 목록이 사는 곳. 도메인으로 찾으므로 이메일만 있으면 됩니다.
  const subscribeOrg = useOrgStore(s => s.subscribe)
  useEffect(() => {
    if (!email) return
    return subscribeOrg(email)
  }, [email, subscribeOrg])

  useEffect(() => {
    if (!uid) return
    const presenceKey = memberKey ?? uid
    const name = displayName ?? email?.split('@')[0] ?? uid
    const unsub = subscribePresence(uid, presenceKey, name)
    return unsub
  }, [uid])

  // Invite link. The token carries the project id as well as the code, because
  // a non-member cannot search the project list to find which project a bare
  // code belongs to.
  useEffect(() => {
    if (!uid || !pendingInviteRef.current) return
    const token = pendingInviteRef.current
    pendingInviteRef.current = null
    const parsed = parseInviteToken(token)
    if (!parsed) return
    let cancelled = false
    joinProject(parsed.projectId, parsed.inviteCode).then(joined => {
      if (joined && !cancelled) setProject(parsed.projectId)
    })
    return () => { cancelled = true }
  }, [uid])

  // Invitations waiting in my inbox, for people invited by address rather than
  // by link. The project itself stays unreadable until the invite is accepted,
  // so the name shown here is the copy stored with the invitation.
  useEffect(() => {
    if (invitePending) return
    const entry = Object.entries(invites).find(([pid]) =>
      !projects.some(p => p.id === pid) && !dismissedInvites.current.has(pid)
    )
    if (!entry) return
    const [pid, invite] = entry
    setInvitePending({ project: { id: pid, name: invite.name || '초대받은 프로젝트', color: '#2383E2', inviteCode: invite.code } })
  }, [invites, projects, invitePending])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName
      const isEditing = tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement as HTMLElement)?.isContentEditable

      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (!isTaskModalOpen) openCommandPalette()
      }

      /**
       * ⌘\ — 노션과 같은 키입니다. 다른 걸 고르면 새로 외워야 합니다.
       *
       * `e.code`로도 봅니다. 한글 입력 상태에서 이 자리를 누르면 브라우저가
       * 주는 글자가 `\`가 아니라 `₩`입니다 — 글자만 보면 한글로 타이핑하다
       * 누른 사람에게는 단축키가 없는 것과 같습니다. `code`는 자판의 자리를
       * 말하므로 입력기와 무관합니다.
       */
      if ((e.metaKey || e.ctrlKey) && (e.key === '\\' || e.key === '₩' || e.code === 'Backslash')) {
        e.preventDefault()
        useUiStore.getState().toggleSidebarHidden()
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !isEditing) {
        e.preventDefault()
        undo()
      }
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [isTaskModalOpen, openCommandPalette, undo])

  // 다 오기 전에는 비어 있다고 말하지 않습니다 — 아직 안 온 것뿐입니다.
  const isEmpty = ready && tasks.length === 0 && view !== 's' && view !== 'g'

  // Notices are invisible to the person who sends them — both the ones that
  // land and the ones that do not. The toast is where both are said.
  useEffect(() => {
    setNoticeReporter(message => useToast.getState().show(message))
  }, [])

  return (
    <div className="flex h-full overflow-hidden">
      {/* 폰에서는 서랍이라 늘 있어야 합니다 — 없으면 열 것이 없습니다. */}
      {(isMobile || !sidebarHidden) && <Sidebar />}

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Topbar />
        {!isMobile && screen === 'work' && <ViewBar />}
        {/* 캘린더 화면은 뷰 탭 없이 거르개만. ViewBar 주석 참고. */}
        {!isMobile && screen === 'calendar' && <ViewBar filtersOnly />}

        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {screen === 'today' ? (
            <TodayView />
          ) : !ready ? (
            <LoadingRows />
          ) : screen === 'calendar' ? (
            /* 범위 없는 캘린더. 뷰 탭의 캘린더와 같은 화면을 그리지만,
               걸린 필터가 없어서 보이는 것이 곧 내 앞의 전부입니다. */
            <CalendarView />
          ) : isEmpty ? (
            <EmptyState />
          ) : (
            <>
              {view === 't' && <TableView />}
              {view === 'b' && <BoardView />}
              {view === 'c' && <CalendarView />}
              {view === 'g' && <GanttView />}
              {view === 's' && <StatsView />}
              {view === 'f' && <FilesView />}
            </>
          )}
        </div>

        {/* Bottom tab nav — in normal flow so iOS PWA viewport quirks can't float it */}
        {isMobile && <ViewBar />}
      </div>

      <TaskModal />
      <TaskDetailErrorBoundary key={detailTaskId ?? 'none'}>
        <TaskDetailModal />
      </TaskDetailErrorBoundary>
      <CommandPalette />
      <Toast />
      <NoticeToast />

      {invitePending && (
        <InviteAcceptModal
          project={invitePending.project}
          onAccept={() => {
            void joinProject(invitePending.project.id, invitePending.project.inviteCode ?? '')
              .then(joined => { if (joined) setProject(invitePending.project.id) })
            setInvitePending(null)
          }}
          onDecline={() => {
            dismissedInvites.current.add(invitePending.project.id)
            setInvitePending(null)
          }}
        />
      )}
    </div>
  )
}

function InviteAcceptModal({ project, onAccept, onDecline }: {
  project: Project
  onAccept: () => void
  onDecline: () => void
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 20000, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r4)', padding: '32px 28px', width: 360, boxShadow: '0 12px 48px rgba(0,0,0,.45)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
        {/* Project icon */}
        <div style={{ width: 48, height: 48, borderRadius: 12, background: project.color, marginBottom: 18 }} />
        <div style={{ fontSize: 13, color: 'var(--t3)', marginBottom: 6 }}>프로젝트 초대</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--t1)', marginBottom: 8, textAlign: 'center' }}>
          {project.name}
        </div>
        <div style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 28, textAlign: 'center', lineHeight: 1.6 }}>
          이 프로젝트에 초대되었습니다.<br />참여를 수락하시겠어요?
        </div>
        <div style={{ display: 'flex', gap: 10, width: '100%' }}>
          <button
            onClick={onDecline}
            style={{ flex: 1, padding: '10px 0', borderRadius: 'var(--r2)', border: '1px solid var(--bd)', background: 'transparent', fontSize: 13, fontWeight: 500, color: 'var(--t2)', cursor: 'pointer', fontFamily: 'var(--font)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            거절
          </button>
          <button
            onClick={onAccept}
            style={{ flex: 2, padding: '10px 0', borderRadius: 'var(--r2)', border: 'none', background: 'var(--ac)', fontSize: 13, fontWeight: 600, color: '#fff', cursor: 'pointer', fontFamily: 'var(--font)' }}
            onMouseEnter={e => e.currentTarget.style.opacity = '.9'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          >
            참여 수락
          </button>
        </div>
      </div>
    </div>
  )
}
