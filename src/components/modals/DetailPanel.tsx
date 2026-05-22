import { useUiStore } from '../../store/uiStore'
import { useTaskStore } from '../../store/taskStore'
import { CategoryBadge, StatusBadge, PriorityBadge, TypeBadge } from '../shared/Badge'
import { AssigneeGroup } from '../shared/Avatar'
import { ProgressBar } from '../shared/ProgressBar'
import { fmtDate } from '../../lib/utils'

export function DetailPanel() {
  const { detailTaskId, setDetailTaskId, openTaskModal } = useUiStore()
  const { tasks, deleteTask, updateTask } = useTaskStore()

  const task = detailTaskId ? tasks.find(t => t.id === detailTaskId) : null

  if (!task) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/22 z-[90] backdrop-blur-[2px]"
        onClick={() => setDetailTaskId(null)}
      />

      {/* Panel */}
      <div className="fixed top-0 right-0 w-[460px] h-screen bg-[rgba(247,247,249,.97)] backdrop-blur-[40px] border-l border-black/[.08] shadow-[-6px_0_40px_rgba(0,0,0,.1)] z-[91] flex flex-col">
        {/* Header */}
        <div className="px-[20px] pt-[18px] pb-[14px] border-b border-black/[.07] bg-white/50 flex items-start gap-[10px]">
          <h2 className="text-[15px] font-bold text-gray-900 leading-[1.45] flex-1">{task.name}</h2>
          <button onClick={() => setDetailTaskId(null)} className="w-[28px] h-[28px] rounded-lg border-none bg-transparent cursor-pointer text-gray-400 text-[20px] flex items-center justify-center hover:bg-gray-100 flex-shrink-0">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-[20px] py-[18px] flex flex-col gap-0">
          <Row label="유형"><TypeBadge type={task.type} /></Row>
          <Row label="카테고리"><CategoryBadge cat={task.cat} /></Row>
          <Row label="상태"><StatusBadge status={task.status} /></Row>
          <Row label="우선순위"><PriorityBadge priority={task.priority} /></Row>
          <Row label="담당자"><AssigneeGroup assignee={task.assignee} size={24} /></Row>
          <Row label="기간">
            <span className="text-[12px] text-gray-700">
              {task.start ? fmtDate(task.start) : '–'} ~ {task.due ? fmtDate(task.due) : '–'}
            </span>
          </Row>
          <Row label="진행률">
            <div className="flex-1">
              <ProgressBar value={task.progress} height={7} />
            </div>
          </Row>
          {task.memo && (
            <Row label="메모">
              <div className="text-[12px] text-gray-600 leading-[1.65] whitespace-pre-wrap bg-white/80 rounded-lg p-[10px] w-full border border-[#ede9fe]">
                {task.memo}
              </div>
            </Row>
          )}
        </div>

        {/* Footer */}
        <div className="px-[20px] py-[14px] border-t border-black/[.07] bg-white/40 flex gap-[8px]">
          <button
            onClick={() => { openTaskModal(task.id); setDetailTaskId(null) }}
            className="flex-1 py-[8px] rounded-[8px] bg-[#007aff] text-white text-[12px] font-semibold border-none cursor-pointer hover:bg-[#0066d6]"
          >
            수정
          </button>
          <button
            onClick={() => {
              if (!confirm('삭제할까요?')) return
              deleteTask(task.id)
              setDetailTaskId(null)
            }}
            className="px-[14px] py-[8px] rounded-[8px] border border-red-200 text-red-500 text-[12px] bg-transparent cursor-pointer hover:bg-red-50"
          >
            삭제
          </button>
        </div>
      </div>
    </>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-[10px] mb-[12px] pb-[12px] border-b border-black/[.06] last:border-b-0 last:mb-0 last:pb-0">
      <div className="text-[10px] font-bold text-gray-400 w-[68px] flex-shrink-0 pt-[3px] tracking-[.4px] uppercase">{label}</div>
      <div className="text-[12px] text-gray-800 flex-1 flex items-center flex-wrap gap-[5px]">{children}</div>
    </div>
  )
}
