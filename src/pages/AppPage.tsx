import { useEffect } from 'react'
import { useUiStore } from '../store/uiStore'
import { useTaskStore } from '../store/taskStore'
import { useSpaceStore } from '../store/spaceStore'
import { Sidebar } from '../components/layout/Sidebar'
import { Topbar } from '../components/layout/Topbar'
import { ViewBar } from '../components/layout/ViewBar'
import { TableView } from '../components/views/table'
import { BoardView } from '../components/views/board'
import { CalendarView } from '../components/views/calendar'
import { StatsView } from '../components/views/stats'
import { GanttView } from '../components/views/gantt'
import { TaskModal } from '../components/modals/TaskModal'
import { DetailPanel } from '../components/modals/DetailPanel'
import { EmptyState } from '../components/shared/EmptyState'
import { Toast } from '../components/shared/Toast'

export function AppPage() {
  const view = useUiStore(s => s.view)
  const tasks = useTaskStore(s => s.tasks)
  const subscribeFirebase = useTaskStore(s => s.subscribeFirebase)
  const subscribeSpaces = useSpaceStore(s => s.subscribeFirebase)

  useEffect(() => {
    const u1 = subscribeFirebase()
    const u2 = subscribeSpaces()
    return () => { u1(); u2() }
  }, [])

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
              {view === 'p' && (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t3)', fontSize: 14 }}>
                  준비 중...
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <TaskModal />
      <DetailPanel />
      <Toast />
    </div>
  )
}
