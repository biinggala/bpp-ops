import { useEffect } from 'react'
import { useUiStore } from '../store/uiStore'
import { useTaskStore } from '../store/taskStore'
import { Sidebar } from '../components/layout/Sidebar'
import { Topbar } from '../components/layout/Topbar'
import { ViewBar } from '../components/layout/ViewBar'
import { TableView } from '../components/views/table'
import { BoardView } from '../components/views/board'
import { CalendarView } from '../components/views/calendar'
import { StatsView } from '../components/views/stats'
import { TaskModal } from '../components/modals/TaskModal'
import { DetailPanel } from '../components/modals/DetailPanel'
import { Toast } from '../components/shared/Toast'

export function AppPage() {
  const view = useUiStore(s => s.view)
  const subscribeFirebase = useTaskStore(s => s.subscribeFirebase)

  useEffect(() => {
    const unsub = subscribeFirebase()
    return unsub
  }, [])

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Topbar />
        <ViewBar />

        {/* View content */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {view === 't' && <TableView />}
          {view === 'b' && <BoardView />}
          {view === 'c' && <CalendarView />}
          {view === 's' && <StatsView />}
          {(view === 'p' || view === 'g') && (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-[14px]">
              준비 중...
            </div>
          )}
        </div>
      </div>

      {/* Overlays */}
      <TaskModal />
      <DetailPanel />
      <Toast />
    </div>
  )
}
