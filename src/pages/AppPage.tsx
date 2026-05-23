import { useEffect } from 'react'
import { useUiStore } from '../store/uiStore'
import { useTaskStore } from '../store/taskStore'
import { useSpaceStore } from '../store/spaceStore'
import { useProjectStore } from '../store/projectStore'
import { useMilestoneStore } from '../store/milestoneStore'
import { useAuthStore } from '../store/authStore'
import { usePresenceStore } from '../store/presenceStore'
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

export function AppPage() {
  const view = useUiStore(s => s.view)
  const tasks = useTaskStore(s => s.tasks)
  const subscribeFirebase = useTaskStore(s => s.subscribeFirebase)
  const subscribeSpaces = useSpaceStore(s => s.subscribeFirebase)
  const subscribeProjects = useProjectStore(s => s.subscribeFirebase)
  const subscribeMilestones = useMilestoneStore(s => s.subscribeFirebase)
  const openCommandPalette = useUiStore(s => s.openCommandPalette)
  const isTaskModalOpen = useUiStore(s => s.isTaskModalOpen)
  const undo = useTaskStore(s => s.undo)
  const { uid, memberKey, displayName, email } = useAuthStore()
  const subscribePresence = usePresenceStore(s => s.subscribe)

  useEffect(() => {
    const u1 = subscribeFirebase()
    const u2 = subscribeSpaces()
    const u3 = subscribeProjects()
    const u4 = subscribeMilestones()
    return () => { u1(); u2(); u3(); u4() }
  }, [])

  useEffect(() => {
    if (!uid) return
    const presenceKey = memberKey ?? uid
    const name = displayName ?? email?.split('@')[0] ?? uid
    const unsub = subscribePresence(uid, presenceKey, name)
    return unsub
  }, [uid])

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
      <TaskDetailModal />
      <CommandPalette />
      <Toast />
    </div>
  )
}
