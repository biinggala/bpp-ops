import { useUiStore } from '../../store/uiStore'
import { useTaskStore } from '../../store/taskStore'
import { useAuthStore } from '../../store/authStore'
import { CATEGORIES } from '../../types'
import type { Category } from '../../types'

const CAT_DOT: Record<Category, string> = {
  Strategy:       '#f59e0b',
  Production:     '#ef4444',
  'Internal Ops': '#10b981',
  'Biz Dev':      '#06b6d4',
  Branding:       '#8b5cf6',
  Analytics:      '#3730a3',
  Community:      '#166534',
}

export function Sidebar() {
  const { space, setSpace, filters, setFilters } = useUiStore()
  const tasks = useTaskStore(s => s.tasks)
  const { memberKey, signOutUser } = useAuthStore()

  const countFor = (cat: Category | null) =>
    cat ? tasks.filter(t => t.cat === cat).length : tasks.length

  return (
    <div className="w-[220px] bg-[#1c1c1e] flex flex-col flex-shrink-0 border-r border-white/[.06]">
      {/* Header */}
      <div className="px-[14px] py-[14px] flex items-center gap-[9px] border-b border-white/[.06]">
        <div className="w-7 h-7 rounded-[9px] bg-[#007aff] flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0">
          CU
        </div>
        <div>
          <div className="text-[13px] font-semibold text-white">크린지 프렌즈</div>
          <div className="text-[9px] text-white/35 tracking-[.5px]">WORKSPACE</div>
        </div>
      </div>

      {/* Search */}
      <div className="px-[10px] py-[8px]">
        <input
          className="w-full bg-white/[.07] border border-white/[.1] rounded-[5px] px-[9px] py-[6px] text-[11px] text-white/70 outline-none placeholder:text-white/28"
          placeholder="🔍  검색..."
          value={filters.search}
          onChange={e => setFilters({ search: e.target.value })}
        />
      </div>

      {/* Nav */}
      <div className="px-[6px] overflow-y-auto flex-1">
        <div className="px-[6px] pt-[10px] pb-[3px] text-[9px] font-semibold text-white/22 tracking-[1px] uppercase">
          Spaces
        </div>

        <SbItem
          active={space === null}
          dot="#7c3aed"
          onClick={() => setSpace(null)}
          count={countFor(null)}
        >
          전체 업무
        </SbItem>

        {CATEGORIES.map(cat => (
          <SbSubItem
            key={cat}
            active={space === cat}
            dot={CAT_DOT[cat]}
            onClick={() => setSpace(cat)}
            count={countFor(cat)}
          >
            {cat}
          </SbSubItem>
        ))}
      </div>

      {/* Footer */}
      {memberKey && (
        <div className="mt-auto px-[8px] py-[10px] border-t border-white/[.07]">
          <button
            onClick={() => signOutUser()}
            className="w-full py-[8px] bg-[#007aff] border-none rounded-[8px] text-white text-[11px] font-semibold cursor-pointer hover:bg-[#0066d6] transition-colors"
          >
            로그아웃
          </button>
        </div>
      )}
    </div>
  )
}

function SbItem({ children, active, dot, onClick, count }: {
  children: React.ReactNode; active: boolean; dot: string
  onClick: () => void; count: number
}) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-[7px] px-[10px] py-[6px] rounded-[5px] cursor-pointer text-[12px] mx-[6px] my-[1px] transition-all ${
        active ? 'bg-[rgba(0,122,255,.25)] text-[#93c5fd]' : 'text-white/50 hover:bg-white/[.08] hover:text-white/90'
      }`}
    >
      <div className="w-[7px] h-[7px] rounded-full flex-shrink-0" style={{ background: dot }} />
      {children}
      <span className="ml-auto text-[10px] bg-white/[.1] px-[6px] py-[1px] rounded-lg text-white/35">
        {count}
      </span>
    </div>
  )
}

function SbSubItem({ children, active, dot, onClick, count }: {
  children: React.ReactNode; active: boolean; dot: string
  onClick: () => void; count: number
}) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-[7px] px-[10px] py-[5px] pl-[24px] rounded-[5px] cursor-pointer text-[11px] mx-[6px] my-[1px] transition-all ${
        active ? 'bg-[rgba(0,122,255,.18)] text-[#93c5fd]' : 'text-white/40 hover:bg-white/[.06] hover:text-white/80'
      }`}
    >
      <div className="w-[6px] h-[6px] rounded-full flex-shrink-0" style={{ background: dot }} />
      {children}
      <span className="ml-auto text-[10px] bg-white/[.1] px-[6px] py-[1px] rounded-lg text-white/35">
        {count}
      </span>
    </div>
  )
}
