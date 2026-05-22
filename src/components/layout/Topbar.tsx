import { useUiStore } from '../../store/uiStore'
import { useAuthStore } from '../../store/authStore'
import { Avatar } from '../shared/Avatar'
import type { MemberKey } from '../../types'

export function Topbar() {
  const { space, openTaskModal, setColorSettings } = useUiStore()
  const { memberKey } = useAuthStore()

  return (
    <div className="bg-white/85 backdrop-blur-[20px] saturate-180 border-b border-black/[.07] px-[16px] h-[48px] flex items-center gap-[8px] flex-shrink-0 shadow-[0_1px_0_rgba(0,0,0,.06)]">
      <div className="text-[15px] font-bold flex items-center gap-[7px]">
        <div className="w-[9px] h-[9px] rounded-full bg-[#007aff]" />
        <span>{space ?? '전체 업무'}</span>
      </div>
      <span className="text-[11px] text-gray-400 ml-1">크린지 프렌즈</span>

      <div className="ml-auto flex items-center gap-[6px]">
        <button
          onClick={() => openTaskModal()}
          className="inline-flex items-center gap-1 px-[11px] py-[5px] rounded-lg text-[11px] font-medium border border-black/[.12] bg-transparent text-gray-500 hover:bg-black/[.04] transition-colors cursor-pointer"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
          Add Task
        </button>

        <button
          onClick={() => setColorSettings(true)}
          className="inline-flex items-center gap-1 px-[9px] py-[5px] rounded-lg text-[11px] border border-black/[.12] bg-transparent text-gray-500 hover:bg-black/[.04] transition-colors cursor-pointer"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.3"/>
            <circle cx="4" cy="5" r="1" fill="currentColor"/>
            <circle cx="9" cy="5" r="1" fill="currentColor"/>
            <path d="M4 8.5c.7 1 4.3 1 5 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          색상
        </button>

        {memberKey && (
          <Avatar memberKey={memberKey as MemberKey} size={26} showName />
        )}
      </div>
    </div>
  )
}
