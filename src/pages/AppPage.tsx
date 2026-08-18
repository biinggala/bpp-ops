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
import { parseInviteToken } from '../lib/paths'
import { useMobile } from '../hooks/useMobile'
import type { Project } from '../types'
import { Sidebar } from '../components/layout/Sidebar'
import { Topbar } from '../components/layout/Topbar'
import { ViewBar } from '../components/layout/ViewBar'
import { TableView } from '../components/views/table'
import { BoardView } from '../components/views/board'
import { CalendarView } from '../components/views/calendar'
import { TimelineView } from '../components/views/timeline'
import { StatsView } from '../components/views/stats'
import { GanttView } from '../components/views/gantt'
import { TaskModal } from '../components/modals/TaskModal'
import { TaskDetailModal } from '../components/modals/TaskDetailModal'
import { CommandPalette } from '../components/modals/CommandPalette'
import { EmptyState } from '../components/shared/EmptyState'
import { Toast } from '../components/shared/Toast'

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
  const tasks = useTaskStore(s => s.tasks)
  const subscribeWorkspace = useSyncStore(s => s.subscribe)
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

      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !isEditing) {
        e.preventDefault()
        undo()
      }
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [isTaskModalOpen, openCommandPalette, undo])

  const isEmpty = tasks.length === 0 && view !== 's' && view !== 'g'

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Topbar />
        {!isMobile && <ViewBar />}

        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {isEmpty ? (
            <EmptyState />
          ) : (
            <>
              {view === 't' && <TableView />}
              {view === 'b' && <BoardView />}
              {view === 'c' && <CalendarView />}
              {view === 'l' && <TimelineView />}
              {view === 'g' && <GanttView />}
              {view === 's' && <StatsView />}
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
