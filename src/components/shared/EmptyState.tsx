import { useUiStore } from '../../store/uiStore'
import { useSpaceStore } from '../../store/spaceStore'

export function EmptyState() {
  const { openTaskModal } = useUiStore()
  const { spaces } = useSpaceStore()
  const hasSpaces = spaces.length > 0

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="text-[48px] select-none">📋</div>

      {!hasSpaces ? (
        <>
          <div>
            <div className="text-[18px] font-bold text-gray-800 mb-2">시작해볼까요?</div>
            <div className="text-[13px] text-gray-400 leading-relaxed">
              왼쪽 사이드바에서 <strong>스페이스</strong>를 먼저 만들어보세요.<br />
              스페이스는 팀의 업무 카테고리입니다.
            </div>
          </div>
          <div className="flex items-center gap-3 text-[12px] text-gray-400">
            <Step n={1} label="사이드바 하단 '스페이스 추가' 클릭" />
            <Arrow />
            <Step n={2} label="스페이스 이름 입력" />
            <Arrow />
            <Step n={3} label="Add Task로 업무 추가" />
          </div>
        </>
      ) : (
        <>
          <div>
            <div className="text-[18px] font-bold text-gray-800 mb-2">업무가 없어요</div>
            <div className="text-[13px] text-gray-400">첫 번째 업무를 추가해보세요</div>
          </div>
          <button
            onClick={() => openTaskModal()}
            className="flex items-center gap-2 px-[20px] py-[10px] rounded-[10px] bg-[#007aff] text-white text-[13px] font-semibold border-none cursor-pointer hover:bg-[#0066d6] transition-colors shadow-[0_2px_12px_rgba(0,122,255,.3)]"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 1v10M1 6h10" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
            업무 추가
          </button>
        </>
      )}
    </div>
  )
}

function Step({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="w-7 h-7 rounded-full bg-[rgba(0,122,255,.1)] text-[#007aff] text-[12px] font-bold flex items-center justify-center">
        {n}
      </div>
      <div className="text-[11px] text-gray-500 max-w-[100px] leading-snug">{label}</div>
    </div>
  )
}

function Arrow() {
  return <div className="text-gray-300 text-[18px] mb-5">→</div>
}
