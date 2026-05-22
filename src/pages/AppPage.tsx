import { useEffect } from 'react'
import { useUiStore } from '../store/uiStore'
import { useTaskStore } from '../store/taskStore'
import { useSpaceStore } from '../store/spaceStore'
import { useProjectStore } from '../store/projectStore'
import { useMilestoneStore } from '../store/milestoneStore'
import { Sidebar } from '../components/layout/Sidebar'
import { Topbar } from '../components/layout/Topbar'
import { ViewBar } from '../components/layout/ViewBar'
import { TableView } from '../components/views/table'
import { BoardView } from '../components/views/board'
import { CalendarView } from '../components/views/calendar'
import { StatsView } from '../components/views/stats'
import { GanttView } from '../components/views/gantt'
import { ProjectView } from '../components/views/project'
import { TaskModal } from '../components/modals/TaskModal'
import { DetailPanel } from '../components/modals/DetailPanel'
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

  useEffect(() => {
    const u1 = subscribeFirebase()
    const u2 = subscribeSpaces()
    const u3 = subscribeProjects()
    const u4 = subscribeMilestones()
    return () => { u1(); u2(); u3(); u4() }
  }, [])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (!isTaskModalOpen) openCommandPalette()
      }
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [isTaskModalOpen, openCommandPalette])

  const isEmpty = tasks.length === 0 && view !== 's' && view !== 'g' && view !== 'p'

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
              {view === 'p' && <ProjectView />}
            </>
          )}
        </div>
      </div>

      <TaskModal />
      <DetailPanel />
      <CommandPalette />
      <Toast />
    </div>
  )
}
