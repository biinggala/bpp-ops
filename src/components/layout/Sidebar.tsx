import { useState, useRef, useEffect } from 'react'
import { useUiStore } from '../../store/uiStore'
import { useTaskStore } from '../../store/taskStore'
import { useSpaceStore } from '../../store/spaceStore'
import { useAuthStore } from '../../store/authStore'
import { Avatar } from '../shared/Avatar'
import { SPACE_PALETTE } from '../../types'
import type { MemberKey } from '../../types'

export function Sidebar() {
  const { space, setSpace, filters, setFilters } = useUiStore()
  const tasks = useTaskStore(s => s.tasks)
  const { spaces, addSpace, deleteSpace, updateSpace } = useSpaceStore()
  const { memberKey, signOutUser } = useAuthStore()

  const [addingSpace, setAddingSpace] = useState(false)
  const [newSpaceName, setNewSpaceName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const editRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (addingSpace) inputRef.current?.focus() }, [addingSpace])
  useEffect(() => { if (editingId) editRef.current?.focus() }, [editingId])

  const countFor = (spaceName: string | null) =>
    spaceName ? tasks.filter(t => t.cat === spaceName).length : tasks.length

  const handleAddSpace = () => {
    if (!newSpaceName.trim()) { setAddingSpace(false); return }
    addSpace(newSpaceName.trim())
    setNewSpaceName('')
    setAddingSpace(false)
  }

  const handleRename = (id: string) => {
    if (editName.trim()) updateSpace(id, { name: editName.trim() })
    setEditingId(null)
  }

  const handleDeleteSpace = (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation()
    if (!confirm(`"${name}" 스페이스를 삭제할까요? 해당 카테고리 업무도 영향받습니다.`)) return
    if (space === name) setSpace(null)
    deleteSpace(id)
  }

  return (
    <div className="w-[220px] bg-[#1c1c1e] flex flex-col flex-shrink-0 border-r border-white/[.06]">
      {/* Header */}
      <div className="px-[14px] py-[14px] flex items-center gap-[9px] border-b border-white/[.06]">
        <div className="w-7 h-7 rounded-[9px] bg-[#007aff] flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0">
          {memberKey ?? 'BPP'}
        </div>
        <div>
          <div className="text-[13px] font-semibold text-white">업무 보드</div>
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

        {/* 전체 */}
        <SbItem active={space === null} dot="#7c3aed" onClick={() => setSpace(null)} count={countFor(null)}>
          전체 업무
        </SbItem>

        {/* Dynamic spaces */}
        {spaces.map(s => (
          <div key={s.id} className="group/sb relative">
            {editingId === s.id ? (
              <div className="flex items-center gap-1 mx-[6px] my-[1px] px-[10px] py-[5px]">
                <div className="w-[6px] h-[6px] rounded-full flex-shrink-0" style={{ background: s.color }} />
                <input
                  ref={editRef}
                  className="flex-1 bg-white/[.1] text-white text-[11px] rounded px-2 py-[2px] outline-none border border-white/20"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onBlur={() => handleRename(s.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleRename(s.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                />
              </div>
            ) : (
              <SbSubItem
                active={space === s.name}
                dot={s.color}
                onClick={() => setSpace(s.name)}
                count={countFor(s.name)}
                onEdit={() => { setEditingId(s.id); setEditName(s.name) }}
                onDelete={e => handleDeleteSpace(e, s.id, s.name)}
              >
                {s.name}
              </SbSubItem>
            )}
          </div>
        ))}

        {/* Add space input */}
        {addingSpace ? (
          <div className="flex items-center gap-2 mx-[6px] my-[1px] px-[10px] py-[5px]">
            <div className="w-[6px] h-[6px] rounded-full bg-white/30 flex-shrink-0" />
            <input
              ref={inputRef}
              className="flex-1 bg-white/[.1] text-white text-[11px] rounded px-2 py-[2px] outline-none border border-white/20 placeholder:text-white/30"
              placeholder="스페이스 이름..."
              value={newSpaceName}
              onChange={e => setNewSpaceName(e.target.value)}
              onBlur={handleAddSpace}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAddSpace()
                if (e.key === 'Escape') { setAddingSpace(false); setNewSpaceName('') }
              }}
            />
          </div>
        ) : (
          <button
            onClick={() => setAddingSpace(true)}
            className="flex items-center gap-[7px] px-[10px] py-[5px] pl-[24px] w-full text-[11px] text-white/30 hover:text-white/60 cursor-pointer bg-transparent border-none mx-[6px] my-[1px] transition-colors rounded-[5px] hover:bg-white/[.04]"
          >
            <span className="text-[14px] leading-none">+</span> 스페이스 추가
          </button>
        )}
      </div>

      {/* Footer */}
      {memberKey && (
        <div className="mt-auto px-[8px] py-[10px] border-t border-white/[.07] flex items-center gap-2">
          <Avatar memberKey={memberKey as MemberKey} size={24} />
          <button
            onClick={() => signOutUser()}
            className="flex-1 py-[6px] bg-white/[.07] border-none rounded-[7px] text-white/50 text-[10px] font-medium cursor-pointer hover:bg-white/[.12] hover:text-white/80 transition-colors"
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
      <span className="ml-auto text-[10px] bg-white/[.1] px-[6px] py-[1px] rounded-lg text-white/35">{count}</span>
    </div>
  )
}

function SbSubItem({ children, active, dot, onClick, count, onEdit, onDelete }: {
  children: React.ReactNode; active: boolean; dot: string
  onClick: () => void; count: number
  onEdit: () => void; onDelete: (e: React.MouseEvent) => void
}) {
  return (
    <div
      onClick={onClick}
      className={`group flex items-center gap-[7px] px-[10px] py-[5px] pl-[24px] rounded-[5px] cursor-pointer text-[11px] mx-[6px] my-[1px] transition-all ${
        active ? 'bg-[rgba(0,122,255,.18)] text-[#93c5fd]' : 'text-white/40 hover:bg-white/[.06] hover:text-white/80'
      }`}
    >
      <div className="w-[6px] h-[6px] rounded-full flex-shrink-0" style={{ background: dot }} />
      <span className="flex-1 truncate">{children}</span>
      <span className="text-[10px] bg-white/[.1] px-[5px] py-[1px] rounded-lg text-white/35 group-hover:hidden">{count}</span>
      <div className="hidden group-hover:flex items-center gap-[2px]">
        <button
          onClick={e => { e.stopPropagation(); onEdit() }}
          className="text-[10px] text-white/30 hover:text-white/70 bg-transparent border-none cursor-pointer px-1 rounded"
        >✏</button>
        <button
          onClick={onDelete}
          className="text-[10px] text-white/30 hover:text-red-400 bg-transparent border-none cursor-pointer px-1 rounded"
        >✕</button>
      </div>
    </div>
  )
}
