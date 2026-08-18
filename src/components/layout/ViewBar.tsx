import React from 'react'
import { useUiStore } from '../../store/uiStore'
import { useTaskStore } from '../../store/taskStore'
import { useMembers } from '../../store/memberStore'
import type { ViewType, Status } from '../../types'
import { STATUS_LIST } from '../../types'

const VIEWS: { id: ViewType; label: string }[] = [
  { id: 't', label: '리스트' },
  { id: 'b', label: '보드' },
  { id: 'c', label: '캘린더' },
  { id: 'g', label: '간트' },
  { id: 's', label: '통계' },
]

export function ViewBar() {
  const { view, setView, filters, setFilters, resetFilters } = useUiStore()
  const allTasks = useTaskStore(s => s.tasks)
  const members = useMembers()
  const allTagOptions = React.useMemo(() => {
    const s = new Set<string>()
    allTasks.forEach(t => t.tags?.forEach(tag => s.add(tag)))
    return Array.from(s).sort()
  }, [allTasks])
  const hasFilters = filters.assignees.length > 0 || filters.statuses.length > 0 || filters.tags.length > 0
  const showFilters = !['c', 's'].includes(view)

  return (
    <div style={{
      height: 44,
      background: 'var(--bg)',
      borderBottom: '1px solid var(--bd)',
      padding: '0 20px',
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      flexShrink: 0,
      overflowX: 'auto',
    }}>
      {VIEWS.map((v, i) => (
        <React.Fragment key={v.id}>
          {(i === 3 || i === 4) && <Divider />}
          <ViewTab active={view === v.id} onClick={() => setView(v.id)}>
            {v.label}
          </ViewTab>
        </React.Fragment>
      ))}

      {showFilters && (
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {members.length > 0 && (
            <MultiSelect
              label="담당자"
              options={members.map(m => ({ value: m.key, label: m.name }))}
              selected={filters.assignees}
              onChange={v => setFilters({ assignees: v })}
            />
          )}
          <MultiSelect
            label="상태"
            options={STATUS_LIST.map(s => ({ value: s, label: s }))}
            selected={filters.statuses}
            onChange={v => setFilters({ statuses: v as Status[] })}
          />
          {allTagOptions.length > 0 && (
            <MultiSelect
              label="태그"
              options={allTagOptions.map(t => ({ value: t, label: `#${t}` }))}
              selected={filters.tags}
              onChange={v => setFilters({ tags: v })}
            />
          )}
          {hasFilters && (
            <button
              onClick={resetFilters}
              style={{ padding: '3px 9px', borderRadius: 'var(--r1)', border: '1px solid rgba(239,68,68,.25)', background: 'rgba(239,68,68,.05)', color: '#dc2626', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font)' }}
            >
              ✕ 초기화
            </button>
          )}
          <select
            value={filters.sort}
            onChange={e => setFilters({ sort: e.target.value as 'due_asc' | 'due_desc' | 'default' })}
            style={{ padding: '4px 8px', borderRadius: 'var(--r1)', border: '1px solid var(--bd)', background: 'transparent', fontSize: 13, color: 'var(--t2)', outline: 'none', cursor: 'pointer', fontFamily: 'var(--font)' }}
          >
            <option value="due_asc">마감 가까운 순</option>
            <option value="due_desc">마감 먼 순</option>
            <option value="default">기본 순서</option>
          </select>
        </div>
      )}
    </div>
  )
}

function ViewTab({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', padding: '4px 12px',
        borderRadius: 'var(--r1)', fontSize: 14, fontWeight: active ? 500 : 400,
        cursor: 'pointer', border: 'none', whiteSpace: 'nowrap',
        background: 'transparent', fontFamily: 'var(--font)',
        color: active ? 'var(--ac)' : 'var(--t2)',
        borderBottom: active ? '2px solid var(--ac)' : '2px solid transparent',
        transition: 'color .1s',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'var(--t1)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'var(--t2)' }}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <div style={{ width: 1, height: 16, background: 'var(--bd)', margin: '0 4px', flexShrink: 0 }} />
}

function MultiSelect<T extends string>({ label, options, selected, onChange }: {
  label: string; options: { value: T; label: string }[]; selected: T[]; onChange: (v: T[]) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [pos, setPos] = React.useState({ top: 0, left: 0 })
  const ref = React.useRef<HTMLDivElement>(null)
  const btnRef = React.useRef<HTMLButtonElement>(null)
  const active = selected.length > 0

  React.useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const toggle = (v: T) =>
    onChange(selected.includes(v) ? selected.filter(s => s !== v) : [...selected, v])

  const handleOpen = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left })
    }
    setOpen(o => !o)
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block', flexShrink: 0 }}>
      <button
        ref={btnRef}
        onClick={handleOpen}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '4px 10px', borderRadius: 'var(--r1)',
          border: active ? '1px solid var(--ac)' : '1px solid var(--bd)',
          background: active ? 'var(--ac-l)' : 'transparent',
          color: active ? 'var(--ac)' : 'var(--t2)',
          fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font)',
          whiteSpace: 'nowrap',
        }}
      >
        {active ? `${label} (${selected.length})` : label}
        <span style={{ fontSize: 9, opacity: .5 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'fixed', top: pos.top, left: pos.left,
          background: 'var(--bg)', border: '1px solid var(--bd)',
          borderRadius: 'var(--r3)', boxShadow: 'var(--sh-md)',
          zIndex: 9000, minWidth: 160, padding: '4px 0',
        }}>
          {options.map(opt => (
            <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', fontSize: 13, color: 'var(--t1)', cursor: 'pointer', transition: 'background .08s' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <input type="checkbox" checked={selected.includes(opt.value)} onChange={() => toggle(opt.value)} style={{ accentColor: 'var(--ac)', width: 13, height: 13, cursor: 'pointer', flexShrink: 0 }} />
              {opt.label}
            </label>
          ))}
          {selected.length > 0 && (
            <>
              <div style={{ height: 1, background: 'var(--bd)', margin: '3px 0' }} />
              <button onClick={() => { onChange([]); setOpen(false) }} style={{ width: '100%', padding: '6px 12px', fontSize: 12, color: 'var(--ac)', cursor: 'pointer', border: 'none', background: 'transparent', textAlign: 'left', fontFamily: 'var(--font)' }}>
                전체 해제
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
