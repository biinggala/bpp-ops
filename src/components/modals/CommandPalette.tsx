import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useUiStore } from '../../store/uiStore'
import { useTaskStore } from '../../store/taskStore'
import { useSpaceStore } from '../../store/spaceStore'
import { useProjectStore } from '../../store/projectStore'
import type { ViewType } from '../../types'

const VIEW_META: { id: ViewType; icon: string; label: string }[] = [
  { id: 't', icon: '≡', label: '리스트 뷰' },
  { id: 'b', icon: '⬛', label: '보드 뷰' },
  { id: 'c', icon: '📅', label: '캘린더 뷰' },
  { id: 'g', icon: '📊', label: '간트 차트' },
  { id: 's', icon: '📈', label: '통계' },
]

function fuzzy(str: string, q: string): boolean {
  if (!q) return true
  const s = str.toLowerCase()
  const query = q.toLowerCase()
  let si = 0
  for (let qi = 0; qi < query.length; qi++) {
    const idx = s.indexOf(query[qi], si)
    if (idx === -1) return false
    si = idx + 1
  }
  return true
}

type Item = {
  id: string
  kind: 'action' | 'task' | 'space' | 'project'
  icon: string
  label: string
  sub?: string
  hint?: string
  accentColor?: string
  onSelect: () => void
}

export function CommandPalette() {
  const {
    isCommandPaletteOpen, closeCommandPalette,
    openTaskModal, setView, setSpace, setProject, setDetailTaskId,
  } = useUiStore()
  const tasks = useTaskStore(s => s.tasks)
  const spaces = useSpaceStore(s => s.spaces)
  const projects = useProjectStore(s => s.projects)

  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isCommandPaletteOpen) {
      setQuery('')
      setSelectedIdx(0)
      setTimeout(() => inputRef.current?.focus(), 20)
    }
  }, [isCommandPaletteOpen])

  useEffect(() => { setSelectedIdx(0) }, [query])

  const items: Item[] = useMemo(() => {
    const q = query.trim()
    const result: Item[] = []

    if (!q) {
      result.push({
        id: 'new-task', kind: 'action', icon: '+', label: '새 업무 추가', hint: 'N',
        onSelect: () => { openTaskModal(); closeCommandPalette() },
      })
      VIEW_META.forEach(v => result.push({
        id: `view-${v.id}`, kind: 'action', icon: v.icon, label: v.label,
        onSelect: () => { setView(v.id); closeCommandPalette() },
      }))
    }

    tasks
      .filter(t => fuzzy(t.name, q) || fuzzy(t.cat, q))
      .slice(0, 8)
      .forEach(t => result.push({
        id: t.id, kind: 'task', icon: '📝', label: t.name,
        sub: [t.cat, t.due].filter(Boolean).join(' · '),
        onSelect: () => { setDetailTaskId(t.id); closeCommandPalette() },
      }))

    spaces
      .filter(s => fuzzy(s.name, q))
      .forEach(s => result.push({
        id: s.id, kind: 'space', icon: '●', label: s.name, hint: '스페이스로 이동',
        accentColor: s.color,
        onSelect: () => { setSpace(s.name); closeCommandPalette() },
      }))

    projects
      .filter(p => fuzzy(p.name, q))
      .forEach(p => result.push({
        id: p.id, kind: 'project', icon: '🗂', label: p.name, hint: '프로젝트로 이동',
        accentColor: p.color,
        onSelect: () => { setProject(p.id); closeCommandPalette() },
      }))

    return result
  }, [query, tasks, spaces, projects])

  const execute = useCallback(() => {
    items[selectedIdx]?.onSelect()
  }, [items, selectedIdx])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!isCommandPaletteOpen) return
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, items.length - 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)) }
      else if (e.key === 'Enter') { e.preventDefault(); execute() }
      else if (e.key === 'Escape') closeCommandPalette()
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [isCommandPaletteOpen, items.length, execute])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${selectedIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIdx])

  if (!isCommandPaletteOpen) return null

  // Group items for section headers
  const groups: { label: string; startIdx: number; items: Item[] }[] = []
  const actions = items.filter(i => i.kind === 'action')
  const taskItems = items.filter(i => i.kind === 'task')
  const spaceItems = items.filter(i => i.kind === 'space')
  const projectItems = items.filter(i => i.kind === 'project')

  let cursor = 0
  if (actions.length) { groups.push({ label: '빠른 실행', startIdx: cursor, items: actions }); cursor += actions.length }
  if (taskItems.length) { groups.push({ label: '업무', startIdx: cursor, items: taskItems }); cursor += taskItems.length }
  if (spaceItems.length) { groups.push({ label: '스페이스', startIdx: cursor, items: spaceItems }); cursor += spaceItems.length }
  if (projectItems.length) { groups.push({ label: '프로젝트', startIdx: cursor, items: projectItems }); cursor += projectItems.length }

  return (
    <>
      <div
        onClick={closeCommandPalette}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 200, backdropFilter: 'blur(4px)' }}
      />
      <div style={{
        position: 'fixed', top: '14vh', left: '50%', transform: 'translateX(-50%)',
        width: 580, maxHeight: '66vh',
        background: 'var(--bg)', borderRadius: 'var(--r4)',
        boxShadow: '0 32px 80px rgba(0,0,0,.32), 0 0 0 1px var(--bd)',
        zIndex: 201, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>

        {/* Search row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
          <span style={{ fontSize: 15, color: 'var(--t3)', lineHeight: 1, flexShrink: 0, fontWeight: 400 }}>⌘</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="업무, 스페이스, 프로젝트 검색..."
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 14, background: 'transparent', color: 'var(--t1)', fontFamily: 'var(--font)' }}
          />
          {query ? (
            <button
              onClick={() => setQuery('')}
              style={{ border: 'none', background: 'var(--bg3)', color: 'var(--t3)', cursor: 'pointer', fontSize: 12, borderRadius: 4, width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontFamily: 'var(--font)' }}
            >✕</button>
          ) : (
            <kbd style={kbdStyle}>ESC</kbd>
          )}
        </div>

        {/* Result list */}
        <div ref={listRef} style={{ overflowY: 'auto', flex: 1 }}>
          {items.length === 0 && (
            <div style={{ padding: '36px 16px', textAlign: 'center', fontSize: 13, color: 'var(--t3)' }}>
              결과 없음
            </div>
          )}

          {groups.map(group => (
            <div key={group.label}>
              <div style={{ padding: '8px 16px 2px', fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>
                {group.label}
              </div>
              {group.items.map((item, i) => {
                const absIdx = group.startIdx + i
                const isSelected = absIdx === selectedIdx
                return (
                  <div
                    key={item.id}
                    data-idx={absIdx}
                    onClick={item.onSelect}
                    onMouseEnter={() => setSelectedIdx(absIdx)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '7px 16px',
                      cursor: 'pointer',
                      background: isSelected ? 'var(--bg3)' : 'transparent',
                      transition: 'background .06s',
                    }}
                  >
                    <span style={{
                      width: 28, height: 28, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      borderRadius: 6, fontSize: 13,
                      background: item.accentColor ? item.accentColor + '18' : 'var(--bg2)',
                      color: item.kind === 'space' ? item.accentColor : 'var(--t2)',
                    }}>
                      {item.icon}
                    </span>

                    <span style={{ fontSize: 13, color: 'var(--t1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.label}
                    </span>

                    {item.sub && (
                      <span style={{ fontSize: 11, color: 'var(--t3)', flexShrink: 0 }}>{item.sub}</span>
                    )}

                    {item.hint && !item.sub && (
                      <span style={{ fontSize: 11, color: 'var(--t3)', flexShrink: 0 }}>{item.hint}</span>
                    )}

                    {isSelected && (
                      <kbd style={{ ...kbdStyle, opacity: .6, flexShrink: 0, marginLeft: 4 }}>↵</kbd>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: '6px 14px', borderTop: '1px solid var(--bd)', display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0 }}>
          <FooterHint keys={['↑', '↓']} label="이동" />
          <FooterHint keys={['↵']} label="선택" />
          <FooterHint keys={['ESC']} label="닫기" />
        </div>
      </div>
    </>
  )
}

const kbdStyle: React.CSSProperties = {
  fontSize: 10, color: 'var(--t3)',
  background: 'var(--bg2)', border: '1px solid var(--bd)',
  borderRadius: 4, padding: '2px 5px',
}

function FooterHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--t3)' }}>
      {keys.map(k => <kbd key={k} style={kbdStyle}>{k}</kbd>)}
      <span>{label}</span>
    </div>
  )
}
