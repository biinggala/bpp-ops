import React, { useEffect, useRef, useState } from 'react'
import { useUiStore } from '../store/uiStore'
import { useTaskStore } from '../store/taskStore'
import { useSpaceStore } from '../store/spaceStore'
import { useProjectStore } from '../store/projectStore'
import { useMilestoneStore } from '../store/milestoneStore'
import { useAuthStore } from '../store/authStore'
import { usePresenceStore } from '../store/presenceStore'
import { useUserProfileStore } from '../store/userProfileStore'
import type { Project } from '../types'
import { Sidebar } from '../components/layout/Sidebar'
import { Topbar } from '../components/layout/Topbar'
import { ViewBar } from '../components/layout/ViewBar'
import { TableView } from '../components/views/table'
import { BoardView } from '../components/views/board'
import { CalendarView } from '../components/views/calendar'
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
  const view = useUiStore(s => s.view)
  const tasks = useTaskStore(s => s.tasks)
  const subscribeFirebase = useTaskStore(s => s.subscribeFirebase)
  const subscribeSpaces = useSpaceStore(s => s.subscribeFirebase)
  const subscribeProjects = useProjectStore(s => s.subscribeFirebase)
  const subscribeMilestones = useMilestoneStore(s => s.subscribeFirebase)
  const findByInvite = useProjectStore(s => s.findByInvite)
  const acceptInvite = useProjectStore(s => s.acceptInvite)
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
  const subscribeProfiles = useUserProfileStore(s => s.subscribe)

  useEffect(() => {
    const u1 = subscribeFirebase()
    const u2 = subscribeSpaces()
    const u3 = subscribeProjects()
    const u4 = subscribeMilestones()
    const u5 = subscribeProfiles()
    return () => { u1(); u2(); u3(); u4(); u5() }
  }, [])

  useEffect(() => {
    if (!uid) return
    const presenceKey = memberKey ?? uid
    const name = displayName ?? email?.split('@')[0] ?? uid
    const unsub = subscribePresence(uid, presenceKey, name)
    return unsub
  }, [uid])

  // Process pending invite from URL link
  useEffect(() => {
    if (!uid || !email || !pendingInviteRef.current) return
    const code = pendingInviteRef.current
    const targetProject = projects.find(p => p.inviteCode === code)
    if (!targetProject) return  // Not loaded from Firebase yet — wait for next sync

    const result = findByInvite(code, email)
    pendingInviteRef.current = null

    if (!result) return  // Not invited
    if (result.status === 'active') {
      setProject(result.project.id)
    } else {
      setInvitePending({ project: result.project })
    }
  }, [uid, email, projects])

  // Auto-detect pending invites from Firebase (no link needed)
  useEffect(() => {
    if (!email || invitePending) return
    const normalizedEmail = email.toLowerCase()
    const pending = projects.find(p =>
      p.pendingEmails?.some(e => e.toLowerCase() === normalizedEmail) &&
      !dismissedInvites.current.has(p.id)
    )
    if (pending) setInvitePending({ project: pending })
  }, [email, projects, invitePending])

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
        <ViewBar />

        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {isEmpty ? (
            <EmptyState />
          ) : (
            <>
              {view === 't' && <TableView />}
              {view === 'b' && <BoardView />}
              {view === 'c' && <CalendarView />}
              {view === 'g' && <GanttView />}
              {view === 's' && <StatsView />}
            </>
          )}
        </div>
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
            if (email) acceptInvite(invitePending.project.id, email)
            setProject(invitePending.project.id)
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
