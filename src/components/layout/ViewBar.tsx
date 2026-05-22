import React from 'react'
import { useUiStore } from '../../store/uiStore'
import { useSpaceStore } from '../../store/spaceStore'
import type { ViewType, Status, MemberKey } from '../../types'
import { STATUS_LIST } from '../../types'

const VIEWS: { id: ViewType; label: string }[] = [
  { id: 't', label: 'List' },
  { id: 'b', label: 'Board' },
  { id: 'c', label: 'Calendar' },
  { id: 'p', label: '담당자' },
  { id: 'g', label: 'Gantt' },
  { id: 's', label: '통계' },
]

const MEMBERS_FILTER: { key: MemberKey; label: string }[] = [
  { key: 'YL', label: '이연주' },
  { key: 'SJ', label: '정세운' },
  { key: 'HC', label: '최희건' },
]

export function ViewBar() {
  const { view, setView, filters, setFilters, resetFilters } = useUiStore()
  const spaces = useSpaceStore(s => s.spaces)

  const hasFilters = filters.assignees.length > 0 || filters.statuses.length > 0
  const showFilters = !['c', 's'].includes(view)

  return (
    <div className="bg-white/75 backdrop-blur-[16px] border-b border-black/[.07] px-[14px] h-[40px] flex items-center gap-[2px] flex-shrink-0 overflow-x-auto z-[100]">
      {VIEWS.map((v, i) => (
        <div key={v.id} className="flex items-center">
          {i === 3 && <div className="w-px h-[18px] bg-gray-200 mx-1 flex-shrink-0" />}
          {i === 5 && <div className="w-px h-[18px] bg-gray-200 mx-1 flex-shrink-0" />}
          <button
            onClick={() => setView(v.id)}
            className={`flex items-center gap-1 px-[10px] py-[4px] text-[12px] font-medium cursor-pointer whitespace-nowrap transition-all border-none bg-transparent ${
              view === v.id
                ? 'text-[#007aff] border-b-2 border-[#007aff] rounded-none pb-[2px]'
                : 'text-gray-500 rounded-[5px] hover:bg-black/[.04] hover:text-gray-800'
            }`}
          >
            {v.label}
          </button>
        </div>
      ))}

      {showFilters && (
        <div className="ml-auto flex items-center gap-[5px] flex-shrink-0">
          {spaces.length > 0 && (
            <MultiSelect
              label="카테고리"
              options={spaces.map(s => ({ value: s.name, label: s.name }))}
              selected={filters.assignees.length > 0 ? [] : []}  // space filter is in sidebar
              onChange={() => {}}
            />
          )}

          <MultiSelect
            label="담당자"
            options={MEMBERS_FILTER.map(m => ({ value: m.key, label: m.label }))}
            selected={filters.assignees}
            onChange={v => setFilters({ assignees: v as MemberKey[] })}
          />

          <MultiSelect
            label="상태"
            options={STATUS_LIST.map(s => ({ value: s, label: s }))}
            selected={filters.statuses}
            onChange={v => setFilters({ statuses: v as Status[] })}
          />

          {hasFilters && (
            <button
              onClick={resetFilters}
              className="px-[9px] py-[4px] text-[11px] rounded-lg border border-red-200/60 text-red-500 bg-red-50/80 cursor-pointer hover:bg-red-100 transition-colors"
            >
              ✕ 필터 해제
            </button>
          )}

          <select
            value={filters.sort}
            onChange={e => setFilters({ sort: e.target.value as 'due_asc' | 'due_desc' | 'default' })}
            className="px-[10px] py-[5px] rounded-lg border border-black/[.12] bg-white/80 text-[11px] text-gray-500 outline-none cursor-pointer"
          >
            <option value="due_asc">마감일 ↑</option>
            <option value="due_desc">마감일 ↓</option>
            <option value="default">기본 순서</option>
          </select>
        </div>
      )}
    </div>
  )
}

function MultiSelect<T extends string>({
  label, options, selected, onChange,
}: {
  label: string
  options: { value: T; label: string }[]
  selected: T[]
  onChange: (v: T[]) => void
}) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  const active = selected.length > 0

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (options.length === 0) return null

  const toggle = (v: T) => {
    onChange(selected.includes(v) ? selected.filter(s => s !== v) : [...selected, v])
  }

  return (
    <div ref={ref} className="relative inline-block flex-shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-[5px] px-[10px] py-[5px] rounded-lg text-[11px] border cursor-pointer font-medium transition-all whitespace-nowrap ${
          active
            ? 'border-[#007aff] text-[#007aff] bg-[rgba(0,122,255,.08)]'
            : 'border-black/[.12] text-gray-500 bg-white/80 hover:bg-gray-50'
        }`}
      >
        {active ? `${label} (${selected.length})` : label}
        <span className="text-[8px] opacity-50 ml-1">▾</span>
      </button>

      {open && (
        <div className="absolute top-[calc(100%+4px)] left-0 bg-white border border-black/[.08] rounded-xl shadow-[0_6px_28px_rgba(0,0,0,.12)] z-[300] min-w-[160px] py-[6px] max-h-[260px] overflow-y-auto">
          {options.map(opt => (
            <label
              key={opt.value}
              className="flex items-center gap-[8px] px-[14px] py-[7px] text-[12px] text-gray-800 cursor-pointer hover:bg-[rgba(0,122,255,.05)] transition-colors"
            >
              <input
                type="checkbox"
                checked={selected.includes(opt.value)}
                onChange={() => toggle(opt.value)}
                className="accent-[#007aff] w-[13px] h-[13px] flex-shrink-0 cursor-pointer"
              />
              {opt.label}
            </label>
          ))}
          {selected.length > 0 && (
            <>
              <div className="h-px bg-gray-100 my-1" />
              <button
                onClick={() => onChange([])}
                className="w-full flex items-center justify-center px-[14px] py-[7px] text-[11px] text-[#007aff] font-semibold cursor-pointer hover:bg-[rgba(0,122,255,.05)] transition-colors"
              >
                전체 해제
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
